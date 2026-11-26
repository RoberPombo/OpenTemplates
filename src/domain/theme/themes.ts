/**
 * Tokens semánticos de tema y acentos.
 *
 * La app no guarda colores en CSS: `themeStyle` produce las custom properties
 * que se aplican en el arranque y al cambiar de tema. Todos los temas declaran
 * exactamente el mismo conjunto de tokens, y los acentos solo sobrescriben los
 * tokens de acento, así que ningún `var(--token)` puede quedar sin valor.
 */

export const THEME_TOKEN_NAMES = [
  "bg",
  "bgDeep",
  "surface",
  "surface2",
  "surface3",
  "surface4",
  "surfaceHover",
  "surfaceActive",
  "field",
  "sidebarFrom",
  "sidebarTo",
  "line",
  "lineSoft",
  "lineStrong",
  "lineHover",
  "text",
  "textStrong",
  "textSoft",
  "muted",
  "muted2",
  "faint",
  "accent",
  "accentStrong",
  "accentDeep",
  "accentDim",
  "accentSoft",
  "accentBorder",
  "accentText",
  "accentTextStrong",
  "successTextStrong",
  "onAccent",
  "onAccentStrong",
  "danger",
  "dangerText",
  "dangerTextStrong",
  "dangerBorder",
  "warning",
  "warningText",
  "warningTextStrong",
  "warningSoft",
  "warningBorder",
  "warningWarmText",
  "info",
  "infoText",
  "infoTextStrong",
  "infoBorder",
  "track",
  "shadowColor",
  "overlay",
] as const;

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];
export type ThemeTokens = Record<ThemeTokenName, string>;

export type ThemeId = "dark" | "light" | "pitch";
export type AccentId = "verde" | "azul" | "violeta";

export type ThemeSelection = {
  theme: ThemeId;
  accent: AccentId;
};

export const DEFAULT_THEME: ThemeId = "dark";
export const DEFAULT_ACCENT: AccentId = "verde";

