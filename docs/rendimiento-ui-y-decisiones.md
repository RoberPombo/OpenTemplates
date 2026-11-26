# Rendimiento de UI y decisiones pendientes

## Enfoque

Medir la interfaz actual antes de incorporar dependencias o cambiar su arquitectura.
Después, priorizar mejoras en función de los datos. La UI puede evolucionar creando
wrappers propios para mantener APIs consistentes y evitar que las features dependan
directamente de una librería visual.

## Referencia de build

Medición reproducida el 2026-11-21 en Linux 7.0.0-43-generic, Node 26.13.1 y pnpm
10.24.0, sobre el commit `b8c3d01`. `pnpm build` (incluye `tsc`) terminó en 0.70 s;
Vite transformó 39 módulos y reportó 118 ms de build:

| Artefacto | Tamaño | Gzip |
| --- | ---: | ---: |
| JavaScript | 335.19 kB | 94.86 kB |
| CSS | 27.47 kB | 6.65 kB |
| HTML | 0.39 kB | 0.26 kB |

Esto mide compilación y tamaño de salida, no rendimiento en ejecución. La primera
captura de frames y React está analizada en
[`medicion-rendimiento-2026-11-21.md`](./medicion-rendimiento-2026-11-21.md).

Tras añadir el capturador de desarrollo, el build previo a Base UI quedó en JS
335.25 kB (94.89 kB gzip) y CSS 27.84 kB (6.81 kB gzip). El botón de captura se
carga solo en desarrollo.

## Protocolo de medición

Registrar commit, sistema operativo, versión de Tauri/WebView, tamaño de ventana,
workspace y pasos realizados. Separar dos pruebas:

1. **Reproducción controlada de UI:** usar una secuencia fija de eventos/deltas, para
   comparar cambios sin variación del modelo o la red.
2. **Uso real:** una sesión representativa de OpenCode, para detectar problemas que
   la reproducción no cubra.

En ambas pruebas observar:

- Fluidez durante streaming y scroll; objetivo de referencia: 60 fps y frames de
  hasta 16.7 ms.
- Bloqueos del hilo principal (tareas largas de más de 50 ms).
- Commits y componentes que se renderizan con React Profiler.
- Memoria en reposo y después de una conversación larga.
- Tamaño de JS/CSS del build, incluido el coste gzip.

Escenario mínimo: abrir una conversación existente, recibir una respuesta larga con
texto, código y eventos de herramientas, hacer scroll durante el streaming y repetir
con historial largo. Guardar trazas y comparar antes/después; no atribuir una mejora
a una librería sin medirla.

En modo desarrollo, el botón **Medir rendimiento** inicia el muestreo de intervalos
entre frames y los commits del Profiler de React en el subárbol del chat. Al detenerlo
descarga un JSON con percentiles, frames lentos, tareas largas si WebKit las expone y
duraciones de render. El informe marca si la API Long Tasks está disponible. No
registra prompts ni contenido. El muestreo de frames tiene un coste pequeño; las
trazas son exploratorias y no sustituyen una validación final en release.

## Decisión de primitivas UI

Usar **shadcn/ui como catálogo de patrones/componentes fuente, con Base UI como
primitiva de interacción** para los componentes que necesiten comportamiento
accesible complejo. shadcn entrega código al repositorio; no se añade como runtime.
El diseño seguirá siendo propio, con wrappers en `src/components/ui` y estilos
basados en los tokens CSS actuales. Para controles simples como inputs se mantiene
HTML nativo. Importar Base UI por componente y solo donde aporte valor.

Se añadió `@base-ui/react` y `Button` ya está respaldado por `@base-ui/react/button`;
`TextInput` sigue siendo un input nativo con estilos existentes.

Build con Base UI Button: JS 342.77 kB (97.65 kB gzip), CSS 28.13 kB
(6.87 kB gzip). Select y Combobox van en un chunk diferido de 146.18 kB
(50.09 kB gzip) que solo se carga al abrir una vista con selects; el entry
principal queda en 357.71 kB (102.90 kB gzip) y el CSS en 32.09 kB
(7.60 kB gzip). La carga diferida protege el arranque, pero el coste al usar
estos controles crece; el siguiente paso es medir si merece la pena el
Combobox solo para el selector de modelos o si conviene un filtro manual.

