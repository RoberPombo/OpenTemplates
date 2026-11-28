//! Proxy propio del preview (opción D de `docs/preview-viabilidad.md`).
//!
//! Listener HTTP en `127.0.0.1` efímero, sin dependencias nuevas. Reenvía al
//! origen upstream **fijo** validado (solo loopback, sin credenciales, sin
//! seguir redirecciones fuera de loopback ni hacia otro puerto) e inyecta un
//! script del selector en respuestas `text/html`. No es un relay arbitrario:
//! toda petición exige token de sesión + Host correcto + origen loopback; el
//! contenido remoto no puede invocar IPC de Tauri; la CSP de la app no cambia.
//!
//! `SessionFileTicket` (diálogo nativo) sigue intacto; aquí se replica su
//! patrón con `PreviewProxyTicket` (un solo uso + TTL + origen ligado) y un
//! token de sesión obligatorio en el listener. Ver `docs/seguridad.md`.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::Duration;

use serde::Serialize;

use crate::preview::{Target, connect, host_header, parse_target, validate_preview_host};

const SELECTOR_JS: &str = include_str!("preview-selector.js");
const SOURCE_NAME: &str = "opentemplates-preview-selector";
const PROXY_PREFIX: &str = "/__ot__";
const COOKIE_NAME: &str = "ot_preview";
const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_REQUEST_BODY: usize = 1024 * 1024;
const MAX_RESPONSE_BODY: usize = 16 * 1024 * 1024;
const IO_TIMEOUT: Duration = Duration::from_secs(5);

/// Cabeceras hop-by-hop que no se reenvían (RFC 7230).
const HOP_BY_HOP: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
];

/// Cabeceras upstream que no se reenvían tal cual al iframe.
const STRIP_RESPONSE_HEADERS: &[&str] = &[
    "connection",
    "keep-alive",
    "transfer-encoding",
    "content-length",
    "x-frame-options",
    "content-security-policy-report-only",
];

/// TTL del ticket de activación, mismo orden que `SESSION_TICKET_TTL`.
pub const PREVIEW_TICKET_TTL: Duration = Duration::from_secs(5 * 60);

/// Origen canónico upstream (`scheme://host:port`) para ligar el ticket.
pub fn canonical_origin(target: &Target) -> String {
    upstream_origin(target)
}

/// Ticket de activación de un solo uso, mismo patrón que `SessionFileTicket`.
#[derive(Debug, Clone)]
pub struct PreviewProxyTicket {
    pub origin: String,
    pub expires_at: std::time::SystemTime,
}

/// Sesión de proxy activa.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PreviewProxySession {
    /// URL del iframe: entra una vez con token; luego cookie HttpOnly.
    pub base_url: String,
    /// Token de sesión obligatorio en el listener (no se persiste).
    pub token: String,
    /// Origen del proxy (`http://127.0.0.1:<puerto>`), para validar `postMessage`.
    pub proxy_origin: String,
    /// Nonce por sesión inyectado, para validar `postMessage`.
    pub nonce: String,
}

pub struct PreviewProxy {
    session: PreviewProxySession,
    addr: SocketAddr,
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

impl PreviewProxy {
    pub fn session(&self) -> PreviewProxySession {
        self.session.clone()
    }

