# Modelo de perfiles, proyectos y workspaces

> El código ya usa **perfil** (`profile`) en tipos, comandos y persistencia. Los
> datos anteriores (`templates.json`, `templates/`, `template.lock.json`,
> `templateId`) se migran al arrancar y siguen leyéndose como fallback.

## Idea

Cuatro piezas declarativas y dos instancias:

- **Proyecto**: uno o más repos con una raíz común. Un repo suelto es un proyecto de
  un solo repo; un multirepo es un proyecto cuya raíz los contiene.
- **Repositorio**: proyecto git añadido a la app, con su remoto y rama principal.
- **Perfil** (hoy `template`): paquete de rol. Define agentes (prompt, modelo, tools,
  permisos), comandos, skills, MCPs y plugins, más las instrucciones base. No
  pertenece a un repo.
- **Huella de contexto**: valor derivado del perfil (y del repo donde se aplica) que
  identifica exactamente lo que opencode carga en un servidor. No se edita.
- **Workspace**: frente de trabajo sobre un proyecto: carpeta, rama, modo e issue.
  Ya no lleva un perfil obligatorio.
- **Sesión**: el trabajador concreto. Elige perfil y agente, y aporta su brief.

El repo nunca elige el perfil. El mismo repo puede tener sesiones de backend,
frontend y métricas con perfiles distintos.

## Regla de aislamiento

Un servidor opencode por **huella**. La huella ya incluye la raíz del proyecto, así
que varias sesiones comparten servidor si su contexto materializado es idéntico.

| Cambia… | ¿Servidor nuevo? |
|---|---|
| Prompt, agente, modelo, permisos del agente | No |
| Skills, MCPs, plugins, AGENTS.md base | Sí (cambia la huella) |
| Worktree dentro del mismo repo | No: mismo servidor, `location.directory` distinto |
| Otro repo sin raíz común | Sí |

Casos concretos:

- Dos trabajadores iguales → dos sesiones, un servidor.
- Backend y frontend que solo difieren en cómo trabajan → un servidor, dos agentes.
- Backend con Postgres y frontend sin él → dos huellas, dos servidores.
- Varias ramas del mismo repo → un servidor, sesiones con directorios distintos
  (ya verificado con el multi-run).

No se comparte un superset de MCPs y skills con permisos por agente para evitar el
servidor extra: el MCP sigue conectado y la tool sigue anunciada al modelo. Es
justo el ruido que este corte quiere quitar.

## Qué entra en la huella

| Capa | Contenido | ¿En la huella? | Dónde vive |
|---|---|---|---|
| Base de contexto | MCPs habilitados y su config, plugins, allowlist de skills (`permissions`), AGENTS.md combinado (global + perfil + repo + issue) | **Sí** | config dir del contexto |
| Rol | agentes (prompt, modelo, tools, permisos propios, temperatura) y comandos | No | `agents/`, `commands/` del contexto |
| Brief | Objetivo de la sesión, issue, notas | No | Sesión |

`huella = sha256(json normalizado)` de la capa base **más la raíz del proyecto**
(el checkout principal, no el worktree), incluido el texto materializado del
AGENTS.md y del `profile.lock.json`. Así la huella identifica un contexto completo y
dos repos distintos nunca colisionan. El modelo por defecto no entra: vive por
agente. El algoritmo se versiona (`huella-v1`) para poder invalidar todo al cambiar
el formato.

Corolario: las instrucciones específicas de rol van en el **prompt del agente**,
nunca en el AGENTS.md base. Si backend y frontend solo difieren en método de
trabajo, comparten huella y servidor. Si difieren en skills o MCPs, no.

## Anatomía de un perfil

