import { describe, expect, test } from "vitest";
import {
  KEYBINDINGS,
  formatShortcut,
  resolveShortcut,
  shortcutFor,
  shortcutMatches,
} from "../palette/keybindings";

const K = { key: "k", ctrlKey: true };
const escape = { key: "Escape" };

describe("resolución de atajos", () => {
  test("la paleta responde a Ctrl+K y Cmd+K", () => {
    expect(resolveShortcut(K)).toBe("palette.open");
    expect(resolveShortcut({ key: "k", metaKey: true })).toBe("palette.open");
  });

  test("las teclas sueltas no disparan atajos", () => {
    expect(resolveShortcut({ key: "k" })).toBeNull();
    expect(resolveShortcut({ key: "d", shiftKey: true })).toBeNull();
  });

  test("funciona con el foco en el composer sin tocar Enter", () => {
    expect(resolveShortcut(K, { inComposer: true, inEditable: true })).toBe("palette.open");
    expect(resolveShortcut({ key: "Enter" }, { inComposer: true })).toBeNull();
    expect(resolveShortcut({ key: "Enter", shiftKey: true }, { inComposer: true })).toBeNull();
    expect(resolveShortcut({ key: "ArrowLeft" }, { inComposer: true })).toBeNull();
  });

  test("Escape cierra el dock activo aunque se esté escribiendo", () => {
    expect(resolveShortcut(escape, { inComposer: true, inEditable: true })).toBe("panel.close");
    expect(resolveShortcut(escape)).toBe("panel.close");
  });

  test("respeta defaultPrevented y los campos editables", () => {
    expect(resolveShortcut({ ...K, defaultPrevented: true })).toBeNull();
    expect(resolveShortcut(escape, { paletteOpen: true })).toBeNull();
  });

  test("cambia de workspace y abre terminal y diff", () => {
    expect(resolveShortcut({ key: "ArrowRight", ctrlKey: true, altKey: true })).toBe(
      "workspace.next",
    );
    expect(resolveShortcut({ key: "ArrowLeft", metaKey: true, altKey: true })).toBe(
      "workspace.previous",
    );
    expect(resolveShortcut({ key: "`", ctrlKey: true })).toBe("panel.terminal");
    expect(resolveShortcut({ key: "d", ctrlKey: true, shiftKey: true })).toBe("panel.diff");
    expect(resolveShortcut({ key: "v", ctrlKey: true, shiftKey: true })).toBe("panel.preview");
  });

  test("parar el turno usa Ctrl+.", () => {
    expect(resolveShortcut({ key: ".", ctrlKey: true })).toBe("session.stop");
    expect(resolveShortcut({ key: ".", ctrlKey: true, shiftKey: true })).toBeNull();
  });

  test("un atajo exige exactamente sus modificadores", () => {
    expect(shortcutMatches({ key: "n", ctrlKey: true }, shortcutFor("session.new")!)).toBe(true);
    expect(
      shortcutMatches({ key: "n", ctrlKey: true, shiftKey: true }, shortcutFor("session.new")!),
    ).toBe(false);
  });

  test("el listado no repite ids", () => {
    const ids = KEYBINDINGS.map((binding) => binding.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("etiquetas de atajos", () => {
  test("formatea para Linux y macOS", () => {
    expect(formatShortcut({ key: "k", mod: true }, "Linux")).toBe("Ctrl+K");
    expect(formatShortcut({ key: "k", mod: true }, "MacIntel")).toBe("⌘K");
    expect(formatShortcut({ key: "ArrowRight", mod: true, alt: true }, "Linux")).toBe("Ctrl+Alt+→");
    expect(formatShortcut({ key: "Escape" }, "Linux")).toBe("Esc");
  });
});
