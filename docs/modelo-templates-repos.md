# Modelo de templates, repositorios y workspaces

## Idea

Tres piezas globales y una instancia:

- **Template**: paquete reutilizable con AGENTS.md, agentes, skills, MCPs, prompts,
  hooks y herramientas. Se define una vez y se asigna a cada workspace.
- **Repositorio**: proyecto git añadido a la app, con su remoto y rama principal.
- **Workspace**: instancia concreta de trabajo sobre un repositorio, con un template,
  un nombre y un modo: checkout principal o worktree. Puede nacer de una issue.
- **Sesiones**: viven dentro del workspace (su propia DB de opencode), de modo que
  todo el trabajo de ese frente queda localizado.

## Mapeo a opencode v2

| Template | Mecanismo de opencode |
|---|---|
| `AGENTS.md` | Instrucciones: se genera un `AGENTS.md` combinado en el config dir aislado |
| `agents/` | `agents/*.md` en el config dir (`XDG_CONFIG_HOME`) |
| `skills/` | Array `skills` + allowlist `permissions` (deny * + allow por ID) |
| `mcps` | `mcp.servers` en la config generada + endpoints runtime por location |
| `prompts` | `commands/*.md` (comandos `/nombre`) |
| `hooks` | Plugins del servidor (`plugins/` y array `plugin`) |
| `herramientas` | `tools`/`permissions` + tools que aportan MCPs y plugins |
| Modelo/permisos | `model`, `tools`, `permissions` de la config generada |

Hallazgo importante: `OPENCODE_DISABLE_PROJECT_CONFIG=1` también desactiva el
descubrimiento de los `AGENTS.md` del proyecto (lo dice la doc de instructions).
Hoy la app pierde las instrucciones del repo. La solución es mantener la config del
proyecto desactivada (para que no inyecte MCPs/skills) y **generar un AGENTS.md
combinado** con global + template + repo + issue.

## Anatomía de un template

```
<appdata>/templates/<template-id>/
├── template.json
├── AGENTS.md                  # instrucciones propias del template
├── agents/<id>.md             # agentes propios
├── commands/<id>.md           # prompts propios
├── skills/<id>/SKILL.md       # skills propias
├── plugins/<id>.ts            # hooks/herramientas propias
└── mcps.json                  # MCPs propios (opcional)
```

```jsonc
{
  "id": "backend",
  "name": "Backend",
  "description": "API, tests y revisión",
  "version": 3,
  "agents": ["reviewer", "planner"],        // de la biblioteca global
  "skills": ["testing", "clean-architecture"],
  "mcps": ["context-mode", "postgres"],
  "commands": ["review", "release"],
  "plugins": ["guard"],
  "model": "anthropic/claude-sonnet-5-5",
  "tools": { "bash": true },
  "permissions": []
}
```

La **biblioteca global** son los MCPs, skills, agentes, comandos y plugins que ya
existen en `~/.config/opencode`. El template selecciona de ahí y puede añadir los
suyos. No se duplica lo que ya está instalado; los assets propios del template viven
en su carpeta.

## Materialización por workspace

Al crear el workspace se genera su config aislada:

```
<appdata>/workspaces/<id>/xdg/opencode/
├── opencode.json        # modelo, mcp.servers, skills, permissions, tools, plugin
├── AGENTS.md            # combinado: global + template + repo + issue
├── agents/              # symlinks: globales + template (template gana)
├── commands/            # symlinks: globales + template (template gana)
└── plugins/             # symlinks de los plugins seleccionados
```

- `opencode.json` parte de la config global, quita `mcp`, `skills`, `instructions`,
  `agents`, `commands` y `plugins`, y añade solo lo del template.
- Las skills se filtran con la allowlist ya verificada.
- El `AGENTS.md` combinado se regenera al arrancar o al reaplicar (nunca se escribe
  a través del symlink del AGENTS.md global: hay que borrar el symlink antes).
- Las instrucciones del repo se escanean (`AGENTS.md` raíz y anidados, sin
  `node_modules`/`.git`) y se añaden en orden padre → hijo.
- Si el workspace nace de una issue, se escribe `ISSUE.md` en la carpeta del
  workspace y se referencia desde el AGENTS.md combinado.