    /// Para el listener, cierra conexiones y limpia; idempotente.
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Despertar `accept`.
        let _ = TcpStream::connect(self.addr);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

struct Shared {
    token: String,
    nonce: String,
    app_origin: String,
    proxy_origin: String,
    upstream: Target,
    upstream_origin: String,
    host_header_expected: String,
    stop: Arc<AtomicBool>,
}

fn random_hex() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

fn upstream_origin(target: &Target) -> String {
    let scheme = if target.tls { "https" } else { "http" };
    format!("{scheme}://{}", host_header(target))
}

fn validate_app_origin(app_origin: &str) -> Result<String, String> {
    let value = app_origin.trim();
    if value.is_empty() {
        return Err("Origen de la app no válido.".to_string());
    }
    // Origen serializado `scheme://host[:port]`, sin credenciales ni ruta.
    if value.contains('@') || value.contains(' ') || value.chars().any(|c| c.is_control()) {
        return Err("Origen de la app no válido.".to_string());
    }
    Ok(value.to_string())
}

/// Levanta el proxy. `upstream_raw` se valida como en `preview_probe`
/// (http(s), sin credenciales, solo loopback, sin espacios). Revalida loopback
/// tras DNS en cada petición (anti rebinding) con `connect`.
pub fn start_proxy(upstream_raw: &str, app_origin: &str) -> Result<PreviewProxy, String> {
    let upstream = parse_target(upstream_raw)?;
    validate_preview_host(&upstream.host)?;
    let app_origin = validate_app_origin(app_origin)?;

    // Comprobación temprana de que upstream es loopback tras DNS y responde.
    drop(connect(&upstream)?);

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("No se pudo abrir el proxy local: {error}"))?;
    let addr = listener
        .local_addr()
        .map_err(|error| format!("No se pudo leer el puerto del proxy: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("No se pudo configurar el proxy local: {error}"))?;

    let token = random_hex();
    let nonce = random_hex();
    let proxy_origin = format!("http://127.0.0.1:{}", addr.port());
    let stop = Arc::new(AtomicBool::new(false));

    let shared = Arc::new(Shared {
        token: token.clone(),
        nonce: nonce.clone(),
        app_origin,
        proxy_origin: proxy_origin.clone(),
        upstream_origin: upstream_origin(&upstream),
        upstream,
        host_header_expected: format!("127.0.0.1:{}", addr.port()),
        stop: stop.clone(),
    });

    let thread_shared = shared.clone();
    let join = std::thread::spawn(move || serve(listener, thread_shared));

    let original_path = shared.upstream.path.clone();
    let base_url = format!(
        "{proxy_origin}{PROXY_PREFIX}/enter?token={token}&to={}",
        percent_encode_path(&original_path)
    );

    Ok(PreviewProxy {
        session: PreviewProxySession {
            base_url,
            token,
            proxy_origin,
            nonce,
        },
        addr,
        stop,
        join: Some(join),
    })
}

fn serve(listener: TcpListener, shared: Arc<Shared>) {
    while !shared.stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => {
                let shared = shared.clone();
                std::thread::spawn(move || handle_conn(stream, shared));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(5));
            }
            Err(_) => {
                if shared.stop.load(Ordering::SeqCst) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }
}

fn handle_conn(mut stream: TcpStream, shared: Arc<Shared>) {
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
    let request = match read_request(&mut stream) {
        Ok(request) => request,
        Err(_) => {
            let response = text_response(400, "Bad Request", "Petición no válida.");
            let _ = write_response(&mut stream, &response);
            return;
        }
    };
    let response = handle_request(&request, &shared);
    let _ = write_response(&mut stream, &response);
}

#[derive(Debug, Default, Clone)]
pub struct Request {
    pub method: String,
    pub target: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

pub struct Response {
    pub status: u16,
    pub reason: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

fn header<'a>(req: &'a Request, name: &str) -> Option<&'a str> {
    let name = name.to_ascii_lowercase();
    req.headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(&name))
        .map(|(_, value)| value.as_str())
}

fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    let header_end;
    loop {
        if let Some(index) = find_subslice(&buffer, b"\r\n\r\n") {
            header_end = index + 4;
            break;
        }
        if buffer.len() > MAX_HEADER_BYTES {
            return Err("Cabeceras demasiado grandes.".to_string());
        }
        match stream.read(&mut chunk) {
            Ok(0) => return Err("Conexión cerrada.".to_string()),
            Ok(read) => buffer.extend_from_slice(&chunk[..read]),
            Err(error) => return Err(format!("No se pudo leer: {error}")),
        }
    }

    let head = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let target = parts.next().unwrap_or_default().to_string();
    if method.is_empty() || target.is_empty() {
        return Err("Línea de petición no válida.".to_string());
    }

    let mut headers = Vec::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.push((name.trim().to_string(), value.trim().to_string()));
        }
    }

    let content_length = headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > MAX_REQUEST_BODY {
        return Err("Cuerpo demasiado grande.".to_string());
    }

    let mut body = buffer[header_end..].to_vec();
    while body.len() < content_length {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => body.extend_from_slice(&chunk[..read]),
            Err(error) => return Err(format!("No se pudo leer el cuerpo: {error}")),
        }
    }
    body.truncate(content_length);

    Ok(Request {
        method,
        target,
        headers,
        body,
    })
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn write_response(stream: &mut TcpStream, response: &Response) -> std::io::Result<()> {
    let mut out = format!("HTTP/1.1 {} {}\r\n", response.status, response.reason);
    let mut has_length = false;
    for (name, value) in &response.headers {
        if name.eq_ignore_ascii_case("content-length") {
            has_length = true;
        }
        out.push_str(&format!("{name}: {value}\r\n"));
    }
    if !has_length {
        out.push_str(&format!("Content-Length: {}\r\n", response.body.len()));
    }
    out.push_str("Connection: close\r\n\r\n");
    stream.write_all(out.as_bytes())?;
    stream.write_all(&response.body)?;
    stream.flush()
}

fn text_response(status: u16, reason: &str, message: &str) -> Response {
    Response {
        status,
        reason: reason.to_string(),
        headers: vec![
            (
                "Content-Type".to_string(),
                "text/plain; charset=utf-8".to_string(),
            ),
            ("X-Content-Type-Options".to_string(), "nosniff".to_string()),
        ],
        body: message.as_bytes().to_vec(),
    }
}

