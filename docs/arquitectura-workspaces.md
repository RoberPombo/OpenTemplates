# Arquitectura de workspaces (OpenConfApp)

## Decisión

Un **workspace** es un perfil lógico dentro de un proyecto (misma carpeta), con su
propio conjunto de MCPs, skills, agentes y sesiones. No es una carpeta distinta: el
caso de uso es tener "programar" y "observabilidad" sobre el mismo proyecto.

El aislamiento es **estricto desde el inicio**: un proceso de opencode por workspace.
El rendimiento se optimiza después (suspender workspaces inactivos), sin cambiar el
modelo de aislamiento.

Verificado contra opencode **v2.3.0** (`/opt/OpenChamber/resources/opencode-cli/opencode`).

## Cómo se aísla

Cada workspace se lanza como un `opencode serve` independiente con este entorno:

| Variable | Valor | Efecto |
|---|---|---|
| `cwd` | carpeta del proyecto | mismo proyecto para todos los workspaces |
| `XDG_CONFIG_HOME` | `<appdata>/workspaces/<id>/xdg` | config, agentes, comandos y plugins propios; no ve la config de `~/.config/opencode` |
| `OPENCODE_DB` | `<appdata>/workspaces/<id>/opencode.db` | sesiones y mensajes aislados; verificado con dos servidores sobre la misma carpeta |
| `OPENCODE_DISABLE_PROJECT_CONFIG` | `1` | ignora `opencode.json` del proyecto y de sus ancestros |
| `OPENCODE_SERVER_PASSWORD` | aleatorio por workspace | auth del API local |
| `OPENCODE_DISABLE_AUTOUPDATE` | `1` | no actualizar el sidecar en caliente |
| `XDG_DATA_HOME` | **sin tocar** | `auth.json` compartido: se inicia sesión una vez para todos |
| `OPENCODE_CONFIG`, `OPENCODE_CONFIG_CONTENT`, `OPENCODE_SESSION_ID` | **unset** | el proceso padre (p. ej. OpenChamber) los inyecta y se heredan |

`XDG_CONFIG_HOME` y `OPENCODE_DISABLE_PROJECT_CONFIG` están verificados con
`opencode debug config --standalone`: solo aparecen los documentos del workspace.
Las sesiones aisladas con `OPENCODE_DB` están verificadas creando sesiones en dos
servidores con el mismo `cwd` y el mismo data dir.

Matiz importante: el descubrimiento de skills **no** queda aislado por
`XDG_CONFIG_HOME`. OpenCode sigue leyendo `~/.config/opencode/skills`,
`~/.claude/skills` y `~/.agents/skills`, y `GET /api/skill` las lista todas. Lo que
aísla de verdad es la allowlist de `permissions`: con un prompt real, un workspace
con `deny *` + `allow testing` vio solo `testing`, mientras otro con `allow stpr-method`
vio solo `stpr-method`, aunque ambos servidores tenían registradas todas las skills.

## Layout en disco

```
<appdata>/workspaces/<id>/
├── xdg/opencode/
│   ├── opencode.json          # generado por la app
│   ├── AGENTS.md -> ~/.config/opencode/AGENTS.md (symlink)
│   ├── agents/                # symlinks o copias selectivas
│   ├── commands/
│   └── plugins/
├── opencode.db                # sesiones de este workspace
├── logs/server.log            # stdout/stderr, sin password
└── workspace.json             # selección persistida (MCPs, skills, modelo)
```

## Config generada

