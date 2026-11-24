# Arquitectura de workspaces (OpenTemplates)

## Decisión

Un **contexto** es la config materializada de una huella (MCPs, skills, plugins e
instrucciones) para una raíz de proyecto. Un **workspace** es el frente de trabajo
sobre esa raíz; las **sesiones** son los trabajadores y eligen perfil y agente.

El aislamiento es **estricto y por contexto**: un proceso de opencode por huella
(la huella ya incluye la raíz del proyecto). Dos sesiones o perfiles con la misma
huella comparten servidor, DB y config; solo se diferencian en el agente. El modelo
completo está en `docs/modelo-templates-repos.md`.

Verificado contra opencode **v2.3.0** (`/opt/OpenChamber/resources/opencode-cli/opencode`).

## Cómo se aísla

Cada contexto se lanza como un `opencode serve` independiente con este entorno:

| Variable | Valor | Efecto |
|---|---|---|
| `cwd` | raíz del proyecto | mismo proyecto para todos los contextos que comparten raíz |
| `XDG_CONFIG_HOME` | `<appdata>/contexts/<huella>/xdg` | config, agentes, comandos y plugins propios; no ve la config de `~/.config/opencode` |
| `OPENCODE_DB` | `<appdata>/contexts/<huella>/opencode.db` | sesiones y mensajes aislados por contexto |
| `OPENCODE_DISABLE_PROJECT_CONFIG` | `1` | ignora `opencode.json` del proyecto y de sus ancestros |
| `OPENCODE_SERVER_PASSWORD` | aleatorio por workspace | auth del API local |
| `OPENCODE_DISABLE_AUTOUPDATE` | `1` | no actualizar el sidecar en caliente |
| `XDG_DATA_HOME` | **sin tocar** | `auth.json` compartido: se inicia sesión una vez para todos |
| `OPENCODE_CONFIG`, `OPENCODE_CONFIG_CONTENT`, `OPENCODE_SESSION_ID` | **unset** | el proceso padre (p. ej. OpenChamber) los inyecta y se heredan |

