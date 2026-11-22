# Revisión: Clean Architecture y testing — OpenTemplates

Fecha: 2026-11-21. Alcance: frontend React (`src/`); el backend Rust se revisa solo como contexto.
Metodología: skills `clean-architecture-frontend`, `refactoring-clean-architecture`, `testing-frontend`.

## 1. Estado actual

- Tauri v2: backend Rust (~4.000 líneas) **con 18 tests unitarios** (`store`, `config`,
  `library`, `server`, `git`, `templates`). El dominio real del producto (aislamiento de
  workspaces, generación de config, templates congelados) vive ahí y ya está razonablemente
  protegido.
- Frontend React 19 + TS (~4.700 líneas): **0 tests**, estructura plana
  (`api.ts`, `opencode.ts`, `types.ts`, 8 componentes).
- Trabajo sin commitear: instrumentación de rendimiento (`PerformanceCapture.tsx`,
  `perf/capture.ts`, `Profiler` en `WorkspaceView`, lazy en `App`). **No se toca en el refactor.**

## 2. Hallazgos (por severidad)

### Crítico

1. **Sin red de seguridad en el frontend.** Las reglas de negocio solo se pueden verificar
   arrancando la app completa (Tauri + opencode). Cualquier refactor es a ciegas.
   → Paso 0 obligatorio: Vitest + RTL y tests de caracterización antes de tocar producción.
2. **Lógica de negocio dentro de componentes** (causa raíz de casi todo lo demás):
   - `Chat.tsx` (994 líneas, 5+ responsabilidades): mapeo DTO→mensaje
     (`toChatMessages`, `toToolActivity`, L104-166), resolución de modelo/agente/variante
     con prioridad actual > guardado > workspace > default del servidor > primero
     (L347-368), reducer de 10 tipos de eventos de streaming inline (L450-539),
     ciclo de vida de sesión, persistencia en localStorage repartida en 6 effects,
     rama git, y el render.
   - `CreateWorkspace.tsx` (766): reglas del wizard — `slugify` (L37), rama y ruta por
     defecto (L128-132), conflictos de checkout principal y de ruta (L134-144),
     validación por paso `canContinue` (L245-254), template rápido con colisión de id
     (L181-225).
   - `SettingsPanel.tsx`: política de aplicación — diff de MCPs (quitar los que sobran,
     añadir los nuevos, L141-162) y decisión de recarga (`skillsChanged || modelChanged`,
     L164-171). Es lógica de aplicación, no de UI.
   - `App.tsx` (402): orquestación de arranque/parada/borrado con la política de
     confirmación embebida (`window.confirm`, worktree sucio → `force`, L170-227),
     agrupación por repo (L57-83), polling y persistencia de selección.
   - `Inspector.tsx`: ratios derivados (`contextRatio`, `cacheRatio`, L261-271) y
     agregación de tokens/coste inline.

### Alto

3. **Acoplamiento directo a infraestructura desde la UI.** Componentes importan `api`
   (invoke de Tauri) y el cliente `@opencode/client`; `localStorage` se usa en 4 componentes
   con claves ad-hoc; `window.confirm` dentro de la orquestación. No se puede sustituir el
   transporte ni testear sin Tauri. Violación de la regla de dependencia.
4. **`any` en la frontera con opencode** (`toToolActivity(part: any)`,
   `toChatMessages(raw: any[])`, casts en Inspector/SettingsPanel). El contrato con el
   servidor no está tipado; los errores de forma se descubren en runtime.

### Medio

5. **Duplicación**: `errorText` ×3 (App, Chat, CreateWorkspace), `folderName` ×3
   (App, Chat, WorkspaceView), toggle de Set/Map ×3 (CreateWorkspace, SettingsPanel,
   ManagePanel). Cada copia diverge sutilmente (p. ej. `errorText` de Chat devuelve
   "Error desconocido" para falsy; las otras no).
6. **Modelo anémico**: `types.ts` son DTOs del backend compartidos por todas las capas;
   no hay capa propia con las reglas del frontend.
7. **Sin enforcement de capas**: nada impide que código nuevo importe `api` desde un
   componente (oxlint no tiene reglas de importación por capas).

## 3. Qué dominio propio tiene el frontend

El backend ya owns el dominio del producto; el frontend **no debe duplicarlo**. Sus reglas
propias (las que hoy viven en componentes) son:

| Regla | Hoy | Destino |
|---|---|---|
| Mapeo mensaje/parts → `ChatMessage`, detalle y estado de tools | Chat.tsx | `domain/chat` (puro) |
| Reducer de eventos de streaming (deltas, tools, idle/failed) | Chat.tsx effect | `domain/chat` (puro) |
| Resolución modelo/agente/variante por prioridad | Chat.tsx | `domain/chat` (puro) |
| Firma de selección aplicada (evitar switch redundante) | Chat.tsx refs | `domain/chat` |
| `slugify`, rama/ruta por defecto, conflictos, validación del wizard | CreateWorkspace | `domain/workspace` |
| Diff de MCPs + decisión de recarga | SettingsPanel | `domain/workspace` |
| Política de borrado (worktree sucio → force; confirmaciones) | App.tsx | caso de uso + puerto de confirmación |
| Agrupación por repo, selección persistente | App.tsx | `domain/workspace` + puerto de preferencias |
| Ratios de contexto/caché, agregación de sesión | Inspector | `domain/chat` (puro) |
| `errorText`, `folderName`, `formatDuration` | ×3 cada uno | `domain/shared` |
| Parser de Markdown (`parseBlocks`, `renderInline`) | Markdown.tsx | ya es puro; solo faltan tests |

`Workspace`, `Repo`, `TemplateManifest` se mantienen como **tipos** (value objects de lectura):
sus invariantes viven en Rust. No se crean clases-espejo ni casos de uso pass-through de una
línea para cada invoke; solo casos de uso donde hay coordinación real.

## 4. Arquitectura objetivo

```
src/
├── domain/
│   ├── chat/            # mapeo, reducer de stream, resolución de selección, ratios
│   ├── workspace/       # wizard (slug, conflictos, validación), diff MCP, grouping, borrado
│   ├── shared/          # errorText, folderName, formatDuration
│   ├── repositories/    # puertos: WorkspaceGateway, LibraryGateway, ChatGateway,
│   │                    #          PreferencesStore, ConfirmDialog
│   └── __tests__/       # puros, sin jsdom
├── data/
│   ├── TauriWorkspaceGateway.ts   # envuelve api.ts, mapea DTO↔dominio, errores planos
│   ├── OpencodeChatGateway.ts     # envuelve @opencode/client (hoy opencode.ts)
│   └── LocalStoragePreferences.ts # claves centralizadas
├── presentation/
│   ├── components/      # los actuales, adelgazados; sin api/client/localStorage
│   ├── hooks/           # useWorkspaces, useChat, useWizard, useWorkspaceSettings
│   └── context/         # AppProvider + useAppContext
├── CompositionRoot.ts   # único punto de cableado (singleton, provideXUseCase)
└── main.tsx             # envuelve en AppProvider
```

Regla de dependencia: `presentation → domain ← data`. Los hooks consumen casos de uso vía
contexto; los componentes reciben datos y callbacks por props. Litmus: los módulos de
`domain/` deben poder ejecutarse desde un terminal, sin React ni Tauri.

## 5. Estrategia de testing

Stack: **Vitest + jsdom + React Testing Library + jest-dom + user-event**.

Pirámide:
1. **Dominio** (mayoría, entorno node, sin DOM): mapeo de mensajes con payloads realistas,
   reducer de eventos (secuencias delta→idle, error, tools), resolución de selección
   (cada peldaño de la prioridad), slugify/conflictos/validación, diff MCP + recarga,
   ratios, parser Markdown.
2. **Casos de uso** con fakes en memoria de los puertos (sin red, sin Tauri).
3. **Componentes** mockeando hooks/gateways, no la API: wizard (pasos, validación,
   conflictos), Chat (enviar, streaming, nueva conversación), SettingsPanel (aplicar).
4. **Integración** (2-3 flujos): crear workspace con fake gateway; chat completo con
   fake `ChatGateway` que emite eventos de stream.

Reglas: tests de caracterización **antes** de extraer (verificar que fallan si cambia el
comportamiento); TDD en cada peldaño de la escalera; `getByRole`/`getByLabelText` antes que
test-ids; nada de peticiones reales. Scripts: `test`, `test:watch`, `test:coverage`; `check`
pasa a incluir los tests. Rust: se mantienen sus tests; fuera de alcance.

## 6. Plan por fases (cada paso: tests en verde, sin cambio de comportamiento)

- **Fase 0 — Red de seguridad.** Infraestructura Vitest + tests de caracterización de lo ya
  testeable sin tocar producción (Markdown renderer). *Sin cambios en código de producción.*
- **Fase 1 — Dominio puro.** Extraer por funcionalidad (chat: mapeo→reducer→selección;
  wizard: slug/conflictos/validación; settings: diff/recarga; shared), test-first, el
  componente pasa a importar el módulo. Commits atómicos por funcionalidad.
- **Fase 2 — Puertos y adaptadores.** `domain/repositories` + `data/` + CompositionRoot +
  AppProvider; hooks `useWorkspaces`/`useChat`/`useWizard`; los componentes pierden
  `api`, `client` y `localStorage`. La política de borrado pasa a caso de uso con puerto
  `ConfirmDialog` (la UI sigue decidiendo cómo confirmar).
