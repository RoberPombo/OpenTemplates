// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { migrateLegacyPreferences } from "../data/migrateLegacyPreferences";

beforeEach(() => {
  localStorage.clear();
});

describe("migrateLegacyPreferences", () => {
  test("copia las claves antiguas a las nuevas y conserva las originales", () => {
    localStorage.setItem("openconf:selected", "w1");
    localStorage.setItem("openconf:session:w1", "s1");
    localStorage.setItem("otra:clave", "x");

    migrateLegacyPreferences();

    expect(localStorage.getItem("opentemplates:selected")).toBe("w1");
    expect(localStorage.getItem("opentemplates:session:w1")).toBe("s1");
    expect(localStorage.getItem("openconf:selected")).toBe("w1");
    expect(localStorage.getItem("opentemplates:otra:clave")).toBeNull();
  });

  test("no pisa una clave nueva que ya tiene valor", () => {
    localStorage.setItem("openconf:panel", "0");
    localStorage.setItem("opentemplates:panel", "1");

    migrateLegacyPreferences();

    expect(localStorage.getItem("opentemplates:panel")).toBe("1");
  });
});
