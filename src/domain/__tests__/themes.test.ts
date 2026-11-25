import { describe, expect, test } from "vitest";
import {
  ACCENTS,
  ACCENT_IDS,
  DEFAULT_ACCENT,
  DEFAULT_THEME,
  THEMES,
  THEME_IDS,
  THEME_TOKEN_NAMES,
  contrastRatio,
  resolveThemeSelection,
  themeStyle,
  themeTokens,
  themeVariable,
} from "../theme/themes";

describe("tokens de tema", () => {
  test("cada tema declara exactamente todos los tokens", () => {
    for (const id of THEME_IDS) {
      expect(Object.keys(THEMES[id].tokens).sort()).toEqual([...THEME_TOKEN_NAMES].sort());
      for (const name of THEME_TOKEN_NAMES) {
        expect(THEMES[id].tokens[name]).toMatch(/^(#[0-9a-f]{6}|rgba\()/i);
      }
    }
  });

  test("cada acento define el juego completo de tokens en ambos temas", () => {
    for (const accentId of ACCENT_IDS) {
      for (const themeId of THEME_IDS) {
        const tokens = themeTokens(themeId, accentId);
        expect(Object.keys(tokens).sort()).toEqual([...THEME_TOKEN_NAMES].sort());
        expect(tokens.accent).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  test("el estilo produce una custom property por token", () => {
    const style = themeStyle("dark", "verde");
    expect(Object.keys(style)).toHaveLength(THEME_TOKEN_NAMES.length);
    expect(style["--bg"]).toBe(THEMES.dark.tokens.bg);
    expect(style["--surface-2"]).toBe(THEMES.dark.tokens.surface2);
    expect(style["--on-accent-strong"]).toBe(THEMES.dark.tokens.onAccentStrong);
  });

  test("los nombres con número conservan el guion", () => {
    expect(themeVariable("surface2")).toBe("--surface-2");
    expect(themeVariable("muted2")).toBe("--muted-2");
    expect(themeVariable("bgDeep")).toBe("--bg-deep");
  });

  test("resuelve valores desconocidos al tema por defecto", () => {
    expect(resolveThemeSelection(null, null)).toEqual({
      theme: DEFAULT_THEME,
      accent: DEFAULT_ACCENT,
    });
    expect(resolveThemeSelection("claro", "morado")).toEqual({
      theme: "dark",
      accent: "verde",
    });
    expect(resolveThemeSelection("light", "azul")).toEqual({ theme: "light", accent: "azul" });
    expect(resolveThemeSelection("pitch", "verde")).toEqual({ theme: "pitch", accent: "verde" });
  });

  test("Pitch Black mantiene el fondo negro puro", () => {
    const tokens = themeTokens("pitch", "azul");
    expect(tokens.bg).toBe("#000000");
    expect(tokens.bgDeep).toBe("#000000");
    expect(tokens.text).toBe("#d4d4d4");
  });
});

describe("contraste de los temas", () => {
  function ratio(a: string, b: string): number {
    const value = contrastRatio(a, b);
    if (value === null) throw new Error(`Color no hexadecimal: ${a} / ${b}`);
    return value;
  }

  test("texto principal y secundario legibles en todos los temas y acentos", () => {
    for (const themeId of THEME_IDS) {
      for (const accentId of ACCENT_IDS) {
        const t = themeTokens(themeId, accentId);
        expect(ratio(t.text, t.bg), `${themeId}/${accentId} text/bg`).toBeGreaterThanOrEqual(7);
        expect(
          ratio(t.text, t.surface),
          `${themeId}/${accentId} text/surface`,
        ).toBeGreaterThanOrEqual(7);
        expect(
          ratio(t.textSoft, t.surface),
          `${themeId}/${accentId} textSoft/surface`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t.muted, t.bg), `${themeId}/${accentId} muted/bg`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test("acento, estados y texto sobre acento cumplen contraste", () => {
    for (const themeId of THEME_IDS) {
      for (const accentId of ACCENT_IDS) {
        const t = themeTokens(themeId, accentId);
        expect(ratio(t.accent, t.surface), `${themeId}/${accentId} accent`).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(
          ratio(t.onAccent, t.accent),
          `${themeId}/${accentId} onAccent`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t.danger, t.bg), `${themeId}/${accentId} danger`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t.warning, t.bg), `${themeId}/${accentId} warning`).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(ratio(t.info, t.bg), `${themeId}/${accentId} info`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test("los acentos son diferentes entre sí", () => {
    const accents = ACCENT_IDS.map((id) => ACCENTS[id].overrides.dark.accent);
    expect(new Set(accents).size).toBe(ACCENT_IDS.length);
  });

  test("contrastRatio rechaza colores no soportados", () => {
    expect(contrastRatio("rgba(0,0,0,0.5)", "#ffffff")).toBeNull();
  });
});
