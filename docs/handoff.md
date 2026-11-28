# Handoff — templates, repos y worktrees

## Objetivo

Evolucionar OpenTemplates (Tauri v2 + React/TS) del modelo actual de workspaces
ad-hoc a:

- **Templates globales híbridos**: seleccionan assets de la biblioteca global de
  opencode y pueden añadir assets propios.
- **Repositorios** añadidos a la app.
- **Workspaces** creados desde un repo + template, en checkout principal o worktree.
- **Issues de GitHub** con `gh` para nombrar el workspace y la rama.
- **Sesiones** dentro del workspace, localizadas y controladas.

Decisiones cerradas por el usuario:

1. Templates híbridos (biblioteca global + assets propios).
2. Worktrees en ruta configurable (app data por defecto).
3. Solo GitHub con `gh` por ahora; fallback manual si no hay `gh`.
4. Avisar si se intenta abrir otro workspace sobre el mismo checkout principal;
   para paralelo, worktree.
5. Template congelado por workspace (selección + versión) y reaplicar explícito.

Diseño completo: `docs/modelo-templates-repos.md`.
Arquitectura de aislamiento: `docs/arquitectura-workspaces.md`.

## Estado actual

- App funcionando: crear/arrancar/parar workspaces, selección de MCPs/skills, chat
  mínimo con streaming, ajustes y persistencia.
- `npm run build`, `cargo check`, `cargo clippy`, `cargo test` pasan.
- `cargo test -- --ignored` arranca un opencode real y crea una sesión.
- Backend Rust: `src-tauri/src/{commands,config,model,server,state}.rs`.
- Frontend: `src/{App.tsx,api.ts,opencode.ts,types.ts,styles.css}` y
  `src/components/{Chat,CreateWorkspace,SettingsPanel,WorkspaceView}.tsx`.
- Datos en `~/.local/share/com.alukard.opentemplates/`.
- opencode v2.3.0; la app lo busca en `PATH` o `OPENCODE_BIN`.

## Invariantes verificados (no romper)

- Un proceso `opencode serve` por **huella de contexto** (no por workspace):
  - `XDG_CONFIG_HOME=<appdata>/contexts/<huella>/xdg`
  - `OPENCODE_DB=<appdata>/contexts/<huella>/opencode.db`
  - `OPENCODE_DISABLE_PROJECT_CONFIG=1`
  - `OPENCODE_SERVER_PASSWORD` aleatoria y puerto libre.
  - Data dir compartido: `auth.json` compartido, un login para todos.
  - La huella cubre raíz del proyecto + config renderizada + AGENTS.md combinado.
    Dos workspaces con la misma huella comparten servidor y DB.
- CORS: pasar `http://localhost:1420`, `http://tauri.localhost`,
  `https://tauri.localhost`, `tauri://localhost`.
- CSP: el preview de la app en marcha necesita `frame-src http://localhost:*
  http://127.0.0.1:*` (la URL es configurable en puerto y ruta, pero solo se
  embeben servidores locales). El iframe es de otro origen, no recibe IPC de
  Tauri y no se puede inspeccionar desde el webview padre.
- **Skills**: el descubrimiento NO respeta `XDG_CONFIG_HOME`; se descubren las de
  `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills` y las del
  proyecto. El aislamiento real es la allowlist de `permissions`:
  `deny *` + `allow` por ID + `deny` explícito de las no seleccionadas.
- **AGENTS.md**: `OPENCODE_DISABLE_PROJECT_CONFIG=1` también desactiva los
  `AGENTS.md` del proyecto. Hay que generar un `AGENTS.md` combinado
  (global + template + repo + issue) en `<ws>/xdg/opencode/AGENTS.md`.
  Cuidado: hoy ese path es un symlink al AGENTS.md global; **borrar el symlink
  antes de escribir**, o se corrompe el fichero del usuario.
- MCP runtime: `/api/experimental/mcp/{server}` por location; `remove` es hasta
  reiniciar. Cada contexto tiene su propio servidor, así que queda confinado.
- Sesiones: aisladas por `OPENCODE_DB` del contexto. Mismo `projectID` si comparten
  carpeta; la UI debe usar el `workspaceId`, no el `projectID`.
- Parar un workspace solo para el servidor si ningún otro workspace de la misma
  huella sigue arrancado.
- Parada: SIGTERM y esperar; SIGKILL solo como fallback.
- Comandos Tauri: args en camelCase desde JS.

## Plan de implementación

1. **Store v2**: `repos.json`, `templates.json`, `workspaces.json` con
   `repoId`, `templateId`, `templateVersion`, modo, path, rama e issue. Migrar o
   resetear el store v1 (hoy no hay datos).
2. **Biblioteca global + templates**: escanear agents/commands/plugins/skills/MCPs
   globales; CRUD de templates; materializar la config del workspace desde el
   template; `template.lock.json` con la selección congelada.
3. **Repos**: alta con ruta canónica (`git rev-parse --show-toplevel`), remoto,
   provider y rama principal; agrupar workspaces por repo; evitar duplicados.
4. **Worktrees**: `git worktree add -b <rama> <ruta> <base>`, ruta configurable,
   rama editable, colisiones, borrar conservando rama, `worktree prune`.
5. **Wizard**: repo → template → nombre → principal/worktree/issue → crear.
   Aviso si ya hay un workspace activo sobre el mismo checkout principal.
6. **Sesiones**: lista por workspace, crear/cambiar/renombrar/archivar; recordar
   la activa.
7. **Issues**: `gh issue list/view --json ...` con cwd del repo; prefill
   nombre/rama; `ISSUE.md` en la carpeta del workspace; fallback manual.
8. **AGENTS.md combinado** y acción "Reaplicar template".

Primera entrega recomendada: fases 1-4 (store, templates, repos, worktrees) y el
wizard básico. El chat actual se adapta después; no romperlo mientras tanto.

## Detalles útiles

### Template

`<appdata>/templates/<id>/` con `template.json`, `AGENTS.md`, `agents/`,
`commands/`, `skills/`, `plugins/`, `mcps.json`.

Manifiesto: `id`, `name`, `description`, `version`, `agents[]`, `skills[]`,
`mcps[]`, `commands[]`, `plugins[]`, `model`, `tools`, `permissions`.

Materialización en `<ws>/xdg/opencode/`:

