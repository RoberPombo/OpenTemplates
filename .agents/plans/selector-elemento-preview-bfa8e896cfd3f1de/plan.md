---
contract: local-plans/v1
revision: 1
approved_revision: 1
active_checkout: null
writer_session: null
status: approved
created_at: "2026-11-28T02:25:16+01:00"
updated_at: "2026-11-28T02:45:00+01:00"
meta_identity: "/home/alukard/Documentos/OpenConfApp/.git"
meta_key: "openconfapp-bf6d4dde39633532"
source_type: intent
source_reference: "intent:sha256:62c39cf60abe2f7587fea380f97d1855791a7b1bd03b8d0a52b73f85246c82fd"
source_key: "selector-elemento-preview-bfa8e896cfd3f1de"
---

# Selector de elemento en el preview: elegir un elemento de la página y mandarlo al agente con contexto útil

> Borrador. No aprobado. Este plan no autoriza implementar nada.
> La aprobación del plan no autoriza por sí sola implementar la fase 1.

## Objective

Añadir al dock de preview (`PreviewDock.tsx`, preview por iframe + sondeo Rust
de #43) un **modo selección**: el usuario activa el modo desde el dock, el
elemento bajo el cursor se resalta, al hacer clic se captura un contexto
compacto del elemento (selector CSS estable, etiqueta, rol, texto corto, estilos
computados curados, caja) y se manda a la sesión activa como prompt numerado
(`client.session.prompt`), sin volcar el DOM entero. Escape sale del modo y la
navegación normal del preview no se rompe. Cubre el punto 3 «Selector de
elemento en preview» de `docs/estado-plan-paridad.md`.

## Decisión arquitectónica: proxy propio vs multiwebview

El preview actual es un iframe de **otro origen**; la política de
mismo origen (same-origin) impide leer el DOM, sus estilos y su consola desde la app, y el
contenido remoto no puede invocar IPC de Tauri (`docs/preview-viabilidad.md`,
decisión 1; `docs/seguridad.md`, «CSP del preview» #81 y SSRF #83). Las dos
vías posibles para un selector real ya estaban identificadas en
`docs/preview-viabilidad.md` (opciones B y D):

### Comparación coste / riesgo

| Criterio                                    | A. Proxy propio que inyecta el selector (opción D)                                                                                                                                                                                                                            | B. Multiwebview de Tauri con script inyectado (opción B)                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mecanismo                                   | Listener HTTP loopback propio en Rust; reenvía peticiones al origen upstream validado; inyecta un script en respuestas `text/html`; la página queda **mismo origen** con el proxy; selección por DOM real + `postMessage` al padre. No requiere acceso cross-origin a la app. | `tauri` feature `unstable` (`add_child`, `WindowBuilder` sin webview, bounds por código); script de inicialización inyectado; eventos al padre.                                                                                                                                                                                                                                                                        |
| Soporte Wayland (esta sesión Linux/Wayland) | **No toca el modelo de ventanas.** Puro HTTP en Rust. Funciona igual en Wayland y X11.                                                                                                                                                                                        | **Bloqueado en esta sesión**: `wry` 0.57.3 en Linux solo crea webviews hijos por X11; `new_as_child` exige `RawWindowHandle::Xlib` y devuelve `UnsupportedWindowHandle` con Wayland (`docs/preview-viabilidad.md`, `wry#1197`); los ejemplos de multiwebview tienen incidencia abierta; se reportan layouts rotos en WebKitGTK con `add_child`. El workaround `GDK_BACKEND=x11` **renuncia a Wayland**, no lo arregla. |
| Coste de mantenimiento                      | Feature propia pero autocontenida (`preview_proxy.rs`); sin dependencias nuevas (HTTP manual con `std`, como `preview.rs`); proxy de nuevo listener = superficie nueva a proteger (token + loopback + Host + upstream fijo + TTL).                                            | Cambia el modelo de ventanas de toda la app para una feature; feature `unstable` de `tauri`; gestión de bounds y z-order; compilación y CI afectados.                                                                                                                                                                                                                                                                  |
| Seguridad / IPC                             | Contenido remoto sigue **sin IPC de Tauri**; `capabilities/default.json` intacto; CSP de la app intacta (`frame-src` ya permite loopback); proxy no puede convertirse en relay arbitrario (upstream fijo validado, solo loopback).                                            | Habría que **relajar seguridad**: Tauri rechaza IPC de orígenes remotos; habría que abrir una capability para `http://localhost:*`, es decir, exponer IPC a **cualquier** página servida en ese puerto (`docs/preview-viabilidad.md`, opción B). Contradice «nada de abrir red arbitraria».                                                                                                                            |
| Riesgo técnico                              | Fidelidad del preview vía proxy: reescritura de URLs (relativas vs absolutas), CSP del upstream sobre el script inyectado, cookies, `Location`, HMR/WebSocket. Mitigado con alcance MVP y degradación explícita.                                                              | En Wayland no arranca; con X11 sigue siendo modelo inestable.                                                                                                                                                                                                                                                                                                                                                          |
| Captura / estilos                           | DOM real accesible dentro del iframe proxied; `getComputedStyle` trivial. Screenshot de elemento requeriría rasterizar DOM (no hay API nativa) o captura de plataforma; **fase posterior**.                                                                                   | DOM real accesible; screenshot dependería de captura de webview/plataforma; **fase posterior**.                                                                                                                                                                                                                                                                                                                        |

### Elección

**Se elige A, proxy propio (opción D), sobre el iframe existente.** Es la única
vía con selector real que mantiene el modelo de ventanas, funciona en Wayland,
**no relaja ninguna capability de Tauri ni la CSP de la app**, y el contenido
remoto sigue sin poder invocar IPC. La opción B se **descarta** por lo ya
documentado en `docs/preview-viabilidad.md` (Wayland + `unstable` + relajar IPC
para orígenes remotos). La opción A original (iframe directo) se **conserva**
cuando el modo selección está inactivo; el proxy solo se activa mientras dura
el modo selección. `docs/preview-viabilidad.md` dejó por escrito que «cuando
exista un proxy propio (opción D) el selector se podrá añadir sobre esta base
sin cambiar el dominio del preview»; este plan realiza ese paso.

### Mínimo viable (Fase 1)

- Botón «Seleccionar elemento» en el dock (`aria-pressed`), solo con preview
  `ready`.
- Al activar: `preview_proxy_start(url, appOrigin)` (comando Tauri) valida el
  mismo loopback que `preview_probe`, levanta listener `127.0.0.1:0`, devuelve
  `PreviewProxySession { baseUrl, token, proxyOrigin }`; el iframe recarga
  contra el proxy; el script del selector se sirve desde el propio proxy.
- Resaltado del elemento bajo el cursor (overlay + outline), sin romper
  scrolling; al hacer clic se captura `PreviewElementContext` y se suprime la
  navegación/click por defecto solo en modo selección.
- `postMessage` validado hacia la app (origen + `event.source` + `nonce` +
  esquema + longitudes); la app **sanea** el payload antes de componer el
  prompt; nada del contenido de la página se trata como instrucción.
- Prompt compacto numerado a la sesión activa con sección `Elemento` recortada;
  reusa `buildPreviewPrompt` + petición del usuario (`note`); tope total
  `PREVIEW_PROMPT_MAX`; no se vuelca el DOM.
- Escape sale del modo (dentro del iframe y en la app), notifica, para el
  proxy (`preview_proxy_stop(token)`), restaura el iframe a la URL original y
  desbloquea la navegación normal. Cerrar el dock / cambiar de URL también
  para el proxy.
- **Estilos computados curados** (subconjunto fijo ~15 propiedades, valores
  recortados): son baratos con `getComputedStyle` dentro del iframe.
- **Captura (screenshot) del elemento: NO en Fase 1.** No hay API de
  rasterizado DOM→imagen en el webview; haría falta dependencia de captura o
  API de plataforma (portal `org.freedesktop.portal.Screenshot` en Wayland,
  ver `docs/preview-viabilidad.md`, opción C). Queda **Fase 2**.
- **Consola: NO en Fase 1.** La captura de `console.*`/`window.onerror` del
  iframe es posible vía script inyectado pero es otra garantía y otra
  superficie; queda **Fase 2**. No se rompe nada de consola existente.

### Forma del proxy propio (Fase 1, diseño)

`src-tauri/src/preview_proxy.rs` (nuevo; sin dependencias nuevas):

- Bind `TcpListener::bind(("127.0.0.1", 0))`; **solo loopback**.
- Prefijo `/__ot__/` reservado para recursos propios (`/__ot__/selector.js`);
  `/__ot__/<token>/...` no se expone; el token **no** aparece en la URL final
  servida al app (entra una vez + cookie `HttpOnly; SameSite=Strict; Path=/`,
  ver «ticket del diálogo» abajo); `GET /__ot__/enter?token=...&to=...` hace
  302 tras `Set-Cookie`, quitando el token de la URL.
- Upstream **fijo** por sesión = `Target` validado una vez con `parse_target`
  - `validate_preview_host` + re-validación de loopback tras DNS en `connect`
    (reuso `pub(crate)` de `preview.rs`); **no** se acepta host/esquema por
    petición; **no** se abre red arbitraria; rutas normalizadas sin `..`; no se
    siguen redirecciones fuera de loopback; `Location` reescrito a origen proxy;
    timeouts + tope de tamaño por respuesta; sin passthrough de cabeceras
    hop-by-hop; `Set-Cookie` sin `Domain` foráneo; `X-Frame-Options` /
    `frame-ancestors` del upstream neutralizados en respuestas proxied (servimos
    nosotros; la app sigue embebiendo solo loopback); CSP del upstream se
    **ajusta mínimamente** para permitir el script propio (`script-src` + self
    proxy) sin añadir `'unsafe-inline'` a la app; app CSP intacta.
- Inyección en `text/html`: `<script src="/__ot__/selector.js"></script>`
  antes de `</body>` + inyección de configuración no secreta (`nonce`, origen
  padre validado, `proxyOrigin`, URL original base). Script estático
  (`include_str!`, sin build extra).
- HMR/WebSocket **no reenviado** en Fase 1 (documentado): renderizado + HMR
  best-effort; el modo selección es transitorio. Assets proxied normalmente.
- Métodos HTTP reenviados (GET/POST/...) con cuerpo y cabeceras seguras; sin
  credenciales inyectadas.

### Contrato del elemento (`PreviewElementContext`, dominio puro)

```ts
type PreviewElementContext = {
  tag: string; // minúsculas, p. ej. "button"
  role: string | null; // role explícito o rol ARIA implícito curado
  selector: string; // CSS estable y único, recortado (~300)
  name: string | null; // nombre accesible corto
  text: string; // texto corto, sin saltos, recortado (~200)
  url: string; // ruta + query + hash dentro del preview (origen original)
  rect: { x: number; y: number; width: number; height: number } | null;
  computedStyles: Partial<Record<PreviewStyleProp, string>> | null; // subconjunto curado, valores recortados
};
```

`PostMessage` entrante (no confiable, se valida): `{ source: "opentemplates-preview-selector", version: 1, type, nonce, element? }`. Selector: preferir `id` único, atributos estables (`data-testid`/`data-test`/`data-cy`/`data-qa`/`aria-label`/`name`), si no camino `tag:nth-of-type`, acortado si es único, recortado. Nunca `outerHTML`/DOM entero. El prompt añade sección numerada «Elemento» con estos campos; todo recortado; **no se ejecuta nada** del contenido; no se guarda nada extra.

## Seguridad (reglas del repo, aplicadas)

| Regla                                                                                                                                                                                                                      | Cumplimiento                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Solo loopback** (#81/#83, `docs/seguridad.md`)                                                                                                                                                                           | Upstream = mismas reglas que `preview_probe` (`validate_preview_host`, rechazo pre-DNS, todas las IPs resueltas loopback, sin credenciales, sin redirecciones fuera de loopback). Proxy escucha **127.0.0.1** efímero. CSP `frame-src http://localhost:* http://127.0.0.1:*` **sin cambios**; proxy origin casa.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Ticket del diálogo** (`SessionFileTicket`, `begin_session_file`, `issue_session_ticket`/`consume_session_ticket`, TTL `SESSION_TICKET_TTL`, token de un solo uso, «el webview nunca elige la ruta», `docs/seguridad.md`) | **Sin cambios** en tickets de ficheros. **No** se añade diálogo nativo nuevo ni acceso a ficheros. Patrón replicado con `PreviewProxyTicket`: (1) `preview_proxy_start` solo invocable por el **webview de la app**; el contenido remoto **no puede llamar IPC** (`capabilities/default.json` intacto, sin capability para orígenes remotos); (2) token **aleatorio** emitido por **Rust**, no elegido por el webview ni por el contenido; (3) emitido tras **acción explícita del usuario** (botón del dock); (4) ligado al **origen upstream canónico validado**; (5) **TTL corto** + `preview_proxy_stop` + limpieza al cerrar; (6) no persistido; (7) **ticket de activación de un solo uso** para crear la sesión + **token de sesión** obligatorio en el listener (no reutiliza `SessionFileMode`). Diferencia deliberada con `SessionFileTicket`: un proxy transparente hace muchas peticiones; la ligadura de origen + TTL + parada explícita sustituyen al consumo único. Nada del contenido del iframe puede pedir nuevos tickets. |
| **CSP acotada**                                                                                                                                                                                                            | CSP de la app **sin tocar** (`default-src 'self'; script-src 'self'; frame-src http://localhost:* http://127.0.0.1:*; connect-src … loopback …`); iframe `sandbox` actual sin cambios; sin `unsafe-inline` nuevo; script inyectado servido desde origen proxy con `script-src` ajustado solo en respuestas proxied; sin `*`; sin ampliar `connect-src`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Nada de abrir red arbitraria**                                                                                                                                                                                           | Proxy no es relay genérico: upstream fijo validado, sin passthrough de host, sin abrir `open_external` nuevo, `capabilities` intactas, sin CORS nuevo, `Origin`/`event.origin` verificados, Host check anti DNS-rebinding, sin seguir redirecciones fuera de loopback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Limitaciones explícitas (no silenciadas)

- Fidelidad vía proxy: apps con CSP estricta propia, URLs absolutas a origen
  upstream, cookies con `SameSite`/`Domain`, service workers o HMR/WS pueden
  degradar el render **solo en modo selección**; al salir se restaura el
  preview directo. Si el proxy no puede servir la página, la UI avisa y
  mantiene el preview normal (degradación, no error silencioso).
- `https` loopback upstream sin verificación TLS (mismo estado que
  `preview_probe`, `verified:false`); proxy re-sirve por `http` loopback.
- **Screenshot de elemento** y **consola** pospuestos a Fase 2. No se afirma
  que existan.
- Estilos computados: subconjunto curado; no es un volcado completo de CSS.

## Seguridad de `postMessage`

Origen proxy conocido + `event.source === iframe.contentWindow` + `nonce`
aleatorio por sesión inyectado + `source`/`version` + validación de esquema +
recorte de longitudes + `targetOrigin` exacto (nunca `'*'`) + comandos solo
desde origen padre verificado. Payload tratado como **datos no confiables**
(no instrucciones; `docs/handoff.md` marca contenido importado como dato, no
instrucciones, misma línea).

## Acceptance criteria

- Con preview `ready`, el dock muestra «Seleccionar elemento»; al activarlo se
  sirve la página vía proxy loopback con script inyectado; el elemento bajo el
  cursor se resalta; el click captura y manda prompt compacto a la **sesión
  activa**; sin sesión activa, aviso (mismo criterio que «Enviar al agente»).
- Prompt numerado con recorte; sección `Elemento` con selector CSS estable,
  etiqueta, rol, texto corto, estilos computados curados (si `getComputedStyle`
  disponible) y caja; **sin DOM completo**; petición del usuario incluida.
- Escape sale del modo (desde dentro del iframe y desde la app), para el proxy,
  restaura URL + navegación normal; no queda overlay ni listener colgando.
- Seguridad verificada por tests (ver Fase 1 checks): token obligatorio;
  host no-loopback rechazado; sin ticket no se sirve; upstream no arbitrario;
  sin redirección fuera de loopback; CSP/capabilities intactas; `postMessage`
  con origen/`source`/`nonce`/esquema; payload no confiable saneado.
- `pnpm check`, `pnpm build`, `cargo test` en `src-tauri` en verde.
- Docs actualizadas: `docs/handoff.md`, `docs/estado-plan-paridad.md`,
  `docs/preview-viabilidad.md`, `docs/seguridad.md` (Fase 1).

## Non-goals

- **Multiwebview**: descartado (Wayland + `unstable` + relajar IPC remoto).
- **Screenshot/captura del elemento** y **consola del preview**: Fase 2.
- **HMR/WebSocket reenviado** por el proxy; **service workers**; apps que no
  rendericen proxied sin reescritura completa; reescritura total de JS.
- Preview **remoto** / no-loopback; ampliar CSP; abrir red arbitraria; nueva
  capability Tauri; diálogo nativo nuevo; persistir nada del elemento.
- Volcar DOM; historial; editar código desde el selector; agente que actúe
  sobre el elemento automáticamente (solo se envía contexto al agente).
- Commitear o publicar: sin permiso explícito.

## Repositories and paths

| Repository    | Canonical checkout / worktree                                                                                                      | Paths in scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenTemplates | `/home/alukard/Documentos/OpenConfApp` (rama `develop`, desde ella rama `feature/preview-selector-elemento`; **no se crea ahora**) | `src-tauri/src/preview_proxy.rs` (nuevo), `src-tauri/src/preview.rs`, `src-tauri/src/state.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/preview-selector.js` (nuevo, `include_str!`), `src-tauri/tauri.conf.json` (verificar CSP sin cambios), `src-tauri/capabilities/default.json` (sin cambios), `src/domain/preview/preview.ts`, `src/domain/preview/element.ts` (nuevo), `src/domain/repositories/PreviewGateway.ts`, `src/data/tauriCommands.ts`, `src/data/TauriGateways.ts`, `src/presentation/components/PreviewDock.tsx`, `src/presentation/hooks/usePreview.ts`, `src/tests/fakes.ts`, tests `src/**/__tests__/*` + `src-tauri` `#[cfg(test)]`, `docs/handoff.md`, `docs/estado-plan-paridad.md`, `docs/preview-viabilidad.md`, `docs/seguridad.md` |

Convenciones: `/home/alukard/.config/opencode/AGENTS.md` (reglas de sesión;
no hay `AGENTS.md` en el repo; proyecto OpenTemplates «OpenConfApp»).
Arquitectura/estilo: `docs/arquitectura-workspaces.md`,
`docs/revision-clean-architecture-y-testing.md`,
`docs/auditoria-clean-architecture-y-tests-2026-11-26.md`, `docs/seguridad.md`,
`docs/preview-viabilidad.md`;
Clean Architecture (`domain` puro sin Tauri/React; `data` adaptadores;
`presentation`; Composition Root; `pnpm check:layers`); tests con Vitest +
React Testing Library; `cargo test`. Commits en español, prefijo convencional;
rama desde `develop`. **No commitear ni publicar sin permiso explícito.**
Puerta de cierre: `pnpm check`, `pnpm build`, `cargo test` en `src-tauri`.

**Confirmed scope.** Inspeccionado: `docs/preview-viabilidad.md`, punto 3 de
`docs/estado-plan-paridad.md`, `docs/seguridad.md`, `PreviewDock.tsx`,
`src-tauri/src/preview.rs`, `commands.rs` (`preview_probe`, `open_external`,
`begin_session_file`), `state.rs` (`SessionFileTicket`),
`lib.rs` (registro de comandos), `tauri.conf.json` (CSP),
`capabilities/default.json`, `PreviewGateway`, `TauriPreviewGateway`,
`tauriCommands.ts`, `usePreview.ts`, `domain/preview/preview.ts`
(`buildPreviewPrompt`, `PREVIEW_PROMPT_MAX`), tests `PreviewDock.test.tsx`,
`preview.test.ts`, `src/tests/fakes.ts`, `package.json`, memoria
`OpenTemplates: commits y entrega`, skill `create-plan`, contrato
`local-plans/v1`. **No inspeccionado a fondo**: estilos CSS del dock
(`.preview-*`), `src-tauri/src/server.rs`, resto de `commands.rs`, CI, i18n,
`docs/handoff.md` completo (solo convención «Estado tras #N» + cola),
`docs/analisis-openchamber-opencode-desktop.md`, `docs/modelo-templates-repos.md`,
`docs/modelo-features.md`. No se ejecutan suites en planificación.

## Public contracts affected

**Rust (nuevos):**

- `preview_proxy::PreviewProxySession { baseUrl, token, proxyOrigin }`
  (Serialize camelCase); `preview_proxy::PreviewProxyTicket`; errores `String`.
- Comandos Tauri nuevos `preview_proxy_start(url, appOrigin) ->
  Result<PreviewProxySession,String>`, `preview_proxy_stop(token)` (registrados
  en `lib.rs` `invoke_handler`); `AppState` += `preview_tickets` /
  `preview_proxies`; `preview_proxy.rs` nuevo; `preview.rs`:
  `Target`, `parse_target`, `validate_preview_host`, `connect`,
  `is_loopback_ip`, `validate_redirect` pasan a `pub(crate)` (sin cambio de
  comportamiento). CSP y `capabilities` **sin cambios**.
- Tests Rust nuevos en `preview_proxy.rs` + `preview.rs` sin regresión.

**TypeScript (nuevos/modificados):**

- `PreviewGateway` += `startElementPicker(url): Promise<PreviewProxySession>`,
  `stopElementPicker(token): Promise<void>`; `TauriPreviewGateway` impl;
  `tauriCommands` += `previewProxyStart`, `previewProxyStop`.
- `domain/preview/element.ts` nuevo: `PreviewElementContext`,
  `PreviewStyleProp`, `PREVIEW_ELEMENT_LIMITS`, `isPreviewElementContext`,
  `sanitizePreviewElement`, `isPreviewSelectorMessage`, `buildElementPrompt`
  (o extensión `PreviewPromptInput.element` + `buildPreviewPrompt`); sin tocar
  `PREVIEW_PROMPT_MAX`.
- `PreviewDock`: nuevo botón + wiring + listener `message` + swap de iframe
  src; restauración en Escape/desmontaje. Copy en español.
- Fake `makePreviewGateway` += métodos nuevos. `session.prompt` reutilizado.

**Docs:** secciones «Estado tras…» en `docs/handoff.md`; punto 3 +
«Decisiones que conviene no reabrir» en `docs/estado-plan-paridad.md`;
actualización de «Selector de elemento» en `docs/preview-viabilidad.md`;
nueva sección proxy en `docs/seguridad.md`. Sin cambios de esquemas
persistidos ni de CLI.

## Decisions

**Ya decidido (con motivo):**

- Proxy propio (A/D) sobre iframe; multiwebview descartado (Wayland + `unstable`
  - relajar IPC remoto) - evidencia `docs/preview-viabilidad.md`.
- Modo selección transitorio; preview directo sin proxy cuando inactivo.
- Sin dependencias nuevas (`std`, sin `unsafe`; proxy HTTP manual como
  `preview.rs`); sin cambio CSP; sin capability nueva; sin diálogo nativo
  nuevo; sin commits/publicación.
- Contexto compacto + estilos computados curados; sin DOM completo.
- Screenshot + consola Fase 2; HMR/WS Fase 2; límites documentados.
- `postMessage` estricto + payload no confiable + saneado.
- Seguridad: loopback + ticket de un solo uso estilo `SessionFileTicket` +
  token de sesión + TTL + Host + origen + upstream fijo + CSP acotada +
  no-redirección-fuera-de-loopback.

**Abierto / necesita decisión del usuario (no bloquea revisar el diseño):**

- Copy exacto del botón/estado en español (propuesta: «Seleccionar elemento»,
  «Seleccionando…», «Elemento enviado a la sesión activa»). (Asume si no hay
  cambio.)
- Confirmación nativa adicional (`app.dialog().message`) antes de abrir el
  proxy: **resuelto por el usuario: no**; lectura «ticket del diálogo» =
  patrón `SessionFileTicket` replicado sin diálogo nuevo.
- Nombre de rama/PR; incluir `docs/` en el mismo commit. (Asume
  `feature/preview-selector-elemento`.)

## Risks

- **Proxy incompleto rompe render** en dev servers con CSP estricta, URLs
  absolutas, cookies o HMR. Mitigación: MVP acotado + degradación explícita +
  restaurar preview directo + tests de inyección/CSP; HMR documentado no
  soportado; límites en docs.
- **Superficie local nueva (listener 127.0.0.1).** Mitigación: token aleatorio
  obligatorio + TTL + Host check + bind loopback + upstream fijo + no relay +
  no persistencia + tests; amenaza residual (procesos locales) documentada
  como en `docs/seguridad.md` «Limitaciones asumidas».
- **`postMessage` injection.** Mitigación: origen + `source` + `nonce` +
  esquema + recorte + no ejecutar; tests con mensajes maliciosos.
- **Wayland/WebKitGTK.** Proxy no toca ventanas; seguridad de CSP no
  verificable en CI (`docs/seguridad.md` «Falta un arranque manual»); incluir
  pasos de verificación manual en `docs/seguridad.md`; no se promete
  verificación en CI.
- **Selector inestable.** `nth-of-type` frágil ante re-render; mitigación:
  preferir `id`/atributos estables, acortar, recortar; best-effort documentado.
- **SSRF ampliado por proxy.** Mitigación: misma política loopback que
  `preview_probe` revalidada por petición + anti-rebinding + upstream fijo +
  tests; ver `docs/seguridad.md` #83.
- **Capa/pureza.** Lógica de dominio pura sin Tauri; proxy solo en `data`
  Rust; `pnpm check:layers`; tests antes que implementación (RED/GREEN).

## Phases

Una sola **Fase 1 vertical** revisable (UI + dominio + proxy + seguridad +
tests + docs en verde), granularidad mínima razonable; **Fase 2** documentada
pero **no autorizada**. (Sin separar por capa ni por repositorio.)

### Phase 1: Modo selección + proxy propio + contexto compacto + tests + docs

- state: pending
- depends_on: []
- authorization: null
- acceptance:
  - Botón «Seleccionar elemento» en el dock; `aria-pressed`; solo con preview `ready`.
  - Activar inicia proxy loopback + script inyectado; elemento resaltado; click captura `PreviewElementContext`.
  - Prompt compacto numerado a la sesión activa con sección `Elemento`, recortado; sin DOM; sin sesión activa avisa.
  - Escape sale (dentro del iframe y en la app); proxy parado; iframe restaurado; navegación normal intacta.
  - Estilos computados curados incluidos si disponibles.
  - Seguridad verificada (token, loopback, host, no-arbitrario, no-redirección, CSP/capabilities intactas, `postMessage`, saneado); `capabilities` y CSP sin cambios.
  - `pnpm check`, `pnpm build`, `cargo test` (src-tauri) en verde; docs actualizadas.
- tasks:
  - [ ] RED: tests Rust `preview_proxy` (token obligatorio; host no-loopback rechazado; sin ticket no sirve; upstream no arbitrario; no redirección fuera de loopback; inyección `text/html`; no inyecta en no-HTML; `Location` reescrito; header hygiene; servidor HTTP local real; puerto cerrado; límites; stop). Reuso tests `preview.rs`.
  - [ ] RED: tests TS dominio `element.ts` (saneado, esquema `postMessage`, nonce/origen, selector, caps, `buildElementPrompt`/extensión `buildPreviewPrompt`, no DOM, payload malicioso).
  - [ ] RED: tests `PreviewDock` (activar modo, resaltar no requiere assert sobre DOM del iframe; swap src a proxy; `postMessage` origen+`source`+nonce+esquema; prompt a `session.prompt`; Escape; sin sesión; desactivar restaura; fake `makePreviewGateway`).
  - [ ] GREEN: `preview_proxy.rs` + `AppState` + comandos `preview_proxy_start/stop` + `lib.rs`; reutilizar `pub(crate)` de `preview.rs`; asset `preview-selector.js`.
  - [ ] GREEN: dominio `element.ts` + extensión prompt; `PreviewGateway` + `TauriPreviewGateway` + `tauriCommands`; `PreviewDock` + `usePreview`.
  - [ ] Docs: `docs/handoff.md`, `docs/estado-plan-paridad.md`, `docs/preview-viabilidad.md`, `docs/seguridad.md`.
  - [ ] Verificación manual (documentada, no en CI): app Tauri con servidor local real; CSP sin errores; Wayland; Escape; navegación. (No ejecutada en planificación.)
- checks:
  - Focused RED/GREEN: `cargo test preview_proxy` + `cargo test preview` (src-tauri); `pnpm vitest run src/domain/__tests__/preview.test.ts` + nuevo `element.test.ts` + `PreviewDock.test.tsx`.
  - Closing gate: `pnpm check && pnpm build && (cd src-tauri && cargo test)`.
  - Independent: revisión manual de seguridad + checklist CSP `docs/seguridad.md`; `pnpm check:layers`.
- evidence: <vacío hasta ejecutar>
- checkpoint: <vacío>
- next_action: Revisión 1 aprobada; pendiente instrucción explícita para implementar Fase 1 TDD con rama desde `develop`.

### Phase 2: Captura del elemento (screenshot) + consola del preview

- state: pending
- depends_on: [1]
- authorization: null
- acceptance:
  - Captura del elemento (PNG) adjunta opcional al contexto, sin inventarla si no se puede.
  - Consola del preview capturada (buffer acotado, recortado) si el requisito lo confirma.
- tasks:
  - [ ] Decidir mecanismo de captura (rasterizado DOM vs API de plataforma; Wayland portal) - **pendiente de aprobación explícita**.
  - [ ] Consola vía script inyectado (`console.*`, `onerror`, `unhandledrejection`) buffer acotado + opt-in.
- checks:
  - Focused + closing gate igual que Fase 1.
- evidence: <vacío>
- checkpoint: <vacío>
- next_action: **No autorizada.** Requiere aprobación explícita tras aceptar Fase 1; confirmar mecanismo de captura y si la consola entra.

## Gates

- Focused: RED/GREEN de tests seleccionados **antes** de implementar (ver checks Fase 1). No se inventan nombres/resultados.
- Closing: `pnpm check && pnpm build && cargo test` en `src-tauri`.
- Independent: revisión de seguridad + verificación manual CSP en app Tauri real (`docs/seguridad.md`); no hay gate extra de repo confirmado más allá de `pnpm check` + `pnpm check:layers` + `cargo test`.
- Planificación **no** ejecuta suites, lint, builds ni coverage; se registran comandos, no salidas.
- Herramienta: `opencode`. Modelo: `unknown`. Sin inventar aprobaciones ni ejecuciones.

## History

- revision 1 (2026-11-28T02:25:16+01:00): borrador creado. No aprobado. Ninguna fase autorizada. herramienta=opencode, modelo=unknown.
- revision 1 (2026-11-28T02:45:00+01:00): **aprobada por el usuario** (revisión 1 exacta). Resuelve «ticket del diálogo»: sin diálogo nativo adicional; patrón `SessionFileTicket` replicado. **No autoriza implementar la fase 1**.

## Next permitted action

Revisión 1 **aprobada** por el usuario. «ticket del diálogo»: sin diálogo
nativo adicional; patrón `SessionFileTicket` replicado. **No se ha autorizado
implementar la fase 1**: esperar instrucción explícita. Al implementar:
rama desde `develop`, TDD (RED/GREEN seleccionado arriba), no tocar CSP ni
capabilities, puerta `pnpm check && pnpm build && (cd src-tauri && cargo test)`,
docs de fase. **No commitear ni publicar sin permiso explícito.** Fase 2 no
autorizada.
