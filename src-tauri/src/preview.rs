use std::io::{Read, Write};
use std::net::{IpAddr, TcpStream, ToSocketAddrs};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const IO_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_BYTES: usize = 128 * 1024;
const MAX_TITLE: usize = 120;

/// Resultado del sondeo de la URL del preview, ya listo para la UI.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PreviewProbe {
    pub ok: bool,
    pub status: Option<u16>,
    pub title: Option<String>,
    pub error: Option<String>,
    pub frame_blocked: bool,
    pub verified: bool,
}

#[derive(Debug, PartialEq)]
struct Target {
    host: String,
    port: u16,
    path: String,
    tls: bool,
}

/// Loopback incluye `127.0.0.0/8`, `::1` y la forma IPv4 mapeada en IPv6
/// (`::ffff:127.0.0.1`), que es como algunos resolvers devuelven `localhost`.
fn is_loopback_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback(),
        IpAddr::V6(v6) => {
            v6.is_loopback() || v6.to_ipv4_mapped().is_some_and(|v4| v4.is_loopback())
        }
    }
}

fn describe_ip(ip: IpAddr) -> &'static str {
    match ip {
        IpAddr::V4(v4) if v4.is_private() => "una dirección privada",
        IpAddr::V4(v4) if v4.is_link_local() => "una dirección link-local",
        IpAddr::V4(v4) if v4.is_unspecified() => "la dirección comodín 0.0.0.0",
        IpAddr::V4(v4) if v4.is_multicast() => "una dirección multicast",
        IpAddr::V4(_) => "una dirección fuera de loopback",
        IpAddr::V6(v6) if v6.is_unspecified() => "la dirección comodín ::",
        IpAddr::V6(v6) if v6.is_multicast() => "una dirección multicast",
        IpAddr::V6(v6) if v6.is_unicast_link_local() => "una dirección link-local",
        IpAddr::V6(_) => "una dirección fuera de loopback",
    }
}

/// Política del sondeo: el preview incrustado solo carga orígenes locales
/// (decisión de #81), así que el backend no debe poder alcanzar nada más.
/// Se admiten `localhost` y direcciones literales de loopback; cualquier otro
/// nombre o IP se rechaza antes de resolver o conectar.
fn validate_preview_host(host: &str) -> Result<(), String> {
    let name = host.trim_matches(['[', ']']);
    if name.eq_ignore_ascii_case("localhost") {
        return Ok(());
    }
    if let Ok(ip) = name.parse::<IpAddr>() {
        if is_loopback_ip(ip) {
            return Ok(());
        }
        return Err(format!(
            "El preview solo admite loopback; {name} es {}. Usa localhost, 127.0.0.1 o ::1.",
            describe_ip(ip)
        ));
    }
    Err(format!(
        "El preview solo admite hosts de loopback (localhost, 127.0.0.1 o ::1); '{name}' no está permitido."
    ))
}

/// Valida un `Location` de redirección antes de darla por buena. No se siguen
/// redirecciones: una absoluta a otro host o a una IP no permitida se rechaza,
/// y una relativa se queda en el mismo origen ya validado.
fn validate_redirect(from: &Target, location: &str) -> Result<(), String> {
    let value = location.trim();
    if value.is_empty() {
        return Ok(());
    }
    let lower = value.to_ascii_lowercase();
    let absolute = if let Some(rest) = value.strip_prefix("//") {
        format!("{}://{rest}", if from.tls { "https" } else { "http" })
    } else if lower.starts_with("http://") || lower.starts_with("https://") {
        value.to_string()
    } else {
        // Ruta relativa (incluida la que empieza por `/`): mismo host y puerto.
        return Ok(());
    };
    let target = parse_target(&absolute)
        .map_err(|error| format!("El preview redirige a una URL no válida: {error}"))?;
    validate_preview_host(&target.host).map_err(|_| {
        format!(
            "El preview redirige a {}:{} fuera de loopback. Revisa la URL del servidor.",
            target.host, target.port
        )
    })
}