- `opencode.json`: base global sin `mcp`/`skills`/`instructions`/`agents`/
  `commands`/`plugins`, más lo seleccionado; allowlist de skills.
- `agents/` y `commands/`: symlinks por fichero, template gana por ID.
- `plugins/`: symlinks de los plugins seleccionados.
- `AGENTS.md`: combinado, regenerado al arrancar/reaplicar.

### Worktree

```
git -C <repo> worktree add -b <rama> <ruta> <base>
git -C <repo> worktree remove <ruta> [--force]
git -C <repo> worktree prune
```

- Ruta por defecto: `<worktreesRoot>/<repo>/<slug>`.
- Base por defecto: `origin/<rama-principal>`; editable.
- Issue: rama `<numero>-<slug>`.
- Al borrar: conservar la rama, avisar si hay cambios sin commitear.

### Issue (GitHub)

```
gh issue list --json number,title,state,url,labels --limit 50
gh issue view <n> --json number,title,body,url,labels,assignees
```

Ejecutar con `cwd` del repo. Si falla, permitir número/título manual.

## Verificación

- `cd src-tauri && cargo fmt && cargo clippy && cargo test`
- `cargo test serves_its_own_project -- --ignored`
- `npm run build`
- Flujo manual: plantilla → repo → worktree → arrancar → chat.
- Comprobar que el AGENTS.md global del usuario no se modifica.

## No hacer

- No volver a activar la config del proyecto para "recuperar" AGENTS.md.
- No escribir a través del symlink del AGENTS.md global.
- No usar el `projectID` de opencode como clave de workspace.
- No borrar ramas al eliminar worktrees.
- No commitear ni integrar nada sin pedirlo (no hay `.stpr/`).

## Estado tras la primera entrega

Implementado (fases 1-4 + wizard básico):

- **Store v2** en `repos.json`, `templates.json`, `workspaces.json` y
  `settings.json` (raíz de worktrees). Migración desde el store v1 con copia
  `workspaces.json.v1.bak`; un store ilegible se aparta como `.broken-<ts>`.
- **Biblioteca global** (`list_library`): agentes, comandos, plugins, skills y
  MCPs de `~/.config/opencode` y compatibles. CRUD de templates (manifiesto +
  `AGENTS.md` + assets propios), con `template.lock.json` congelado por workspace.
- **Materialización**: `opencode.json` sin `mcp/skills/instructions/agents/
  commands/plugins`, con la selección congelada (MCPs, skills, agentes, comandos,
  plugins, modelo, tools y permisos), allowlist de skills y `AGENTS.md` combinado
  (global + template + repo + issue). Nunca se escribe a través del symlink del
  `AGENTS.md` global.
- **Repos**: alta desde carpeta con `git rev-parse --show-toplevel`, remoto,
  provider y rama principal; refresco y agrupación de workspaces por repo.
- **Worktrees**: `git worktree add -b`, ruta configurable
  (`<appdata>/worktrees` por defecto), rama/base/ruta editables, detección de
  colisiones, `fetch` opcional, borrado conservando la rama y `worktree prune`.
- **Wizard**: repo → template → nombre y modo (principal/worktree) → resumen,
  con aviso si ya hay un workspace sobre el mismo checkout principal y opción de
  arrancar al crear.
- **UI de gestión**: repos, templates (selección de biblioteca y AGENTS.md) y
  raíz de worktrees. Ajustes del workspace con «Reaplicar template».
- **Historial de sesiones**: panel lateral del chat (botón «Sesiones») con la
  lista de sesiones del workspace (`session.list` por `directory`), búsqueda por
  título, cambio de sesión, renombrado en línea (`session.update`) y borrado con
  confirmación (`session.remove`). La lista se refresca al crear, renombrar,
  borrar y al terminar cada turno (el coste cambia). Verificado contra opencode
  v2.3.0: `list` devuelve `{data, cursor}` y cada sesión trae `title`, `cost`,
  `tokens` y `time.created/updated`.
- **Dock de permisos y preguntas**: sobre el composer, sin modal. Carga los
  pendientes con `permission.list` y `session.form.list` al montar y al cambiar
  de sesión; sigue `permission.asked/replied` y
  `form.created/replied/cancelled` por SSE. Permisos con «Permitir una vez»,
  «Permitir siempre» y «Rechazar» (`permission.reply`), y preguntas del agente
  como formularios (`session.form.reply/cancel`). Verificado contra opencode
  v2.3.0: `session.form` es un endpoint estable del mismo SDK, así que el dock
  cubre también las preguntas. El estrechado de payloads vive en
  `data/opencodePayloads.ts` y el estado puro en `domain/chat/permissions.ts` y
  `domain/chat/forms.ts`.
- **Panel de cambios y ficheros**: el botón «Cambios» de la cabecera abre el
  Inspector en su pestaña de diff; «Resumen» y «Ficheros» comparten panel. La
  lista tiene estado (añadido/modificado/borrado) y contadores, con dos fuentes:
  `session.diff` para lo que hizo el agente en la sesión y
  `vcs.status`/`vcs.diff` para el árbol de trabajo. El visor pinta el parche
  unificado con numeración y resaltado por línea (sin dependencias nuevas), y el
  árbol de ficheros carga cada carpeta con `file.list` y abre el contenido con
  `file.read` (texto o binario; los ficheros grandes se cortan a 256 KiB). Se
  refresca al cambiar de sesión y al terminar un turno (`session.idle` y
  `session.execution.*`), con debounce de 400 ms para no martillear el servidor.
  La pestaña se recuerda por workspace en `opentemplates:panel-tab:<id>`.
  Verificado contra opencode v2.3.0 real: `session.diff` y `vcs.diff` devuelven
  `{file, patch, additions, deletions, status}`; `vcs.status` omite `patch`;
  `file.list` devuelve `{path, type}` con las carpetas acabadas en `/` y
  `file.read` entrega `Uint8Array`. `file.watch` se deja fuera: el refresco por
  fin de turno ya cubre el caso y evita duplicar watchers por workspace.

