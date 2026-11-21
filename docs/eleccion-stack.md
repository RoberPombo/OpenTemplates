# Elección de stack para la UI

## Medición real (esta máquina, Linux/Wayland)

Medido con PSS de `/proc/<pid>/smaps_rollup`, que reparte las páginas compartidas
y evita el doble conteo del RSS.

| Componente | PSS en reposo | RSS |
|---|---:|---:|
| Tauri release (app + WebKitWebProcess + NetworkProcess + Glycin) | **139 MB** | 415 MB |
| `opencode serve` idle (sin MCPs, sin sesión) | **96 MB** | 150 MB |
| MCP `context-mode` (Node) | **41 MB** | 88 MB |
| Vite en desarrollo (no existe en release) | 145 MB | 201 MB |

El binario de Tauri pesa 6.8 MB; el de opencode, 239 MB. El tamaño del paquete lo
domina opencode, no el toolkit de UI.

## Lectura

Con tres workspaces abiertos y dos MCPs por workspace, el orden de magnitud es:

```
UI Tauri        139 MB
3 × opencode    288 MB
6 × MCPs        250-600 MB
-----------------------------
total           680 MB - 1 GB
```

La UI es el **15-20%** del consumo. Cambiar de toolkit puede ahorrar 70-100 MB,
pero el coste real está en los procesos de opencode y sus MCPs. La optimización
grande no es la UI: es **no tener todos los workspaces vivos a la vez**.

## Opciones

### Tauri (actual)

- WebView del sistema: WebKitGTK en Linux, WebView2 en Windows, WKWebView en macOS.
- React + TypeScript ya escrito; markdown, código, SSE y formularios salen gratis.
- 139 MB medidos en Linux. En Windows/macOS suele ser menor porque el runtime es
  compartido por el sistema.
- Riesgo: WebKitGTK es la parte menos consistente y la que más memoria usa.

### Flutter

- Renderer propio (Skia/Impeller), misma UI en los tres SO.
- Widgets y paquetes buenos para chat, markdown, resaltado y ventanas.
- Estimado 100-180 MB PSS en Linux; **hay que medirlo**, no es un dato verificado.
- Supervisión de procesos en Dart (`Process.start`) o mantener el daemon en Rust.
- Coste: reescribir la UI y el supervisor; hot reload excelente.

### Rust nativo

| Toolkit | PSS estimado | Nota |
|---|---:|---|
| egui/eframe | 30-60 MB | inmediate mode; texto, selección, IME y accesibilidad flojos |
| iced | 40-80 MB | retenido, más estructurado; texto/markdown a mano |
| Slint | 40-80 MB | declarativo y rápido; licencia GPL o comercial |
| Dioxus native (Blitz) | 40-90 MB | prometedor, pero inmaduro para un chat serio |

Ahorro real frente a Tauri: unos 70-100 MB. A cambio, construir el chat (markdown,
código, selección, IME, accesibilidad, scroll de miles de mensajes) cuesta semanas.
Para una herramienta interna puede valer; para un producto, es riesgo.

### Qt/QML

- Maduro, texto excelente, muy buen rendimiento; 80-150 MB estimados.
- C++ (o PySide, que añade un runtime pesado) y licencia LGPL/comercial.
- No compensa frente a Tauri para este caso.

### Avalonia (.NET)

- Cross-platform, XAML, ~120-200 MB estimados; runtime .NET.
- Buena opción si el equipo es .NET; no es una mejora de consumo frente a Tauri.

### PWA + daemon local

- Se reutiliza la UI React; el daemon Rust/Go ocupa 10-20 MB.
- Si el navegador ya está abierto, el coste incremental es mínimo.
- No es una app nativa: pestaña, notificaciones y ciclo de vida del daemon.
- Es la opción de menor consumo total y menor esfuerzo, pero cambia el producto.

### Electron / Wails

- Electron: 250-400 MB; descartado.
- Wails: mismo modelo de WebView que Tauri; en Linux el mismo WebKitGTK. No aporta.

## Recomendación

1. **No cambiar Tauri ahora por memoria.** El shell no es el cuello de botella y la
   UI ya está hecha. El backend Rust (supervisor, config, HTTP/SSE) es agnóstico a
   la UI: si algún día se cambia, se conserva.
2. **Implementar ciclo de vida de workspaces** antes de tocar el toolkit:
   - arrancar solo el workspace activo;
   - suspender el inactivo tras N minutos (parar el proceso y reanudarlo al volver);
   - no arrancar MCPs hasta que el workspace se use.
   Esto ahorra 96 MB + MCPs por workspace, mucho más que cualquier reescritura.
3. **Si el problema es fluidez/batería en Linux**, hacer un prototipo vertical de una
   pantalla (sidebar + chat con 2.000 mensajes + streaming) en Flutter y en egui, y
   medir. Decidir con datos, no con estimaciones.
4. **Si el target principal es Windows/macOS**, Tauri es claramente la mejor
   relación coste/consumo: WebView2/WKWebView son eficientes y compartidos.
5. **PWA** solo si se acepta la experiencia de navegador; es la vía más barata para
   bajar consumo y mantener React.

## Criterio de cambio

Cambiar de stack solo si el prototipo demuestra una de estas dos cosas:

- ahorra ≥100 MB de PSS en el escenario real (3 workspaces + 4 MCPs), o
- duplica la autonomía / elimina tirones de scroll o input en Linux,

y además el coste de mantener la UI nueva es asumible. Si no, el esfuerzo se pone
en suspender workspaces y en medir MCPs, que es donde está el gasto.
