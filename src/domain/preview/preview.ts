/**
 * Dominio de la vista previa de la app en marcha.
 *
 * Aquí vive lo que no depende de Tauri ni de React: normalización de la URL o
 * puerto que escribe el usuario, tamaños de dispositivo, traducción del sondeo
 * del servidor a un estado legible y composición del prompt para el agente.
 *
 * El selector de elemento (clic en un elemento para enviar contexto compacto)
 * vive en `element.ts` y se habilita con un proxy propio que inyecta un script
 * (`docs/preview-viabilidad.md`, opción D); este módulo compone el prompt.
 */

export const DEFAULT_PREVIEW_URL = "http://localhost:5173";

/** Límite del prompt que se envía al agente; lo que sobre se recorta. */
export const PREVIEW_PROMPT_MAX = 900;

export const PREVIEW_DEVICES = {
  desktop: { label: "Escritorio", width: 1440, height: 900 },
  tablet: { label: "Tablet", width: 834, height: 1112 },
  mobile: { label: "Móvil", width: 390, height: 844 },
} as const;

export type PreviewDevice = keyof typeof PREVIEW_DEVICES;

export function isPreviewDevice(value: string | null | undefined): value is PreviewDevice {
  return value === "desktop" || value === "tablet" || value === "mobile";
}

export function previewSize(device: PreviewDevice): { width: number; height: number } {
  const { width, height } = PREVIEW_DEVICES[device];
  return { width, height };
}

export function previewDeviceLabel(device: PreviewDevice): string {
  return PREVIEW_DEVICES[device].label;
}

/** Resultado del sondeo que hace el backend sobre la URL del preview. */
export type PreviewProbe = {
  ok: boolean;
  status: number | null;
  title: string | null;
  error: string | null;
  /** El servidor manda X-Frame-Options o frame-ancestors: no se puede embeber. */
  frameBlocked: boolean;
  /** False para https, donde solo se comprueba que el puerto acepta conexión. */
  verified: boolean;
};

export type PreviewUrlResult = { ok: true; url: string } | { ok: false; error: string };

function invalidUrl(message: string): PreviewUrlResult {
  return { ok: false, error: message };
}

/**
 * Acepta lo que la gente escribe de verdad: `5173`, `:5173`, `localhost:5173`,
 * `127.0.0.1:5173/app` o una URL completa http(s). Devuelve la URL canónica o
 * un error en español listo para mostrar.
 */
export function normalizePreviewUrl(raw: string): PreviewUrlResult {
  const value = raw.trim();
  if (!value) return invalidUrl("Escribe una URL o un puerto (por ejemplo 5173).");

  const hasScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value);
  const portOnly = /^:?(\d{1,5})(\/.*)?$/.exec(value);
  let candidate: string;
  if (hasScheme) {
    candidate = value;
  } else if (portOnly) {
    const port = Number(portOnly[1]);
    if (port < 1 || port > 65535) {
      return invalidUrl("El puerto debe estar entre 1 y 65535.");
    }
    candidate = `http://localhost:${port}${portOnly[2] ?? ""}`;
  } else {
    candidate = value.startsWith("//") ? `http:${value}` : `http://${value}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return invalidUrl("La URL no es válida. Ejemplo: http://localhost:5173");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return invalidUrl("Solo se admiten direcciones http:// o https://.");
  }
  if (!url.hostname) {
    return invalidUrl("La URL no incluye un servidor.");
  }
  if (url.username || url.password) {
    return invalidUrl("La URL no puede incluir usuario ni contraseña.");
  }
  const port = url.port ? Number(url.port) : null;
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    return invalidUrl("El puerto debe estar entre 1 y 65535.");
  }

  const canonical =
    url.pathname === "/" && !url.search && !url.hash
      ? `${url.protocol}//${url.host}`
      : url.toString();
  return { ok: true, url: canonical };
}

export type PreviewStateView = {
  status: "ready" | "error";
  message: string;
};