```
<appdata>/profiles/<profile-id>/
├── profile.json
├── AGENTS.md                  # instrucciones base propias del perfil
├── agents/<id>.md             # roles: prompt, modelo, tools, permisos
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
existen en `~/.config/opencode`. El perfil selecciona de ahí y puede añadir los
suyos. No se duplica lo instalado; los assets propios viven en su carpeta.

## Materialización por huella

```
<appdata>/contexts/<huella>/
├── xdg/opencode/
│   ├── opencode.json          # modelo por defecto, mcp.servers, skills, permissions, tools, plugin
│   ├── AGENTS.md              # combinado: global + perfil + repo + issue
│   ├── agents/                # symlinks: globales + perfil (perfil gana)
│   ├── commands/              # symlinks: globales + perfil (perfil gana)
│   └── plugins/               # symlinks de los plugins seleccionados
├── opencode.db                # sesiones de este contexto
├── profile.lock.json          # selección congelada que produjo la huella
└── logs/server.log            # stdout/stderr, sin password
```

- El contexto se crea una vez; los workspaces y sesiones de la misma huella lo
  reutilizan.
- `profile.lock.json` congela la selección: editar un perfil no cambia contextos
  existentes hasta "Reaplicar".
- Reaplicar recalcula la huella. Si cambia, se crea otro contexto: las sesiones
  nuevas van allí y las vivas siguen en el suyo hasta reiniciar.
- Si dos perfiles del mismo repo comparten huella, comparten config dir, DB y
  servidor; solo cambian el agente elegido por sesión.

## Repos e instrucciones

- Los AGENTS.md del repo (raíz y anidados, sin `node_modules`/`.git`) se escanean y
  se combinan en el AGENTS.md base, en orden padre → hijo. Por eso el contenido del
  repo forma parte de la huella.
- Si el workspace nace de una issue, se escribe `ISSUE.md` en la carpeta del
  proyecto y se referencia desde el AGENTS.md combinado.
- **Multirepo**: si hay raíz común, un solo proyecto y un solo `cwd`; las sesiones
  seleccionan qué subcarpetas entran en su brief. Si no hay raíz común, un proyecto
  por repo y servidores separados: un proceso no sirve dos raíces de forma limpia.
- **Worktrees**: se crean con `git worktree add`; las sesiones usan su carpeta como
  `location.directory` dentro del mismo servidor. Compartir AGENTS.md y DB es lo
  deseado para comparar ramas. Si un worktree modifica sus AGENTS.md respecto a la
  raíz, la huella cambia y ese contexto se separa.

## Flujo de creación

1. Añadir repo o proyecto.
2. Elegir modo: principal, worktree o desde issue.
3. Nombre, rama y brief.
4. Elegir perfil y agente (por defecto el de ajustes).
5. Al abrir la primera sesión, materializar la huella y arrancar su servidor si no
   existe.
6. Abrir otra sesión con otro perfil: si su huella coincide, comparte servidor; si
   no, se levanta uno nuevo sobre la misma raíz.

## UI

- **Proyectos**: repos, raíz, rama principal.
- **Perfiles**: lista y editor (AGENTS.md base, selección de agentes/skills/MCPs/
  prompts/plugins, modelo y permisos).
- **Workspaces**: lista agrupada por proyecto, estado live/parado y sesiones dentro.
- **Nueva sesión**: elegir perfil y agente; badge «comparte servidor con…» cuando la
  huella coincide.
- **Ajustes del workspace**: perfil por defecto, ruta, rama, issue y reaplicar.

## Persistencia

```
<appdata>/repos.json
<appdata>/profiles.json        # manifiestos; assets en profiles/<id>/
<appdata>/workspaces.json      # projectId, repoId, modo, path, rama, issue, defaultProfileId
<appdata>/contexts/<huella>/   # config materializada, lock, DB y logs
```

## Migración desde el modelo actual

1. `templates.json` → `profiles.json`; el manifiesto se mantiene y se le añade
   `baseAgents`.
2. `workspace.templateId` → `defaultProfileId`; `template.lock.json` →
   `profile.lock.json`.
3. Al arrancar, calcular la huella de cada workspace existente y materializar su
   contexto una vez. Los workspaces con la misma huella comparten contexto.
4. Mover un workspace vivo a un contexto compartido exige reiniciar su servidor;
   no se borra nada hasta que el nuevo arranque correctamente.

## Fases

1. Huella y store de contextos (`contexts/<huella>`), reutilización y reinicio
   limpio.
2. Perfiles: CRUD sobre `profiles.json` y renombrado desde templates.
3. Proyectos y repos: agrupación y raíz.
4. Workspaces sin perfil obligatorio.
5. Sesión con perfil y agente; servidor por huella.
6. Worktrees e issues.
7. AGENTS.md combinado y reaplicar perfil.
8. UI de contextos activos, GC y suspensión.

## Decisiones

Cerradas:

1. El perfil no se asocia al repo ni al workspace: se elige por **sesión**.
2. El aislamiento se mide por **huella**: MCPs + skills + plugins + instrucciones.
   Nada de superset con permisos por agente.
3. El rol fino (prompt, modelo, tools) es un **agente** dentro de la huella.
4. Un servidor por huella; los worktrees comparten servidor vía
   `location.directory`.
5. Huella congelada por contexto y reaplicación explícita.

Abiertas:

1. Instrucciones de repo por directorio en vez de combinarlas: permitiría compartir
   contexto entre repos del mismo stack; descubrir AGENTS.md del proyecto está sin
   verificar con `OPENCODE_DISABLE_PROJECT_CONFIG`.
2. GC y suspensión de contextos sin sesiones vivas.
3. GitLab como segundo proveedor de issues.
