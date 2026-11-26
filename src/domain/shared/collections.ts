/** Toggle inmutable de un Set: añade si falta, quita si ya está. */
export function toggleSetValue<T>(previous: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(previous);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** Toggle inmutable de un Map: quita la clave si existe, si no la fija. */
export function toggleMapValue<K, V>(previous: ReadonlyMap<K, V>, key: K, value: V): Map<K, V> {
  const next = new Map(previous);
  if (next.has(key)) next.delete(key);
  else next.set(key, value);
  return next;
}