fn failure(error: impl Into<String>) -> PreviewProbe {
    PreviewProbe {
        ok: false,
        status: None,
        title: None,
        error: Some(error.into()),
        frame_blocked: false,
        verified: true,
    }
}

fn parse_port(value: &str) -> Result<u16, String> {
    if value.is_empty() || !value.chars().all(|c| c.is_ascii_digit()) {
        return Err("El puerto de la URL no es válido.".to_string());
    }
    match value.parse::<u16>() {
        Ok(port) if port > 0 => Ok(port),
        _ => Err("El puerto debe estar entre 1 y 65535.".to_string()),
    }
}

fn split_authority(authority: &str, tls: bool) -> Result<(String, u16), String> {
    let default_port = if tls { 443 } else { 80 };
    if authority.starts_with('[') {
        let end = authority
            .find(']')
            .ok_or_else(|| "La URL no es válida: falta cerrar la IPv6.".to_string())?;
        let host = authority[..=end].to_string();
        let rest = &authority[end + 1..];
        let port = if rest.is_empty() {
            default_port
        } else if let Some(value) = rest.strip_prefix(':') {
            parse_port(value)?
        } else {
            return Err("La URL no es válida después de la IPv6.".to_string());
        };
        return Ok((host, port));
    }

    match authority.rsplit_once(':') {
        Some((host, value)) if !host.is_empty() => Ok((host.to_string(), parse_port(value)?)),
        Some(_) => Err("La URL no incluye un servidor.".to_string()),
        None => Ok((authority.to_string(), default_port)),
    }
}

/// Valida y separa una URL http(s) sin dependencias externas. El host se
/// resuelve después; aquí solo se rechaza lo que no puede ser una URL de preview.
fn parse_target(raw: &str) -> Result<Target, String> {
    let value = raw.trim();
    if value.is_empty() {
        return Err("La URL está vacía.".to_string());
    }
    let (tls, rest) = if let Some(rest) = value.strip_prefix("http://") {
        (false, rest)
    } else if let Some(rest) = value.strip_prefix("https://") {
        (true, rest)
    } else {
        return Err("La URL debe empezar por http:// o https://.".to_string());
    };
    if rest.is_empty() {
        return Err("La URL no incluye un servidor.".to_string());
    }
    let (authority, path) = match rest.find('/') {
        Some(index) => (&rest[..index], &rest[index..]),
        None => (rest, "/"),
    };
    if authority.contains('@') {
        return Err("La URL no puede incluir usuario ni contraseña.".to_string());
    }
    if authority.is_empty() {
        return Err("La URL no incluye un servidor.".to_string());
    }
    let (host, port) = split_authority(authority, tls)?;
    if host.trim_matches(['[', ']']).is_empty() {
        return Err("La URL no incluye un servidor.".to_string());
    }
    if host
        .chars()
        .any(|c| c.is_whitespace() || c.is_control() || c == '/' || c == '\\')
    {
        return Err("El servidor de la URL no es válido.".to_string());
    }
    if path.chars().any(|c| c == '\r' || c == '\n') {
        return Err("La ruta de la URL no es válida.".to_string());
    }
    Ok(Target {
        host,
        port,
        path: if path.is_empty() {
            "/".to_string()
        } else {
            path.to_string()
        },
        tls,
    })
}

fn describe_io(error: &std::io::Error, host: &str, port: u16) -> String {
    match error.kind() {
        std::io::ErrorKind::ConnectionRefused => format!(
            "No hay nadie escuchando en {host}:{port}. Arranca el servidor de desarrollo y reinténtalo."
        ),
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => {
            format!("Se agotó el tiempo de espera al conectar con {host}:{port}.")
        }
        _ => format!("No se pudo conectar con {host}:{port}: {error}"),
    }
}

