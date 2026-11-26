# Auditoría de Clean Architecture, tests, seguridad y rendimiento

Fecha: 2026-11-26. Alcance: frontend `src/` (23.9k líneas TS/TSX, 67 ficheros de test).
El backend Rust se revisa como contexto de seguridad; no se modifica en esta pasada.

Método: reglas de las skills `clean-architecture-frontend`, `refactoring-clean-architecture`,
`testing-frontend`; análisis programático de duplicación, dependencias, cobertura y lint;
lectura de los módulos de mayor tamaño y de los tests con más mocks.

---

## 1. Veredicto

La **regla de dependencia se cumple**: `presentation → domain ← data`, sin ciclos, sin
`localStorage`, `window.confirm`, `@tauri-apps/api` ni el cliente de opencode dentro de
componentes, y sin `any` en la frontera. La base es sólida y muy por encima de la media:
puertos explícitos, Composition Root, casos de uso y 692 tests en verde.

Los problemas que quedan no son de capas, son de **cohesión y tamaño**: tres piezas
concentran demasiadas responsabilidades (`useChat`, `Inspector`, `CreateWorkspace`), varios
casos de uso son pass-through, y parte de los tests de componente están acoplados a llamadas
del gateway en vez de a comportamiento visible.

Estado medido antes → después de esta pasada:

| Métrica | Antes | Después |
|---|---:|---:|
| Tests | 672 | 692 |
| Cobertura statements | 78.1 % | 79.1 % |
| Cobertura branches | 74.6 % | 75.1 % |
| Bundle inicial (JS) | 920 kB / 254 kB gzip | 480 kB / 141 kB gzip |
| Lint | 93 warnings | 94 warnings* |
| `any` | 0 | 0 |

\* Suben 2 por reglas nuevas sobre el código extraído; no hay errores.

---

## 2. Clean Architecture: lo que está bien

- **Puertos y adaptadores reales.** `domain/repositories` no conoce Tauri ni el SDK; los
  adaptadores normalizan errores y payloads (`data/opencodePayloads.ts`).
- **Dominio puro y testeable en node.** `domain/chat`, `domain/features`, `domain/race`,
  `domain/workspace`, `domain/shared` no importan React ni infraestructura (verificado).
- **Sin ciclos de dependencia** entre módulos (análisis del grafo completo).
- **CompositionRoot sobrescribible** por constructor; los tests inyectan puertos, no red.
- **Cobertura de dominio alta**: chat 96 %, shared 98 %, race 91 %, theme 97 %.

## 3. Hallazgos de arquitectura y code smells

### Alto

1. **`useChat` es un God Hook (1.188 líneas, 15+ efectos).** Mezcla ciclo de vida de sesión,
   catálogo de modelos/agentes, streaming, permisos/formularios, objetivos, notificaciones,
   transferencia de sesiones y preferencias. Es el principal foco de baja cohesión.
   → Extraer `useChatSessions`, `useChatCatalog`, `useChatRequests` y `useChatGoal`, dejando
   `useChat` como composición. Los tests de integración de Chat ya cubren el comportamiento.
2. **`Inspector` (835 líneas) mezcla I/O, agregación y política de avisos.** El efecto de
   umbrales de presupuesto se movió a `useBudgetAlerts` en esta pasada; queda pendiente
   extraer la carga de datos (`project/session/usage/models/statuses/stats`) a un hook
   `useInspectorData`.
3. **`CreateWorkspace` (719 líneas) mantiene estado y validación de 4 pasos** aunque las
   reglas puras ya viven en `domain/workspace/wizard`. → Extraer `useWizard` y los pasos
   (`RepoStep`, `ProfileStep`, `NameStep`, `SummaryStep`) a componentes.
4. **`SettingsDialog` bajó de 869 a 641 líneas** al extraer `SkillsSection` y `McpsSection`.
   Aún mezcla navegación, formulario de workspace, notificaciones, presupuesto y “reapply”.
   → Extraer `useWorkspaceSettingsForm` y `WorkspaceSection`.