export const THEMES: Record<ThemeId, { label: string; tokens: ThemeTokens }> = {
  dark: {
    label: "Oscuro",
    tokens: {
      bg: "#0b0e12",
      bgDeep: "#0a0f14",
      surface: "#11161c",
      surface2: "#161c24",
      surface3: "#1a222c",
      surface4: "#1d2630",
      surfaceHover: "#151b22",
      surfaceActive: "#1a2530",
      field: "#0f141a",
      sidebarFrom: "#121820",
      sidebarTo: "#0e1218",
      line: "#232b35",
      lineSoft: "#1a222b",
      lineStrong: "#2a3541",
      lineHover: "#34434f",
      text: "#e7edf4",
      textStrong: "#eaf1f8",
      textSoft: "#c7d4e2",
      muted: "#8b97a6",
      muted2: "#74808e",
      faint: "#586574",
      accent: "#3ddc97",
      accentStrong: "#62f0b4",
      accentDeep: "#2bbf83",
      accentDim: "#1f6f52",
      accentSoft: "#18261f",
      accentBorder: "#2c3f35",
      accentText: "#a7f3c8",
      accentTextStrong: "#b9f5ce",
      successTextStrong: "#b9f5ce",
      onAccent: "#07120d",
      onAccentStrong: "#04110b",
      danger: "#ff6b6b",
      dangerText: "#ffb1b1",
      dangerTextStrong: "#ffd3d3",
      dangerBorder: "#4a2626",
      warning: "#f5c451",
      warningText: "#f2d894",
      warningTextStrong: "#ffc45c",
      warningSoft: "#1c1710",
      warningBorder: "#4a3a1d",
      warningWarmText: "#ffb98a",
      info: "#7aa2ff",
      infoText: "#a9c2ff",
      infoTextStrong: "#8ec5ff",
      infoBorder: "#274057",
      track: "#2b3743",
      shadowColor: "#000000",
      overlay: "rgba(3, 6, 9, 0.7)",
    },
  },
  light: {
    label: "Claro",
    tokens: {
      bg: "#f4f6f9",
      bgDeep: "#edf1f6",
      surface: "#ffffff",
      surface2: "#f7f9fc",
      surface3: "#eef2f7",
      surface4: "#e8edf4",
      surfaceHover: "#f0f4f9",
      surfaceActive: "#e6eef7",
      field: "#ffffff",
      sidebarFrom: "#ffffff",
      sidebarTo: "#f2f6fa",
      line: "#d8e0e9",
      lineSoft: "#e6ebf1",
      lineStrong: "#c4d0dc",
      lineHover: "#9aaaba",
      text: "#16202b",
      textStrong: "#0c141c",
      textSoft: "#33414f",
      muted: "#586777",
      muted2: "#657483",
      faint: "#7c8a98",
      accent: "#0f7a55",
      accentStrong: "#0b6345",
      accentDeep: "#0d6b4a",
      accentDim: "#3d8f72",
      accentSoft: "#e5f5ee",
      accentBorder: "#a7d9c5",
      accentText: "#0d6b4a",
      accentTextStrong: "#07543a",
      successTextStrong: "#07543a",
      onAccent: "#ffffff",
      onAccentStrong: "#ffffff",
      danger: "#b42318",
      dangerText: "#a61b14",
      dangerTextStrong: "#8f1710",
      dangerBorder: "#e7b4b0",
      warning: "#8a5a00",
      warningText: "#7a5200",
      warningTextStrong: "#6b4700",
      warningSoft: "#fff6df",
      warningBorder: "#e8cf96",
      warningWarmText: "#9a4b00",
      info: "#1d5bbf",
      infoText: "#1a4fa5",
      infoTextStrong: "#14408a",
      infoBorder: "#b8cdf0",
      track: "#d5dee8",
      shadowColor: "#1a2430",
      overlay: "rgba(20, 28, 38, 0.42)",
    },
  },
  /**
   * Pitch Black (Viktor Qvarfordt): fondo negro puro, texto #d4d4d4 y azul de
   * selección de VS Code. Los grises de superficie son casi negros para
   * conservar jerarquía sin ensuciar el negro del fondo.
   */
  pitch: {
    label: "Pitch Black",
    tokens: {
      bg: "#000000",
      bgDeep: "#000000",
      surface: "#050505",
      surface2: "#0a0a0a",
      surface3: "#111111",
      surface4: "#171717",
      surfaceHover: "#0d0d0d",
      surfaceActive: "#161616",
      field: "#060606",
      sidebarFrom: "#060606",
      sidebarTo: "#000000",
      line: "#1f1f1f",
      lineSoft: "#141414",
      lineStrong: "#2b2b2b",
      lineHover: "#3d3d3d",
      text: "#d4d4d4",
      textStrong: "#ffffff",
      textSoft: "#bdbdbd",
      muted: "#9c9c9c",
      muted2: "#8a8a8a",
      faint: "#6b6b6b",
      accent: "#3794ff",
      accentStrong: "#6cb2ff",
      accentDeep: "#1f74d1",
      accentDim: "#17456e",
      accentSoft: "#071421",
      accentBorder: "#1e3a55",
      accentText: "#9dc7ff",
      accentTextStrong: "#c3ddff",
      successTextStrong: "#9ff0c4",
      onAccent: "#000000",
      onAccentStrong: "#000000",
      danger: "#f87171",
      dangerText: "#ffb1b1",
      dangerTextStrong: "#ffd3d3",
      dangerBorder: "#4a2020",
      warning: "#fecc00",
      warningText: "#ffdf70",
      warningTextStrong: "#ffe680",
      warningSoft: "#171200",
      warningBorder: "#4a3c0d",
      warningWarmText: "#ffb98a",
      info: "#56b6ff",
      infoText: "#a9c2ff",
      infoTextStrong: "#8ec5ff",
      infoBorder: "#1e3a55",
      track: "#262626",
      shadowColor: "#000000",
      overlay: "rgba(0, 0, 0, 0.72)",
    },
  },
};

type AccentOverrides = Partial<ThemeTokens>;

function defineAccent(
  label: string,
  dark: AccentOverrides,
  light: AccentOverrides,
  pitch: AccentOverrides,
): { label: string; overrides: Record<ThemeId, AccentOverrides> } {
  return { label, overrides: { dark, light, pitch } };
}

export const ACCENTS: Record<
  AccentId,
  { label: string; overrides: Record<ThemeId, AccentOverrides> }