> Actualización 2026-11-26: estas cifras son históricas. La medición vigente,
> el presupuesto y el análisis del chunk Select están en
> [Presupuesto de bundle inicial](#presupuesto-de-bundle-inicial-2026-11-26).

## Decisiones pendientes para cuando se necesiten

- **Markdown:** `react-markdown` y `remark-gfm` no son alternativas equivalentes:
  `remark-gfm` es un plugin que se puede usar con `react-markdown` para GFM. Comparar
  esa combinación con el parser actual y con Streamdown usando mensajes largos y
  contenido incompleto durante streaming.
- **Resaltado:** evaluar Shiki y su coste de inicialización, resaltado fuera del hilo
  principal y carga diferida; evitar recalcular bloques de código históricos.
- **Paneles, paleta, virtualización y diffs:** incorporar respectivamente solo si
  hacen falta paneles ajustables, acciones rápidas, historiales que lo justifiquen o
  revisión de cambios. Cargar vistas pesadas bajo demanda cuando sea posible.
- **Terminal:** añadir xterm solo si el producto requiere una terminal interactiva;
  no para presentar logs o resultados de herramientas.
- **Transporte:** mantener la suscripción actual del cliente OpenCode salvo que una
  medición identifique un problema. Usar `tauri::ipc::Channel` si Rust necesita ser
  propietario del stream y transmitirlo a la UI, no como optimización asumida.

## Wrappers de UI

La primera base está en `src/presentation/components/ui`: `Button` (Base UI con
variantes visuales propias), `TextInput` (HTML nativo), `Select` (Base UI, con grupos
y variantes `chip`/`field`) y `Select` con búsqueda (`AsyncSearchableSelect`, Combobox
de Base UI) para catálogos largos como los modelos. Los selects van en carga diferida
y los de agente/razonamiento siguen usando el Select simple. Ampliar wrappers conforme
aparezcan usos repetidos y mantener sus props orientadas al producto, sin exponer APIs
de librería a las features.

## Presupuesto de bundle inicial (2026-11-26)

Medición sobre `develop` en `034ff1c`, Linux 7.0.0-43-generic, Node 26.13.1,
pnpm 10.24.0 y Vite 8.3.8. El build usa `tsc && vite build`; los hashes de los
assets no forman parte del presupuesto.

### Qué cuenta como bundle inicial

El chunk de entrada **más sus imports estáticos**. No cuentan los chunks de
`lazy()`/`dynamicImports`: esos se descargan al abrir su vista. Contar solo el
fichero `index-*.js` infravalora el arranque; por ejemplo, antes de este cambio
el entry pesaba 487.01 kB pero sus imports estáticos sumaban 506.13 kB.

`vite.config.ts` genera `dist/.vite/manifest.json` (`build.manifest: true`).
`scripts/check-bundle-budget.mjs` lee ese manifest, resuelve la entrada y su
cierre de imports estáticos y compara el total con el presupuesto. Funciona con
assets hasheados porque nunca busca nombres fijos.

### Presupuesto y puerta de CI

- **Presupuesto: 500 kB de JS inicial** (`BUNDLE_BUDGET_KB` permite uno puntual).
- CI ejecuta `pnpm run check:bundle` justo después de `pnpm build` y falla si se
  supera.
- Reproducir en local: `pnpm build && pnpm check:bundle`.
- Informe visual: `pnpm analyze` (modo `analyze`, solo devDependency) escribe
  `dist/bundle-analysis.html` con el desglose por módulo. No se incluye en el
  bundle de producción.

El margen actual es pequeño (~3.8 kB). Es intencionado: cualquier import pesado
nuevo debe entrar por un límite `lazy` o acompañarse de una revisión explícita
del presupuesto.

### Métricas antes/después

| Medida | Antes | Después | Δ |
| --- | ---: | ---: | ---: |
| JS inicial (entrada + estáticos) | 506.13 kB / 150.72 kB gzip | **496.21 kB / 145.95 kB gzip** | −9.92 / −4.77 |
| Entry `index` | 487.01 kB / 143.10 kB gzip | 496.21 kB / 145.95 kB gzip | +9.20 / +2.85 |
| Chunk diferido `Select` | 150.01 kB / 50.80 kB gzip | 158.70 kB / 53.83 kB gzip | +8.69 / +3.03 |
| CSS inicial | 91.25 kB / 15.34 kB gzip | 91.25 kB / 15.34 kB gzip | 0 |

El entry crece porque absorbe estáticos que antes eran chunks compartidos
(`jsx-runtime`, `errors`, `Preferences`). El total inicial baja al dejar de
importar Base UI desde `Button`: los helpers de render de Base UI
(`useRenderElement`, ~9.2 kB) pasan al chunk diferido de `Select`.

Los gzip de la tabla salen de la salida de Vite; `check:bundle` usa zlib y
puede diferir ~1 kB, por eso la puerta de CI compara el tamaño sin comprimir.

### Chunks diferidos vigentes

| Chunk | Tamaño | Gzip | Se carga al… |
| --- | ---: | ---: | --- |
| `Select` | 158.70 kB | 53.83 kB | montar el primer `Select`/`AsyncSearchableSelect` (compositor del chat, ajustes, carrera, formularios) |
| `TerminalDock` | 341.12 kB | 86.56 kB | abrir la terminal (incluye xterm) |
| `Inspector` | 39.47 kB | 10.97 kB | abrir el inspector |
| `SettingsDialog` | 35.04 kB | 8.89 kB | abrir ajustes |
| `PreviewDock` | 8.64 kB | 3.40 kB | abrir el preview |
| `mcp` (compartido) | 0.52 kB | 0.33 kB | con Inspector o ajustes |

## Análisis del chunk Select (issue #86)

`AsyncSelect.tsx` ya envuelve las tres implementaciones en `lazy()` +
`Suspense`, así que **Base UI no está en el bundle inicial**. El chunk de
150–159 kB solo se paga cuando aparece un select en pantalla.

Desglose del chunk antes del cambio (datos de `rollup-plugin-visualizer`,
`renderedLength` sin minificar; el fichero minificado son 150.01 kB):

| Parte | renderedLength |
| --- | ---: |
| `@base-ui/react` (Select + Combobox + internals) | 297.2 kB |
| `@base-ui/utils` | 26.9 kB |
| `@floating-ui/dom` + `core` | 34.5 kB |
| `@floating-ui/react-dom` | 6.2 kB |
| `use-sync-external-store` | 4.8 kB |
| `src/presentation/components/ui/Select.tsx` | 14.5 kB |

### ¿Cargar Base UI por sección?

Se probó separar el `Select` básico (Base UI Select) del searchable
(`Combobox`) en módulos con `lazy()` independientes. El resultado fue:

| Ruta | Coste |
| --- | ---: |
| Solo `Select` básico | 122.12 kB / 43.90 kB gzip |
| Solo searchable | 136.38 kB / 48.25 kB gzip |
| Ambos (chat, ajustes) | 161.58 kB / 57.26 kB gzip |
| Chunk único actual | 150.01 kB / 50.80 kB gzip |

La separación deja un chunk común con los internals de Base UI/Floating UI. Las
pantallas que usan los dos controles —el compositor del chat monta el selector
de modelo searchable y los de agente/razonamiento básicos, y ajustes hace lo
mismo— acaban cargando **más** que con un único chunk. Se descartó y se
mantuvo un solo módulo diferido.

### ¿Control nativo para los casos simples?

Los selects simples (agente, razonamiento, suscripción, opciones de formulario)
son listas cortas y podrían usar `<select>` nativo. No se hizo porque:

- El chat monta siempre el selector de modelo searchable, así que el chunk de
  Base UI se cargaría igualmente; no hay ahorro en el arranque ni en la vista
  principal.
- Cambiaría el aspecto y la interacción visibles (popup estilizado, grupos,
  fichas de opción) sin una decisión de UX.
- Los tests de `Select` y accesibilidad cubren el comportamiento actual de
  Base UI; sustituirlo exigiría reescribirlos y perdería la semántica de
  listbox/combobox ya validada.

Decisión: mantener Base UI para `Select`/`AsyncSelect` mientras se use en el
compositor del chat. Si en el futuro el selector de modelo deja de montarse en
la vista inicial, revisar si los selects simples pueden ser nativos y sacar
Base UI de esa ruta.
