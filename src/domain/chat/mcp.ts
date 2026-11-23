/**
 * Estado de los servidores MCP de un workspace. El adaptador estrecha
 * `mcp.list` a estos tipos; la presentación decide etiqueta, tono y acciones.
 */
export type McpState = "connected" | "pending" | "disabled" | "failed" | "needs_auth" | "unknown";

export type McpServerStatus = {
  name: string;
  state: McpState;
  /** Error legible que reporta el servidor cuando falla o pide auth. */
  error?: string;
  title?: string;
};

export function mcpStateLabel(state: McpState): string {
  switch (state) {
    case "connected":
      return "conectado";
    case "pending":
      return "conectando";
    case "disabled":
      return "desconectado";
    case "failed":
      return "fallando";
    case "needs_auth":
      return "requiere autorización";
    default:
      return "sin estado";
  }
}

export function mcpStateTone(state: McpState): "ok" | "warn" | "bad" | "" {
  switch (state) {
    case "connected":
      return "ok";
    case "pending":
      return "warn";
    case "failed":
    case "needs_auth":
      return "bad";
    default:
      return "";
  }
}

/** Solo un servidor conectado puede desconectarse; el resto puede reintentar. */
export function mcpAction(state: McpState): "connect" | "disconnect" {
  return state === "connected" || state === "pending" ? "disconnect" : "connect";
}

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, "g");

/**
 * Texto legible para la fila: quita secuencias ANSI, colapsa espacios y corta
 * los errores kilométricos. Devuelve `null` si no hay nada que mostrar.
 */
export function readableMcpError(error: string | undefined, max = 240): string | null {
  if (!error) return null;
  const plain = error.replace(ANSI_PATTERN, "").replace(/\s+/g, " ").trim();
  if (!plain) return null;
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max - 1).trimEnd()}…`;
}
