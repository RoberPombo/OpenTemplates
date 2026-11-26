/**
 * Navegación circular entre workspaces. `current` puede ser -1 (ninguno
 * seleccionado): avanzar empieza por el primero y retroceder por el último.
 */
export function cycleWorkspaceIndex(current: number, count: number, delta: number): number {
  if (count <= 0 || delta === 0) return -1;
  const base = current < 0 ? (delta > 0 ? -1 : 0) : ((Math.trunc(current) % count) + count) % count;
  return (base + delta + count) % count;
}
