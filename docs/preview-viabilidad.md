# Viabilidad del preview con selector de elemento (#13)

Fecha: 2026-11-24 · Rama: `feat/preview` · Tauri 2.12.5 · React 19 · Linux/Wayland

Este documento decide **cómo se embebe la app en marcha** y **cómo se inspecciona
un elemento** antes de escribir la UI, con el coste medido en este repo. La
conclusión anticipada: el preview sólido entra por iframe y sondeo en Rust; el
selector de elemento queda fuera porque ninguna opción lo permite sin un proxy
propio o sin cambiar el modelo de ventanas y renunciar a Wayland.

## Opciones y coste real

### A. Iframe dentro del webview de la app

- **Coste**: cero dependencias nuevas. Solo hay que abrir `frame-src` en la CSP
  (`src-tauri/tauri.conf.json`), que hoy no permite marcos.
- **Lo que funciona**: la página se pinta, conserva sus scripts, su propio
  `localStorage` y su hot reload. El usuario ve la app real, no una captura.
- **El límite**: la página es de otro origen (`http://localhost:5173` frente a
  `tauri://localhost`). La política de mismo origen impide leer su DOM, sus
  estilos o sus errores de consola desde el webview padre. Sin proxy no hay
  selector de elemento.
- **Riesgo de embebido**: un dev server puede mandar `X-Frame-Options` o
  `frame-ancestors`. Medido con el Vite de este repo (`curl -sSI
  http://127.0.0.1:1420/`): `HTTP/1.1 200 OK`, sin `X-Frame-Options` ni CSP de
  marco, así que se puede embeber. El sondeo detecta esos headers y la UI avisa
  con un botón para abrir en el navegador.
- **Estado sin DOM**: se resuelve con un sondeo del backend (ver decisión), no
  con `iframe.onload`, que también dispara con la página de error de WebKit.

### B. Webview hijo de Tauri (multiwebview)

- **Coste**: activar la feature `unstable` del crate `tauri` (`add_child`,
  `WindowBuilder` sin webview, gestión de bounds por código). Cambia el modelo de
  ventanas de toda la app para una feature.
- **Incompatible con esta sesión**: en Linux `wry` 0.57.3 solo crea webviews
  hijos por X11; `new_as_child` exige `RawWindowHandle::Xlib` y devuelve
  `UnsupportedWindowHandle` con Wayland (`wry/src/webkitgtk/mod.rs`). La sesión
  de desarrollo es Wayland (`XDG_SESSION_TYPE=wayland`,
  `WAYLAND_DISPLAY=wayland-0`), y los propios ejemplos de multiwebview tienen
  una incidencia abierta por lo mismo (wry#1197). Además hay reportes de layout
  roto en WebKitGTK al llamar a `add_child`.
- **Selector**: sería posible con un script de inicialización inyectado y
  eventos al padre, pero el contenido remoto no puede invocar comandos Tauri por
  defecto: Tauri rechaza IPC de orígenes remotos. Habría que abrir una
  capability para `http://localhost:*`, es decir, relajar la seguridad para
  cualquier página que se sirva en ese puerto.
- **Descartada** por coste de mantenimiento, ruptura del modelo de ventanas y
  falta de soporte en Wayland.

### C. Captura de pantalla de la región + coordenadas

- **Coste**: no hay API de captura en Tauri; habría que añadir una dependencia
  de captura y, en Wayland, usar el portal `org.freedesktop.portal.Screenshot`
  (presente en la sesión) con consentimiento del usuario cada vez.
- **Lo que no resuelve**: sin DOM no hay estilos computados, ni consola, ni
  árbol; solo un rectángulo de píxeles y coordenadas. El agente recibiría una
  imagen y una posición, no «este botón».
- No se implementa: el coste es alto y el resultado no es el selector que pide
  la feature.

### D. Proxy propio para servir el preview desde el mismo origen

- **Coste**: reescribir HTML y rutas absolutas de assets, reenviar WebSocket de
  HMR, cookies y cabeceras, e inyectar el script del selector en cada respuesta.
  Frágil con cualquier dev server que no sea Vite y con apps que asumen su host.
- Es la única vía para un selector real dentro de un iframe, pero es una feature
  en sí misma y no entra en el alcance de #13.

## Decisión

1. **Preview por iframe** (opción A), con `frame-src http://localhost:*
   http://127.0.0.1:*` en la CSP: la URL es configurable en puerto y ruta, pero
   solo se embeben servidores locales (decisión de #81). El iframe es de otro
   origen y no puede invocar IPC de Tauri; la carga de una URL arbitraria queda
   aislada por el navegador.
2. **Sondeo en Rust** (`preview_probe`) en lugar de `fetch` del webview: sin
   CORS, con timeout, estado HTTP, título, detección de `X-Frame-Options` /
   `frame-ancestors` y mensajes de conexión concretos. Sin dependencias nuevas:
   `std::net::TcpStream`. Para `https` solo se comprueba que el puerto acepta
   conexión (no se inspecciona TLS).
3. **Abrir en navegador** con un comando Tauri (`open_external`) que usa
   `xdg-open`/`open`/`rundll32` sin shell y sin esperar.
4. **Selector de elemento fuera**. No se simula: no hay clic en el DOM, ni
   estilos computados, ni errores de consola. El prompt al agente lleva URL,
   workspace, ruta, tamaño, estado del sondeo y la petición del usuario,
   recortado y numerado. Cuando exista un proxy propio (opción D) o Wayland deje
   de ser un bloqueo para multiwebview (opción B), el selector se podrá añadir
   sobre esta base sin cambiar el dominio del preview.

## Verificación de la decisión

- `pnpm dev` de este repo en `127.0.0.1:1420`; el sondeo real devuelve
  `PreviewProbe { ok: true, status: Some(200), title: Some("OpenTemplates"),
  error: None, frame_blocked: false, verified: true }`.
- Tests de Rust: parseo de URL/puerto, credenciales y esquemas rechazados,
  título y `X-Frame-Options`, `frame-ancestors`, servidor HTTP local real y
  puerto cerrado con mensaje «No hay nadie escuchando».
- Tests de dominio: normalización de `5173`, `:3000`, `localhost:5173`,
  `https`, credenciales y puertos fuera de rango; estados del sondeo; prompt
  numerado, con aviso de marco bloqueado y recorte.
- Tests de componente: carga, error de conexión sin iframe en blanco,
  reintento, URL inválida, persistencia por workspace, cambio de dispositivo,
  abrir externo y envío al agente.
- Prueba en la app real: `GDK_BACKEND=x11 pnpm tauri dev` con un servidor HTTP
  en `localhost:5173`. Un iframe temporal con la CSP nueva pinta la página en la
  ventana de Tauri (captura revisada) y se retira después. Confirma que
  `frame-src` no rompe la CSP ni el arranque.
