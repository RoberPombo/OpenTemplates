# Modelo de features, pasos y sesiones

> Borrador de trabajo. Cierra el naming de `workspace` y define cómo se organiza
> una feature sobre uno o varios repos. Sustituye al frente de trabajo único
> descrito en `docs/modelo-templates-repos.md`; el resto de ese documento
> (perfiles, huella, contextos) sigue vigente.

## Términos

| Término | Qué es | Vive en |
|---|---|---|
| **Feature** | Unidad de trabajo con un objetivo y un tipo (`feature`, `fix`, `hotfix`, `chore`). Es lo que el usuario crea y nombra, y sobrevive a las sesiones. | `features.json` |
| **Target** | Participación de un repo en la feature: ruta dentro del checkout, rama y scopes. Solo tiene worktree propio si el proyecto no tiene raíz git. | `feature.json` |
| **Raíz** | Repo git contenedor del multirepo. Declara los subrepos en `.gitmodules` y versiona su gitlink; se hace su worktree y el de cada subrepo en `repos/`. Aporta el AGENTS.md que manda sobre todos. | `feature.json`, `repos.json` |
| **Carpeta de la feature** | Raíz única de la feature: el worktree de la raíz (o los de cada target) más los artefactos compartidos. | `<appdata>/features/<id>/` |
| **Scope** | Subcarpeta o subcarpetas donde trabaja un paso (`front`, `back`, `.`). **No** es un worktree. | `Step.scope` |
| **Step** | Fase del flujo con un rol: coordinar, plan, implementar, verificar, integrar. Es la unidad de orquestación. | `feature.json` |
| **Sesión** | El trabajador de opencode que ejecuta un step. 1:1 con el step por ahora. | DB del contexto |
| **Perfil** | Paquete de rol (agentes, comandos, skills, MCPs, plugins, AGENTS.md base). Es el antiguo *template*. | `profiles.json` |
| **Flujo** | Receta que genera los steps (`standard`, `fast`). No es un perfil. | `flows.json` |
| **Contexto** | Config materializada de una huella; un servidor por huella. | `contexts/<huella>/` |

Colisiones a evitar:

- **Grupo**: se confunde con el grupo de sesiones. El equipo es una propiedad
  (`steps`), no la entidad.
- **Trabajo**: ya significa *árbol de trabajo* en la UI de git.
- **Goal**: ya está usado para el bucle autónomo de una sesión (turnos/coste) en
  `domain/chat/goals.ts`. El objetivo de la feature es `brief`.
- **Workspace**: queda como detalle técnico (carpeta/worktree), no como entidad
  de cabecera.

## Jerarquía

```
Feature 1 ── 0..1 Raíz (repo contenedor del multirepo)
Feature 1 ── N Target (ruta, rama, scopes)
Feature 1 ── N Step   (tipo, scope, perfil, agente, sesión)

Proyecto  = repos con raíz común (dato de configuración)
Contexto  = (ruta de la raíz + config efectiva) → 1 servidor
```

La feature **no cuelga de un proyecto**: cuelga de repos. Un proyecto sigue
siendo la agrupación de repos con raíz común, pero una feature puede tocar repos
de proyectos distintos. Eso es lo que permite "1 repo o varios subrepos".

La pieza que se hace checkout no es el repo que editas, sino la **raíz**: si el
proyecto tiene un repo contenedor, su worktree; si no, un worktree por target.

Dos palabras que conviene no mezclar:

- **Carpeta de la feature**: el sitio único donde vive todo lo de esa feature.
- **Worktree**: checkout de **un** repo git; no puede abarcar dos repos.

Regla: se hace **un worktree por repo que se checkoutea**, nunca por subcarpeta.
Con raíz git, un worktree del metarepo y uno por subrepo, todos en la misma
carpeta de feature y en su ruta relativa; los targets son rutas dentro de esa
carpeta. Sin raíz, un worktree por target. Las subcarpetas siempre son `scopes`,
nunca checkouts. Al paralelizar se duplica el trabajo de checkout, no la carpeta
de la feature.

Con raíz:

