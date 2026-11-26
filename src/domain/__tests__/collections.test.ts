// @vitest-environment node
import { describe, expect, test } from "vitest";
import { toggleMapValue, toggleSetValue } from "../shared/collections";

describe("toggleSetValue", () => {
  test("añade si falta y quita si está, sin mutar el original", () => {
    const original = new Set(["a"]);
    const added = toggleSetValue(original, "b");
    expect([...added]).toEqual(["a", "b"]);
    expect([...original]).toEqual(["a"]);
    expect([...toggleSetValue(added, "a")]).toEqual(["b"]);
  });
});

describe("toggleMapValue", () => {
  test("fija el valor si falta y quita la clave si existe", () => {
    const original = new Map([["a", 1]]);
    const added = toggleMapValue(original, "b", 2);
    expect([...added]).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    expect([...original]).toEqual([["a", 1]]);
    expect([...toggleMapValue(added, "a", 9)]).toEqual([["b", 2]]);
  });
});