5. **Casos de uso pass-through**: `CheckForUpdate`, `InstallUpdate`, `SaveFeature`,
   `DeleteFeature`, `ProvisionFeature` y `CreateWorkspace` (tras validar) solo delegan.
   Añaden ceremonia y tests triviales. → Mantener `DeleteWorkspace`,
   `ApplyWorkspaceSettings`, `StartFeature`, `LaunchCoordinator` y `ApproveDecomposition`
   (tienen política real); el resto puede llamarse por puerto desde el hook o fusionarse.

### Medio

6. **`domain/race/races.ts` (711 líneas)** mezcla máquina de estados, estimación de coste,
   etiquetas, serialización y aplicación de eventos. → Partir en `race/state`, `race/estimate`,
   `race/serialize`, `race/events`, reexportando desde `races.ts` para no romper imports.
7. **`App.tsx` (500 líneas)** todavía resuelve navegación de paleta y coordinación de
   features. La navegación circular ya se extrajo a `domain/workspace/navigation`; queda
   mover el despacho de acciones de paleta a una función pura.
8. **Duplicación de helpers** (corregida en parte): `parseModelRef` ×3, `formatBytes` ×2,
   toggles de `Set`/`Map` ×4, `errorText` con guard ×1. Ya viven en `domain/shared` y
   `domain/chat/selection`.
9. **`domain/features/provision.ts` y `domain/models/details.ts`** son solo tipos (0 %
   cobertura legítimo). No son código muerto, pero conviene documentarlo para que no se
   interprete como hueco de tests.
10. **`useFeatures` era el hook con menor cobertura (25 %)**; ahora 55 % con 5 tests nuevos
    de carga, arranque, provisioning bloqueado y borrado cancelado.

## 4. Tests: duplicados, poco valiosos y acoplados

### Pirámide actual (692 tests)

- Dominio: ~470 tests, node, rápidos. Bien.
- Casos de uso con fakes: 27 tests (14 + 8 + 5).
- Componentes/hooks: ~190 tests con jsdom.
- Integración: Chat (41), App (14), WorkspaceView (6). Bien dimensionado.

### Duplicación detectada

- **Fixtures de feature repetidos en 5 ficheros** (`features.test`, `featureUsecases.test`,
  `coordinator.test`, `FeatureView.test`, `CoordinatorPanel.test`): el mismo borrador con
  mínimas variaciones. → Centralizado en `src/tests/fixtures.ts`
  (`makeFeatureInput`, `makeFeature`, `makeStartedFeature`). Eliminadas ~50 líneas duplicadas.
- **Fakes de cliente ad-hoc**: `Inspector.test.tsx` construye su propio `ChatServer` de ~90
  líneas en vez de usar `makeFakeClient`. Riesgo: cada método nuevo del puerto obliga a
  tocar varios fakes. → Extender `makeFakeClient` con `usageLimits` y reutilizarlo.
- **Solapamiento aceptable** entre tests de dominio y de integración (p. ej. notificaciones,
  objetivos): el dominio prueba la decisión y Chat prueba el cableado. No se considera
  duplicado, pero conviene no añadir más casos de integración para reglas ya cubiertas.

### Tests de bajo valor (eliminados o a eliminar)

- Eliminado `getInstance es singleton` (`data.test.ts`): prueba un detalle de construcción,
  no comportamiento.
- Candidatos a simplificar: `WindowConfirmDialog delega en window.confirm`, `SaveFeature
  delega en el gateway`, `DeleteFeature borra por id`. Verifican una delegación 1:1; si el
  caso de uso desaparece (ver §3.5), el test desaparece con él.
- `themeCss.test.ts` **sí aporta**: es una guarda real contra colores fijos y tokens rotos.

### Acoplamiento a implementación