- **Comandos y skills en el composer**: al escribir `/` al principio o tras un
  espacio se abre un menú con los comandos del servidor (`command.list`) y las
  skills que el workspace permite (`skill.list` filtrado por `workspace.skills`
  y `disabledSkills`). Tiene filtro incremental (sin distinguir mayúsculas ni
  acentos), navegación con flechas, Enter para elegir, Escape para cerrar y
  anuncio del filtro para lectores de pantalla; el textarea actúa como
  `combobox` con `aria-activedescendant` sobre el `listbox`. El comando elegido
  queda como chip y se envía con `session.command({name, text})`; las skills
  seleccionadas se adjuntan como `skills: [{id}]`. Si solo se elige una skill,
  se envía con `session.prompt` y la misma lista `skills`. La lógica pura vive
  en `domain/chat/commands.ts` y el estrechado en `data/opencodePayloads.ts`.
  Verificado contra opencode v2.3.0 real: `command.list` devuelve
  `{name, description}`; `session.command` expande `$ARGUMENTS` y adjunta el
  contenido de las skills; `session.prompt` acepta la misma lista. Los comandos
  personalizados se descubren en `<ws>/xdg/opencode/command/*.md` (singular).

- **Notificaciones nativas**: avisos del sistema cuando el agente termina un
  turno (`session.idle` y `session.execution.succeeded|failed|interrupted`) o se
  queda esperando una aprobación o una respuesta (`permission.asked` y
  `form.created`). Usa `@tauri-apps/plugin-notification` 2.8.1 con
  `tauri-plugin-notification` registrado en `lib.rs` y `notification:default` en
  la capability de la ventana. El puerto `NotificationGateway` vive en
  `domain/repositories`; el adaptador `TauriNotificationGateway` degrada a no-op
  fuera de Tauri (navegador, `pnpm dev`, tests), así que React nunca carga APIs
  nativas reales. La decisión (tipo de evento, foco, preferencia y throttling)
  es pura y está en `domain/chat/notifications.ts`: el título lleva workspace y
  sesión, el cuerpo lo esencial, y los turnos encadenados de la misma sesión se
  agrupan con 10 s de margen; permisos y preguntas no se throttlean, pero se
  deduplican por `requestId`. El foco se consulta con `document.hasFocus()` en el
  momento del evento. La preferencia es global
  (`opentemplates:notifications`, desactivada por defecto) y su toggle en
  «Ajustes del workspace» pide permiso al activarla, nunca al arrancar. Extra: el
  sidebar marca con un contador los avisos sin ver del workspace y lo limpia al
  seleccionarlo. Limitación conocida: cada workspace mantiene su propio SSE y
  solo se observa el del workspace seleccionado, así que los avisos y la marca
  cubren la sesión activa de ese workspace; para el resto haría falta un
  suscriptor global por servidor.

- **Consumo acumulado por workspace**: la sección «Uso» del Inspector pasa a
  «Consumo del workspace» y consulta `session.stats` con selector de rango
  (7 días, 30 días o total), coste, tokens de entrada/salida/caché, sesiones,
  prompts, pasos/subagentes, días activos, racha, barras de actividad por día
  (últimos 30 días activos) y desglose por modelo ordenado por coste. Los
  límites del proveedor (`usage.limits`) quedan en su propia sección para no
  mezclar el gasto del workspace con las cuotas de la cuenta. Verificado contra
  opencode v2.3.0 real: `session.stats({from, to, timezone, tools})` devuelve
  `{range, sessions, subagents, prompts, steps, tokens{input, output, reasoning,
  cache{read, write}}, cost, tools, activeDays, streak, activity[{date, steps}],
  models[{model{id, providerID}, steps, tokens, cost}]}`; `from`/`to` son epoch
  en ms, `tools: "none"` evita el detalle de tools y `total` omite los extremos.
  La agregación y el formato viven en `domain/chat/usage.ts`
  (`usageStatsInput`, `activityBars`, `sortModelUsage`, `formatCost`,
  `formatTokens`, `formatCount`) y el estrechado en
  `data/opencodePayloads.ts`; sin dependencias de gráficas.
- **Presupuesto mensual por workspace**: campo opcional en «Ajustes del
  workspace» persistido en la preferencia existente
  `opentemplates:budget:<workspaceId>` (no crea store nuevo ni toca la config
  del servidor). El Inspector muestra el gasto frente al umbral, avisa al 80 %
  y al superarlo, y reutiliza las notificaciones nativas de la PR #35: como
  mucho un aviso por umbral y día (`opentemplates:budget-alert:<workspaceId>:<umbral>`),
  solo con la preferencia de avisos activa y la ventana sin foco. Si el coste
  salta varios umbrales a la vez se envía solo el mayor y se marcan todos.

- **Exportar, importar y duplicar sesiones**: el panel de sesiones tiene
  «Exportar» por fila (⤓), «Importar» en la cabecera (⤒) y «Duplicar» (⧉); el
  timeline ofrece «Continuar desde aquí» por mensaje. La exportación pide el
  fichero con el diálogo nativo (`@tauri-apps/plugin-dialog`), escribe con el
  comando Tauri `write_text_file` (solo `.json`; devuelve `false` y la UI pide
  confirmación antes de sobrescribir) y está saneada por defecto: sustituye
  rutas personales (`/home/...`, `/Users/...`, `C:\Users\...`) y del workspace,
  y credenciales conocidas (`sk-`, `ghp_`, `Bearer`, claves de autorización) por
  `<ruta>` y `<credencial>`. La casilla «Exportar sin sanear» deja el JSON tal
  cual. La importación lee con `read_text_file` (tope de 32 MiB) y valida el
  sobre versionado en dominio antes de llamar a `session.import`; la sesión se
  reasocia a la carpeta del workspace actual, se selecciona y la lista se
  refresca. El fork usa `session.fork({sessionID, before})`, selecciona la
  sesión nueva y se bloquea mientras hay un turno en curso. La lógica pura vive
  en `domain/chat/transfer.ts` (formato `opentemplates.session` v1, validación,
  saneado, título de reserva y mensajes de error de importación) y el estrechado
  en `data/opencodePayloads.ts` (`toSessionTransfer`). Verificado contra
  opencode v2.3.0 real: `GET /api/experimental/session/{id}/export` devuelve
  `{info, messages}` sin sanear por defecto; `?sanitize=true` cambia el título y
  la carpeta por `[redacted:session-...]` y **todos** los textos de los mensajes
  por `[redacted:text:...]` (por eso se sanea en dominio y se pide en crudo);
  `session.import` crea la sesión en la `location` indicada y devuelve `409
  ConflictError` si el id existe (y `500` si los ids de mensaje ya están en esa
  base); `session.fork` con `before` corta el historial en ese mensaje.
  Limitación conocida: importar en el workspace del que salió la sesión falla
  por los ids de mensaje; el mensaje de la UI lo explica.