```
<appdata>/features/feat-123/
├── multirepo/        # worktree del metarepo
│   ├── AGENTS.md     # estándar para todos los subrepos
│   ├── .gitmodules   # ruta, URL y rama de cada subrepo
│   └── repos/
│       ├── front/    # worktree del subrepo
│       └── back/
├── BRIEF.md
└── PLAN-*.md
```

Sin raíz (repos sueltos):

```
<appdata>/features/feat-123/
├── repo-a/           # git worktree de A
├── repo-b/           # git worktree de B
├── BRIEF.md
└── PLAN-*.md
```

## Ejemplo A — un repo (Next)

```jsonc
{
  "id": "feat-123",
  "name": "Checkout con Stripe",
  "kind": "feature",
  "flow": "standard",
  "targets": [
    {
      "repoId": "repo-a",
      "baseBranch": "main",
      "branch": "feature/checkout-stripe",
      "worktreePath": "<appdata>/worktrees/feat-123/repo-a",
      "scopes": ["."]
    }
  ]
}
```

Flujo estándar, 6 steps:

1. `coordinate` (feature) — lee `BRIEF.md`, escribe `DECOMPOSITION.md` y, si toca,
   reparte scopes.
2. `recon` (target A, scope `.`) — investigación barata; escribe `RECON.md` con
   rutas, restricciones y lo que hay que decidir.
3. `plan` (target A, scope `.`) — lee brief y recon; escribe `PLAN.md`.
4. `implement` (target A, scope `.`) — depende de `plan` y del gate de aprobación.
5. `verify` (target A, scope `.`) — escribe `VERIFY.md`.
6. `integrate` (feature) — rebase sobre la base, commit/PR, cierra la feature.

## Ejemplo B — multirepo con front y back

Hay tres formas y el modelo las cubre igual:

- **Un repo git con `front/` y `back/`** → 1 target, 2 scopes, 1 worktree.
- **Multirepo con repo raíz** → 2 targets (`front`, `back`), **1 worktree de la
  raíz** con un worktree de cada subrepo en `repos/<nombre>`.
- **Carpeta con dos repos sueltos, sin raíz** → 2 targets, 2 worktrees en la misma
  carpeta de feature.

En los tres casos los steps con fan-out por scope:

```
coordinate (feature)
├─ recon(front)     → plan(front) → implement(front) → verify(front) ┐
├─ recon(back)      → plan(back)  → implement(back)  → verify(back)  ├─ integrate (feature)
└─────────────────────────────────────────────────────────────────────┘
```

| | A (1 repo) | B raíz (2 targets) | B suelto (2 repos) |
|---|---|---|---|
| coordinación | 1 | 1 | 1 |
| investigación | 1 | 2 | 2 |
| plan | 1 | 2 | 2 |
| implementación | 1 | 2 | 2 |
| verificación | 1 | 2 | 2 |
| integración | 1 | 1 | 1 |
| worktrees (metarepo + subrepos) | 1 | 3 | 2 |

A y B con raíz comparten servidor, porque en la base solo entra el AGENTS.md de la
raíz y la huella no cambia por scope. B suelto necesita uno por repo, y ahí la
orquestación la lleva la app: una sesión del coordinador no puede abrir sesiones
en otro servidor.

## Multirepo con raíz

El metarepo MAIN declara sus subrepos en `.gitmodules` (ruta, URL y rama base) y
versiona el **gitlink** de cada uno: el commit concreto, no sus archivos. `repos/`
está registrado; `ignore = all` solo oculta sus cambios en el estado habitual del
metarepo, no los desregistra.

Materialización con worktrees independientes (no `git submodule update`):

```bash
# raíz
git -C "$MAIN" worktree add -b "$BRANCH" "$WT" origin/develop

# cada subrepo declarado que entra en la feature
git -C "$MAIN/repos/$REPO" worktree add -b "$BRANCH" "$WT/repos/$REPO" "origin/$BASE"
```

- La ruta sale de `.gitmodules`; la base, de su `branch` o del override. Los
  subrepos se descubren por la declaración, no escaneando carpetas.