- `Chat.test.tsx` (983 líneas, 55 `toHaveBeenCalled`) es una suite de integración legítima,
  pero varias aserciones son de protocolo (`session.create` con argumentos exactos,
  `message.list` con límites). Mantenerlas: son el contrato con opencode. Evitar añadir
  aserciones sobre estado interno del hook.
- `useRace.test` (15 `toHaveBeenCalled`) prueba el hook, no la UI; aceptable, pero debería
  complementarse con un test de `RaceView` para el comportamiento visible.
- `Markdown.test` usa `innerHTML`/`className`: algunas aserciones son de marcado, no de
  semántica. No es grave porque el renderer es propio; preferir `getByRole("link")` donde
  sea posible.
- `Inspector.test` tiene 24 `vi.fn` y 13 `toHaveBeenCalled`; prueba efectos (reload,
  connect/disconnect) que son comportamiento, pero el fake duplicado lo hace frágil.

### Huecos de cobertura relevantes

- `useChat` 75 %: los caminos de error de transferencia y objetivos son los menos cubiertos.
- `App.tsx` 62 %: comandos de paleta y estados de arranque.
- `data/TauriGateways` 32 %: adaptadores finos; cubrir al menos los mapeos nuevos.
- `useFeatures` 55 %: aprobación de descomposición y coordinador.
- `src/perf/capture.ts` 0 %: instrumentación de desarrollo, aceptable.

## 5. Seguridad

Bien: CSP activa, `connect-src` acotado a localhost, capabilities mínimas
(`dialog`, `updater`, `process:restart`, `notification`), sin plugin `fs`/`shell`, comandos
Rust sin shell (`Command::new` con args), validación de rutas de artefactos y de ficheros de
sesión (`.json`, tope 32 MiB), updater firmado.

Corregido en esta pasada:

- **Enlaces no confiables del agente**: Markdown y formularios pintaban `href` sin validar.
  Nuevo `safeExternalUrl` (`domain/shared/url.ts`): solo http/https/mailto y rutas relativas;
  bloquea `javascript:`, `data:`, `vbscript:`, `file:` y variantes con saltos de línea.
  Un enlace inseguro se pinta como texto.
- **Iframe del preview sin `sandbox`**: añadido
  `allow-scripts allow-same-origin allow-forms allow-modals allow-downloads`. El preview corre
  en otro origen (localhost), no en el de Tauri; se documenta la excepción de la regla.

Pendiente / notas:

- La CSP permite `frame-src http:` y `https:` para el preview. Es necesario para la función,
  pero conviene restringirlo a `http://localhost:* http://127.0.0.1:*` si no se usa preview
  remoto.
- `write_text_file`/`read_text_file` solo validan extensión `.json`; una XSS podría escribir
  un JSON arbitrario. El riesgo es bajo (CSP + sin HTML crudo + sin `eval`), pero se puede
  acotar a la carpeta de exports.
- `notifiedRequests` crecía sin límite durante una sesión larga; ahora se limpia al cambiar
  de sesión.
- El backend Rust tiene 18 tests; no se tocó. Revisar en otra pasada el aislamiento de
  `preview_probe` (SSRF local) y los límites de tamaño de artefactos.

## 6. Rendimiento

Corregido:

- **Bundle inicial 920 → 480 kB** (254 → 141 kB gzip) con `lazy` + `Suspense` para
  `TerminalDock` (xterm, 341 kB), `Inspector`, `PreviewDock` y `SettingsDialog`.
- **Polling con ventana oculta**: `useWorkspaces` (estado cada 5 s) e `Inspector` (5
  peticiones cada 5 s) se saltan el ciclo si `document.visibilityState === "hidden"` y
  reanudan al volver.
- **Filas de mensaje memoizadas** (`MessageRow` con `memo`): un delta de streaming ya no
  vuelve a renderizar los 200 mensajes del historial.
- **Mapa de avisos acotado** al cambiar de sesión.

Pendiente:

- `Inspector` sigue lanzando 5 peticiones en paralelo cada 5 s mientras está abierto; valorar
  backoff o pausar si no hay foco.
