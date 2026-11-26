/**
 * Carrera multi-run: el mismo encargo a varios modelos en paralelo, con una
 * sesión (y opcionalmente un worktree) por corrida.
 *
 * El estado y las transiciones viven en módulos por responsabilidad; este
 * fichero es el barril público que conserva los imports existentes:
 *
 * - `state`: creación, máquina de estados, eventos, totales y limpieza.
 * - `estimate`: estimación de tokens y coste.
 * - `labels`: etiquetas y textos de confirmación.
 * - `serialize`: serializar, parsear, normalizar y recuperar.
 */
export * from "./state";
export * from "./estimate";
export * from "./labels";
export * from "./serialize";