/// Sanea el request-target: solo origin-form; sin `..`, sin `//host`, sin
/// esquema, sin backslash ni control; quita nuestro parámetro `__ot_token`.
pub fn sanitize_proxy_target(raw: &str) -> Result<String, String> {
    let value = raw.trim();
    if value.is_empty() {
        return Err("Ruta vacía.".to_string());
    }
    if value.chars().any(|c| c.is_control()) {
        return Err("Ruta no válida.".to_string());
    }
    if value.contains('\\') {
        return Err("Ruta no válida.".to_string());
    }
    // absolute-form (`http://host/...`) o authority-form no permitidos.
    let lower = value.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return Err("No se permite authority en la ruta.".to_string());
    }
    if value.starts_with("//") {
        return Err("No se permite authority en la ruta.".to_string());
    }

    let (path, query) = match value.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (value, None),
    };
    // Quitar fragmento si llega.
    let path = path.split('#').next().unwrap_or("");
    let path = if path.is_empty() { "/" } else { path };

    // Normalizar `.`/`..` sin permitir escapar del origen.
    let mut segments: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            segment => {
                // Rechazar `..` también codificado (`%2e%2e`, `%2E%2E`, mixto).
                let decoded = percent_decode(segment);
                if decoded == ".." {
                    return Err("Ruta no válida (`..`).".to_string());
                }
                if decoded == "." {
                    continue;
                }
                segments.push(segment);
            }
        }
    }
    let normalized_path = format!("/{}", segments.join("/"));
    // Conservar barra final si la ponía.
    let normalized_path = if path.ends_with('/') && normalized_path != "/" {
        format!("{normalized_path}/")
    } else {
        normalized_path
    };

    // No permitir que `__ot__` del usuario colisione con nuestros recursos.
    if normalized_path == PROXY_PREFIX || normalized_path.starts_with(&format!("{PROXY_PREFIX}/")) {
        return Err("Ruta reservada.".to_string());
    }

    let clean_query = query
        .map(|q| {
            q.split('&')
                .filter(|pair| {
                    !pair.is_empty()
                        && !pair.eq_ignore_ascii_case("__ot_token")
                        && !pair.starts_with("__ot_token=")
                        && !pair.eq_ignore_ascii_case("__ot_token")
                })
                .collect::<Vec<_>>()
                .join("&")
        })
        .unwrap_or_default();

    Ok(if clean_query.is_empty() {
        normalized_path
    } else {
        format!("{normalized_path}?{clean_query}")
    })
}

fn percent_encode_path(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'/' | b'-' | b'_' | b'.' | b'~' | b'?' | b'=' | b'&' | b'%'
            )
        {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn percent_encode_query(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn query_param(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
        if name.eq_ignore_ascii_case(key) {
            return Some(percent_decode(value));
        }
    }
    None
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn token_ok(req: &Request, shared: &Shared, query: &str) -> bool {
    if let Some(query_token) = query_param(query, "__ot_token")
        && constant_time_eq(query_token.as_bytes(), shared.token.as_bytes())
    {
        return true;
    }
    if let Some(cookie) = header(req, "cookie") {
        for part in cookie.split(';') {
            let part = part.trim();
            if let Some((name, value)) = part.split_once('=')
                && name.trim() == COOKIE_NAME
                && constant_time_eq(value.trim().as_bytes(), shared.token.as_bytes())
            {
                return true;
            }
        }
    }
    false
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn strip_cookie(req: &Request, name: &str) -> Option<String> {
    let cookie = header(req, "cookie")?;
    let parts: Vec<String> = cookie
        .split(';')
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty() && p.split_once('=').map(|(n, _)| n.trim()) != Some(name))
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("; "))
    }
}