- `useChat` recarga hasta 200 mensajes en cada `idle`; si el historial es grande, conviene
  actualización incremental con el evento en vez de recarga completa.
- El chunk `Select` (150 kB) se comparte; revisar si Base UI se puede cargar por sección.

## 7. Refactor aplicado en esta pasada

| Cambio | Ficheros | Efecto |
|---|---|---|
| Helpers de dominio compartidos | `shared/format.ts`, `shared/url.ts`, `shared/collections.ts`, `shared/errors.ts` | Menos duplicación, tests nuevos |
| `parseModelRef` único | `domain/chat/selection.ts` + 3 usos | Elimina 3 copias |
| `safeExternalUrl` | Markdown, RequestDock | Cierra enlaces ejecutables |
| `useBudgetAlerts` | Inspector → hook | Aísla política de avisos |
| Navegación circular | `domain/workspace/navigation.ts` + App | Lógica fuera de la vista |
| Secciones de ajustes | `components/settings/{Skills,Mcps}Section.tsx` | SettingsDialog −228 líneas |
| Fixtures de feature | `src/tests/fixtures.ts` + 5 tests | Elimina duplicación de setup |
| `useFeatures` tests | `hooks/__tests__/useFeatures.test.tsx` | Cobertura 25 → 55 % |
| Lazy de docks/diálogos | `WorkspaceView`, `App` | Bundle inicial −48 % |
| Polling consciente de visibilidad | `useWorkspaces`, `Inspector` | Menos I/O en segundo plano |
| `MessageRow` memoizado | `Chat.tsx` | Menos renders en streaming |
| Limpieza de tests triviales | `data.test.ts` | −1 test sin valor |

Verificación: `pnpm typecheck`, `pnpm exec oxlint` (0 errores), `pnpm exec oxfmt --check`,
`pnpm test` (692 en verde) y `pnpm build` (correcto).

## 8. Backlog priorizado

### P0 — cohesión (siguiente iteración)

1. Partir `useChat` en 4 hooks por responsabilidad, manteniendo su interfaz pública para que
   `Chat.tsx` no cambie. Empezar por `useChatGoal` (bloque más aislado, líneas ~670-865) y
   `useChatRequests` (permisos/formularios).
2. Extraer `useInspectorData` de `Inspector` (carga y polling) y dejar la vista con derivados.
3. Extraer `useWizard` + pasos de `CreateWorkspace`.

### P1 — arquitectura y tests

4. Decidir el destino de los casos de uso pass-through: eliminarlos o darles política real.
5. Partir `domain/race/races.ts` por responsabilidad con reexports.
6. Reutilizar `makeFakeClient` en `Inspector.test` (añadir `usageLimits` al fake).
7. Añadir tests de `ApproveDecomposition`/`launchCoordinator` en `useFeatures` y de
   `RaceView` como comportamiento visible.
8. Mover el despacho de acciones de paleta de `App` a una función pura testeable.

### P2 — seguridad y rendimiento

9. Acotar `frame-src` de la CSP a localhost/127.0.0.1 si el preview remoto no es requisito.
10. Acotar `write_text_file`/`read_text_file` a una carpeta de exports.
11. Backoff/pausa del polling de `Inspector` y actualización incremental del historial de Chat.
12. Revisar en Rust `preview_probe` (SSRF) y límites de artefactos.

## 9. Reglas para que no vuelva a pasar

- Un hook de presentación no debería pasar de ~300 líneas ni mezclar dos fuentes de I/O.
- `domain/` no importa React, Tauri, `localStorage` ni el SDK; el lint de capas puede
  añadirse con `no-restricted-imports` por ruta.
- Los tests de componente usan fixtures compartidos y `getByRole`; las aserciones de
  protocolo se reservan al adaptador.
- Los helpers de formato/validación van a `domain/shared` en cuanto tengan una segunda copia.
- Los diálogos y docks pesados se cargan con `lazy`; el bundle inicial se vigila en CI.
