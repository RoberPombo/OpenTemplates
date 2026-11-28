import { describe, expect, test } from "vitest";
import {
  PREVIEW_ELEMENT_LIMITS,
  PREVIEW_ELEMENT_SOURCE,
  PREVIEW_ELEMENT_VERSION,
  isPreviewSelectorMessage,
  sanitizePreviewElement,
} from "../preview/element";
import { buildPreviewPrompt } from "../preview/preview";

const ready = {
  ok: true,
  status: 200,
  title: null,
  error: null,
  frameBlocked: false,
  verified: true,
};

describe("sanitizePreviewElement — payload no confiable", () => {
  test("sanea un elemento válido y recorta longitudes", () => {
    const el = sanitizePreviewElement({
      tag: "BUTTON",
      role: "button",
      selector: "#save",
      name: "Guardar",
      text: "  Guardar   ahora  ",
      url: "/app",
      rect: { x: 1.234, y: 2, width: 100, height: 40 },
      computedStyles: { "background-color": "rgb(0,0,0)", color: "red", "not-a-prop": "x" },
    });
    expect(el).not.toBeNull();
    expect(el!.tag).toBe("button");
    expect(el!.text).toBe("Guardar ahora");
    expect(el!.computedStyles).toEqual({ "background-color": "rgb(0,0,0)", color: "red" });
    expect(el!.rect).toEqual({ x: 1.23, y: 2, width: 100, height: 40 });
  });

  test("recorta strings enormes y quita caracteres de control", () => {
    const el = sanitizePreviewElement({
      tag: "a",
      selector: "x".repeat(5000),
      name: "n".repeat(5000),
      text: "t".repeat(5000) + "\u0000\u0001",
      url: "u".repeat(5000),
    });
    expect(el!.selector.length).toBeLessThanOrEqual(PREVIEW_ELEMENT_LIMITS.selector);
    expect(el!.name!.length).toBeLessThanOrEqual(PREVIEW_ELEMENT_LIMITS.name);
    expect(el!.text.length).toBeLessThanOrEqual(PREVIEW_ELEMENT_LIMITS.text);
    expect(el!.text).not.toContain("\u0000");
  });

  test("rechaza payloads sin etiqueta ni selector y nunca lanza", () => {
    expect(sanitizePreviewElement(null)).toBeNull();
    expect(sanitizePreviewElement("x")).toBeNull();
    expect(sanitizePreviewElement({})).toBeNull();
    expect(sanitizePreviewElement({ tag: "<script>", selector: "" })).toBeNull();
    expect(sanitizePreviewElement({ tag: "1bad" })).toBeNull();
  });

  test("ignora propiedades de estilo desconocidas y no recorre prototipos", () => {
    const el = sanitizePreviewElement({
      tag: "div",
      selector: "div",
      computedStyles: { color: "red", __proto__: { evil: 1 }, "x-extra": "y" },
    });
    expect(el!.computedStyles).toEqual({ color: "red" });
    expect(({} as Record<string, unknown>).evil).toBeUndefined();
  });

  test("rect con números no finitos se descarta", () => {
    const el = sanitizePreviewElement({
      tag: "div",
      selector: "div",
      rect: { x: NaN, y: 1, width: 1, height: 1 },
    });
    expect(el!.rect).toBeNull();
  });
});

describe("isPreviewSelectorMessage — esquema + nonce", () => {
  const valid = {
    source: PREVIEW_ELEMENT_SOURCE,
    version: PREVIEW_ELEMENT_VERSION,
    type: "element",
    nonce: "n",
  };

  test("acepta mensajes válidos del script", () => {
    expect(isPreviewSelectorMessage(valid, "n")).toBe(true);
    expect(isPreviewSelectorMessage({ ...valid, type: "ready" }, "n")).toBe(true);
    expect(isPreviewSelectorMessage({ ...valid, type: "exit" }, "n")).toBe(true);
  });

  test("rechaza origen de source, versión, nonce, tipo o forma incorrectos", () => {
    expect(isPreviewSelectorMessage({ ...valid, source: "evil" }, "n")).toBe(false);
    expect(isPreviewSelectorMessage({ ...valid, version: 2 }, "n")).toBe(false);
    expect(isPreviewSelectorMessage({ ...valid, nonce: "otro" }, "n")).toBe(false);
    expect(isPreviewSelectorMessage({ ...valid, type: "hack" }, "n")).toBe(false);
    expect(isPreviewSelectorMessage(null, "n")).toBe(false);
    expect(isPreviewSelectorMessage("x", "n")).toBe(false);
  });
});

describe("buildPreviewPrompt con elemento", () => {
  test("añade sección Elemento numerada, recortada, sin DOM completo", () => {
    const prompt = buildPreviewPrompt({
      workspaceName: "Demo",
      url: "http://localhost:5173",
      projectPath: "/tmp/demo",
      device: "desktop",
      probe: ready,
      note: "revisa esto",
      element: {
        tag: "button",
        role: "button",
        selector: "#save",
        name: "Guardar",
        text: "Guardar",
        url: "/app",
        rect: { x: 10, y: 20, width: 100, height: 30 },
        computedStyles: { color: "red", "background-color": "blue" },
      },
    });
    expect(prompt).toContain("Elemento: <button>");
    expect(prompt).toContain("Selector CSS: #save");
    expect(prompt).toContain("Rol: button");
    expect(prompt).toContain("Texto corto: Guardar");
    expect(prompt).toContain("Estilos (curado):");
    expect(prompt).toContain("Petición: revisa esto");
    expect(prompt).not.toContain("<html");
    expect(prompt.length).toBeLessThanOrEqual(900 + 20);
  });
});