fn connect(target: &Target) -> Result<TcpStream, String> {
    let lookup = target.host.trim_matches(['[', ']']);
    let addresses: Vec<_> = (lookup, target.port)
        .to_socket_addrs()
        .map_err(|error| format!("No se pudo resolver {}: {error}", target.host))?
        .collect();
    for address in &addresses {
        if !is_loopback_ip(address.ip()) {
            return Err(format!(
                "El preview resolvió {} a {} ({}); solo se admite loopback.",
                target.host,
                address.ip(),
                describe_ip(address.ip())
            ));
        }
    }
    let mut last: Option<std::io::Error> = None;
    for address in addresses {
        match TcpStream::connect_timeout(&address, CONNECT_TIMEOUT) {
            Ok(stream) => return Ok(stream),
            Err(error) => last = Some(error),
        }
    }
    Err(match last {
        Some(error) => describe_io(&error, &target.host, target.port),
        None => format!("No se encontró ninguna dirección para {}.", target.host),
    })
}

fn host_header(target: &Target) -> String {
    let default_port = if target.tls { 443 } else { 80 };
    if target.port == default_port {
        target.host.clone()
    } else {
        format!("{}:{}", target.host, target.port)
    }
}

fn split_head(text: &str) -> (&str, &str) {
    if let Some(index) = text.find("\r\n\r\n") {
        return (&text[..index], &text[index + 4..]);
    }
    if let Some(index) = text.find("\n\n") {
        return (&text[..index], &text[index + 2..]);
    }
    (text, "")
}

fn decode_entities(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

fn extract_title(body: &str) -> Option<String> {
    let lower = body.to_ascii_lowercase();
    let start = lower.find("<title")?;
    let open = start + lower[start..].find('>')? + 1;
    let end = open + lower[open..].find("</title>")?;
    let raw = decode_entities(&body[open..end]);
    let title = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() {
        return None;
    }
    Some(title.chars().take(MAX_TITLE).collect())
}

fn parse_response(buffer: &[u8], target: &Target) -> PreviewProbe {
    let text = String::from_utf8_lossy(buffer);
    let (head, body) = split_head(&text);
    let mut lines = head.lines();
    let status = lines
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok());
    let Some(status) = status else {
        return failure(format!(
            "La respuesta de {}:{} no es HTTP.",
            target.host, target.port
        ));
    };

    let mut frame_blocked = false;
    let mut location: Option<&str> = None;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim();
        if name == "location" {
            location = Some(value);
        }
        if name == "x-frame-options" && !value.eq_ignore_ascii_case("allowall") {
            frame_blocked = true;
        }
        if name == "content-security-policy" {
            for directive in value.split(';') {
                let directive = directive.trim().to_ascii_lowercase();
                if let Some(ancestors) = directive.strip_prefix("frame-ancestors")
                    && !ancestors.split_whitespace().any(|item| item == "*")
                {
                    frame_blocked = true;
                }
            }
        }
    }

    if (300..400).contains(&status)
        && let Some(location) = location
        && let Err(error) = validate_redirect(target, location)
    {
        return PreviewProbe {
            ok: false,
            status: Some(status),
            title: None,
            error: Some(error),
            frame_blocked,
            verified: true,
        };
    }

    if status >= 400 {
        return PreviewProbe {
            ok: false,
            status: Some(status),
            title: None,
            error: Some(format!("El servidor respondió HTTP {status}.")),
            frame_blocked,
            verified: true,
        };
    }

    PreviewProbe {
        ok: true,
        status: Some(status),
        title: extract_title(body),
        error: None,
        frame_blocked,
        verified: true,
    }
}