- **Terminal por workspace**: botón «Terminal» en la cabecera del workspace
  (junto a Sesiones/Panel/Cambios) y dock inferior con pestañas por PTY,
  «Nueva», cierre por pestaña y reconexión. Usa `@xterm/xterm` 6.0.0 y
  `@xterm/addon-fit` 0.11.0 (versiones exactas) con su CSS. El PTY se crea con
  `cwd` del proyecto y sin `env`, así hereda el entorno aislado del workspace.
  Cerrar el dock solo cierra el WebSocket, no el PTY; cerrar una pestaña o parar
  el workspace lo termina (al borrar, el borrado ya para el servidor y con él
  sus PTYs, así que no se matan antes de la confirmación). Protocolo verificado
  contra opencode v2.3.0 real: `POST /api/pty/{id}/connect-token` con cabecera
  `x-opencode-ticket: 1` devuelve `{ticket, expires_in: 60}`; el WebSocket es
  `ws://host/api/pty/{id}/connect?location[directory]=<cwd>&ticket=<ticket>`
  (el ticket es de un solo uso y sustituye a la auth básica); los frames de
  texto son salida UTF-8 y también se acepta entrada de texto o binaria; los
  frames binarios que empiezan por `0x00` llevan `{"cursor":N}`, el offset
  absoluto del flujo para reanudar sin duplicar; el tamaño se cambia con
  `pty.update` (`{size:{cols,rows}}`) por HTTP; al terminar el shell el socket
  cierra con `4404` y `session exited`. El puerto `TerminalGateway` está en
  `domain/repositories`; el adaptador (`data/TerminalGateway.ts`) resuelve el
  ticket y las tramas, y `domain/terminal/terminals.ts` concentra pestañas,
  buffer limitado y aritmética de cursor (probada sin WebSocket). Al reconectar
  se pide `cursor = último confirmado + bytes recibidos`; si nunca hubo cursor
  se limpia el buffer local y se deja que el servidor reenvíe lo que retiene.
- **Estado runtime de MCP**: el Inspector muestra el estado real de cada
  servidor (`connected`, `pending`, `disabled`, `failed`, `needs_auth`) con
  etiqueta en español y el error del servidor en la fila (texto en una línea,
  sin ANSI y acotado). Refresca con `mcp.list` al abrir y con los eventos
  `mcp.status.changed`, sin esperar al sondeo de 5 s. Cada fila habilitada tiene
  «Conectar»/«Reintentar» o «Desconectar», que llaman a
  `experimental.mcp.connect/disconnect` (los métodos `mcp.*` están deprecados
  en el SDK 2.3.2); no reescriben la config ni recargan la location, así que no
  reaplican el template. Verificado contra opencode v2.3.0 real con un MCP local
  roto (`/bin/false`): `mcp.list` devuelve
  `{status:"failed", error:"Connection closed: MCP server process exited with code 1"}`,
  `disconnect` lo deja en `{status:"disabled"}` y `connect` lo reintenta.
- **Objetivos de sesión (Session Goals)**: chip en el composer con el objetivo,
  el progreso (`turno N/M`) y el coste; diálogo para definirlo o editarlo
  (texto, límite de turnos con 5 por defecto y límite de coste opcional) y
  controles para pausar, reanudar y quitar. El panel de sesiones marca con
  «objetivo» las que lo tienen activo. Al cerrar un turno (`session.idle` o
  `session.execution.*`) el hook pide una decisión y, si es `continue`, envía un
  prompt breve que recuerda el objetivo; si es `done`/`blocked` para y avisa por
  notificación nativa. Estado en `domain/chat/goals.ts` (texto, estado
  activo/pausado/cumplido/bloqueado/agotado, turnos, coste y tokens acumulados,
  límites y última decisión), persistido por workspace y sesión en
  `prefKeys.goal`; al abrir la app se reanuda si estaba activo y la sesión no
  está ocupada. Guardas probadas: permiso o pregunta pendiente, parada manual,
  turno fallido, decisión repetida sin progreso (misma huella de conversación),
  turnos y coste. Verificado contra opencode v2.3.0 real:
  `POST /api/experimental/generate/decisions` devuelve
  `{data:{answers:[{type:"choice",name,choice,confidence}],cost,tokens}}` y
  **exige un modelo con capacidad de decisión**: el modelo de chat de la sesión
  se rechaza con `422 UnsupportedModelError` («is a chat model, not a decision
  model»). Por eso el hook descubre el modelo con
  `model.list({types:["decision"]})` (en el servidor de prueba,
  `opencode/jev-1.13-free`) y lo usa solo para evaluar; el turno del agente
  sigue con el modelo de la sesión. El fake de tests incorpora
  `generate.decisions`, y el estrechado vive en
  `data/opencodePayloads.ts` (`toGoalDecisionResult`).