/// Petición proxied: valida seguridad y reenvía al upstream fijo.
fn handle_request(req: &Request, shared: &Shared) -> Response {
    // Host check anti DNS-rebinding: solo el listener loopback exacto.
    let host = header(req, "host").unwrap_or_default();
    if !host.eq_ignore_ascii_case(&shared.host_header_expected) {
        return text_response(400, "Bad Request", "Host no permitido.");
    }

    let (raw_path, raw_query) = match req.target.split_once('?') {
        Some((path, query)) => (path, query),
        None => (req.target.as_str(), ""),
    };
    let raw_path = raw_path.split('#').next().unwrap_or("");

    // Recursos propios del proxy.
    if raw_path == format!("{PROXY_PREFIX}/selector.js") {
        if req.method != "GET" || !token_ok(req, shared, raw_query) {
            return text_response(403, "Forbidden", "Token no válido.");
        }
        return Response {
            status: 200,
            reason: "OK".to_string(),
            headers: vec![
                (
                    "Content-Type".to_string(),
                    "application/javascript; charset=utf-8".to_string(),
                ),
                ("X-Content-Type-Options".to_string(), "nosniff".to_string()),
                ("Cache-Control".to_string(), "no-store".to_string()),
            ],
            body: SELECTOR_JS.as_bytes().to_vec(),
        };
    }

    if raw_path == format!("{PROXY_PREFIX}/enter") {
        if req.method != "GET" || !token_ok(req, shared, raw_query) {
            return text_response(403, "Forbidden", "Token no válido.");
        }
        let to = query_param(raw_query, "to").unwrap_or_else(|| "/".to_string());
        let location = match sanitize_proxy_target(&to) {
            Ok(target) => target,
            Err(_) => "/".to_string(),
        };
        return Response {
            status: 302,
            reason: "Found".to_string(),
            headers: vec![
                ("Location".to_string(), location),
                (
                    "Set-Cookie".to_string(),
                    format!(
                        "{COOKIE_NAME}={}; Path=/; HttpOnly; SameSite=Strict",
                        shared.token
                    ),
                ),
                ("Cache-Control".to_string(), "no-store".to_string()),
            ],
            body: Vec::new(),
        };
    }

    if raw_path == PROXY_PREFIX || raw_path.starts_with(&format!("{PROXY_PREFIX}/")) {
        return text_response(404, "Not Found", "Recurso no encontrado.");
    }

    // Token obligatorio en el listener.
    if !token_ok(req, shared, raw_query) {
        return text_response(403, "Forbidden", "Token no válido.");
    }

    // Ruta saneada hacia el upstream fijo.
    let target = match sanitize_proxy_target(&req.target) {
        Ok(target) => target,
        Err(_) => return text_response(400, "Bad Request", "Ruta no válida."),
    };

    match proxy_upstream(req, &target, shared) {
        Ok(response) => response,
        Err(error) => text_response(502, "Bad Gateway", &error),
    }
}

fn proxy_upstream(req: &Request, target: &str, shared: &Shared) -> Result<Response, String> {
    let mut upstream = shared.upstream.clone();
    // Fijar upstream: solo se cambia path+query; host/esquema no.
    let (path, query) = match target.split_once('?') {
        Some((path, query)) => (path.to_string(), query.to_string()),
        None => (target.to_string(), String::new()),
    };
    upstream.path = if query.is_empty() {
        path
    } else {
        format!("{path}?{query}")
    };

    let mut stream = connect(&upstream)?;
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));

    let mut request = format!(
        "{} {} HTTP/1.1\r\nHost: {}\r\n",
        req.method,
        upstream.path,
        host_header(&upstream)
    );
    for (name, value) in &req.headers {
        let lower = name.to_ascii_lowercase();
        if HOP_BY_HOP.contains(&lower.as_str()) {
            continue;
        }
        // No reenviar nuestra cookie de proxy ni `Origin`/`Referer` al upstream.
        if lower == "origin" || lower == "referer" {
            continue;
        }
        // Forzar identity upstream: re-servimos reescrito, sin compresión.
        if lower == "accept-encoding" {
            continue;
        }
        if lower == "cookie" {
            if let Some(stripped) = strip_cookie(req, COOKIE_NAME) {
                request.push_str(&format!("Cookie: {stripped}\r\n"));
            }
            continue;
        }
        request.push_str(&format!("{name}: {value}\r\n"));
    }
    request.push_str(&format!("Content-Length: {}\r\n", req.body.len()));
    request.push_str("Connection: close\r\n\r\n");

    stream
        .write_all(request.as_bytes())
        .and_then(|_| stream.write_all(&req.body))
        .map_err(|error| format!("No se pudo enviar la petición upstream: {error}"))?;

    let mut buffer = Vec::new();
    let mut chunk = [0u8; 16384];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                buffer.extend_from_slice(&chunk[..read]);
                if buffer.len() > MAX_RESPONSE_BODY + MAX_HEADER_BYTES {
                    buffer.truncate(MAX_RESPONSE_BODY + MAX_HEADER_BYTES);
                    break;
                }
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut =>
            {
                if !buffer.is_empty() {
                    break;
                }
                return Err("El servidor no respondió a tiempo.".to_string());
            }
            Err(error) => {
                if !buffer.is_empty() {
                    break;
                }
                return Err(format!("Se cortó la conexión upstream: {error}"));
            }
        }
    }

    parse_upstream_response(&buffer, shared, target)
}