/// Sondea una URL del preview. Nunca lanza: el fallo se devuelve en `error`.
pub fn probe(raw: &str) -> PreviewProbe {
    let target = match parse_target(raw) {
        Ok(target) => target,
        Err(error) => return failure(error),
    };
    if let Err(error) = validate_preview_host(&target.host) {
        return failure(error);
    }
    let mut stream = match connect(&target) {
        Ok(stream) => stream,
        Err(error) => return failure(error),
    };
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));

    // Solo se comprueba que el puerto acepta conexión: inspeccionar TLS exigiría
    // una dependencia extra y el preview local por defecto es http.
    if target.tls {
        return PreviewProbe {
            ok: true,
            status: None,
            title: None,
            error: None,
            frame_blocked: false,
            verified: false,
        };
    }

    let request = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\nUser-Agent: OpenTemplates-preview\r\nAccept: text/html,application/xhtml+xml\r\nConnection: close\r\n\r\n",
        target.path,
        host_header(&target)
    );
    if let Err(error) = stream.write_all(request.as_bytes()) {
        return failure(format!("No se pudo enviar la petición: {error}"));
    }

    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                buffer.extend_from_slice(&chunk[..read]);
                if buffer.len() >= MAX_BYTES {
                    buffer.truncate(MAX_BYTES);
                    break;
                }
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut =>
            {
                if buffer.is_empty() {
                    return failure("El servidor no respondió a tiempo.");
                }
                break;
            }
            Err(error) => {
                if buffer.is_empty() {
                    return failure(format!("Se cortó la conexión: {error}"));
                }
                break;
            }
        }
    }

    if buffer.is_empty() {
        return failure("El servidor cerró la conexión sin responder.");
    }
    parse_response(&buffer, &target)
}

