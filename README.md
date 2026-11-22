# OpenTemplates

Workspaces aislados sobre [opencode](https://opencode.ai). Cada workspace tiene su
propio proceso, configuración, MCPs, skills y sesiones, aunque varios workspaces
compartan la misma carpeta de proyecto.

## Requisitos

- opencode v2 en `PATH` (o `OPENCODE_BIN=/ruta/al/binario`).
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

El frontend usa TypeScript 7, Tailwind CSS 4, oxlint y oxfmt.

```bash
pnpm typecheck     # tsc --noEmit
pnpm lint          # oxlint
pnpm lint:fix      # oxlint --fix
pnpm format        # oxfmt
pnpm format:check  # oxfmt --check
pnpm check         # typecheck + lint + format:check
```

## Cómo funciona

Cada workspace se lanza como un `opencode serve` independiente con:

- `XDG_CONFIG_HOME` propio: su `opencode.json`, agentes, comandos y plugins.
- `OPENCODE_DB` propio: sesiones y mensajes separados.
- `OPENCODE_DISABLE_PROJECT_CONFIG=1`: el `opencode.json` del proyecto no inyecta
  MCPs ni skills en todos los workspaces.
- `OPENCODE_SERVER_PASSWORD` aleatoria y puerto local propio.
- El data dir compartido, para reutilizar el login de proveedores (`auth.json`).

La configuración del workspace se genera a partir de la config global de opencode:
se conservan modelo, providers, agentes y permisos, y se sustituyen `mcp` y
`skills` por la selección del workspace. El descubrimiento de skills no respeta
`XDG_CONFIG_HOME`: opencode sigue viendo las de `~/.config/opencode/skills` y las
del proyecto. Por eso el aislamiento real lo impone una allowlist de permisos
(`deny *` + `allow` de las skills elegidas), que oculta y bloquea las demás.

Los datos de la app viven en el directorio de datos de Tauri
(`~/.local/share/com.alukard.opentemplates` en Linux):

```
workspaces.json
workspaces/<workspace-id>/
├── xdg/opencode/opencode.json
├── opencode.db
└── logs/server.log
```

La primera vez que arranca con el nombre nuevo, la app mueve automáticamente el
directorio anterior (`~/.local/share/com.alukard.openconf`) y copia las
preferencias guardadas con el prefijo `openconf:` a las claves actuales.

## Alcance actual

- Crear, arrancar, parar y eliminar workspaces.
- Seleccionar MCPs y skills por workspace.
- Aplicar MCPs en caliente; skills y modelo recargan la location de ese workspace.
- Chat mínimo con sesiones y streaming.
- Panel derecho con consumo de la sesión, estado de git, uso, MCPs y recursos.
- Persistencia de selecciones y sesión activa.

Pendiente: OAuth de MCPs remotos desde la UI, catálogos HTTP de skills, importar
la configuración global desde la app, logs en la UI y empaquetar opencode como
sidecar.

## Tests

```bash
cd src-tauri
cargo test
cargo test -- --ignored   # arranca un opencode real y crea una sesión
```
