# Análisis de OpenChamber y OpenCode Desktop: qué podemos añadir a OpenTemplates

Fecha: 2026-11-22 · Rama: `ci/action-bumps` · OpenTemplates 0.2.0

## Qué se ha analizado

| Fuente | Versión / referencia |
|---|---|
| OpenTemplates (este repo) | 0.2.0, Tauri v2 + React 19, `@opencode/client` 2.3.2 |
| opencode (motor) | v2.3.0 en `PATH`; SDK con 31 namespaces |
| OpenChamber | instalada (`/opt/OpenChamber`, build 2026-11-15, `opencode-cli` 2.3.0) + `main` del repo (744 páginas de docs) |
| OpenCode Desktop | instalada (`/opt/OpenCode`) + `dev` del repo `anomalyco/opencode` (`packages/app`, `packages/desktop`) |

Las dos apps son Electron sobre el mismo motor y el mismo API. La comparación sirve
porque marcan el techo de lo que el API de opencode ya permite hoy: casi todo lo que
hacen ellas se puede hacer desde OpenTemplates **sin tocar el CLI**, solo consumiendo
endpoints que el SDK ya expone.

## Lo que OpenTemplates ya tiene

- Workspaces aislados: un `opencode serve` por workspace con `XDG_CONFIG_HOME`,
  `OPENCODE_DB`, password y `OPENCODE_DISABLE_PROJECT_CONFIG` propios.
- Templates versionados (agentes, MCPs, skills, plugins, modelo, permisos
  declarativos, `AGENTS.md`) con reaplicación.
- Repos con worktrees y `worktreesRoot` configurable.
- Chat: agente, modelo, razonamiento, actividad de tools (solo estado), razonamiento
  colapsable, nueva conversación, parar. **Una sesión activa por workspace.**
- Inspector: sesión (tokens, coste, acierto de caché), proyecto (`vcs` branch/status),
  uso (límites semanal/mensual, saldo), recursos (CPU/RSS del proceso), fuentes
  (toggles de skills y MCP en caliente).
- Ajustes por workspace (template, MCPs, skills, modelo), logs del proceso, updater.

Huecos confirmados por búsqueda en el código: no hay diff, ni árbol de ficheros, ni
terminal, ni historial de sesiones, ni permisos/preguntas interactivas, ni
notificaciones, ni temas/keybinds/paleta, ni adjuntos, ni export/fork, ni slash
commands, ni preview, ni commit/PR.

## Mapa de capacidades

### OpenChamber

| Bloque | Qué aporta |
|---|---|
| Session Goals | Criterio de fin de sesión; reintenta turnos hasta cumplirlo, sobrevive al cierre de la app |
| Multi-run + Fusion | Hasta 5 modelos en sesiones/worktrees separados; compara y fusiona el mejor resultado |
| Changes Walkthrough | Tour del diff agrupado en pasos con explicación del agente |
| Preview | App/dev server embebido; clic en un elemento envía screenshot + estilos + errores al agente |
| GitHub | Arrancar sesión desde issue/PR, devolver checks fallidos y comentarios, actualizar/mergear PR |
| Multi-dispositivo | Desktop, Web/PWA, VS Code, iOS/Android; pairing por QR, Private Relay E2E, LAN/túneles/SSH |
| Control | Dashboard por proyecto (estado, aprobaciones, tareas programadas, límites de proveedor, tokens y coste), carpetas, notas/todos/plans |
| Extras | Tareas programadas (cron), agent-control tool, agent pages, auto model routing, magic prompts, project actions, catálogo de skills, git identities, temas, voz |

### OpenCode Desktop

| Bloque | Qué aporta |
|---|---|
| Shell | Pestañas con grupos y drag, sidebar con sesiones fijadas, paleta de comandos, keymap, deep links, notificaciones + sonido, multi-ventana, zoom, export de logs |
| Timeline | Virtualizada, búsqueda en conversación, citar mensajes, diffs por turno, reconexión, salto a mensaje |
| Requests docks | Permisos, preguntas del agente, elicitation, aprobación de websearch, auto-approve |
| Composer | Adjuntos e imágenes, editor rico, historial, slash commands, cola de mensajes, panel de shell (`!`), barra de subagentes, pill de todos, chip de modelo |
| Sesión | Renombrar, fork, export, eliminar, handoff |
| Proveedores | Conexión guiada (incluye sign-in de MCP y ChatGPT), gestión de modelos, límites y free/go limit |
| Servers | Registro de servidores y pairing por QR (remoto/móvil) |
| Workspace | Árbol de ficheros con watcher y visor, LSP, opciones por proyecto |
| Voz | Modo llamada con transporte y tools propias |
| Ajustes | Apariencia/zoom, keybinds, notificaciones, experimental, about/licenses, instalar CLI |

## Huecos y features candidatas

Todo lo marcado como disponible en SDK existe ya en `@opencode/client` 2.3.2
(namespaces `session`, `permission`, `command`, `file`, `pty`, `shell`, `vcs`,
`worktree`, `usage`, `event`, `mcp`, `skill`, `voice`…). No hace falta fork del motor.