- **Carreras multi-run**: botón «Carrera» en la cabecera del workspace. El
  diálogo pide el encargo, de 2 a 5 modelos del catálogo (multi-select buscable),
  agente opcional y «un worktree por corrida» (activado por defecto si el
  proyecto es git y hay raíz de worktrees). Si el catálogo trae precios, muestra
  el coste estimado con el prompt y 1.200 tokens de salida por corrida. Al
  lanzar, crea las corridas en paralelo: worktree propio vía
  `worktree.create({projectID, branch: rama actual, directory: raíz, name})`,
  sesión con `session.create({location:{directory}, agent, model})` y el mismo
  `session.prompt` para todas. Un fallo de worktree, sesión o prompt solo marca
  esa corrida como fallida; las demás siguen. El estado se sigue con el SSE
  existente (`session.execution.*`, `session.idle`, `permission.asked` y
  `form.created`), sin sondeo; al terminar se piden `session.get` (coste y
  tokens), `session.diff` (ficheros y líneas) y `message.list` (resumen). La
  vista de comparación tiene una tarjeta por corrida con modelo, estado, coste,
  duración, tokens, cambios, resumen o error, y acciones «Abrir sesión» (el chat
  la abre y se puede seguir como cualquier otra), «Ver diff» (panel de cambios),
  «Quedarse con esta» y «Descartar». Elegir ganadora pide confirmación, aplica
  sus cambios al workspace (si tiene worktree propio), cierra y elimina las
  sesiones y worktrees de las perdedoras (con `force: true`, sin tocar la rama
  base) y deja intacta la ganadora. Descartar una corrida hace lo mismo solo con
  ella. Al parar o eliminar un workspace con carrera viva se
  avisa; al volver a un workspace la carrera se reconcilia con `session.get`, y
  si la app se cerró, las corridas activas se marcan como fallidas. Estado
  puro en `domain/race/races.ts` (máquina de estados, ganadora, limpieza,
  estimación, serialización, recuperación y resolución de proyecto), hook en
  `presentation/hooks/useRace.ts`, persistencia en
  `opentemplates:race:<workspaceId>` (localStorage) y componentes
  `RaceControls`, `RaceDialog` y `RaceView`. Verificado contra opencode v2.3.0
  real con un solo servidor y dos worktrees: `session.list?directory=` filtra
  por carpeta, `session.diff`, `vcs.status` y `vcs.diff` responden por
  directorio, `session.create` acepta modelo y agente, y `worktree.remove`
  conserva la rama base. Limitaciones conocidas: `worktree.create` deja el
  worktree en HEAD separado (no crea rama por corrida, así que no hay rama que
  conservar más allá de la base); las sesiones de corridas en worktree no salen
  en el panel de sesiones porque este lista el directorio del workspace, se
  abren desde la carrera. La fusión del resultado ganador se añadió después; el
  detalle está en «Estado tras fusionar la ganadora de una carrera».

