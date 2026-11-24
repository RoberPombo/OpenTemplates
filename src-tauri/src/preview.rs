use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
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
    let addresses = (lookup, target.port)
        .to_socket_addrs()
        .map_err(|error| format!("No se pudo resolver {}: {error}", target.host))?;
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
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim();
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