/// Abre una URL http(s) en el navegador del sistema. Sin shell y sin esperar.
pub fn open_external(url: &str) -> Result<(), String> {
    parse_target(url)?;
    let mut command = if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(url);
        command
    } else if cfg!(target_os = "windows") {
        let mut command = Command::new("rundll32");
        command.args(["url.dll,FileProtocolHandler", url]);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("No se pudo abrir el navegador: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn normaliza_urls_http_y_https() {
        assert_eq!(
            parse_target("http://localhost:5173/").unwrap(),
            Target {
                host: "localhost".into(),
                port: 5173,
                path: "/".into(),
                tls: false,
            }
        );
        assert_eq!(
            parse_target("https://127.0.0.1/app?x=1#y").unwrap(),
            Target {
                host: "127.0.0.1".into(),
                port: 443,
                path: "/app?x=1#y".into(),
                tls: true,
            }
        );
        assert_eq!(
            parse_target("http://[::1]:3000").unwrap(),
            Target {
                host: "[::1]".into(),
                port: 3000,
                path: "/".into(),
                tls: false,
            }
        );
    }

    #[test]
    fn rechaza_urls_que_no_son_http_o_llevan_credenciales() {
        assert!(parse_target("ftp://localhost").is_err());
        assert!(parse_target("http://user:pass@localhost:5173").is_err());
        assert!(parse_target("http://localhost:0").is_err());
        assert!(parse_target("http://localhost:70000").is_err());
        assert!(parse_target("http://").is_err());
    }

    fn loopback_target() -> Target {
        Target {
            host: "localhost".into(),
            port: 5173,
            path: "/".into(),
            tls: false,
        }
    }

    #[test]
    fn acepta_solo_hosts_de_loopback() {
        for host in [
            "localhost",
            "LOCALHOST",
            "127.0.0.1",
            "127.5.5.5",
            "::1",
            "[::1]",
            "0:0:0:0:0:0:0:1",
            "[::ffff:127.0.0.1]",
        ] {
            assert!(validate_preview_host(host).is_ok(), "rechazó {host}");
        }
        for host in [
            "example.com",
            "app.localhost.evil.com",
            "192.168.1.10",
            "10.0.0.5",
            "172.16.0.1",
            "169.254.10.1",
            "0.0.0.0",
            "[::]",
            "[fe80::1]",
            "[fd00::1]",
        ] {
            assert!(validate_preview_host(host).is_err(), "aceptó {host}");
        }
    }

    #[test]
    fn rechaza_un_host_remoto_antes_de_conectar() {
        let probe = probe("http://example.com/");
        assert!(!probe.ok);
        let error = probe.error.unwrap();
        assert!(error.contains("loopback"), "{error}");
    }

    #[test]
    fn rechaza_ips_privadas_y_link_local() {
        let private = probe("http://192.168.1.10:5173/");
        assert!(!private.ok);
        assert!(
            private.error.unwrap().contains("privada"),
            "el error debe explicar que es una IP privada"
        );

        let link_local = probe("http://[fe80::1]:5173/");
        assert!(!link_local.ok);
        assert!(
            link_local.error.unwrap().contains("link-local"),
            "el error debe explicar que es link-local"
        );
    }

    #[test]
    fn rechaza_redireccion_a_otro_host() {
        let raw = b"HTTP/1.1 302 Found\r\nLocation: http://example.com/login\r\n\r\n";
        let probe = parse_response(raw, &loopback_target());
        assert!(!probe.ok);
        assert_eq!(probe.status, Some(302));
        let error = probe.error.unwrap();
        assert!(
            error.contains("redirige") && error.contains("loopback"),
            "{error}"
        );
    }

    #[test]
    fn rechaza_redireccion_protocol_relative_a_ip_privada() {
        let raw = b"HTTP/1.1 301 Moved\r\nLocation: //192.168.1.10/admin\r\n\r\n";
        let probe = parse_response(raw, &loopback_target());
        assert!(!probe.ok);
        assert!(probe.error.unwrap().contains("redirige"));
    }

    #[test]
    fn acepta_redireccion_relativa_sin_seguirla() {
        let raw = b"HTTP/1.1 302 Found\r\nLocation: /login\r\n\r\n";
        let probe = parse_response(raw, &loopback_target());
        assert!(probe.ok);
        assert_eq!(probe.status, Some(302));
    }

    #[test]
    fn extrae_estado_titulo_y_bloqueo_de_marco() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nX-Frame-Options: DENY\r\n\r\n<html><head><title>Mi &amp; app</title></head></html>";
        let probe = parse_response(
            raw,
            &Target {
                host: "localhost".into(),
                port: 5173,
                path: "/".into(),
                tls: false,
            },
        );
        assert!(probe.ok);
        assert_eq!(probe.status, Some(200));
        assert_eq!(probe.title.as_deref(), Some("Mi & app"));
        assert!(probe.frame_blocked);
        assert!(probe.verified);
    }

    #[test]
    fn marca_error_http_sin_titulo() {
        let raw = b"HTTP/1.1 500 Internal Server Error\r\n\r\nboom";
        let probe = parse_response(
            raw,
            &Target {
                host: "localhost".into(),
                port: 5173,
                path: "/".into(),
                tls: false,
            },
        );
        assert!(!probe.ok);
        assert_eq!(probe.status, Some(500));
        assert!(probe.error.unwrap().contains("HTTP 500"));
    }

    #[test]
    fn detecta_frame_ancestors() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Security-Policy: default-src 'self'; frame-ancestors 'none'\r\n\r\n";
        let probe = parse_response(
            raw,
            &Target {
                host: "localhost".into(),
                port: 5173,
                path: "/".into(),
                tls: false,
            },
        );
        assert!(probe.frame_blocked);
    }

    #[test]
    fn sondea_un_servidor_http_local() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 1024];
            let _ = stream.read(&mut request);
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 61\r\n\r\n<html><head><title>Demo</title></head><body>ok</body></html>",
                )
                .unwrap();
        });
        let probe = probe(&format!("http://127.0.0.1:{port}/"));
        server.join().unwrap();
        assert!(probe.ok);
        assert_eq!(probe.status, Some(200));
        assert_eq!(probe.title.as_deref(), Some("Demo"));
        assert!(!probe.frame_blocked);
    }

    #[test]
    fn explica_que_no_hay_servidor_escuchando() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let probe = probe(&format!("http://127.0.0.1:{port}/"));
        assert!(!probe.ok);
        assert!(probe.error.unwrap().contains("No hay nadie escuchando"));
    }

    /// Prueba manual contra un dev server real: `cargo test preview_probe_real -- --ignored`.
    #[test]
    #[ignore]
    fn preview_probe_real() {
        let url = std::env::var("PREVIEW_TEST_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:1420".to_string());
        let probe = probe(&url);
        eprintln!("preview_probe({url}) = {probe:?}");
        assert!(probe.ok, "{probe:?}");
    }
}
