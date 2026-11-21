# Handoff — templates, repos y worktrees

## Objetivo

Evolucionar OpenConf (Tauri v2 + React/TS) del modelo actual de workspaces
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
- Datos en `~/.local/share/com.alukard.openconf/`.
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

Pendiente de las fases 5-8:

- Issues de GitHub con `gh` (`ISSUE.md` ya se materializa si llega un `IssueRef`).
- Lista de sesiones por workspace (crear/cambiar/renombrar/archivar).
- Reparar workspaces `missing` recreando su worktree.
- Selector de modelo/agentes por workspace como overrides explícitos (hoy se
  editan en el template y se reaplican).