- **Fase 3 — Presentación.** Tests de componente con hooks mockeados; partir Chat en
  hook + vista; limpiar Inspector/ManagePanel; tipar la frontera opencode (eliminar `any`).

Orden dentro de cada fase: de lo simple a lo complejo (shared → wizard → settings → chat).
Chat es lo más delicado (SSE, carreras entre `reload` y stream): se caracteriza con un fake
client antes de mover nada.

## 7. Riesgos y notas

- **WIP de rendimiento sin commitear**: conviene commitearlo antes del refactor para no
  mezclarlo en los commits de la escalera. El refactor no modifica esos ficheros.
- TypeScript 7 y Vite 8 son muy recientes: fijar versiones de Vitest compatibles y verificar
  `typecheck` + `build` tras la fase 0.
- No se commitea nada sin petición explícita del usuario (regla del harness); la skill
  recomienda commit por paso, se aplicará si el usuario lo autoriza.
- **Edición en paralelo**: durante la fase 1 el usuario estuvo editando `App.tsx`,
  `WorkspaceView.tsx`, `CreateWorkspace.tsx` y creando `src/components/ui/` (primitivas
  Button/TextInput). Las ediciones del refactor fueron quirúrgicas (replace exacto) y no
  tocaron esas zonas. `WorkspaceView` quedó fuera del cableado por estar en edición activa.
- **Rareza del entorno**: `pnpm lint` literal es interceptado por el wrapper de salida del
  harness y falla con "Linter process terminated abnormally"; el lint real pasa sin errores
  (solo warnings preexistentes). Usar `L=lint; pnpm run "$L"` o `pnpm exec oxlint`.

## 8. Progreso

### Fase 0 — completada (2026-11-21)

- Vitest 5 + jsdom 31 + RTL 16 + jest-dom 8 + user-event 14 + coverage-v8.
- `vitest.config.ts`, `src/tests/setup.ts` (stub de `scrollIntoView` solo en entorno DOM),
  scripts `test`/`test:watch`/`test:coverage`, `check` incluye tests.
- 21 tests de caracterización de `Markdown` (bloques e inline), verificados con una mutación
  temporal (el test falla si cambia el comportamiento) y revertida.

### Fase 1 — completada (2026-11-21)

Dominio puro extraído con TDD (rojo → verde → cableado), 111 tests de dominio en entorno node:

| Módulo | Contenido | Componentes cableados |
|---|---|---|
| `domain/shared` | `errorText`, `folderName`, `formatDuration` | Chat, App, CreateWorkspace, SettingsPanel, Inspector, ManagePanel |
| `domain/chat/messages` | `toChatMessages`, `toToolActivity`, `toolDetail` + contrato tipado (sin `any`) | Chat |
| `domain/chat/selection` | catálogos, `resolveModelChoice`/`resolveAgentChoice`, `effectiveVariant` | Chat |
| `domain/chat/stream` | `applyChatEvent` (reducer de 10 eventos), `chatStreamReducer` (acciones de UI), `eventRequestsReload` | Chat (`useReducer`) |
| `domain/chat/usage` | `toSessionUsage`, `contextRatio`, `cacheRatio` | Inspector |
| `domain/workspace/wizard` | `slugify`, derivados, conflictos, `canContinue`, `quickTemplateId`, `workspaceNameError` | CreateWorkspace, ManagePanel |
| `domain/workspace/config` | `sameSet`, `diffMcps`, `configNeedsReload` | SettingsPanel |
| `domain/workspace/grouping` | `groupWorkspacesByRepo` | App |

- Chat: 994 → 768 líneas; el bucle de eventos de ~90 líneas es ahora un dispatch al reducer.
- Red de seguridad de Chat: 9 tests de caracterización con cliente fake (`src/tests/fakes.ts`,
  hub de eventos SSE controlable) cubriendo sesión, envío, streaming, error, parar, rama y
  nueva conversación. Pasaron antes y después del cableado del reducer.
- Semánticas originales preservadas aunque sean peculiares (p. ej. `sameSet` compara
  longitudes brutas; `errorText` de Chat conserva su guard de falsy).
- Total: **141 tests**, `typecheck`/`lint`/`format:check` en verde. Sin commits (WIP del
  usuario mezclado en el checkout; no autorizados).

### Fase 2 — completada (2026-11-21)

Regla de dependencia verificada: ningún componente ni App importa ya `api`, el cliente
opencode, `localStorage` ni `window.confirm`; el dominio no importa React ni infraestructura.

- **Puertos** en `domain/repositories/`: `WorkspaceGateway`, `RepoGateway`, `TemplateGateway`,
  `SettingsGateway`/`BootstrapGateway`, `LibraryGateway`, `ResourcesGateway`, `ChatGateway`
  (superficie estructural del servidor opencode, sin tipos del SDK), `Preferences` (+ `prefKeys`
  centralizadas), `ConfirmDialog`, `FolderPicker`.
