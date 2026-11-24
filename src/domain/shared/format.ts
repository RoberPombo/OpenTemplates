/**
 * Tiempo relativo corto: "ahora", "hace 5 min", "hace 3 h", "hace 2 d" y, a
 * partir de 30 días, fecha `dd/mm/aaaa`. Vacío si la marca no es válida.
 */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const diff = now - timestamp;
  if (diff < 60_000) return "ahora";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} d`;
  const date = new Date(timestamp);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

/** Duración en ms legible: "1.5s", "2m 5s"; vacío si no es positiva o finita. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}