- Se parte de la base remota, no del SHA que fija el gitlink: la feature empieza
  fresca y el gitlink se actualiza al integrar.
- **Rama local por defecto**: `<tipo>/<slug>` (`feature/checkout-stripe`,
  `hotfix/caida-pagos`). El commit queda anclado a una ref recuperable y el PR sale
  con upstream sin pasos extra; crear la rama no cuesta más que `--detach`. Si la
  rama ya existe se avisa; `--detach` se permite por repo para casos concretos.
- **Objetos y refs compartidos**: un `fetch` en cualquier checkout actualiza las
  referencias remotas que ven los dos, pero no mueve HEAD ni los archivos del
  otro. Cambiar archivos o hacer pull en MAIN no toca el worktree.
- **Actualizar la base** es explícito y por repo: `git rebase origin/<base>` antes
  del push, no un merge. Se hace en el paso de integración, no al crear, y nunca
  automático.
- **`ignore = all`** hace que `git status` del metarepo no muestre los cambios de
  los subrepos. El panel de cambios y la verificación tienen que mirar cada
  worktree de subrepo por separado (o forzar `--ignore-submodules=none`); si no,
  un paso puede dar por limpio algo que no lo está.
- **Integración**, en este orden: commit y push en cada subrepo tocado, luego
  `git add repos/<x>` en el metarepo para registrar el nuevo gitlink, y commit y
  push del metarepo. Al revés, el metarepo apuntaría a commits que aún no existen
  en remoto.
- **Solo el AGENTS.md de la raíz entra en la base** del contexto. Ese texto le dice
  al modelo que use también el del subrepo correspondiente; los hijos no se
  combinan ni cambian la huella. Por eso la feature comparte servidor aunque toque
  varios subrepos, y el estándar del padre se aplica siempre.
- Paralelizar: otra feature = otro worktree del metarepo y otro de cada subrepo,
  con su rama `<tipo>/<otro-slug>`; si el slug coincide, se avisa antes de crear.
- Si no hay raíz git, se cae al caso de un worktree por target.

### Bootstrap de la feature

Después de crear los worktrees, antes de lanzar el coordinador. La lista es **por
repo/subrepo**, editable, y la app solo propone candidatos:

1. **Detección (sugerencia).** Ficheros ignorados del checkout principal que
   parezcan configuración: `.env*`, `*.local`, `.npmrc`, `.tool-versions`,
   `docker-compose.override.yml`, configs de servicio. Se excluyen `.git`,
   `node_modules`, `dist`, `build`, `.next`, `target`, logs y cachés. El usuario
   confirma, añade o quita.
2. **Copia.** Cada entrada tiene modo:

   | Modo | Uso |
   |---|---|
   | `copy` | Defecto para ficheros de configuración; conserva permisos |
   | `link` | Solo si se acepta compartir el fichero con el checkout principal |
   | `clone` | Copia con reflink si el FS lo soporta; si no, copia normal |
   | `auto` | Lo decide el gestor del repo (ver `node_modules`) |

3. **`node_modules`.** Se puede traer para evitar el install, pero con una regla
   segura: `auto` compara el lockfile con el del checkout principal. Si coincide,
   copia (reflink si el FS lo soporta; si no, copia normal). Si no, instala con el
   gestor: pnpm `install --prefer-offline --frozen-lockfile`, npm
   `ci --prefer-offline`. Con yarn o bun se copia y se avisa, en vez de improvisar
   el install. **No symlink**: si la feature cambia dependencias, un enlace
   contaminaría el principal.
4. **Verificar** cada worktree por separado, subrepos incluidos: `ignore = all`
   oculta su estado en el metarepo.
5. **Registrar** en `feature.json` los SHAs de partida: HEAD del metarepo, HEAD de
   cada subrepo y el gitlink declarado.

Los ficheros copiados pueden contener secretos: no se indexan, no se registran en
logs ni se suben a ningún sitio. Si falta algo marcado como obligatorio, la feature
queda en `blocked` y no se lanza ninguna sesión: mejor no arrancar servicios con
media configuración.

## Tipos y flujos

El tipo se elige al abrir y decide la receta; no se infiere por tamaño del cambio:

| Tipo | Cuándo | Flujo | Steps |
|---|---|---|---|
| `feature` | Funcionalidad nueva | `standard` | coordinate → recon* → plan* → implement* → verify* → integrate |
| `fix` | Bug con alcance y riesgo normal | `standard` | igual |
| `hotfix` | Producción rota, hay que salir ya | `fast` | change* → verify* → integrate |
| `chore` | No toca código de producción (docs, CI, deps, refactor sin comportamiento) | `fast` | change* → verify* → integrate |

`*` = uno por scope (o por target si el scope es `.`). Gates: en `standard`,
aprobar el plan antes de implementar y verificación en verde antes de integrar;
en `fast`, solo verificación en verde.

Un flujo es una receta expandida con `targets × scopes`. En `fast` no hay
coordinador ni plan: la misma sesión recibe el brief con el alcance y ejecuta.
`hotfix` parte de `main` o del tag en producción, no de `develop`; el resto parte
de la base configurada por repo.

Los cuatro tipos generan la misma clase de steps; lo que cambia es la receta, no
el modelo. Un `fix` puede acortar el plan (una nota en `BRIEF.md`) sin saltarse la
verificación.

## El coordinador

Una sesión por feature, antes de los planes. Es el único sitio donde se describe
la feature, y solo decide **contenido**; la app decide **ejecución**.

Entradas: `BRIEF.md`, `ISSUE.md`, `.gitmodules`, el AGENTS.md de la raíz y lectura
de los worktrees para estructura, no código. Salida: `DECOMPOSITION.md` con

- targets y scopes confirmados, y peticiones de añadir alguno,
- brief por scope para el plan (qué investigar, criterios de aceptación),
- orden y dependencias entre scopes, riesgos,
- estrategia de verificación por scope.

No crea sesiones, no hace commit ni push. Pide cosas a la app con dos
herramientas, y la app valida y ejecuta:

- `feature.request_target` → crear el worktree de un repo/scope que faltaba antes
  de los planes.
- `feature.propose_steps` → generar los steps de cada scope (recon, plan,
  implementación y verificación); la app muestra el gate de aprobación.

El coordinador corre en la raíz, así que en multirepo ve front y back y propone un
plan para cada uno. No habla con las sesiones de plan: les deja el artefacto y el
step declara qué leer. Si el alcance cambia, se re-ejecuta `coordinate`,
reescribe `DECOMPOSITION.md` y los planes afectados se marcan obsoletos.

En `fast` no hay coordinador: el brief va directo a la sesión que ejecuta.

### Contexto y coste

El coordinador es la única conversación con el usuario; el resto de steps son
workers que publican artefactos. Para que su contexto no crezca:

- No lee código ni ejecuta tests: eso es `recon` (barato) o el plan.
- Su estado vive en `BRIEF.md`, `DECOMPOSITION.md` y `NOTES.md`, no en el hilo. Si
  la conversación se alarga, se compacta o se reabre con esos artefactos.
- De cada worker lee el `## Resumen` del artefacto; el resto solo si lo pide.
- Los modelos se asignan por step: coordinador y `recon` baratos; `plan` caro.

`recon` es la investigación corta que prepara el plan: un modelo barato recorre
rutas, dependencias y restricciones y escribe `RECON-<scope>.md` con lo que toca,
dónde está y qué no se sabe. El plan caro lee brief + recon y se gasta el
presupuesto en decidir, no en explorar. Si el recon no encuentra nada relevante,
el plan lo sabe antes de empezar.

Reparto de roles por step:

| Step | Perfil |
|---|---|
| `coordinate` | coordinador: lee y escribe artefactos; no edita código |
| `recon` | explorador: lee y busca; escribe `RECON-<scope>.md`; no edita |
| `plan` | planificador: lee recon y escribe `PLAN-<scope>.md` |
| `implement` | implementador: edita código y ejecuta tests |
| `verify` | verificador: lee el diff, ejecuta tests; no edita |
| `integrate` | integrador: commit/push/PR; sin lógica de negocio |

El paso de integración también hace el `rebase` sobre `origin/<base>` antes de
empujar.

