// @vitest-environment node
import { describe, expect, test } from "vitest";
import { configNeedsReload, diffMcps, sameSet } from "../workspace/config";

describe("sameSet", () => {
  test("ignora el orden", () => {
    expect(sameSet(["a", "b"], ["b", "a"])).toBe(true);
  });

  test("compara longitudes brutas: los duplicados cuentan (semántica original)", () => {
    expect(sameSet(["a", "a"], ["a"])).toBe(false);
    expect(sameSet(["a", "a"], ["a", "a"])).toBe(true);
  });

  test("distingue contenido y longitud", () => {
    expect(sameSet(["a"], ["a", "b"])).toBe(false);
    expect(sameSet(["a", "b"], ["a", "c"])).toBe(false);
    expect(sameSet([], [])).toBe(true);
  });
});

describe("diffMcps", () => {
  test("removed y added conservan el orden de primera aparición", () => {
    expect(diffMcps(["a", "b", "c"], ["b", "d"])).toEqual({ removed: ["a", "c"], added: ["d"] });
  });

  test("sin cambios", () => {
    expect(diffMcps(["a", "b"], ["b", "a"])).toEqual({ removed: [], added: [] });
  });

  test("listas vacías", () => {
    expect(diffMcps([], ["a"])).toEqual({ removed: [], added: ["a"] });
    expect(diffMcps(["a"], [])).toEqual({ removed: ["a"], added: [] });
  });

  test("duplicados no generan operaciones repetidas", () => {
    expect(diffMcps(["a", "a", "b"], ["b", "b"])).toEqual({ removed: ["a"], added: [] });
  });
});

describe("configNeedsReload", () => {
  const base = {
    beforeSkills: ["s1"],
    afterSkills: ["s1"],
    beforeModel: "anthropic/claude" as string | null,
    afterModel: "anthropic/claude",
  };

  test("sin cambios de skills ni modelo → no recarga", () => {
    expect(configNeedsReload(base)).toBe(false);
    expect(configNeedsReload({ ...base, afterSkills: ["s1", "s1"] })).toBe(true);
  });

  test("cambio de skills → recarga", () => {
    expect(configNeedsReload({ ...base, afterSkills: ["s2"] })).toBe(true);
    expect(configNeedsReload({ ...base, afterSkills: [] })).toBe(true);
  });

  test("cambio de modelo → recarga; null y vacío son equivalentes; trim aplicado", () => {
    expect(configNeedsReload({ ...base, afterModel: "openai/gpt" })).toBe(true);
    expect(configNeedsReload({ ...base, beforeModel: null, afterModel: "" })).toBe(false);
    expect(configNeedsReload({ ...base, beforeModel: null, afterModel: "  " })).toBe(false);
    expect(configNeedsReload({ ...base, afterModel: " anthropic/claude " })).toBe(false);
    expect(configNeedsReload({ ...base, beforeModel: undefined, afterModel: "x" })).toBe(true);
  });
});
