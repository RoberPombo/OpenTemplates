/**
 * Selector de elemento del preview (dominio puro, sin React ni Tauri).
 *
 * El payload llega por `postMessage` desde un iframe **no confiable** y por un
 * script inyectado por el proxy; se trata como **dato**, nunca como
 * instrucción. Todo string se recorta y se limpia; no se vuelca DOM.
 */

export const PREVIEW_ELEMENT_SOURCE = "opentemplates-preview-selector";
export const PREVIEW_ELEMENT_VERSION = 1;

export const PREVIEW_STYLE_PROPS = [
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "width",
  "height",
  "margin",
  "padding",
  "color",
  "background-color",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "border",
  "border-radius",
  "z-index",
  "overflow",
  "flex-direction",
  "gap",
] as const;

export type PreviewStyleProp = (typeof PREVIEW_STYLE_PROPS)[number];

export type PreviewRect = { x: number; y: number; width: number; height: number };

export type PreviewElementContext = {
  tag: string;
  role: string | null;
  selector: string;
  name: string | null;
  text: string;
  /** Ruta + query + hash dentro del preview (origen original, no el proxy). */
  url: string;
  rect: PreviewRect | null;
  computedStyles: Partial<Record<PreviewStyleProp, string>>;
};

export const PREVIEW_ELEMENT_LIMITS = {
  selector: 300,
  tag: 40,
  role: 80,
  name: 160,
  text: 200,
  url: 300,
  style: 80,
} as const;

/** Sesión de proxy emitida por Rust; token no se persiste. */
export type PreviewProxySession = {
  baseUrl: string;
  token: string;
  proxyOrigin: string;
  nonce: string;
};

export type PreviewSelectorMessageType = "ready" | "element" | "exit";

export type PreviewSelectorMessage = {
  source: typeof PREVIEW_ELEMENT_SOURCE;
  version: typeof PREVIEW_ELEMENT_VERSION;
  type: PreviewSelectorMessageType;
  nonce: string;
  element?: PreviewElementContext;
  url?: string;
  originalUrl?: string;
};

const STYLE_PROP_SET = new Set<string>(PREVIEW_STYLE_PROPS);

export function clipElement(value: unknown, max: number): string {
  const raw = typeof value === "string" ? value : "";
  // Quitar caracteres de control; colapsar espacios.
  const clean = raw
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function sanitizeTag(value: unknown): string {
  const tag = clipElement(value, PREVIEW_ELEMENT_LIMITS.tag).toLowerCase();
  return /^[a-z][a-z0-9-]*$/.test(tag) ? tag : "";
}

function sanitizeOptional(value: unknown, max: number): string | null {
  const cleaned = clipElement(value, max);
  return cleaned.length > 0 ? cleaned : null;
}

function sanitizeRect(value: unknown): PreviewRect | null {
  if (!value || typeof value !== "object") return null;
  const rect = value as Record<string, unknown>;
  const nums = [rect.x, rect.y, rect.width, rect.height].map((n) =>
    typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : null,
  );
  if (nums.some((n) => n === null)) return null;
  const [x, y, width, height] = nums as number[];
  return { x, y, width, height };
}

function sanitizeStyles(value: unknown): Partial<Record<PreviewStyleProp, string>> {
  const out: Partial<Record<PreviewStyleProp, string>> = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (!STYLE_PROP_SET.has(key)) continue;
    const cleaned = clipElement(val, PREVIEW_ELEMENT_LIMITS.style);
    if (cleaned.length > 0) out[key as PreviewStyleProp] = cleaned;
  }
  return out;
}

/**
 * Valida y sanea un `PreviewElementContext` no confiable. Devuelve `null` si
 * no hay etiqueta ni selector utilizable. Nunca lanza.
 */
export function sanitizePreviewElement(raw: unknown): PreviewElementContext | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const tag = sanitizeTag(input.tag);
  const selector = clipElement(input.selector, PREVIEW_ELEMENT_LIMITS.selector);
  if (!tag && !selector) return null;
  return {
    tag,
    role: sanitizeOptional(input.role, PREVIEW_ELEMENT_LIMITS.role),
    selector,
    name: sanitizeOptional(input.name, PREVIEW_ELEMENT_LIMITS.name),
    text: clipElement(input.text, PREVIEW_ELEMENT_LIMITS.text),
    url: clipElement(input.url, PREVIEW_ELEMENT_LIMITS.url),
    rect: sanitizeRect(input.rect),
    computedStyles: sanitizeStyles(input.computedStyles ?? input.computed_styles),
  };
}

/**
 * Valida la forma de un mensaje `postMessage`. Origen (`event.origin`),
 * `event.source` y `targetOrigin` se comprueban en la capa de presentación;
 * aquí se verifica esquema + `nonce` + `source` + `version`.
 */
export function isPreviewSelectorMessage(
  raw: unknown,
  expectedNonce: string,
): raw is PreviewSelectorMessage {
  if (!raw || typeof raw !== "object") return false;
  const msg = raw as Record<string, unknown>;
  if (msg.source !== PREVIEW_ELEMENT_SOURCE) return false;
  if (msg.version !== PREVIEW_ELEMENT_VERSION) return false;
  if (msg.nonce !== expectedNonce) return false;
  if (msg.type !== "ready" && msg.type !== "element" && msg.type !== "exit") return false;
  return true;
}
