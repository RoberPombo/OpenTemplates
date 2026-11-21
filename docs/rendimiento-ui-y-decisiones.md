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
