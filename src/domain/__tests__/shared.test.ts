// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  errorText,
  errorTextOr,
  folderName,
  formatBytes,
  formatDuration,
  formatPercent,
  safeExternalUrl,
} from "../shared";

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
  test("errorTextOr usa el texto por defecto solo si el error es vacío", () => {
    expect(errorTextOr(null)).toBe("Error desconocido");
    expect(errorTextOr("", "otro")).toBe("otro");
    expect(errorTextOr("fallo")).toBe("fallo");
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

describe("formatBytes", () => {
  test("bytes, KB, MB y GB con una decimal", () => {
    expect(formatBytes(19)).toBe("19 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2 * 1024 ** 2)).toBe("2.0 MB");
    expect(formatBytes(1.25 * 1024 ** 3)).toBe("1.3 GB");
  });
  test("valores no finitos o negativos caen a 0 B", () => {
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});
describe("formatPercent", () => {
  test("una decimal y vacío si no es finito", () => {
    expect(formatPercent(75)).toBe("75.0%");
    expect(formatPercent(28.57)).toBe("28.6%");
    expect(formatPercent(Number.NaN)).toBe("");
  });
});
describe("safeExternalUrl", () => {
  test("admite http, https, mailto y rutas relativas", () => {
    expect(safeExternalUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeExternalUrl("mailto:hola@example.com")).toBe("mailto:hola@example.com");
    expect(safeExternalUrl("/docs/guia")).toBe("/docs/guia");
    expect(safeExternalUrl("#seccion")).toBe("#seccion");
  });
  test("descarta esquemas ejecutables, incluso con espacios o mayúsculas", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("Java\nScript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,<script>1</script>")).toBeNull();
    expect(safeExternalUrl("vbscript:msgbox(1)")).toBeNull();
    expect(safeExternalUrl("file:///etc/passwd")).toBeNull();
  });
  test("vacío o nulo → null", () => {
    expect(safeExternalUrl("")).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
  });
});
