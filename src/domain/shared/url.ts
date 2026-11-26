/**
 * Enlaces que se pueden pintar en la UI. El contenido que llega del agente es
 * dato no confiable: se admiten http(s), mailto y rutas relativas, y se
 * descartan esquemas ejecutables (`javascript:`, `data:`, `vbscript:`…).
 */
const EXECUTABLE_SCHEMES = /^(javascript|data|vbscript|file|blob):/i;
const ALLOWED_SCHEMES = new Set(["http", "https", "mailto"]);

export function safeExternalUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  // Los caracteres de control permiten escribir `java\nscript:` y que el
  // navegador lo interprete como esquema ejecutable.
  const compact = value.replace(/[\s\u0000-\u001f\u007f]+/g, "");
  if (EXECUTABLE_SCHEMES.test(compact)) return null;
  const scheme = compact.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme && !ALLOWED_SCHEMES.has(scheme)) return null;
  return value;
}