/** Traduce el sondeo a un estado legible: listo con su detalle o error concreto. */
export function describePreviewProbe(probe: PreviewProbe): PreviewStateView {
  if (!probe.ok) {
    return {
      status: "error",
      message: probe.error?.trim() || "No se pudo conectar con la aplicación.",
    };
  }
  if (!probe.verified) {
    return { status: "ready", message: "Conexión establecida (HTTPS sin verificar)." };
  }
  const status = probe.status ?? 0;
  const title = probe.title ? ` · «${clip(probe.title, 70)}»` : "";
  return {
    status: "ready",
    message: `HTTP ${status}${title}`,
  };
}

/** Líneas numeradas del elemento elegido; recortadas; sin DOM completo. */
function elementPromptLines(element: NonNullable<PreviewPromptInput["element"]>): string[] {
  const lines = [`Elemento: <${clip(element.tag, 40) || "?"}>`];
  if (element.selector) lines.push(`Selector CSS: ${clip(element.selector, 300)}`);
  if (element.role) lines.push(`Rol: ${clip(element.role, 80)}`);
  if (element.name) lines.push(`Nombre accesible: ${clip(element.name, 160)}`);
  if (element.text) lines.push(`Texto corto: ${clip(element.text, 200)}`);
  if (element.url) lines.push(`Elemento en: ${clip(element.url, 300)}`);
  if (element.rect) {
    const r = element.rect;
    lines.push(
      `Caja: ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}`,
    );
  }
  const styles = Object.entries(element.computedStyles ?? {});
  if (styles.length > 0) {
    const rendered = styles
      .map(([key, value]) => `${key}: ${clip(String(value), 80)}`)
      .slice(0, 24)
      .join("; ");
    lines.push(`Estilos (curado): ${rendered}`);
  }
  return lines;
}

function clip(value: string, limit: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function promptState(probe: PreviewProbe | null): string {
  if (!probe) return "comprobando";
  if (!probe.ok) return `error de conexión: ${clip(probe.error ?? "no se pudo conectar", 220)}`;
  const view = describePreviewProbe(probe);
  return view.message;
}

export type PreviewPromptInput = {
  workspaceName: string;
  url: string;
  projectPath: string;
  device: PreviewDevice;
  probe: PreviewProbe | null;
  /** Lo que el usuario quiere que revise; si falta, se pide una revisión general. */
  note?: string;
  /** Elemento elegido en modo selección; se añade como sección recortada. */
  element?: import("./element").PreviewElementContext | null;
};

/**
 * Prompt breve y numerado para el agente. Recorta cada campo y el total, y
 * termina con una marca explícita cuando ha habido que recortar.
 */
export function buildPreviewPrompt(input: PreviewPromptInput): string {
  const size = previewSize(input.device);
  let line = 4;
  const lines = [
    "Revisa la aplicación que tengo en marcha en este workspace.",
    "",
    `1. URL: ${clip(input.url, 240)}`,
    `2. Workspace: ${clip(input.workspaceName, 80) || "workspace"}`,
    `3. Ruta local: ${clip(input.projectPath, 240)}`,
    `${line++}. Vista: ${previewDeviceLabel(input.device)} (${size.width}×${size.height})`,
  ];
  if (input.probe?.frameBlocked) {
    lines.push(`${line++}. Aviso: el servidor prohíbe embeber la página (X-Frame-Options).`);
  }
  if (input.element) {
    for (const elementLine of elementPromptLines(input.element)) {
      lines.push(`${line++}. ${elementLine}`);
    }
  }
  lines.push(
    `${line++}. Estado: ${promptState(input.probe)}`,
    `${line}. Petición: ${clip(input.note ?? "", 700) || (input.element ? "revisa el elemento seleccionado y dime qué falla o qué mejorarías." : "revisa la vista y dime qué falla o qué mejorarías.")}`,
  );

  const text = lines.join("\n");
  if (text.length <= PREVIEW_PROMPT_MAX) return text;
  const marker = "\n… (prompt recortado)";
  return `${text.slice(0, PREVIEW_PROMPT_MAX - marker.length).trimEnd()}${marker}`;
}