fn parse_upstream_response(
    buffer: &[u8],
    shared: &Shared,
    _target: &str,
) -> Result<Response, String> {
    let (head_bytes, body_start) = match buffer.windows(4).position(|w| w == b"\r\n\r\n") {
        Some(index) => (&buffer[..index], index + 4),
        None => match buffer.windows(2).position(|w| w == b"\n\n") {
            Some(index) => (&buffer[..index], index + 2),
            None => return Err("La respuesta upstream no es HTTP.".to_string()),
        },
    };
    let head = String::from_utf8_lossy(head_bytes).to_string();
    let mut lines = head.lines();
    let status_line = lines.next().unwrap_or_default();
    let mut parts = status_line.split_whitespace();
    let _version = parts.next();
    let status = parts
        .next()
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| "La respuesta upstream no es HTTP.".to_string())?;
    let reason = parts.collect::<Vec<_>>().join(" ");

    let mut headers = Vec::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.push((name.trim().to_string(), value.trim().to_string()));
        }
    }

    let body_bytes = &buffer[body_start.min(buffer.len())..];
    let mut body = body_bytes.to_vec();

    let chunked = headers.iter().any(|(name, value)| {
        name.eq_ignore_ascii_case("transfer-encoding")
            && value.to_ascii_lowercase().contains("chunked")
    });
    if chunked {
        body = dechunk(&body);
    } else if let Some(length) = headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.parse::<usize>().ok())
    {
        body.truncate(length);
    }
    if body.len() > MAX_RESPONSE_BODY {
        body.truncate(MAX_RESPONSE_BODY);
    }

    // Re-servir: filtrar cabeceras, reescribir Location/Set-Cookie, ajustar CSP.
    let content_type = headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("content-type"))
        .map(|(_, value)| value.clone())
        .unwrap_or_default();
    let content_encoded = headers.iter().any(|(name, value)| {
        name.eq_ignore_ascii_case("content-encoding")
            && !value.trim().is_empty()
            && !value.eq_ignore_ascii_case("identity")
    });
    let is_html = content_type.to_ascii_lowercase().contains("text/html") && !content_encoded;

    let mut out_headers: Vec<(String, String)> = Vec::new();
    let mut set_cookies: Vec<String> = Vec::new();
    for (name, value) in headers {
        let lower = name.to_ascii_lowercase();
        if lower == "set-cookie" {
            set_cookies.push(value.clone());
            continue;
        }
        if STRIP_RESPONSE_HEADERS.contains(&lower.as_str()) {
            continue;
        }
        if lower == "content-security-policy" {
            if is_html {
                out_headers.push((name, adjust_csp(&value)));
            } else {
                out_headers.push((name, value));
            }
            continue;
        }
        if lower == "location" {
            match rewrite_location(&value, shared) {
                Some(location) => out_headers.push((name, location)),
                None => {
                    return Err(
                        "El preview redirige fuera de loopback o a otro origen.".to_string()
                    );
                }
            }
            continue;
        }
        out_headers.push((name, value));
    }

    // Set-Cookie reescrito (filtramos arriba y reañadimos).
    for value in set_cookies {
        out_headers.push(("Set-Cookie".to_string(), rewrite_set_cookie(&value)));
    }

    if is_html {
        body = inject_selector(&body, shared);
    }

    out_headers.push(("X-Content-Type-Options".to_string(), "nosniff".to_string()));
    out_headers.push(("Content-Length".to_string(), body.len().to_string()));
    out_headers.push(("Connection".to_string(), "close".to_string()));

    Ok(Response {
        status,
        reason: if reason.is_empty() {
            "OK".to_string()
        } else {
            reason
        },
        headers: out_headers,
        body,
    })
}

fn dechunk(body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut rest = body;
    loop {
        let Some(line_end) = rest.windows(2).position(|w| w == b"\r\n") else {
            break;
        };
        let size_str = String::from_utf8_lossy(&rest[..line_end]);
        let size_str = size_str.trim();
        let size = usize::from_str_radix(size_str.split(';').next().unwrap_or(""), 16).unwrap_or(0);
        rest = &rest[line_end + 2..];
        if size == 0 {
            break;
        }
        if rest.len() < size {
            out.extend_from_slice(rest);
            break;
        }
        out.extend_from_slice(&rest[..size]);
        rest = &rest[size..];
        if rest.starts_with(b"\r\n") {
            rest = &rest[2..];
        }
    }
    out
}

/// Reescribe `Location`: upstream mismo origen -> proxy; relativa intacta;
/// fuera de loopback u otro origen -> bloqueado (`None`).
fn rewrite_location(location: &str, shared: &Shared) -> Option<String> {
    let value = location.trim();
    if value.is_empty() {
        return Some(String::new());
    }
    let lower = value.to_ascii_lowercase();
    let absolute = if let Some(rest) = value.strip_prefix("//") {
        let scheme = if shared.upstream.tls { "https" } else { "http" };
        format!("{scheme}://{rest}")
    } else if lower.starts_with("http://") || lower.starts_with("https://") {
        value.to_string()
    } else {
        // relativa (incluida `/...`): se re-servirá por el proxy.
        return Some(value.to_string());
    };

    let target = parse_target(&absolute).ok()?;
    if !validate_preview_host(&target.host).is_ok() {
        return None;
    }
    // Solo se puede re-servir lo que el upstream fijo pueda responder.
    let same_origin = target.tls == shared.upstream.tls
        && target.host.eq_ignore_ascii_case(&shared.upstream.host)
        && target.port == shared.upstream.port;
    if !same_origin {
        return None;
    }
    let mut path = target.path.clone();
    if path.is_empty() {
        path = "/".to_string();
    }
    Some(format!("{}{}", shared.proxy_origin, path))
}