- **Paleta de comandos, atajos y temas**: `Ctrl/Cmd+K` o el botón discreto
  «Comandos» del sidebar abren una paleta con búsqueda incremental. El catálogo
  es declarativo en `domain/palette/catalog.ts` (ids, grupos, palabras clave,
  atajos y disponibilidad según workspace, servidor y handlers montados) y el
  filtro puntúa prefijo, inicio de palabra y palabras clave, ignorando acentos y
  mayúsculas. La paleta navega con flechas/Home/End, ejecuta con Enter, cierra
  con Escape y expone `listbox`/`option` con `aria-activedescendant`; no añade
  dependencias. Acciones reales: nuevo workspace, ir a los workspaces recientes
  (orden persistido en `prefKeys.recentWorkspaces`), siguiente/anterior, ajustes
  del workspace, nueva sesión, parar turno, exportar la sesión activa saneada,
  definir objetivo, panel del workspace, sesiones, diff/cambios, terminal,
  cerrar el dock activo y lanzar carrera multi-run. Las acciones que dependen de
  estado local se registran con `useCommandAction`
  (`presentation/context/CommandActions.tsx`); las de workspace y navegación se
  resuelven en `App.tsx`. Atajos en `domain/palette/keybindings.ts`:
  `Ctrl/Cmd+K` paleta, `Ctrl/Cmd+N` nueva sesión, `Ctrl/Cmd+.` parar turno,
  `Escape` cerrar dock, `Ctrl/Cmd+Alt+←/→` workspace anterior/siguiente,
  ``Ctrl/Cmd+` `` terminal y `Ctrl/Cmd+Shift+D` diff. Los atajos con modificador
  funcionan con foco en el composer y no interceptan Enter/Shift+Enter ni la
  escritura normal. La página «Atajos» de ajustes lista el set; personalizarlos
  queda pendiente para no abrir un editor a medias.
- **Temas**: `styles.css` ya no contiene hex ni `rgba()`: todos los colores son
  custom properties semánticas (`--surface-2`, `--text-soft`, `--accent-border`,
  `--warning-soft`, etc.) definidas en `domain/theme/themes.ts`. Hay tres temas
  completos (oscuro actual, claro legible y Pitch Black, el tema de VS Code de
  Viktor Qvarfordt con fondo negro puro) y tres acentos (verde, azul y
  violeta). `themeStyle` se aplica en `main.tsx` antes de montar React y hay un
  preload mínimo en `index.html` que fija `data-theme`/`color-scheme`; la
  selección se persiste en `prefKeys.theme` y `prefKeys.accent`. La página
  «Apariencia» de ajustes aplica los cambios al momento y previsualiza todos
  los temas con los tokens del dominio. Los tests comprueban que los tres temas
  y todos los acentos declaran el juego completo de tokens, que ningún token queda
  sin usar, que toda `var(--…)` de la hoja existe, que no hay colores fijos y
  que texto principal, secundario, acentos y estados superan el contraste WCAG
  AA. Verificación visual: `pnpm tauri dev` arranca sin errores y las vistas de
  paleta y ajustes se revisaron en oscuro y claro con capturas headless del
  mismo CSS/componentes.

Pendiente de las fases 5-8:

- Issues de GitHub con `gh` (`ISSUE.md` ya se materializa si llega un `IssueRef`).
- Archivar sesiones (la lista ya no muestra archivadas; falta el gesto).
- Reparar workspaces `missing` recreando su worktree.
- Selector de modelo/agentes por workspace como overrides explícitos (hoy se
  editan en el template y se reaplican).
- Personalización de atajos: la página los lista y el dominio ya resuelve
  conflictos, pero falta un editor que persista combinaciones por usuario.

## Estado tras #12: flujo git y pull request

Implementado sobre el panel de cambios existente (no hay panel nuevo):

- **Estado y commit asistido**: el modo «Working tree» usa ahora un puerto
  `GitGateway` contra comandos Tauri. Muestra rama, upstream, ahead/behind y
  cada fichero con su estado (`A/M/D/R/C/U/…`, incluidos no rastreados y
  conflictos) y resumen de líneas. El checkbox prepara o quita del índice
  (`git add -- <rutas>` / `git restore --staged -- <rutas>`), y el mensaje se
  puede generar con `generate.text` a partir del diff staged.
- **Guardas duras**: el commit solo sale de un botón explícito; nunca se pasa
  `--no-verify` ni `--force`; si falla un hook se muestra su salida y el flujo
  se detiene sin push automático. Antes de commitear se confirman los ficheros
  sin preparar. Sin upstream, el botón publica la rama con `push -u origin
  <rama>` mostrando el nombre; con upstream, hace `git push` normal.
- **Pull request**: tarjeta con estado de `gh`, rama/base, enlace a GitHub,
  checks (con lista de fallidos y sus enlaces), revisiones y comentarios. Si
  `gh` falta o no hay sesión, se muestra el mensaje y el enlace a la
  documentación. La PR se crea con base principal, título y cuerpo editables y
  borrador generado desde los commits de la rama. «Enviar al agente» construye
  un prompt recortado (checks fallidos + revisiones + comentarios) y lo manda a
  la sesión activa con `session.prompt`; sin sesión queda deshabilitado.
- **Backend**: `git.rs` ejecuta git con `cwd` del workspace, argumentos como
  array y timeout de 180 s; `process.rs` centraliza la ejecución con lectura
  paralela de stdout/stderr. `gh.rs` normaliza `gh pr view/checks/create` con
  timeout de 120 s y distingue «no hay PR» de errores de auth/instalación.
  `git status` devuelve porcelain y numstat crudos: el parseo (renombrados,
  borrados, no rastreados, conflictos, `-z`) vive y se prueba en
  `domain/workspace/git.ts`.
- **Verificación**: `pnpm check` en verde (594 tests; nuevos de dominio
  `git.test.ts` y `pullRequest.test.ts`, de componente `ChangesPanel.test.tsx`
  y `PullRequestCard.test.tsx`, y fakes de ambos gateways). `cargo test` en
  verde (32 tests; incluye repo temporal para stage selectivo, hook que falla,
  push con upstream, y argumentos que nunca llevan force/no-verify). No se
  levantó la app contra un GitHub real para crear la PR desde la tarjeta: la
  creación y los checks se validaron con mocks; la PR de esta entrega se abrió
  con `gh` desde la terminal.

Pendiente relacionado: issues de GitHub y las acciones de worktree que ya
estaban en la lista anterior.

## Estado tras #13: preview de la app en marcha

Implementado como dock inferior por workspace, junto al terminal, sin panel
nuevo. Decisión de viabilidad y coste de las alternativas en
`docs/preview-viabilidad.md`.

- **Acceso**: botón «Vista» en la cabecera del workspace, entrada «Vista previa
  de la app» en la paleta (#41) y atajo `Ctrl/Cmd+Shift+V`. El dock abierto se
  recuerda en `opentemplates:preview`; Escape lo cierra después del terminal.
- **URL por workspace**: campo de URL o puerto (acepta `5173`, `:5173`,
  `localhost:5173` o una URL http/https) con `Aplicar`, `Recargar` y `Abrir` en
  el navegador externo. El último valor se guarda en
  `opentemplates:preview-url:<workspaceId>`; el tamaño de dispositivo
  (escritorio 1440×900, tablet 834×1112, móvil 390×844) en
  `opentemplates:preview-device:<workspaceId>`.
- **Estado antes de pintar**: `preview_probe` (Rust) sondea la URL con timeout,
  sin CORS, y devuelve `{ok, status, title, error, frameBlocked, verified}`.
  Mientras comprueba se muestra «Comprobando…», nunca un iframe en blanco. Si no
  hay servidor, el mensaje concreto («No hay nadie escuchando en host:puerto…»)
  y botones «Reintentar»/«Abrir en el navegador». Si hay respuesta, se pinta el
  iframe; si el servidor manda `X-Frame-Options` o `frame-ancestors`, se avisa
  de que el marco puede quedar vacío. `https` solo comprueba que el puerto
  acepta conexión (no se inspecciona TLS).
- **Enviar al agente**: con URL, workspace, ruta local, tamaño, estado y la
  petición del usuario compone un prompt numerado, recortado a 900 caracteres,
  y lo manda con `session.prompt` a la sesión activa del workspace (el mismo
  `sessionId` que usa el chat). Sin sesión el botón queda deshabilitado y se
  explica. El iframe no aporta screenshot, estilos ni errores de consola porque
  es de otro origen: **el selector de elemento no está implementado**. Se
  necesitaría un proxy propio que sirva el preview desde el mismo origen e
  inyecte el script, o multiwebview, que hoy no funciona en Wayland con wry
  0.57.3 (solo X11) y cambia el modelo de ventanas.
- **Verificación**: `pnpm check` en verde (616 tests; nuevos de dominio
  `preview.test.ts` y de componente `PreviewDock.test.tsx`, más el botón en
  `WorkspaceView.test.tsx` y un fake de gateway). `cargo test` en verde (39
  tests; nuevos de `preview.rs`, incluido un servidor HTTP local y un puerto
  cerrado). `cargo clippy --all-targets -- -D warnings` en verde. Prueba manual
  con `pnpm dev` real en `127.0.0.1:1420`: el sondeo devuelve `ok`, HTTP 200,
  título «OpenTemplates» y `frameBlocked: false`. También se arrancó la app
  completa (`GDK_BACKEND=x11 pnpm tauri dev`) con un servidor real en
  `localhost:5173` y se comprobó en una captura de la ventana que un iframe con
  la nueva CSP pinta la página (temporalmente para la prueba, retirado después).
  El flujo del dock (estados, URL, dispositivo, envío) se valida con fakes en
  componente; no se recorrió a mano un workspace real porque el store de prueba
  estaba vacío.

Pendiente relacionado: selector de elemento (requiere proxy propio o
multiwebview con soporte Wayland), screenshot/consola y captura de una región.

## Estado tras contextos por huella (fase 1)

- `context.rs`: huella SHA-256 (versión 1) sobre raíz del proyecto + config
  renderizada + AGENTS.md combinado. Store en `<appdata>/contexts/<huella>/` con
  `context.json` (raíz, workspaces, timestamps) y refcount attach/detach.
- `config.rs`: `plan()` y `write_plan()` separados; el plan se calcula una vez y
  sirve tanto para la huella como para materializar.
- Servidores indexados por huella (no por workspace). `ServerInfo.contextHash`
  identifica el contexto; `workspace_status` devuelve una entrada por workspace
  compartido para no cambiar la UI. Parar o borrar desengancha solo ese workspace
  y mata el proceso cuando el contexto queda vacío.
- Migración: al primer arranque de un workspace se copian sus `opencode.db*`
  legados al contexto para conservar las sesiones.
- `Workspace.contextHash` se persiste; reaplicar o cambiar la selección produce
  otra huella y las sesiones nuevas van al contexto nuevo.
- Verificación: `cargo test` en verde (41 tests; nuevos de `context.rs`),
  `pnpm check` en verde (616 tests).
- Pendiente de la fase 2: el modelo por defecto sigue entrando en la huella
  (hace de fallback del servidor); perfiles por sesión y agente; badge de
  «comparte servidor»; GC de contextos sin uso.

## Estado tras renombrar templates a perfiles (fase 2)

- Rust: `templates.rs` → `profiles.rs`; `ProfileManifest`, `ProfileLock`,
  `Workspace.profileId/profileVersion`, `AppSettings.defaultProfileId`. Comandos
  `list_profiles`, `save_profile`, `delete_profile`, `profile_agents_md`,
  `save_profile_agents_md` y `reapply_profile`.
- Persistencia: `profiles.json`, `profiles/<id>/profile.json` y
  `profile.lock.json`. Al arrancar se migra `templates.json` (se reescribe), el
  directorio `templates/` (renombrado) y las rutas absolutas guardadas en
  `workspaces.json` y en los locks (`templates/…` → `profiles/…`). Los manifiestos
  y locks antiguos se leen como fallback.
- Frontend: tipos y gateway `Profile*`, `profileId`, `defaultProfileId`, pestaña y
  textos «Perfil/Perfiles». Las claves de preferencias siguen siendo
  `opentemplates:*`.
- Los assets de un perfil llevan `source: "profile"`; los locks antiguos conservan
  `template` como etiqueta hasta reaplicar.
- El modelo ya no entra en la huella: `fingerprint_without_model` lo quita antes de
  hashear. `useChat` pasa `workspace.model` a `session.create` (y el multi-run ya lo
  hacía), así dos perfiles con distinto modelo comparten contexto.
- `WorkspaceView` muestra «comparte servidor con …» cuando otro workspace arrancado
  tiene la misma `contextHash`.
- Verificación: `cargo test` 44 en verde (nuevos de migración de store, rutas y lock),
  `cargo clippy -D warnings` limpio, `pnpm check` 618 tests en verde.

## Estado tras perfil por sesión (fase 5)

- Rust: comando `start_profile(workspaceId, profileId)` que congela y materializa
  ese perfil sin tocar el lock por defecto del workspace, arranca su contexto y
  devuelve `ServerInfo` con `model`/`models` del perfil. `stop_workspace` para todos
  los contextos del workspace y desconecta cada contexto del `context.json`.
- Un workspace puede tener varios contextos vivos a la vez (uno por huella). El
  estado (`workspace_status`) sigue devolviendo una entrada por workspace y
  contexto; el frontend las agrupa por `contextHash`.
- Frontend: selector «Perfil del workspace» en la cabecera. Al cambiarlo se llama
  a `start_profile`, se guarda el `ServerInfo` y `Chat` se remonta con el cliente de
  ese contexto. Las claves de sesión, modelo, agente y variante incluyen la huella
  del contexto, así que cada perfil tiene su historial y sus preferencias.
- `ServerInfo.model`/`models` describen el perfil del contexto; las sesiones lo
  reciben al crearse. Si dos perfiles comparten huella (solo cambia el modelo), el
  servidor es el mismo pero cada sesión lleva su modelo.
- Verificación: `cargo test` 45, `cargo clippy -D warnings` limpio, `pnpm check`
  619 tests en verde (nuevo de selector de perfil y de modelo al crear sesión).
- Pendiente: dar de alta perfiles desde el selector, marcar el perfil en la lista
  de sesiones y GC de contextos sin uso.

## Estado tras fusionar la ganadora de una carrera

- Rust: `git::merge_worktree(destination, source)` y el comando
  `git_merge_worktree`. Valida que ambos checkouts compartan `git-common-dir`,
  prepara todo en el worktree de la corrida con `git add -A`, obtiene un parche
  binario desde el ancestro común con su rama base (incluye commits que hiciera
  el agente) y lo comprueba en el workspace con `git apply --check`. Si encaja, aplica el parche y prepara en el índice solo
  las rutas tocadas. No crea commits ni ramas. Si no encaja, devuelve `conflict`
  con las rutas afectadas y no escribe nada.
- Resultado `GitMergeResult`: `merged`, `empty` o `conflict`, con ficheros,
  líneas añadidas/borradas, conflictos y mensaje de git.
- Dominio: `Race.merge` pasa de `null` reservado a `RaceMerge` persistido
  (`merged`, `empty`, `conflict`, `failed`). `mergeableWinner` decide si la
  ganadora tiene worktree y no se fusionó ya; `recordMerge` guarda el resultado.
  El parseo antiguo de carreras sin `merge` sigue funcionando.
- Hook: `keepWinner` elige, intenta la fusión y solo limpia las perdedoras si el
  resultado es `merged` o `empty`. En `conflict` o `failed` conserva perdedoras
  y worktrees, muestra el error y ofrece «Reintentar fusión». Sin worktrees no
  intenta fusionar: las corridas compartieron la carpeta y no hay cambios
  atribuibles.
- UI: resumen de la fusión en la cabecera, rutas en conflicto con `role=alert` y
  botón de reintento en la tarjeta de la ganadora. La confirmación explica que
  los cambios quedan preparados sin commit.
- Verificación: `pnpm check` en verde (756 tests), `pnpm build` en verde y
  `cargo test` con 72 tests pasando y 2 ignorados. Tests nuevos de Rust para
  altas/modificaciones/borrados, vacío, conflicto sin tocar el destino y
  rechazo de repos distintos; tests TS de dominio, serialización, hook y vista.
- Limitaciones: no fusiona carreras sin worktrees, no resuelve conflictos ni
  aplica parches parciales, no crea el commit y conserva el worktree y la sesión
  de la ganadora.

## Estado tras sesiones por step

Implementado el lanzamiento y el avance de las sesiones del grafo de features;
el coordinador, la descomposición, la provisión y las carreras se conservan.

- **Perfil y agente por tipo de paso.** `domain/features/steps.ts` centraliza la
  resolución: `coordinate` (coordinador), `recon` (explorador), `plan`
  (planificador), `implement` (implementador), `verify` (verificador) e
  `integrate` (integrador). Manda la elección explícita antes de crear la
  sesión, luego el `profileId` guardado, el perfil cuyo id o nombre coincide con
  el rol, el perfil por defecto y, por último, el primero. El agente se toma de
  `agentId` si existe en el perfil, luego por rol y, si no, el del servidor.
  `coordinatorProfileId` reutiliza el mismo resolutor.
- **Worktree correcto.** `coordinate` e `integrate` usan la raíz de la feature;
  `recon`, `plan`, `implement` y `verify` usan el worktree de su target. El
  scope no cambia el `cwd`: va en el encargo.
- **Runner por paso.** Nuevo comando `start_feature_step_runner(featureId,
  stepId, profileId)` en `feature_runner.rs`. Reutiliza el motor de contextos y
  el dueño `Feature`, así que comparte servidor con el coordinador cuando el
  perfil produce la misma huella y arranca otro cuando no. Cada paso escribe su
  lock en `.runner/steps/<id-saneado>/profile.lock.json`; el coordinador sigue
  con `.runner/profile.lock.json`.
- **Coordinador sin ambigüedad.** Al arrancar el coordinador se guarda
  `.runner/runner.json` con su `contextHash`; `feature_runner_status` filtra por
  ese hash para no devolver el servidor de un paso.
- **Sesión y reanudación.** `LaunchStep` resuelve perfil y agente, crea la
  sesión en el directorio del paso, guarda `sessionId`, `profileId`, `agentId` y
  `contextHash` antes de enviar el encargo y reutiliza la sesión al reabrir. Si
  falla el guardado, intenta borrar la sesión recién creada. El hook bloquea
  lanzamientos duplicados por `stepId`.
- **Grafo y gates.** Solo se lanza un paso pendiente con dependencias `done`.
  `Terminar paso` pasa a `awaiting-review`; `Aprobar y continuar` lo cierra y
  libera a sus dependientes. `plan` y `verify` bloquean implementación e
  integración hasta aprobarse. Al aprobar el último paso la feature queda
  `done`. No hay avance automático al recibir `session.idle`.
- **UI.** `StepSessions` sustituye la lista estática de pasos: muestra perfil,
  agente, sesión y acciones; permite elegir perfil antes de lanzar y abre el
  chat del paso con `StepChat` sobre un workspace sintético. `CoordinatorChat`
  comparte ahora `FeatureSessionChat` con los pasos.
- **Flujo rápido.** `start_feature_step_runner` admite `fast`; el coordinador
  sigue rechazándolo. En `fast` el paso `implement` recibe un encargo sin plan.

Verificación: `pnpm check` en verde (782 tests), `pnpm build` en verde,
`pnpm check:bundle` con 495.61 kB de 500 kB y `cargo test` con 76 tests
pasando y 2 ignorados (incluye pruebas nuevas de rutas y locks de pasos).
`FeatureView` y `FeatureDialog` pasan a chunks perezosos para no engordar el
bundle inicial. También se estabilizó la prueba de preview que reservaba un
puerto libre y podía fallar si otro proceso lo reutilizaba antes del sondeo.
No se levantó la app contra worktrees reales en esta entrega: el flujo de UI se
validó con dobles y el runner con tests puros.

Limitaciones conocidas:

- El avance es manual; falta reaccionar a `session.idle` para pasar a revisión
  automáticamente sin saltarse los gates.
- `stop_feature_runner` para todos los servidores del dueño `Feature`, así que
  parar el coordinador también para los runners de paso vivos. Las sesiones
  quedan guardadas.
- Si cambia el perfil y con él la huella del contexto, la sesión guardada puede
  no existir en el servidor nuevo; se avisa, pero no se reasocia.
- No hay reintento, resolución de conflictos ni reasociación de sesiones
  perdidas.

## Estado tras borrar una feature (worktrees y ramas)

- **Backend**: `feature_delete_preview` calcula el plan sin tocar nada
  (`exists`, `dirty`, `branchExists`, `branchPublished`, `branchInUse` y
  `protectReason`) y `delete_feature(id, forceDirty)` hace la limpieza real.
  Antes de tocar disco para el dueño `Feature` (coordinador y runners de paso) y
  revalida la preview: no confía en lo que vio la UI.
- **Orden**: worktrees de más profundo a menos profundo (los targets están dentro
  del worktree de la raíz), `worktree prune` por repo y después `branch -D`. Solo
  se borra la rama de un worktree que se quitó o que ya no existía.
- **Protecciones**: se conserva la rama base de la entrada, la que existe en
  `refs/remotes/origin/<rama>` o tiene upstream (con `fetch` best-effort antes) y
  la que está checkouteada por un worktree ajeno. Las conservadas se devuelven en
  `keptBranches` con su motivo; no son errores y no bloquean el borrado.
- **Cambios sin commitear**: sin `forceDirty` la limpieza aborta antes de quitar
  nada. La UI muestra la lista de worktrees sucios y exige marcar «Eliminar
  también los cambios sin commitear» para habilitar el botón.
- **Carpeta**: se borra `<appdata>/features/<id>/` (BRIEF, planes, `NOTES.md` y
  `.runner`) solo si coincide exactamente con esa ruta; si no, se conserva y se
  avisa. Nunca se hace `remove_dir_all` sobre una ruta arbitraria.
- **Fallo parcial**: si falla un worktree, una rama o la carpeta, la feature sigue
  en `features.json` con el mismo estado y la UI refresca la preview y muestra
  los errores. Un reintento continúa donde se quedó: worktrees ausentes y ramas
  ya borradas no vuelven a fallar.
- **UI**: el botón «Eliminar» de `FeatureView` abre `DeleteFeatureDialog` desde
  `App.tsx` (lazy). Lista worktrees y ramas, enseña las protegidas, avisa de la
  pérdida de artefactos y del `forceDirty`. No usa `window.confirm` porque el
  puerto `ConfirmDialog` es síncrono y no admite ni listas ni casilla.
- **Verificación**: `pnpm check` en verde (792 tests), `pnpm build` en verde y
  `cargo test` con 86 tests pasando y 2 ignorados; `cargo clippy --all-targets --
  -D warnings` limpio. Tests nuevos de Rust para worktrees anidados, rama base,
  publicada, en uso, sucio sin y con force, idempotencia, fallo parcial con
  reintento y carpeta fuera de `features/`; tests TS de dominio, caso de uso,
  hook y diálogo. No se levantó la app contra worktrees reales: el flujo de UI se
  validó con dobles y la limpieza con repos temporales.
- **Limitaciones**: no se borran ramas remotas, PRs ni sesiones; no se comprueba
  si la rama tiene commits sin integrar (la confirmación avisa de que se
  pierden). La detección de rama publicada usa las refs locales tras un `fetch`
  best-effort: sin red ni refs remotas no puede saber que otra copia la publicó.