La app parte de la config global del usuario, **quita `mcp` y `skills`**, y añade la
selección del workspace. El resto (modelo, providers, agentes, permisos, plugins) se
hereda para no duplicar configuración.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-5-5",
  "mcp": {
    "servers": {
      "context7": { "type": "remote", "url": "https://mcp.context7.com/mcp" },
      "postgres": { "type": "local", "command": ["npx", "-y", "@mcp/postgres"] }
    }
  },
  "skills": ["/home/user/.config/opencode/skills"],
  "permissions": [
    { "action": "skill", "resource": "*", "effect": "deny" },
    { "action": "skill", "resource": "testing", "effect": "allow" },
    { "action": "skill", "resource": "stpr-method", "effect": "allow" }
  ]
}
```

La lista `skills` apunta a los directorios fuente (el padre de cada skill elegida),
para que opencode las descubra. La lista `permissions` es la que garantiza el
aislamiento: aunque una skill del proyecto o del sistema se descubra, el modelo no
la ve y no se puede cargar si no está permitida. Las reglas se evalúan en orden y
gana la última que coincide, por eso el `deny *` va antes de los `allow`. Además se
añade un `deny` explícito por cada skill descubierta y no seleccionada, para no
depender solo del comodín.

## MCPs: activar y desactivar en caliente

Hay dos capas y las dos son necesarias:

1. **Persistencia**: el servidor está en `mcp.servers` de la config del workspace.
2. **Runtime**: la API v2 expone endpoints por location:
   - `PUT /api/experimental/mcp/{server}` añade o reemplaza y conecta.
   - `DELETE /api/experimental/mcp/{server}` lo quita del runtime hasta reiniciar.
   - `POST /api/experimental/mcp/{server}/connect|disconnect` conecta o desconecta
     sin borrar la config.

Verificado: añadir un MCP en la location A no lo hace aparecer en la location B.
En este diseño cada servidor tiene una sola location, así que el efecto queda
confinado al workspace.

OAuth de MCPs remotos: `opencode mcp auth <server>` ejecutado con el entorno del
workspace (mismo `XDG_CONFIG_HOME`, mismo data dir). El estado aparece como
`needsAuth` en `GET /api/mcp`.

## Skills: activar y desactivar

No hay endpoint runtime para skills. El flujo es:

1. Escribir la lista `skills` y las reglas `permissions` del workspace.
2. `POST /api/location/reload` en **ese** servidor, o reiniciarlo.

`location/reload` reconstruye las locations de ese proceso; no toca a los demás
workspaces. Las sesiones siguen vivas, aunque se cancelan permisos y formularios
pendientes. Si se busca máxima seguridad, reiniciar el proceso del workspace es
igual de barato y no deja dudas.

La biblioteca de skills de la app escanea como mínimo:

- `~/.config/opencode/skills`
- `~/.claude/skills` y `~/.agents/skills` (compatibilidad)
- `.opencode/skills` del proyecto (si el usuario decide exponerlas)
- directorios y catálogos HTTP añadidos por el usuario

## Sesiones y auth

- `auth.json` vive en el data dir compartido: un login sirve para todos los
  workspaces. Los tokens se refrescan en el mismo fichero.
- Cada workspace tiene su propia DB, así que su lista de sesiones es independiente.
- Ambos procesos calculan el mismo `projectID` (misma carpeta). La app debe usar su
  propio `workspaceId` como clave de UI, no el `projectID` de opencode.
- Mover una sesión entre workspaces no es parte del MVP; más adelante se puede
  exportar/importar (`/api/experimental/session/export|import`).

## Supervisor en Tauri

- Sidecar `opencode` empaquetado como `externalBin` (un binario por plataforma).
- Rust elige un puerto libre, arranca el proceso, lee la línea
  `server listening on http://127.0.0.1:<port>` y guarda el estado.
- Un supervisor por workspace: health check, reinicio con backoff, parada ordenada
  (SIGTERM y, si no cae, SIGKILL).
- Comandos Tauri: `workspace_start`, `workspace_stop`, `workspace_status`,
  `workspace_apply_selection`, `workspace_open_logs`.
- Frontend: un cliente `@opencode/client` por workspace (baseUrl + basic auth) y una
  suscripción SSE por workspace. CSP `connect-src http://127.0.0.1:*`.
- Nunca loguear stdout en crudo: el servidor imprime la password si no se le pasa.
  Pasarla siempre por entorno y redactarla.

## Límites y riesgos

- **`/etc/opencode`** es configuración de sistema y se sigue cargando. Si algún día
  se usa, afecta a todos los workspaces; hoy está vacío.
- **Skills del repo**: `OPENCODE_DISABLE_PROJECT_CONFIG` desactiva configs, no
  necesariamente `.opencode/skills`. La allowlist de permisos las neutraliza.
- **Plugins globales**: si se copian, un plugin puede añadir tools o MCPs por su
  cuenta. Se pueden seleccionar por workspace o dejar fuera del MVP.
- **Watchers**: dos servidores vigilando la misma carpeta duplican inotify. Se
  mitiga suspendiendo el workspace inactivo (parar el proceso y arrancarlo al volver)
  cuando toque medir rendimiento.
- **Puerto**: reservar el puerto en Rust y pasarlo; hay una carrera mínima entre
  liberar y arrancar. Alternativa: `--port 0` si el binario lo soporta (pendiente de
  verificar) y leer el puerto de stdout.
- **Coste**: N procesos y N bases de datos. Las DB nuevas empiezan vacías; no se
  copia la DB global de 3.8 GB.

## MVP

1. Esqueleto Tauri v2 + React + TypeScript + Vite (Bun) y sidecar opencode.
2. Supervisor de un workspace con config generada, puerto y password.
3. UI de workspaces: crear, arrancar, parar, cambiar.
4. Toggles de MCP (runtime + persistencia) y de skills (config + reload).
5. Chat mínimo con `@opencode/client` y SSE.
6. Persistencia de selecciones y estados de conexión.

Después: OAuth de MCPs, importación de la config global, suspensión por inactividad.

## Estado

Implementado en este repo:

- [x] Modelo de workspace y persistencia en `workspaces.json`.
- [x] Supervisor por workspace (arranque, parada, puerto y password propios).
- [x] Config aislada generada desde la global con MCPs y skills seleccionados.
- [x] Allowlist de skills y `deny` explícito de las no seleccionadas.
- [x] UI de workspaces, creación, ajustes y chat mínimo con streaming.
- [x] MCPs en caliente; skills/modelo con reload del workspace.

Pendiente:

- [ ] OAuth de MCPs remotos desde la UI (`opencode mcp auth`).
- [ ] Catálogos HTTP de skills en la biblioteca.
- [ ] Mostrar logs del servidor en la UI.
- [ ] Sidecar empaquetado (hoy usa `opencode` del PATH o `OPENCODE_BIN`).
- [ ] Suspensión de workspaces inactivos.