- **Casos de uso** (14 tests con fakes): `DeleteWorkspace` (política de confirmación y worktree
  sucio → force), `ApplyWorkspaceSettings` (diff MCP + recarga), `CreateWorkspace` (validación).
- **Adaptadores** en `data/`: `TauriGateways` (delegan en `tauriCommands.ts`, el antiguo
  `api.ts` movido a data; errores normalizados a `Error` con `cause`), `OpencodeChatGateway`
  (construye el cliente; cast documentado solo para la unión experimental de `mcp.add`),
  `LocalStoragePreferences`, `WindowConfirmDialog`, `TauriFolderPicker`.
- **CompositionRoot** (singleton, puertos sobrescribibles por constructor para tests) +
  **AppProvider/useAppContext** + `main.tsx` envuelto.
- **Hook `useWorkspaces`**: carga, polling, selección, arranque/parada/borrado. App queda como
  vista pura (365 → ~230 líneas). 12 tests de caracterización de App escritos antes del
  cableado y verdes después sin cambios (el mock de `tauriCommands` intercepted también a los
  adaptadores).
- Componentes cableados a puertos: Chat (preferencias), WorkspaceView (gateway + preferencias),
  SettingsPanel (caso de uso + library), Inspector (resources/setDisabled), CreateWorkspace
  (folder picker + repos + templates + caso de uso), ManagePanel (todo).
- `opencode.ts` eliminado; el tipo `WorkspaceClient` es ahora alias del puerto `ChatGateway`.
- `lib` ES2022 (Error cause). Build de producción verificado.

### Fase 3 — completada (2026-11-21)

Hecho:
- Tests de componente del **wizard** (4: camino feliz con input exacto, rama existente obligatoria,
  conflicto de checkout principal, colisión de id de template rápido) con CompositionRoot de
  puertos fake — prueban la inyección de extremo a extremo.
- Tests de componente de **SettingsPanel** (5: aplicar sin cambios, añadir MCP + modelo con
  recarga, quitar MCP, sin servidor, reaplicar template).
- **Chat partido en hook + vista** (2026-11-21): `src/presentation/hooks/useChat.ts` concentra sesión,
  catálogo, selección, streaming, envío/parada y persistencia de preferencias; `Chat.tsx` queda
  como vista (render, scroll y autoalto del textarea). Los 9 tests de caracterización de Chat
  siguen verdes sin cambiar aserciones.
- **Payloads de opencode estrechados en el adaptador** (2026-11-21): `data/opencodePayloads.ts`
  convierte catálogo, agentes, mensajes (con consumo) y límites de uso; `OpencodeChatGateway`
  implementa `ChatServer extends ChatGateway` y es el único que conoce el SDK. `ChatGateway`
  conserva `unknown` para el transporte crudo y los datos opacos (eventos, config MCP).
  Chat/Inspector ya no tienen casts de borde; 8 tests nuevos del estrechado.
- Tests de componente de **ManagePanel** (6: añadir repo, quitar repo con confirmación, crear
  template con slug y modelos normalizados, nombre obligatorio, AGENTS.md al seleccionar,
  guardar raíz de worktrees) e **Inspector** (4: sesión/proyecto/uso/recursos con puerto fake,
  estado vacío sin sesión, toggle de MCP con persistencia y recarga, toggle de skill).
- Total: **201 tests**, typecheck/lint/format/build en verde.

### Reorganización final a `presentation/` (2026-11-21)

El WIP del usuario ya estaba commiteado (`9f246fa` tooling, `cdff2be` rendimiento, `11af862`
refactor fases 0-3), así que la reorganización dejó de estar bloqueada.

- `git mv` de `src/components`, `src/hooks` y `src/context` a `src/presentation/` (components,
  hooks, context), conservando historial; `components/ui` y `components/__tests__` viajan con
  los componentes.
- Imports actualizados: `App.tsx`, `main.tsx`, `src/__tests__/App.test.tsx` y los ficheros
  movidos, con la profundidad relativa correcta (`../../domain`, `../../../CompositionRoot`,
  etc.). Los imports entre `components`/`hooks`/`context` no cambian al compartir
  `presentation/`; `CompositionRoot.ts` y `main.tsx` siguen en la raíz de `src`.
- Sin cambios de comportamiento ni en `domain/` ni en `data/`: los diffs de los ficheros
  movidos son solo líneas de import (más el reajuste de una línea larga por oxfmt).
- Puerta completa en verde: `pnpm typecheck`, `pnpm exec oxlint` (exit 0, solo warnings
  preexistentes), `pnpm format:check`, `pnpm test` (**201 tests**) y `pnpm build`.

Pendiente (opcional):
- Estrechar también `mcp.list.status` (SettingsPanel todavía hace un cast local).
- Regla de lint que prohíba imports de `data/` desde presentación.