## Perfiles: qué se asocia a qué

Dos capas que no hay que confundir:

- **Perfil** = rol (qué agentes, skills, MCPs y permisos tiene).
- **Flujo** = proceso (qué pasos y en qué orden).

Asociaciones:

```
app / usuario        → config global (auth, modelos, defaults)
repo                 → perfiles por defecto por tipo de paso (pista, no binding)
feature              → instrucciones propias (brief, issue, AGENTS extra)
step                 → perfilId + agentId   ← binding real
sesión               → override de modelo/agente
```

Precedencia: `sesión > step > feature > repo > app`. El hijo gana por clave; en
las allowlists (skills, tools) gana la más restrictiva. Solo lo que cambia la
huella (MCPs, skills, plugins, AGENTS.md) crea contexto nuevo; modelo, agente y
comandos no.

Esto matiza la decisión cerrada nº 1 de `modelo-templates-repos.md` ("el perfil
no se asocia al repo"): el repo aporta **defaults**, no un binding. Quien
materializa el contexto sigue siendo el step/sesión.

## Qué recibe cada sesión

La app resuelve la config efectiva y la inyecta; el contexto ya solo expone esa
allowlist, así que "lo que tiene para usar" está aplicado, no solo sugerido:

```md
Feature: Checkout con Stripe (feat-123)
Paso: implement · repo B · scope front/ · worktree <ruta>
Perfil: front-impl · agente: implementer · modelo: ...
Disponible: skills [...], MCPs [...], plugins [...]
Lee: BRIEF.md, DECOMPOSITION.md, PLAN-front.md
Escribe: cambios en front/ (la verificación es otro paso)
```

Artefactos compartidos en `features/<id>/`:

```
BRIEF.md            # objetivo, issue, criterios de aceptación
DECOMPOSITION.md    # salida del coordinador: scopes y orden
RECON-<scope>.md    # investigación barata: rutas, restricciones, dudas
PLAN-<scope>.md
VERIFY-<scope>.md
NOTES.md            # decisiones y estado corto, para no releer el hilo
```

Así el coordinador "pasa" el plan a los implementadores sin hablar con ellos:
comparten carpeta y el step declara qué leer.

## Worktree y ciclo de vida

El worktree es **perezoso hasta que el alcance está claro**, no hasta el primer
step:

1. **Borrador.** La feature existe sin tocar disco: nombre, tipo, targets y ramas
   propuestas. Se puede abandonar gratis.
2. **Confirmación.** Usuario define issue y scopes (qué carpetas de qué repos
   entran). Ahí se hace `fetch` de la base y `git worktree add -b` **de la raíz**,
   y de cada subrepo en su ruta relativa (ver *Multirepo con raíz*); si no hay
   raíz, uno por target. Luego corre el bootstrap por repo. La base por defecto es
   `main`; se puede cambiar por target al confirmar (p. ej. `develop`) y en
   `hotfix` es `main` o el tag en producción. Limpio = desde la base, sin restos
   locales.
3. **Ejecución.** Los steps corren ya sobre checkouts aislados; el coordinador y
   el plan necesitan leer código, por eso el worktree nace antes de lanzarlos y
   nunca se planifica sobre el checkout principal sucio.

- Dos features sobre la misma raíz (o repo) = dos worktrees distintos: eso es el
  paralelismo.
- Al cerrar: merge/PR, `git worktree remove`, la rama se conserva; si falla, no
  se borra nada.

## Estados

```
Feature: draft → confirmed → running → blocked (gate) → done | failed | cancelled
Step:    pending → ready → running → awaiting-review → done | failed | skipped
```

`confirmed` es el gate de alcance: issue y scopes cerrados, worktrees creados y
grafo de steps generado. `ready` es derivado: dependencias `done` y gate anterior
aprobado. La app avanza el grafo; el coordinador propone la descomposición y el
usuario la aprueba.

## Persistencia

```
<appdata>/features.json          # índice: id, nombre, estado, targets
<appdata>/features/<id>/feature.json
<appdata>/features/<id>/*.md     # artefactos compartidos
<appdata>/flows.json             # recetas standard/fast
<appdata>/profiles.json          # roles (ya existe)
<appdata>/repos.json             # repos y subrepos; incluye bootstrap por repo
<appdata>/contexts/<huella>/     # config materializada y DB
```

Cada `step` guarda `sessionId`, `profileId`, `agentId` y `contextHash`. Las
sesiones viven en la DB del contexto; si el contexto se recrea, el step conserva
su brief y se puede reasociar/importar la sesión (ya hay migración de sesiones).

## Decisiones

Cerradas:

1. La feature cuelga de repos, no de proyectos; monorepo (1 target, N scopes),
   multirepo con raíz (N targets, 1 worktree) y repos sueltos (N targets, N
   worktrees) son el mismo modelo.
2. Una carpeta por feature. El checkout es de la **raíz** cuando existe; si no, un
   worktree por target. Nunca por subcarpeta. Paralelizar duplica el worktree de
   la raíz (o del repo), no la carpeta de la feature.
3. Submódulos declarados en `.gitmodules` (ruta, URL y rama base); el metarepo
   versiona el gitlink. Se materializan con un worktree por repo desde la base
   remota, no con `git submodule update`.
4. Rama local por defecto (`<tipo>/<slug>`) en cada repo: ancla los commits y el
   PR sale con upstream. Si ya existe se avisa; `--detach` queda como opción por
   repo.
5. `ignore = all` oculta los cambios de los subrepos en el estado del metarepo: la
   app consulta cada worktree por separado para cambios y verificación.
6. Fetch comparte objetos y refs, pero no mueve HEAD ni archivos. Actualizar la
   base de una feature es una operación explícita, nunca automática.
7. Bootstrap por repo/subrepo, editable y con detección como sugerencia: modos
   `copy`, `link`, `clone` y `auto`. `node_modules` según el lockfile (`pnpm i
   --offline` con pnpm; copia con reflink si no), nunca symlink. Lo copiado puede
   tener secretos: no se indexa ni se publica.
8. Solo el AGENTS.md de la raíz entra en la base del contexto; ese texto remite al
   del subrepo. Los AGENTS.md hijos no se combinan ni cambian la huella, así que
   front y back comparten servidor y el estándar del padre manda.
9. Worktree perezoso hasta confirmar issue y alcance; después se crea (y se
   materializan los subrepos) antes de lanzar coordinador y plan.
10. Base por defecto `main`, modificable por target al confirmar; `hotfix` parte de
    `main` o del tag en producción.
11. El tipo (`feature`, `fix`, `hotfix`, `chore`) se elige al abrir y decide el
    flujo; `standard` para feature/fix, `fast` para hotfix/chore.
12. `fast` no crea coordinador ni plan; `standard` sí.
13. Integración en multirepo con raíz: commit y push de subrepos primero, después
    `git add repos/<x>` (nuevo gitlink) y commit/push del metarepo.
14. El coordinador es la única conversación con el usuario: propone contenido y
    pide a la app crear targets y steps. La app ejecuta, el usuario aprueba. No
    crea sesiones por su cuenta.
15. Actualizar la base: `git rebase origin/<base>` por repo antes del push, en
    integración y explícito; nunca merge automático.
16. Flujo `standard` con `recon*` entre coordinación y plan: investigación barata
    que escribe `RECON-<scope>.md`; el plan caro lee brief + recon y decide.
    Modelos por step: coordinador y recon baratos, plan caro.
17. El contexto del coordinador no guarda código ni el historial de los workers;
    el estado vive en artefactos y se compacta o reabre desde ellos.

Abiertas:

1. Repo como defaults de perfil por tipo de step, no como binding (matiza la
   decisión cerrada nº 1 de `modelo-templates-repos.md`).
2. Al crear, la base remota puede no coincidir con el gitlink que versiona el
   metarepo: decidir si se avisa, si se parte del gitlink o de la base.
3. Qué pasa con una feature cuyo target es un repo sin git.
4. Carreras: hoy son otra entidad; decidir si pasan a ser una feature con varios
   steps `implement` en paralelo sobre el mismo scope.
