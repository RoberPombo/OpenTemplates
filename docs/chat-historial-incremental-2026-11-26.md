# Historial de Chat incremental (#85)

Fecha: 2026-11-26. Cliente `@opencode/client` 2.3.2, servidor opencode v2.3.2.

## Investigación de la API

`message.list` **no** admite `after` ni `since`. Sí expone paginación por cursor:

```ts
message.list({
  sessionID: string,
  limit?: number,
  order?: "asc" | "desc",
  cursor?: string,
  type?: ...,
}): Promise<{
  data: SessionMessageInfo[],
  cursor: { previous?: string | null; next?: string | null },
}>
```

El cursor es opaco para el cliente. En el servidor (`packages/server/src/handlers/message.ts`
y `packages/core/src/session/store.ts` de opencode v2.3.2) se codifica como
`{ id, order, direction }` en base64url:

- `direction: "next"` + `order: "asc"` devuelve las filas con `seq > seq(anchor)` en
  orden ascendente. Es exactamente «mensajes posteriores al último conocido».
- `cursor` **no puede combinarse con `order`**: el servidor responde
  `InvalidCursorError` (el orden ya viaja dentro del cursor).
- Si el ancla ya no existe (por ejemplo, tras compactar), devuelve `[]`; no hay error.

Conclusión: la actualización incremental es viable y segura con la API actual. No hace
falta inventar una paginación propia ni depender del payload del evento terminal.

## Estrategia aplicada

1. `ChatGateway` y `OpencodeChatGateway` exponen `cursor` en la petición y devuelven
   `cursor.previous/next` de la respuesta (antes se descartaba).
2. `useChatSessions.reload` sigue siendo la recarga completa (200, `asc`) y guarda el
   `cursor.next` como ancla de la sesión. Se usa al abrir/cambiar de sesión y, por
   selección de la sesión creada, tras importar o bifurcar.
3. Nuevo `reloadIncremental`: si hay ancla de la sesión activa, pide páginas de 50 con
   `cursor` (sin `order`) y avanza con `cursor.next` mientras la página venga llena.
   Fusiona por id con el historial visible: sustituye mensajes reenviados y conserva
   las referencias de los ya presentes, de modo que las filas memoizadas no se vuelven
   a renderizar.
4. Sin ancla (historial vacío o adaptador que no devuelve cursor) cae a la recarga
   completa. El primer cierre de turno de una sesión vacía paga esa recarga; los
   siguientes ya son incrementales.
5. `useChat` llama a `reloadIncremental` en los eventos terminales en vez de `reload`.

El historial visible conserva mensajes, orden (`created`) y estados de herramientas:
los mensajes nuevos se mapean con el mismo `toChatMessages` que la recarga completa.
Para sesiones por debajo del límite de 200 el resultado es idéntico. Por encima de 200,
la recarga anterior se quedaba en los 200 más antiguos; la incremental añade el turno
nuevo al final en lugar de descartarlo. Es una mejora deliberada y queda anotada como
riesgo de comportamiento en el PR.

## Medición

`PerformanceCapture` mide frames y commits de React en la app de escritorio con un
servidor opencode real. No es viable en este entorno sin interfaz ni servidor, así que
no se adjunta una traza A/B. Como medida reproducible del coste que elimina el cambio,
se ejecutó un microbenchmark temporal (2000 iteraciones, historial de 200 mensajes con
texto, razonamiento y herramienta por asistente):

| Operación por cierre de turno | Tiempo medio |
|---|---|
| Antes: mapear los 200 mensajes | 0,0339 ms |
| Después: mapear 2 nuevos + fusionar | 0,0083 ms |

- Payload de la petición: 32.761 B (200 mensajes) frente a 333 B (2 nuevos), ~98,4 %
  menos datos en el caso medido.
- Además del mapeo, la recarga completa creaba objetos nuevos para los 200 mensajes y
  forzaba el render de todas las filas; la fusión conserva las referencias y solo
  renderiza las nuevas.
- Queda pendiente repetir con `PerformanceCapture` en la app con un historial real para
  cuantificar frames/commits; el microbenchmark no mide red, pintura ni WebView.

## Riesgos y límites

- El cursor está atado al orden con el que se creó. La recarga completa usa `asc`, así
  que la incremental no debe enviar `order`.
- Un mensaje anterior al ancla que cambie después no se vuelve a leer. En el flujo
  actual los turnos cerrados son inmutables; el mensaje del turno en curso se pide
  entero al cerrar.
- Si el ancla desaparece (compactación), el servidor devuelve `[]` y el historial
  previo se conserva. Un cambio de sesión o una recarga completa restablece el ancla.
- La recarga completa sigue siendo el camino de recuperación si no hay cursor o si la
  carga inicial falla.