/// `Set-Cookie` sin `Domain` foráneo; `Path=/`; quita `Secure`? (http local).
pub fn rewrite_set_cookie(value: &str) -> String {
    let mut parts = value.split(';');
    let name_value = parts.next().unwrap_or_default().trim().to_string();
    let mut out = vec![name_value];
    let mut has_path = false;
    for attr in parts {
        let attr = attr.trim();
        let lower = attr.to_ascii_lowercase();
        if lower.starts_with("domain=") {
            continue; // no fijar dominio: cookie del origen proxy
        }
        if lower.starts_with("path=") {
            has_path = true;
            out.push("Path=/".to_string());
            continue;
        }
        if lower == "secure" {
            continue; // proxy es http loopback
        }
        out.push(attr.to_string());
    }
    if !has_path {
        out.push("Path=/".to_string());
    }
    out.join("; ")
}

/// Ajuste mínimo de CSP upstream para permitir el script propio (sin tocar la
/// CSP de la app): quita `frame-ancestors`, añade `'self'` a `script-src`.
pub fn adjust_csp(csp: &str) -> String {
    let mut directives: Vec<String> = Vec::new();
    let mut script_seen = false;
    for directive in csp.split(';') {
        let directive = directive.trim();
        if directive.is_empty() {
            continue;
        }
        let name = directive
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if name == "frame-ancestors" {
            continue;
        }
        if name == "script-src" {
            script_seen = true;
            let mut tokens: Vec<String> = directive
                .split_whitespace()
                .skip(1)
                .map(|t| t.to_string())
                .filter(|t| t != "'none'")
                .collect();
            if !tokens.iter().any(|t| t == "'self'") {
                tokens.push("'self'".to_string());
            }
            directives.push(format!("script-src {}", tokens.join(" ")));
            continue;
        }
        directives.push(directive.to_string());
    }
    if !script_seen {
        directives.push("script-src 'self'".to_string());
    }
    directives.join("; ")
}

/// Inyecta configuración + script propio en HTML, antes de `</body>`.
fn inject_selector(body: &[u8], shared: &Shared) -> Vec<u8> {
    let html = String::from_utf8_lossy(body).to_string();
    let original_url = format!(
        "{}{}",
        shared.upstream_origin,
        original_path_for_injection(shared)
    );
    let query = format!(
        "parentOrigin={}&proxyOrigin={}&nonce={}&originalUrl={}",
        percent_encode_query(&shared.app_origin),
        percent_encode_query(&shared.proxy_origin),
        percent_encode_query(&shared.nonce),
        percent_encode_query(&original_url),
    );
    let snippet = format!("<script src=\"{PROXY_PREFIX}/selector.js?{query}\"></script>");
    let lower = html.to_ascii_lowercase();
    let inserted = if let Some(index) = lower.rfind("</body>") {
        format!("{}{}{}", &html[..index], snippet, &html[index..])
    } else if let Some(index) = lower.rfind("</html>") {
        format!("{}{}{}", &html[..index], snippet, &html[index..])
    } else {
        format!("{html}{snippet}")
    };
    inserted.into_bytes()
}

