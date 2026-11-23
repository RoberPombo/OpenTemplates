// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  changeStatusCode,
  changeStatusLabel,
  decodeFileContent,
  fileDirectory,
  fileDisplayName,
  isTurnEndEvent,
  parsePatch,
  sortFileEntries,
  summarizeChanges,
  type FileChange,
} from "../workspace/changes";

const patch = `diff --git a/notas.txt b/notas.txt
index 15bf608..56b2a8c 100644
--- a/notas.txt
+++ b/notas.txt
@@ -1,3 +1,4 @@
 uno
-dos
+dos cambiado
 tres
+cuatro
`;

function change(overrides: Partial<FileChange> = {}): FileChange {
  return {
    file: "src/a.ts",
    additions: 2,
    deletions: 1,
    status: "modified",
    patch: "",
    ...overrides,
  };
}

describe("summarizeChanges", () => {
  test("suma contadores y separa por estado", () => {
    expect(
      summarizeChanges([
        change(),
        change({ file: "nuevo.ts", status: "added", additions: 5, deletions: 0 }),
        change({ file: "viejo.ts", status: "deleted", additions: 0, deletions: 4 }),
      ]),
    ).toEqual({
      files: 3,
      additions: 7,
      deletions: 5,
      added: 1,
      modified: 1,
      deleted: 1,
    });
  });
  test("un listado vacío da todo a cero", () => {
    expect(summarizeChanges([])).toEqual({
      files: 0,
      additions: 0,
      deletions: 0,
      added: 0,
      modified: 0,
      deleted: 0,
    });
  });
});

describe("etiquetas y rutas", () => {
  test("traduce el estado a español y a su inicial", () => {
    expect(changeStatusLabel("added")).toBe("añadido");
    expect(changeStatusLabel("modified")).toBe("modificado");
    expect(changeStatusLabel("deleted")).toBe("borrado");
    expect(changeStatusCode("added")).toBe("A");
    expect(changeStatusCode("modified")).toBe("M");
    expect(changeStatusCode("deleted")).toBe("D");
  });
  test("separa nombre y carpeta de una ruta relativa", () => {
    expect(fileDisplayName("src/domain/chat/stream.ts")).toBe("stream.ts");
    expect(fileDirectory("src/domain/chat/stream.ts")).toBe("src/domain/chat");
    expect(fileDisplayName("README.md")).toBe("README.md");
    expect(fileDirectory("README.md")).toBe("");
  });
});

describe("parsePatch", () => {
  test("mapea metadatos, hunk, contexto, altas y bajas con numeración", () => {
    const lines = parsePatch(patch);
    expect(lines.slice(0, 4).map((line) => line.kind)).toEqual(["meta", "meta", "meta", "meta"]);
    expect(lines[4]).toMatchObject({ kind: "hunk", oldLine: null, newLine: null });
    expect(lines.slice(5)).toEqual([
      { kind: "context", text: "uno", oldLine: 1, newLine: 1 },
      { kind: "delete", text: "dos", oldLine: 2, newLine: null },
      { kind: "add", text: "dos cambiado", oldLine: null, newLine: 2 },
      { kind: "context", text: "tres", oldLine: 3, newLine: 3 },
      { kind: "add", text: "cuatro", oldLine: null, newLine: 4 },
    ]);
  });
  test("acepta hunks sin recuento y CRLF", () => {
    const lines = parsePatch("@@ -10 +20 @@\r\n-viejo\r\n+nuevo\r\n");
    expect(lines).toEqual([
      { kind: "hunk", text: "@@ -10 +20 @@", oldLine: null, newLine: null },
      { kind: "delete", text: "viejo", oldLine: 10, newLine: null },
      { kind: "add", text: "nuevo", oldLine: null, newLine: 20 },
    ]);
  });
  test("un parche vacío no inventa líneas", () => {
    expect(parsePatch("")).toEqual([]);
  });
  test("reinicia la numeración en cada hunk", () => {
    const lines = parsePatch(
      "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-uno\n+UNO\n@@ -10,2 +10,2 @@\n-diez\n+ DIEZ\n once\n",
    );
    expect(lines.filter((line) => line.kind === "hunk")).toHaveLength(2);
    expect(lines).toContainEqual({ kind: "delete", text: "diez", oldLine: 10, newLine: null });
    expect(lines).toContainEqual({ kind: "context", text: "once", oldLine: 11, newLine: 11 });
  });
  test("vuelve a metadatos al empezar otro fichero", () => {
    const lines = parsePatch(
      "diff --git a/a b/a\n@@ -1 +1 @@\n-uno\n+UNO\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1 +1 @@\n-dos\n+DOS\n",
    );
    expect(lines[4]).toMatchObject({ kind: "meta", text: "diff --git a/b b/b" });
    expect(lines[5]).toMatchObject({ kind: "meta", text: "--- a/b" });
    expect(lines[7]).toMatchObject({ kind: "hunk" });
  });
  test("lo que no parece diff queda como metadato", () => {
    expect(parsePatch("texto suelto")).toEqual([
      { kind: "meta", text: "texto suelto", oldLine: null, newLine: null },
    ]);
  });
});

describe("sortFileEntries", () => {
  test("pone directorios antes que ficheros y ordena por nombre", () => {
    const sorted = sortFileEntries([
      { path: "zeta.txt", type: "file" },
      { path: "src/", type: "directory" },
      { path: "Alfa.txt", type: "file" },
      { path: "docs/", type: "directory" },
    ]);
    expect(sorted.map((entry) => entry.path)).toEqual(["docs/", "src/", "Alfa.txt", "zeta.txt"]);
  });
});

describe("decodeFileContent", () => {
  test("decodifica UTF-8 como texto", () => {
    const bytes = new TextEncoder().encode("hola\nmundo\n");
    expect(decodeFileContent(bytes)).toEqual({
      kind: "text",
      text: "hola\nmundo\n",
      bytes: bytes.length,
      truncated: false,
    });
  });
  test("marca binario cuando hay bytes nulos", () => {
    expect(decodeFileContent(new Uint8Array([1, 0, 2]))).toEqual({
      kind: "binary",
      text: "",
      bytes: 3,
      truncated: false,
    });
  });
  test("corta por el límite y avisa de la parte oculta", () => {
    const bytes = new TextEncoder().encode("abcdef");
    expect(decodeFileContent(bytes, 4)).toEqual({
      kind: "text",
      text: "abcd",
      bytes: 6,
      truncated: true,
    });
  });
  test("tolera payloads que no son bytes", () => {
    expect(decodeFileContent(undefined)).toEqual({
      kind: "binary",
      text: "",
      bytes: 0,
      truncated: false,
    });
  });
});

describe("isTurnEndEvent", () => {
  test("reconoce el final del turno y no los deltas", () => {
    expect(isTurnEndEvent({ type: "session.idle" })).toBe(true);
    expect(isTurnEndEvent({ type: "session.execution.succeeded" })).toBe(true);
    expect(isTurnEndEvent({ type: "session.execution.failed" })).toBe(true);
    expect(isTurnEndEvent({ type: "session.execution.interrupted" })).toBe(true);
    expect(isTurnEndEvent({ type: "session.text.delta" })).toBe(false);
  });
});
