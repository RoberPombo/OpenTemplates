const LEGACY_PREFIX = "openconf:";
const CURRENT_PREFIX = "opentemplates:";

/**
 * Copia las preferencias guardadas con el identificador anterior (`openconf:`)
 * a las claves actuales la primera vez que arranca la app renombrada.
 * No borra las antiguas: volver a la versión previa sigue funcionando.
 */
export function migrateLegacyPreferences(): void {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(LEGACY_PREFIX)) keys.push(key);
  }
  for (const key of keys) {
    const value = localStorage.getItem(key);
    if (value === null) continue;
    const currentKey = CURRENT_PREFIX + key.slice(LEGACY_PREFIX.length);
    if (localStorage.getItem(currentKey) === null) {
      localStorage.setItem(currentKey, value);
    }
  }
}
