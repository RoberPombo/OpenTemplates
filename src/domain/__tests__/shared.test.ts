// @vitest-environment node
import { describe, expect, test } from "vitest";
import { errorText, folderName, formatDuration } from "../shared";

describe("errorText", () => {
  test("devuelve el string tal cual", () => {
    expect(errorText("fallo")).toBe("fallo");
  });

  test("extrae el message de un Error", () => {
    expect(errorText(new Error("roto"))).toBe("roto");
  });

  test("serializa objetos", () => {
    expect(errorText({ code: 42 })).toBe('{"code":42}');
  });

  test("serializa objetos circulares sin lanzar", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(typeof errorText(circular)).toBe("string");
  });

  test("null se serializa como 'null' (semántica de App/CreateWorkspace)", () => {
    expect(errorText(null)).toBe("null");
  });
});

describe("folderName", () => {
  test("último segmento de una ruta absoluta", () => {
    expect(folderName("/home/user/proyecto")).toBe("proyecto");
  });

  test("ignora slashes finales", () => {
    expect(folderName("/home/user/proyecto/")).toBe("proyecto");
  });

  test("ruta relativa", () => {
    expect(folderName("proyecto")).toBe("proyecto");
  });

  test("cadena vacía devuelve la propia cadena", () => {
    expect(folderName("")).toBe("");
  });
});

describe("formatDuration", () => {
  test("vacío para duración no positiva o no finita", () => {
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(-5)).toBe("");
    expect(formatDuration(Number.NaN)).toBe("");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("");
  });

  test("segundos con un decimal por debajo de un minuto", () => {
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(59_900)).toBe("59.9s");
  });

  test("minutos y segundos redondeados a partir de un minuto", () => {
    expect(formatDuration(60_000)).toBe("1m 0s");
    expect(formatDuration(125_000)).toBe("2m 5s");
  });
});
