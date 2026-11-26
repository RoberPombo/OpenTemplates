# OpenTemplates

Contextos de [opencode](https://opencode.ai) compartidos por huella y perfiles por
sesión. Un contexto agrupa lo que opencode carga al arrancar (MCPs, skills, plugins
e instrucciones) y sirve a todos los workspaces y sesiones que lo necesitan; dos
trabajadores con el mismo contexto comparten proceso, config y base de datos.

## Requisitos

- opencode v2 en `PATH`, en `~/.opencode/bin` o con `OPENCODE_BIN=/ruta/al/binario`.
- Node.js 20+, pnpm 10+ y Rust estable.
- Linux: `webkit2gtk-4.1` (Tauri v2).

## Arrancar

```bash
pnpm install
pnpm tauri dev
```

Para compilar la app:

```bash
pnpm tauri build
```

## Calidad de código

El frontend usa TypeScript 7, Tailwind CSS 4, oxlint y oxfmt. Las dependencias
npm se declaran con versión exacta (`save-exact` en `.npmrc`), sin `^` ni `~`.

```bash
pnpm typecheck     # tsc --noEmit
pnpm lint          # oxlint
pnpm lint:fix      # oxlint --fix
pnpm format        # oxfmt
pnpm format:check  # oxfmt --check
pnpm check         # typecheck + lint + format:check
```

## Ramas

`develop` es la rama por defecto: todo el trabajo sale de ahí y vuelve con PR.
`main` solo recibe merges desde `develop`, también por PR.

```bash
pnpm hooks   # activa .githooks en este clon (una vez)
```

Ese hook rechaza cualquier `git push` directo a `main`, incluido el force-push y
el borrado de la rama. Es una salvaguarda local: la protección real del
servidor necesita un repo público o GitHub Pro.

## Releases

Cada merge en `main` pasa por `release-please`, que sube la versión y crea el tag
`vX.Y.Z`; el tag compila Linux, Windows y macOS y publica la release con los
binarios firmados y `latest.json`. La app consulta las actualizaciones al
arrancar. Detalles y secretos en [docs/releases.md](docs/releases.md).

## Cómo funciona

La **huella de contexto** resume la raíz del proyecto, la configuración renderizada
y el `AGENTS.md` combinado. Se calcula con SHA-256, así que dos workspaces que
producen la misma huella comparten un único `opencode serve`; si cambia una skill,
un MCP, un plugin o las instrucciones, la huella cambia y el contexto se separa.
El modelo no entra en la huella: se elige al crear cada sesión.

Cada contexto se lanza como un `opencode serve` con:

- `XDG_CONFIG_HOME` propio: su `opencode.json`, agentes, comandos y plugins.
- `OPENCODE_DB` propio: sesiones y mensajes del contexto.
- `OPENCODE_DISABLE_PROJECT_CONFIG=1`: el `opencode.json` del proyecto no inyecta
  MCPs ni skills.
- `OPENCODE_SERVER_PASSWORD` aleatoria y puerto local propio.
- El data dir compartido, para reutilizar el login de proveedores (`auth.json`).

La configuración parte de la config global de opencode: se conservan providers,
agentes y permisos, y se sustituyen `mcp` y `skills` por la selección del perfil.
El descubrimiento de skills no respeta `XDG_CONFIG_HOME`: opencode sigue viendo las
de `~/.config/opencode/skills` y las del proyecto. Por eso el aislamiento real lo
impone una allowlist de permisos (`deny *` + `allow` de las skills elegidas).

Los **perfiles** (antes templates) agrupan rol, agentes, skills, MCPs, comandos,
plugins y modelo por defecto. El workspace congela su perfil principal; desde la
cabecera se puede cambiar de perfil, lo que arranca o reutiliza su contexto y
cambia la lista de sesiones. Cada contexto guarda sus propias claves de sesión,
modelo y agente, de modo que dos perfiles no comparten historial. Los worktrees del
mismo repo comparten contexto si la huella coincide; los repos sin raíz común no.

Los datos de la app viven en el directorio de datos de Tauri
(`~/.local/share/com.alukard.opentemplates` en Linux):

```
profiles.json
workspaces.json
profiles/<perfil>/
├── profile.json
├── AGENTS.md
├── agents/ · commands/ · skills/ · plugins/
contexts/<huella>/
├── xdg/opencode/opencode.json
├── xdg/opencode/AGENTS.md
├── opencode.db
├── profile.lock.json
├── context.json            # raíz y workspaces que usan el contexto
└── logs/server.log
```

Al arrancar se migra el formato anterior: `templates.json` → `profiles.json`,
`templates/` → `profiles/`, `template.lock.json` → `profile.lock.json` y las rutas
absolutas de assets en workspaces y locks. La primera vez que un workspace entra
en un contexto se copia su `opencode.db` anterior para conservar las sesiones.
También se mueve el directorio legado `com.alukard.openconf` y se adaptan las
preferencias con prefijo `openconf:`.

## Alcance actual

- Repos y workspaces: checkout principal, worktree o carpeta ad-hoc, con issues de
  GitHub.
- Perfiles reutilizables con agentes, skills, MCPs, comandos, plugins y permisos.
- Contextos compartidos por huella con parada y borrado por referencia.
- Selector de perfil en el workspace; cada perfil conserva sus sesiones, modelo y
  agente, y el badge indica cuándo se comparte servidor.
- MCPs en caliente; skills y modelo recargan la location de ese contexto.
- Chat con sesiones, streaming, permisos, preguntas, objetivos y multi-run.
- Inspector con consumo, estado de git, diff, ficheros, MCPs y recursos.
- Terminal, preview de la app en marcha, comandos `/`, paleta y atajos.
- Persistencia de selecciones y sesión activa.

Pendiente: crear perfiles desde el selector, marcar el perfil en la lista de
sesiones, GC de contextos sin uso, OAuth de MCPs remotos desde la UI, catálogos
HTTP de skills, logs en la UI y empaquetar opencode como sidecar.

## Tests

```bash
pnpm check                # typecheck + lint + formato + tests
cd src-tauri
cargo test                # unidad e integración sin red
cargo clippy --all-targets -- -D warnings
cargo test -- --ignored   # arranca un opencode real y crea una sesión
```