`XDG_CONFIG_HOME` y `OPENCODE_DISABLE_PROJECT_CONFIG` están verificados con
`opencode debug config --standalone`: solo aparecen los documentos del contexto.
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
<appdata>/contexts/<huella>/
├── xdg/opencode/
│   ├── opencode.json          # generado por la app
│   ├── AGENTS.md -> ~/.config/opencode/AGENTS.md (symlink)
│   ├── agents/                # symlinks o copias selectivas
│   ├── commands/
│   └── plugins/
├── opencode.db                # sesiones de este contexto
├── profile.lock.json          # selección congelada que produjo la huella
├── logs/server.log            # stdout/stderr, sin password
└── context.json               # huella, raíz y refcount de workspaces/sesiones
```

## Config generada

La app parte de la config global del usuario, **quita `mcp` y `skills`**, y añade la
selección del contexto. El resto (modelo, providers, agentes, permisos, plugins) se
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

1. **Persistencia**: el servidor está en `mcp.servers` de la config del contexto.
2. **Runtime**: la API v2 expone endpoints por location:
   - `PUT /api/experimental/mcp/{server}` añade o reemplaza y conecta.
   - `DELETE /api/experimental/mcp/{server}` lo quita del runtime hasta reiniciar.
   - `POST /api/experimental/mcp/{server}/connect|disconnect` conecta o desconecta
     sin borrar la config.

Verificado: añadir un MCP en la location A no lo hace aparecer en la location B.
En este diseño cada servidor tiene una sola location, así que el efecto queda
confinado al contexto.

OAuth de MCPs remotos: `opencode mcp auth <server>` ejecutado con el entorno del
contexto (mismo `XDG_CONFIG_HOME`, mismo data dir). El estado aparece como
`needsAuth` en `GET /api/mcp`.

## Skills: activar y desactivar

No hay endpoint runtime para skills. El flujo es:

1. Escribir la lista `skills` y las reglas `permissions` del contexto.
2. `POST /api/location/reload` en **ese** servidor, o reiniciarlo.

`location/reload` reconstruye las locations de ese proceso; no toca a los demás
contextos. Las sesiones siguen vivas, aunque se cancelan permisos y formularios
pendientes. Si se busca máxima seguridad, reiniciar el proceso del contexto es
igual de barato y no deja dudas.

La biblioteca de skills de la app escanea como mínimo:

- `~/.config/opencode/skills`
- `~/.claude/skills` y `~/.agents/skills` (compatibilidad)
- `.opencode/skills` del proyecto (si el usuario decide exponerlas)
- directorios y catálogos HTTP añadidos por el usuario

## Sesiones y auth

- `auth.json` vive en el data dir compartido: un login sirve para todos los
  contextos. Los tokens se refrescan en el mismo fichero.
- Cada contexto tiene su propia DB; los workspaces y sesiones que comparten huella
  comparten DB y lista de sesiones. Cambiar de perfil con la misma huella no cambia
  de DB.
- Ambos procesos calculan el mismo `projectID` (misma carpeta). La app usa su propio
  `workspaceId`/`contextId` como clave de UI, no el `projectID` de opencode.
- Mover una sesión entre contextos se hace exportando e importando
  (`/api/experimental/session/{id}/export` y `/api/experimental/session/import`,
  más `session.fork` para duplicar): el export sanea rutas y credenciales en
  dominio, y el import reasocia la sesión a la carpeta del workspace de destino.
  El `sanitize` del servidor no se usa: sustituye el título, la carpeta y todos
  los textos por `[redacted:...]`, así que la sesión deja de ser legible.
  Limitación verificada del servidor: reimportar una sesión en el mismo
  workspace falla (409 si repite el id de sesión y 500 si repite los ids de
  mensaje); la UI lo explica en vez de ocultarlo.

## Sesiones y carreras en varios directorios

Verificado contra opencode **v2.3.0** con un solo `opencode serve` y un repo git
con varios worktrees:

1. **Un proceso atiende sesiones en varios directorios.** Cada
   `POST /api/session` lleva su `location.directory` y la sesión queda asociada a
   esa carpeta. `GET /api/session?directory=<ruta>` devuelve solo las sesiones de
   ese directorio; el filtro es el parámetro `directory` plano, **no**
   `location[directory]` (ese es el de `vcs`, `file`, `mcp`, `pty`, etc.).
2. **El diff y el estado de git son por directorio.** `session.diff` devuelve
   los ficheros tocados por esa sesión. `vcs.status` y `vcs.diff` con
   `location[directory]` ven solo el árbol de trabajo de esa carpeta: dos
   sesiones que crean `A.txt` y `B.txt` en worktrees distintos no se ven entre
   sí.
3. **`session.create` acepta `agent` y `model`.** La sesión nace con ese modelo y
   agente (`SessionInfo.agent` y `SessionInfo.model` lo confirman), así que una
   carrera no necesita un `switchModel` posterior.
4. **`session.get` sirve para reconciliar.** Devuelve `projectID`, `cost`,
   `tokens`, `outcome` (`succeeded`/`failed`/`interrupted`) y
   `time.idle`, suficiente para cerrar una corrida que terminó mientras la app
   estaba en otro workspace.
5. **`worktree.create`** (`POST /api/worktree`) pide `projectID`, que sale de
   `project.list` (`canonical` es el checkout principal aunque la sesión viva en
   un worktree). `branch` es la **referencia base** que se comprueba, no una rama
   nueva; `directory` es la carpeta padre y `name` la hija, y devuelve
   `directory/name`. El worktree queda en **HEAD separado** (sin rama propia).
   `worktree.remove` borra el worktree y exige `force: true` si hay cambios sin
   commitear. Como no se crea rama por corrida, no hay rama que borrar: la rama
   base del workspace queda intacta.
6. **Coste.** El catálogo (`model.list`) trae `cost.input` y `cost.output` por
   millón de tokens; la app estima antes de lanzar con el prompt y 1.200 tokens
   de salida por corrida. Si algún modelo no publica precio, no se muestra total.

Por eso una carrera usa **N sesiones dentro del mismo proceso**, cada una en su
directorio, y no N contextos temporales.

## Terminal por contexto
El servidor expone PTYs por location (`pty.list/create/get/update/remove`) y un
WebSocket para hablar con cada uno. Verificado contra v2.3.0:
1. `POST /api/pty/{id}/connect-token` con `x-opencode-ticket: 1` y
   `location[directory]` devuelve `{ticket, expires_in}` (60 s, un solo uso).
2. `ws://host/api/pty/{id}/connect?location[directory]=...&ticket=...&cursor=N`
   (el ticket sustituye a la auth básica).
3. Salida en frames de texto (UTF-8) o binarios; entrada igual.
4. Los binarios que empiezan por `0x00` son control: `{"cursor":N}`, offset
   absoluto del flujo. Al reconectar con `cursor` el servidor reenvía solo lo
   que falta; sin `cursor` reenvía el buffer retenido.
