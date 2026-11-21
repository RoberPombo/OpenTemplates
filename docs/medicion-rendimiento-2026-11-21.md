# Medición inicial de rendimiento

Traza recibida: `openconf-performance-2026-11-21T15-06-00.755Z.json`.

## Resultados

- Duración: 100.6 s; 5,030 muestras de `requestAnimationFrame`.
- Intervalo medio: 20.00 ms; p95 21 ms, p99 25 ms, máximo 45 ms.
- 4,952 intervalos (98.5%) superan 16.7 ms; solo 2 superan 33.3 ms y ninguno
  supera 50 ms.
- React: 385 commits del subárbol `Chat`; `actualDuration` acumulado 1,296 ms,
  mediana 3 ms, p95 4 ms y máximo 6 ms. Ningún commit superó 8 ms.
- La traza no contiene tareas largas, pero no registra si el WebView soportaba la
  API Long Tasks. No se puede concluir que no ocurrieran.

## Lectura

Los frames son casi exactamente de 20 ms, equivalente a 50 Hz. En el entorno hay
un monitor primario de 3440×1440 a 49.96 Hz y otro de 1920×1080 a 59.96 Hz. Por
tanto, esta traza parece limitada por el refresco del monitor primario y no permite
validar el objetivo de 60 fps. No muestra pausas largas sostenidas.

El coste medido de React es bajo en esta ejecución; no aparece evidencia de que el
tiempo de render del subárbol del chat sea el cuello de botella principal. Esto no
mide pintura/composición de WebKit ni prueba una ráfaga máxima de tokens. Tampoco se
registró el tamaño del historial ni el tipo exacto de actividad durante la captura.

Una lectura puntual de RSS posterior a la traza fue: OpenConf 191,160 KiB,
WebKitWebProcess 292,524 KiB, WebKitNetworkProcess 63,628 KiB y servidor OpenCode
318,288 KiB. Son RSS por proceso, no memoria exclusiva ni pico; no deben sumarse
como RAM exacta de la app.

## Segunda captura: monitor de alta frecuencia

Traza: `openconf-performance-2026-11-21T15-18-30.430Z.json`.

- Duración: 51.8 s; 7,233 muestras, media de 7.16 ms (aprox. 139.6 callbacks/s),
  p95 12 ms, p99 17 ms y máximo 32 ms.
- 121 intervalos (1.7%) superan 16.7 ms; ninguno supera 33.3 ms.
- React: 276 commits; mediana 6 ms, p95 8 ms, máximo 19 ms. Un commit supera
  16.7 ms; el acumulado del Profiler fue 1,718 ms.
- `longTaskApiSupported: false`: WebKit no expone Long Tasks; el cero de tareas
  largas no es evidencia de que no hubiera bloqueos.

La cadencia de frames concuerda con la pantalla DP-3 observada a 143.91 Hz. La
interfaz sostuvo una cadencia cercana a 140 Hz durante esta prueba; no hubo pausas
de más de 33 ms. El render del chat es normalmente breve, aunque hay algún commit
aislado de 19 ms que conviene vigilar si se repite con historiales mayores. Esta
captura no incluye memoria ni una medida de presentación real de GPU; `requestAnimationFrame`
es una aproximación de la cadencia de la WebView.

Las dos capturas no son una comparación A/B estricta: duración y carga no están
documentadas como idénticas. Para cerrar la línea base, repetir con el mismo prompt
y tamaño de historial en una frecuencia fija y anotar el monitor usado.

## Siguiente prueba

Repetir exactamente el mismo prompt y el mismo historial, en el mismo monitor y
refresco. Registrar si hubo streaming continuo y conservar la nueva marca de soporte
de Long Tasks.