### Fase 1 — barato, alto impacto, sin decisiones de producto

| # | Feature | Por qué encaja | API | Esfuerzo |
|---|---|---|---|---|
| 1 | Historial de sesiones por workspace | Hoy solo se recuerda la última; el aislamiento por `OPENCODE_DB` ya da el historial gratis | `session.list/get/update/remove`, `message.list` | S |
| 2 | Dock de permisos y preguntas | Los permisos son estáticos por template; si un agente pide `ask` la UI no existe. Riesgo real de bloqueo silencioso | `permission.list/reply`, eventos, `session.background` | M |
| 3 | Panel de diff y ficheros | Revisar el cambio es el 80 % del valor de un workspace; hoy hay que salir a un editor | `session.diff`, `vcs.diff/status`, `file.list/read/find/watch` | M |
| 4 | Slash commands y skills invocables | `command.list` + `skill.list` ya existen y no se usan en el composer | `command.list`, `session.command` | S |
| 5 | Pill de todos/plan | opencode ya emite todos por sesión; hoy se pierden | eventos de sesión | S |
| 6 | Notificaciones nativas | Turno terminado o permiso esperando, con badge por workspace | `tauri-plugin-notification` + eventos | S |
| 7 | Coste y uso por workspace acumulado | El Inspector da la sesión; falta serie temporal y presupuesto por template | `session.stats`, `usage.limits` | S |
| 8 | Export/import y fork de sesión | Compartir una sesión reproducible entre templates/workspaces | `session.export/import/fork` | S |

### Fase 2 — el diferenciador propio

| # | Feature | Por qué encaja | API | Esfuerzo |
|---|---|---|---|---|
| 9 | Terminal por workspace | Refuerza "workspace aislado": shell dentro del mismo cwd y entorno que el agente | `pty.*`, `shell.*` | M |
| 10 | Multi-run sobre templates | Encaja con la marca: mismo prompt, N modelos × N worktrees, comparar y quedarse uno. OpenChamber lo limita a 5 y a su propia UI | `session.create/prompt`, `worktree.*` | L |
| 11 | Session Goals | Bucle de reintento con criterio de fin y límite de turnos, estado persistido en Tauri | `session.prompt/background/stats` | M |
| 12 | Flujo git/PR | Commit asistido, crear PR, devolver checks fallidos al agente | `vcs.*` + `gh` CLI | M |
| 13 | Preview + selector de elemento | Enviar screenshot/estilos/errores al agente evita el "esto de aquí" | webview Tauri + `session.prompt` | L |
| 14 | Paleta de comandos, keybinds y temas | Paridad de shell con Desktop; bajo coste y mucha percepción de acabado | solo UI | M |
| 15 | MCP runtime | Conectar/desconectar y estado sin reiniciar el workspace | `mcp.list/add/remove/connect/disconnect` | S |
| 16 | Tareas programadas | Un cron por workspace/template reutilizando el arranque que ya existe | orquestación propia | M |

### Fase 3 — estratégico, decidir antes de empezar

| # | Feature | Nota |
|---|---|---|
| 17 | Acceso remoto y móvil | Requiere servir el workspace fuera de Tauri (pairing, relay o tailnet). Es un producto distinto: decidir si entra |
| 18 | Voz | `voice.models/session` existe; valor bajo frente a coste de UI |
| 19 | Walkthrough del diff | Muy vistoso, pero primero hace falta el panel de diff (#3) |
| 20 | Catálogo/marketplace de templates | Encaja con la marca, pero necesita backend y gobierno de contenido |

## Lo que no recomiendo copiar

- Relay propio y apps iOS/Android: coste de infraestructura y soporte desproporcionado
  para el tamaño del proyecto; si hay demanda, tailnet/SSH antes que relay propio.
- Elicitation, websearch dock, queue panel y free/go limit: son resolución de problemas
  concretos de OpenCode Desktop y de su modelo de negocio, no del nuestro.
- Extensiones/temas de terceros con sandbox: mucho superficie de seguridad para el
  retorno.

## Orden sugerido

1. **#1, #7, #6**: hacen visible lo que ya ocurre (sesiones, coste, avisos). Sin cambios
   de modelo de datos, y son la base de casi todo lo demás.
2. **#2, #3, #5**: convierten el chat en un sitio donde se puede trabajar y revisar de
   principio a fin. Aquí está el mayor salto de utilidad por euro invertido.
3. **#9, #10, #11**: lo que nos diferencia de "un chat con opencode detrás": terminal,
   comparación de modelos y objetivos que se persiguen solos.
4. Revaluar #12–#16 con uso real de las fases anteriores.

## Nota de arquitectura

Cada feature nueva entra por el mismo camino que las existentes: interfaz de gateway en
`src/domain/repositories`, caso de uso en `src/domain/usecases`, implementación en
`src/data` (SDK o comando Tauri) y componente en `src/presentation`. Las que son de
estado (historial, goals, presupuesto) piden store en Rust; las que son de lectura pura
del API pueden vivir solo en el frontend, como ya hace `OpencodeChatGateway`.