fn original_path_for_injection(shared: &Shared) -> String {
    shared.upstream.path.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shared_for(upstream_raw: &str) -> Shared {
        let upstream = parse_target(upstream_raw).unwrap();
        Shared {
            token: "tok".to_string(),
            nonce: "nonce".to_string(),
            app_origin: "tauri://localhost".to_string(),
            proxy_origin: "http://127.0.0.1:12345".to_string(),
            upstream_origin: upstream_origin(&upstream),
            upstream,
            host_header_expected: "127.0.0.1:12345".to_string(),
            stop: Arc::new(AtomicBool::new(false)),
        }
    }

    #[test]
    fn sanea_ruta_sin_escapar_del_origen() {
        assert_eq!(sanitize_proxy_target("/a/b?x=1").unwrap(), "/a/b?x=1");
        assert_eq!(sanitize_proxy_target("/").unwrap(), "/");
        assert!(sanitize_proxy_target("/a/../b").is_err());
        assert!(sanitize_proxy_target("/a/../../etc").is_err());
        assert!(sanitize_proxy_target("/a/%2e%2e/b").is_err());
        assert!(sanitize_proxy_target("/a/%2E%2E/b").is_err());
        assert!(sanitize_proxy_target("//evil.com/x").is_err());
        assert!(sanitize_proxy_target("http://evil.com/x").is_err());
        assert!(sanitize_proxy_target("/a\\..\\b").is_err());
        assert!(sanitize_proxy_target("/a\u{0000}b").is_err());
        // no reenviar nuestro token al upstream
        assert_eq!(
            sanitize_proxy_target("/x?__ot_token=tok&y=2").unwrap(),
            "/x?y=2"
        );
    }

    #[test]
    fn rechaza_token_invalido_o_ausente() {
        let shared = shared_for("http://localhost:5173");
        let base = Request {
            method: "GET".to_string(),
            target: "/".to_string(),
            headers: vec![("Host".to_string(), "127.0.0.1:12345".to_string())],
            body: Vec::new(),
        };
        // sin token
        let res = handle_request(&base, &shared);
        assert_eq!(res.status, 403);
        // token malo
        let mut bad = base.clone();
        bad.headers
            .push(("Cookie".to_string(), format!("{COOKIE_NAME}=wrong")));
        assert_eq!(handle_request(&bad, &shared).status, 403);
    }

    #[test]
    fn rechaza_host_no_local_anti_rebinding() {
        let shared = shared_for("http://localhost:5173");
        let req = Request {
            method: "GET".to_string(),
            target: "/".to_string(),
            headers: vec![
                ("Host".to_string(), "evil.com".to_string()),
                ("Cookie".to_string(), format!("{COOKIE_NAME}=tok")),
            ],
            body: Vec::new(),
        };
        assert_eq!(handle_request(&req, &shared).status, 400);
    }

    #[test]
    fn rewrite_location_solo_mismo_upstream_loopback() {
        let shared = shared_for("http://localhost:5173");
        assert_eq!(
            rewrite_location("/login", &shared).as_deref(),
            Some("/login")
        );
        assert_eq!(
            rewrite_location("http://localhost:5173/app", &shared).as_deref(),
            Some("http://127.0.0.1:12345/app")
        );
        assert_eq!(rewrite_location("http://evil.com/", &shared), None);
        assert_eq!(rewrite_location("http://localhost:9999/", &shared), None);
        assert_eq!(rewrite_location("//evil.com/", &shared), None);
        assert_eq!(rewrite_location("http://192.168.1.1/", &shared), None);
    }

    #[test]
    fn rewrite_set_cookie_quita_domain_y_secure() {
        let out = rewrite_set_cookie("sid=abc; Domain=evil.com; Secure; HttpOnly; SameSite=Lax");
        assert!(out.starts_with("sid=abc"));
        assert!(!out.to_ascii_lowercase().contains("domain"));
        assert!(!out.to_ascii_lowercase().contains("secure;"));
        assert!(out.contains("HttpOnly"));
        assert!(out.contains("Path=/"));
    }

    #[test]
    fn adjust_csp_permite_script_propio_sin_frame_ancestors() {
        let out = adjust_csp("default-src 'self'; script-src 'none'; frame-ancestors 'none'");
        assert!(out.contains("default-src 'self'"));
        assert!(out.contains("script-src 'self'"));
        assert!(!out.contains("frame-ancestors"));
        assert!(!out.contains("'none'; script-src") || !out.contains("script-src 'none'"));
        let added = adjust_csp("default-src 'self'");
        assert!(added.contains("script-src 'self'"));
    }

    #[test]
    fn inyecta_selector_solo_html_antes_de_body() {
        let shared = shared_for("http://localhost:5173/app");
        let html = b"<html><body><p>hola</p></body></html>".to_vec();
        let out = inject_selector(&html, &shared);
        let s = String::from_utf8(out).unwrap();
        assert!(s.contains("/__ot__/selector.js?"));
        assert!(s.contains("parentOrigin=tauri%3A%2F%2Flocalhost"));
        assert!(s.contains("nonce=nonce"));
        // sin <script> inline
        assert!(!s.contains("window.__OT_PREVIEW__"));
        assert!(s.find("<script").unwrap() < s.find("</body>").unwrap());
    }

    #[test]
    fn rechaza_upstream_no_loopback() {
        assert!(start_proxy("http://example.com/", "tauri://localhost").is_err());
        assert!(start_proxy("http://192.168.1.10/", "tauri://localhost").is_err());
        assert!(start_proxy("http://user:pass@localhost:5173/", "tauri://localhost").is_err());
        assert!(start_proxy("ftp://localhost/", "tauri://localhost").is_err());
    }

    #[test]
    fn rechaza_origen_app_invalido() {
        // upstream loopback válido pero sin servidor; valida origen app antes.
        assert!(start_proxy("http://127.0.0.1:1/", "tauri://localhost evil").is_err());
    }

    // --- integración con servidor upstream real y listener proxy real ---

    use std::io::{Read as IoRead, Write as IoWrite};
    use std::net::TcpListener as StdTcpListener;
    use std::thread;

    /// Sanear antes de imprimir en asserts (CodeQL log-injection): sin control.
    fn scrub(value: &str) -> String {
        value
            .chars()
            .filter(|c| !c.is_control())
            .take(200)
            .collect()
    }

    fn spawn_upstream() -> u16 {
        let listener = StdTcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            // responder varias peticiones
            for _ in 0..32 {
                let Ok((mut stream, _)) = listener.accept() else {
                    break;
                };
                let mut req = [0u8; 4096];
                let _ = stream.read(&mut req);
                let body = b"<html><head><title>Demo</title></head><body><p>ok</p></body></html>";
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nX-Frame-Options: DENY\r\nSet-Cookie: sid=abc; Domain=evil.com; Secure\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.write_all(body);
            }
        });
        port
    }

    fn proxy_raw_get(addr: SocketAddr, request: &str) -> String {
        let mut stream = TcpStream::connect(addr).unwrap();
        stream.write_all(request.as_bytes()).unwrap();
        let mut out = String::new();
        stream.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn proxy_real_sirve_con_token_inyecta_y_quita_xfo() {
        let port = spawn_upstream();
        let proxy = start_proxy(&format!("http://127.0.0.1:{port}/"), "tauri://localhost").unwrap();
        let session = proxy.session();
        let proxy_port = session.proxy_origin.rsplit(':').next().unwrap().to_string();
        let addr: SocketAddr = format!("127.0.0.1:{proxy_port}").parse().unwrap();

        // sin token -> 403
        let no_token = proxy_raw_get(
            addr,
            &format!("GET / HTTP/1.1\r\nHost: 127.0.0.1:{proxy_port}\r\nConnection: close\r\n\r\n"),
        );
        assert!(no_token.starts_with("HTTP/1.1 403"), "{}", scrub(&no_token));

        // host erróneo -> 400
        let bad_host = proxy_raw_get(
            addr,
            &format!(
                "GET /?__ot_token={} HTTP/1.1\r\nHost: evil.com\r\nConnection: close\r\n\r\n",
                session.token
            ),
        );
        assert!(bad_host.starts_with("HTTP/1.1 400"), "{}", scrub(&bad_host));

        // con token -> 200 + inyección + sin XFO + set-cookie reescrito
        let ok = proxy_raw_get(
            addr,
            &format!(
                "GET /?__ot_token={} HTTP/1.1\r\nHost: 127.0.0.1:{proxy_port}\r\nConnection: close\r\n\r\n",
                session.token
            ),
        );
        assert!(ok.starts_with("HTTP/1.1 200"), "{}", scrub(&ok));
        assert!(ok.contains("/__ot__/selector.js?"), "{}", scrub(&ok));
        assert!(ok.contains("parentOrigin="), "{}", scrub(&ok));
        assert!(!ok.contains("window.__OT_PREVIEW__"), "{}", scrub(&ok));
        assert!(
            !ok.to_ascii_lowercase().contains("x-frame-options"),
            "{}",
            scrub(&ok)
        );
        assert!(ok.contains("<title>Demo</title>"), "{}", scrub(&ok));
        assert!(
            !ok.to_ascii_lowercase().contains("domain=evil.com"),
            "{}",
            scrub(&ok)
        );

        // ruta reservada no colisiona
        let reserved = proxy_raw_get(
            addr,
            &format!(
                "GET /__ot__/nope?__ot_token={} HTTP/1.1\r\nHost: 127.0.0.1:{proxy_port}\r\nConnection: close\r\n\r\n",
                session.token
            ),
        );
        assert!(reserved.starts_with("HTTP/1.1 404"), "{}", scrub(&reserved));

        proxy.stop();
    }

    #[test]
    fn proxy_serve_script_selector_con_token() {
        let port = spawn_upstream();
        let proxy = start_proxy(&format!("http://127.0.0.1:{port}/"), "tauri://localhost").unwrap();
        let session = proxy.session();
        let proxy_port = session.proxy_origin.rsplit(':').next().unwrap().to_string();
        let addr: SocketAddr = format!("127.0.0.1:{proxy_port}").parse().unwrap();
        let res = proxy_raw_get(
            addr,
            &format!(
                "GET /__ot__/selector.js HTTP/1.1\r\nHost: 127.0.0.1:{proxy_port}\r\nCookie: {COOKIE_NAME}={}\r\nConnection: close\r\n\r\n",
                session.token
            ),
        );
        assert!(res.starts_with("HTTP/1.1 200"), "{}", scrub(&res));
        assert!(
            res.contains("opentemplates-preview-selector"),
            "{}",
            scrub(&res)
        );
        proxy.stop();
    }
}
