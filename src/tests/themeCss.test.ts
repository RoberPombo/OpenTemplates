import { describe, expect, test } from "vitest";
// @ts-expect-error — Vitest ejecuta en Node aunque el proyecto no incluya @types/node.
import { readFileSync } from "node:fs";
import { THEME_TOKEN_NAMES, themeVariable } from "../domain/theme/themes";

const css = readFileSync("src/styles.css", "utf8");

/** Custom properties que no son del tema (las pone Base UI en tiempo de ejecución). */
const RUNTIME_VARIABLES = new Set([
  "--anchor-width",
  "--available-width",
  "--available-height",
  "--radius",
]);

function usedVariables(): string[] {
  return [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]))];
}

describe("CSS y tokens de tema", () => {
  test("no quedan colores fijos en la hoja de estilos", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\brgba?\(/i);
  });

  test("toda custom property usada existe en todos los temas", () => {
    const themeVariables = new Set(THEME_TOKEN_NAMES.map(themeVariable));
    const missing = usedVariables().filter(
      (name) => !themeVariables.has(name) && !RUNTIME_VARIABLES.has(name),
    );
    expect(missing).toEqual([]);
  });

  test("los tokens del tema se usan de verdad en la hoja", () => {
    const used = new Set(usedVariables());
    const unused = [...THEME_TOKEN_NAMES].map(themeVariable).filter((name) => !used.has(name));
    expect(unused).toEqual([]);
  });
});