El workspace guarda `templateId`, `templateVersion` y un `template.lock.json` con la
selección materializada. Editar un template no cambia workspaces existentes; se
actualizan con una acción explícita "Reaplicar template".

## Repositorios y worktrees

Un repositorio se añade con su ruta canónica (se valida con
`git rev-parse --show-toplevel`), su remoto y su rama principal
(`refs/remotes/origin/HEAD`, con fallback a la rama actual).

Modos de workspace:

- **Principal**: `cwd` = checkout principal. Usa la rama actual. Solo se recomienda
  un workspace activo por checkout; dos procesos sobre la misma carpeta comparten
  ficheros, watchers y estado git.
- **Worktree**: se crea con
  `git -C <repo> worktree add -b <rama> <ruta> <base>`.
  - Ruta por defecto: `<worktrees-root>/<repo>/<slug>` (configurable).
  - Rama por defecto: `<slug>`; desde issue: `<numero>-<slug>`.
  - Base por defecto: `origin/<rama-principal>`; se puede cambiar.
  - Si la rama ya existe, ofrecer usarla o crear un sufijo.
  - Al borrar el workspace: parar el servidor, `git worktree remove` (con `--force`
    si hay cambios, avisando), y **conservar la rama**.
- **Desde issue**: se consulta con `gh` (GitHub) y se rellenan nombre, número,
  título, rama y slug. Si no hay `gh` o el remoto no es GitHub, se permite meter
  número/título a mano. La issue se guarda como `ISSUE.md` y como metadato del
  workspace.

No se borra nunca el checkout principal. Un workspace cuyo path ya no existe se
marca como "missing" y se puede reparar o archivar.

## Flujo de creación

1. Elegir repositorio (o añadirlo).
2. Elegir template.
3. Nombre del workspace.
4. Modo: principal / worktree / desde issue.
5. Si worktree: rama, base, ruta, fetch opcional.
6. Si issue: elegir issue de la lista; se propone nombre y rama.
7. Crear: materializar config, registrar workspace y, si se quiere, arrancar el
   servidor.
8. El workspace aparece agrupado por repo; dentro, sus sesiones.

## Sesiones

Cada workspace tiene su DB y su lista de sesiones. La UI deja crear, cambiar,
renombrar y archivar sesiones; la sesión activa se recuerda por workspace. Al
archivar un workspace se conservan sus sesiones; al borrarlo definitivamente se
puede borrar también su DB.

## UI

- **Workspaces**: lista agrupada por repo, estado live/parado, sesiones dentro.
- **Repos**: añadir/eliminar repos, ver remoto, rama principal y workspaces.
- **Templates**: lista y editor (AGENTS.md, selección de agentes/skills/MCPs/
  prompts/plugins, modelo y permisos).
- **Nuevo workspace**: asistente repo → template → nombre → modo → issue.
- **Ajustes del workspace**: plantilla aplicada, ruta, rama, issue, y opción de
  reaplicar template; los toggles puntuales pasan a ser overrides del workspace.

## Persistencia

Separar ficheros para no mezclar:

```
<appdata>/repos.json
<appdata>/templates.json        # manifiestos; assets en templates/<id>/
<appdata>/workspaces.json       # incluye repoId, templateId, modo, path, rama, issue
```

## Fases

1. Store v2: repos, templates y workspaces; migración/limpieza del store actual.
2. Biblioteca global + CRUD de templates + materialización de config.
3. Repos: alta, detección de remoto/rama, agrupación.
4. Worktrees: crear, validar, borrar, conservar rama.
5. Asistente de nuevo workspace (repo + template + modo + issue).
6. Sesiones por workspace (lista, crear, cambiar, renombrar).
7. Issues con `gh` y fallback manual.
8. AGENTS.md combinado y reaplicar template.

## Decisiones abiertas

1. **Templates híbridos** (selección de biblioteca global + assets propios) frente a
   bundles autocontenidos. Recomendado: híbrido.
2. **Worktrees** en app data, junto al repo o configurable. Recomendado: configurable,
   por defecto app data.
3. **Issues**: GitHub con `gh` primero, GitLab después, fallback manual siempre.
4. **Checkout principal**: permitir varios workspaces o avisar y limitar a uno
   activo. Recomendado: avisar; usar worktrees para paralelo.
5. **Template vivo o congelado**: recomendado congelar la selección por workspace y
   reaplicar explícitamente.