5. El tamaño se cambia por HTTP con `pty.update({size:{cols,rows}})`.
6. Al terminar el shell, el socket cierra con `4404` y `session exited`.
El PTY se crea con el `cwd` del proyecto y sin `env`, para heredar el entorno
aislado del contexto. Cerrar el dock no lo mata: solo cierra el WebSocket.

## Supervisor en Tauri

- Sidecar `opencode` empaquetado como `externalBin` (un binario por plataforma).
- Rust elige un puerto libre, arranca el proceso, lee la línea
  `server listening on http://127.0.0.1:<port>` y guarda el estado.
- Un supervisor por contexto: health check, reinicio con backoff, parada ordenada
  (SIGTERM y, si no cae, SIGKILL). Los comandos conservan su nombre por
  compatibilidad, pero se indexan por huella, no por id de workspace.
- Comandos Tauri: `workspace_start`, `workspace_stop`, `workspace_status`,
  `workspace_apply_selection`, `workspace_open_logs`.
- Frontend: un cliente `@opencode/client` por contexto (baseUrl + basic auth) y una
  suscripción SSE por contexto. CSP `connect-src http://127.0.0.1:*`.
- Nunca loguear stdout en crudo: el servidor imprime la password si no se le pasa.
  Pasarla siempre por entorno y redactarla.

## Límites y riesgos

- **`/etc/opencode`** es configuración de sistema y se sigue cargando. Si algún día
  se usa, afecta a todos los contextos; hoy está vacío.
- **Skills del repo**: `OPENCODE_DISABLE_PROJECT_CONFIG` desactiva configs, no
  necesariamente `.opencode/skills`. La allowlist de permisos las neutraliza.
- **Plugins globales**: si se copian, un plugin puede añadir tools o MCPs por su
  cuenta. Se pueden seleccionar por perfil o dejar fuera del MVP.
- **Watchers**: dos contextos vigilando la misma carpeta duplican inotify. Se
  mitiga suspendiendo el contexto inactivo (parar el proceso y arrancarlo al volver)
  cuando toque medir rendimiento.
- **Puerto**: reservar el puerto en Rust y pasarlo; hay una carrera mínima entre
  liberar y arrancar. Alternativa: `--port 0` si el binario lo soporta (pendiente de
  verificar) y leer el puerto de stdout.
- **Coste**: N procesos y N bases de datos, uno por huella y raíz, no por sesión.
  Las DB nuevas empiezan vacías; no se copia la DB global de 3.8 GB.

## MVP

1. Esqueleto Tauri v2 + React + TypeScript + Vite (Bun) y sidecar opencode.
2. Supervisor de un contexto con config generada, puerto y password.
3. UI de workspaces: crear, arrancar, parar, cambiar.
4. Toggles de MCP (runtime + persistencia) y de skills (config + reload).
5. Chat mínimo con `@opencode/client` y SSE.
6. Persistencia de selecciones y estados de conexión.

Después: OAuth de MCPs, importación de la config global, suspensión por inactividad.

## Estado

Implementado en este repo:

- [x] Modelo de workspace y persistencia en `workspaces.json`.
- [x] Supervisor por workspace (arranque, parada, puerto y password propios). Pasa a
      indexarse por huella de contexto en la fase 1 de
      `docs/modelo-templates-repos.md`.
- [x] Config aislada generada desde la global con MCPs y skills seleccionados.
- [x] Allowlist de skills y `deny` explícito de las no seleccionadas.
- [x] UI de workspaces, creación, ajustes y chat mínimo con streaming.
- [x] MCPs en caliente; skills/modelo con reload del contexto.
- [x] Estado runtime de MCP con `mcp.list` y `mcp.status.changed`, y
      `connect`/`disconnect` sin reaplicar el perfil.
- [x] Terminal por contexto con `pty.*` y WebSocket con ticket.
- [x] Carreras multi-run: N sesiones en un proceso, cada una en su directorio
      (worktree opcional), con comparación y elección de ganadora.

Pendiente:

- [ ] Store de contextos por huella, reutilización de servidores entre perfiles y
      migración desde `workspaces/<id>`.
- [ ] OAuth de MCPs remotos desde la UI (`opencode mcp auth`).
- [ ] Catálogos HTTP de skills en la biblioteca.
- [ ] Mostrar logs del servidor en la UI.
- [ ] Sidecar empaquetado (hoy usa `opencode` del PATH o `OPENCODE_BIN`).
- [ ] Suspensión de contextos inactivos.
