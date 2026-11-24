/**
 * Atajos de teclado de la app: definición declarativa y resolución pura.
 *
 * `mod` significa Ctrl en Linux/Windows y Cmd en macOS; el formato de la
 * etiqueta recibe la plataforma para no depender de `navigator` en el dominio.
 * Las teclas sin modificador (Escape) nunca se resuelven mientras se escribe,
 * salvo el propio Escape, para no romper el composer ni Enter/Shift+Enter.
 */

export type Shortcut = {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
};

export type Keybinding = {
  id: string;
  label: string;
  shortcut: Shortcut;
};

export type ShortcutEvent = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
};

export type ShortcutContext = {
  /** La paleta abierta gestiona sus propias teclas. */
  paletteOpen?: boolean;
  /** El foco está en el textarea del composer. */
  inComposer?: boolean;
  /** El foco está en cualquier campo editable. */
  inEditable?: boolean;
};

/** Set mínimo y coherente con la UI; el orden es el de la página de atajos. */
export const KEYBINDINGS: readonly Keybinding[] = [
  { id: "palette.open", label: "Abrir la paleta de comandos", shortcut: { key: "k", mod: true } },
  { id: "session.new", label: "Nueva sesión en el workspace", shortcut: { key: "n", mod: true } },
  { id: "session.stop", label: "Parar el turno en curso", shortcut: { key: ".", mod: true } },
  { id: "panel.close", label: "Cerrar el panel o dock activo", shortcut: { key: "Escape" } },
  {
    id: "workspace.next",
    label: "Ir al workspace siguiente",
    shortcut: { key: "ArrowRight", mod: true, alt: true },
  },
  {
    id: "workspace.previous",
    label: "Ir al workspace anterior",
    shortcut: { key: "ArrowLeft", mod: true, alt: true },
  },
  { id: "panel.terminal", label: "Abrir o cerrar el terminal", shortcut: { key: "`", mod: true } },
  {
    id: "panel.diff",
    label: "Abrir el panel de diff y cambios",
    shortcut: { key: "d", mod: true, shift: true },
  },
  {
    id: "panel.preview",
    label: "Abrir o cerrar la vista previa de la app",
    shortcut: { key: "v", mod: true, shift: true },
  },
] as const;

export function shortcutFor(id: string): Shortcut | undefined {
  return KEYBINDINGS.find((binding) => binding.id === id)?.shortcut;
}

function normalizeKey(key: string): string {
  if (key.length === 1) return key.toLowerCase();
  if (key === "Esc") return "Escape";
  return key;
}

/**
 * ¿La tecla de este evento activa este atajo en este contexto?
 * Los atajos con modificador funcionan con el foco en el composer; las teclas
 * sueltas solo fuera de campos editables (Escape es la excepción).
 */
export function shortcutMatches(
  event: ShortcutEvent,
  shortcut: Shortcut,
  context: ShortcutContext = {},
): boolean {
  if (event.defaultPrevented || context.paletteOpen) return false;
  const mod = Boolean(event.ctrlKey || event.metaKey);
  if (Boolean(shortcut.mod) !== mod) return false;
  if (Boolean(shortcut.shift) !== Boolean(event.shiftKey)) return false;
  if (Boolean(shortcut.alt) !== Boolean(event.altKey)) return false;
  if (normalizeKey(event.key) !== normalizeKey(shortcut.key)) return false;

  const hasModifier = mod || Boolean(event.altKey) || Boolean(event.shiftKey);
  if (!hasModifier && normalizeKey(event.key) !== "Escape") {
    if (context.inComposer || context.inEditable) return false;
  }
  return true;
}

/** Primer atajo que casa con el evento, o `null`. */
export function resolveShortcut(
  event: ShortcutEvent,
  context: ShortcutContext = {},
  bindings: readonly Keybinding[] = KEYBINDINGS,
): string | null {
  for (const binding of bindings) {
    if (shortcutMatches(event, binding.shortcut, context)) return binding.id;
  }
  return null;
}

function isMac(platform: string): boolean {
  return /mac|iphone|ipad|darwin/i.test(platform);
}

const KEY_LABELS: Record<string, string> = {
  ArrowRight: "→",
  ArrowLeft: "←",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
};

/** Etiqueta legible, p. ej. `Cmd+K` en macOS y `Ctrl+K` en el resto. */
export function formatShortcut(shortcut: Shortcut, platform = "linux"): string {
  const mac = isMac(platform);
  const parts: string[] = [];
  if (shortcut.mod) parts.push(mac ? "⌘" : "Ctrl");
  if (shortcut.alt) parts.push(mac ? "⌥" : "Alt");
  if (shortcut.shift) parts.push(mac ? "⇧" : "Shift");
  const key =
    KEY_LABELS[shortcut.key] ??
    (shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key);
  parts.push(key);
  return mac ? parts.join("") : parts.join("+");
}