> = {
  verde: defineAccent(
    "Verde",
    {},
    {},
    {
      accent: "#4ade80",
      accentStrong: "#86efac",
      accentDeep: "#22c55e",
      accentDim: "#14532d",
      accentSoft: "#06140c",
      accentBorder: "#1c3b28",
      accentText: "#a7f3c8",
      accentTextStrong: "#c9f9dd",
      successTextStrong: "#c9f9dd",
      onAccent: "#000000",
      onAccentStrong: "#000000",
    },
  ),
  azul: defineAccent(
    "Azul",
    {
      accent: "#5aa0ff",
      accentStrong: "#8ec5ff",
      accentDeep: "#3f82e0",
      accentDim: "#24507f",
      accentSoft: "#101a2a",
      accentBorder: "#274057",
      accentText: "#a9c2ff",
      accentTextStrong: "#cfe2ff",
      successTextStrong: "#cfe2ff",
      onAccent: "#04101f",
      onAccentStrong: "#02101f",
    },
    {
      accent: "#1d5bbf",
      accentStrong: "#164a9e",
      accentDeep: "#1a54b0",
      accentDim: "#4f82c4",
      accentSoft: "#e8f0fd",
      accentBorder: "#b8cdf0",
      accentText: "#17458f",
      accentTextStrong: "#0f3572",
      successTextStrong: "#0f3572",
      onAccent: "#ffffff",
      onAccentStrong: "#ffffff",
    },
    {
      accent: "#3794ff",
      accentStrong: "#6cb2ff",
      accentDeep: "#1f74d1",
      accentDim: "#17456e",
      accentSoft: "#071421",
      accentBorder: "#1e3a55",
      accentText: "#9dc7ff",
      accentTextStrong: "#c3ddff",
      successTextStrong: "#c3ddff",
      onAccent: "#000000",
      onAccentStrong: "#000000",
    },
  ),
  violeta: defineAccent(
    "Violeta",
    {
      accent: "#b18cff",
      accentStrong: "#cdb4ff",
      accentDeep: "#8e68e0",
      accentDim: "#4c3775",
      accentSoft: "#1a1426",
      accentBorder: "#352a4d",
      accentText: "#d6c4ff",
      accentTextStrong: "#e7dcff",
      successTextStrong: "#e7dcff",
      onAccent: "#130a24",
      onAccentStrong: "#0d0619",
    },
    {
      accent: "#6b3fc4",
      accentStrong: "#5530a3",
      accentDeep: "#6039b3",
      accentDim: "#8a6cc0",
      accentSoft: "#f1ecfb",
      accentBorder: "#d5c6ee",
      accentText: "#56329f",
      accentTextStrong: "#44257f",
      successTextStrong: "#44257f",
      onAccent: "#ffffff",
      onAccentStrong: "#ffffff",
    },
    {
      accent: "#b18cff",
      accentStrong: "#cdb4ff",
      accentDeep: "#8e68e0",
      accentDim: "#4a3370",
      accentSoft: "#120c1f",
      accentBorder: "#33254d",
      accentText: "#d6c4ff",
      accentTextStrong: "#e7dcff",
      successTextStrong: "#e7dcff",
      onAccent: "#000000",
      onAccentStrong: "#000000",
    },
  ),
};

export const THEME_IDS: readonly ThemeId[] = ["dark", "light", "pitch"];
export const ACCENT_IDS: readonly AccentId[] = ["verde", "azul", "violeta"];

export function isThemeId(value: unknown): value is ThemeId {
  return value === "dark" || value === "light" || value === "pitch";
}

export function isAccentId(value: unknown): value is AccentId {
  return value === "verde" || value === "azul" || value === "violeta";
}

/** Resuelve una selección tolerando valores viejos o corruptos. */
export function resolveThemeSelection(
  theme?: string | null,
  accent?: string | null,
): ThemeSelection {
  return {
    theme: isThemeId(theme) ? theme : DEFAULT_THEME,
    accent: isAccentId(accent) ? accent : DEFAULT_ACCENT,
  };
}

/** Tokens completos del tema con el acento aplicado. */
export function themeTokens(theme: ThemeId, accentId: AccentId = DEFAULT_ACCENT): ThemeTokens {
  const base = THEMES[theme].tokens;
  return { ...base, ...ACCENTS[accentId].overrides[theme] };
}

/** Nombre de custom property para un token (`surface2` → `--surface-2`). */
export function themeVariable(name: ThemeTokenName): string {
  return `--${name
    .replace(/([A-Z])/g, (letter) => `-${letter}`)
    .replace(/(\d+)/g, "-$1")
    .toLowerCase()}`;
}

/** Custom properties listas para `style.setProperty`. */
export function themeStyle(theme: ThemeId, accent: AccentId): Record<string, string> {
  const tokens = themeTokens(theme, accent);
  return Object.fromEntries(THEME_TOKEN_NAMES.map((name) => [themeVariable(name), tokens[name]]));
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function parseHex(color: string): [number, number, number] | null {
  const value = color.trim().replace(/^#/, "");
  if (value.length === 3) {
    return [
      Number.parseInt(value[0] + value[0], 16),
      Number.parseInt(value[1] + value[1], 16),
      Number.parseInt(value[2] + value[2], 16),
    ];
  }
  if (value.length === 6) {
    return [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16),
    ];
  }
  return null;
}

/** Contraste WCAG entre dos colores hex; `null` si alguno no es hex. */
export function contrastRatio(foreground: string, background: string): number | null {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  if (!fg || !bg) return null;
  const luminance = (rgb: [number, number, number]) =>
    0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  const a = luminance(fg);
  const b = luminance(bg);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}
