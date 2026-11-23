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

- Un proceso `opencode serve` por workspace:
  - `XDG_CONFIG_HOME=<ws>/xdg`
  - `OPENCODE_DB=<ws>/opencode.db`
  - `OPENCODE_DISABLE_PROJECT_CONFIG=1`
  - `OPENCODE_SERVER_PASSWORD` aleatoria y puerto libre.
  - Data dir compartido: `auth.json` compartido, un login para todos.
- CORS: pasar `http://localhost:1420`, `http://tauri.localhost`,
  `https://tauri.localhost`, `tauri://localhost`.
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
  reiniciar. Cada workspace tiene su propio servidor, así que queda confinado.
- Sesiones: aisladas por `OPENCODE_DB`. Mismo `projectID` si comparten carpeta;
  la UI debe usar el `workspaceId`, no el `projectID`.
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

Pendiente de las fases 5-8:

- Issues de GitHub con `gh` (`ISSUE.md` ya se materializa si llega un `IssueRef`).
- Archivar sesiones (la lista ya no muestra archivadas; falta el gesto).
- Reparar workspaces `missing` recreando su worktree.
- Selector de modelo/agentes por workspace como overrides explícitos (hoy se
  editan en el template y se reaplican).
