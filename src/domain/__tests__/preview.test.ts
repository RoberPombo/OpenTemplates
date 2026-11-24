import { describe, expect, test } from "vitest";
import {
  DEFAULT_PREVIEW_URL,
  PREVIEW_PROMPT_MAX,
  buildPreviewPrompt,
  describePreviewProbe,
  previewSize,
  normalizePreviewUrl,
  type PreviewProbe,
} from "../preview/preview";

const ready: PreviewProbe = {
  ok: true,
  status: 200,
  title: "Mi app",
  error: null,
  frameBlocked: false,
  verified: true,
};

describe("normalización de URL y puerto", () => {
  test("acepta un puerto suelto y lo convierte en localhost", () => {
    expect(normalizePreviewUrl("5173")).toEqual({
      ok: true,
      url: "http://localhost:5173",
    });
    expect(normalizePreviewUrl(":3000")).toEqual({
      ok: true,
      url: "http://localhost:3000",
    });
    expect(normalizePreviewUrl("4173/ruta")).toEqual({
      ok: true,
      url: "http://localhost:4173/ruta",
    });
  });

  test("añade http a un host sin esquema y recorta espacios", () => {
    expect(normalizePreviewUrl("  localhost:5173/  ")).toEqual({
      ok: true,
      url: "http://localhost:5173",
    });
    expect(normalizePreviewUrl("127.0.0.1:8080/app")).toEqual({
      ok: true,
      url: "http://127.0.0.1:8080/app",
    });
  });

  test("respeta https y la ruta, sin barras de más", () => {
    expect(normalizePreviewUrl(DEFAULT_PREVIEW_URL)).toEqual({
      ok: true,
      url: "http://localhost:5173",
    });
    expect(normalizePreviewUrl("https://localhost:8443/x?a=1")).toEqual({
      ok: true,
      url: "https://localhost:8443/x?a=1",
    });
  });

  test("rechaza esquemas, credenciales y puertos fuera de rango", () => {
    expect(normalizePreviewUrl("")).toMatchObject({ ok: false });
    expect(normalizePreviewUrl("ftp://localhost")).toMatchObject({
      ok: false,
      error: expect.stringContaining("http"),
    });
    expect(normalizePreviewUrl("http://usuario:clave@localhost:5173")).toMatchObject({
      ok: false,
      error: expect.stringContaining("usuario"),
    });
    expect(normalizePreviewUrl("70000")).toMatchObject({
      ok: false,
      error: expect.stringContaining("puerto"),
    });
    expect(normalizePreviewUrl("no es una url")).toMatchObject({ ok: false });
  });
});

describe("estado del preview", () => {
  test("traduce un sondeo listo con su HTTP y título", () => {
    expect(describePreviewProbe(ready)).toEqual({
      status: "ready",
      message: "HTTP 200 · «Mi app»",
    });
  });

  test("https solo verifica la conexión", () => {
    expect(describePreviewProbe({ ...ready, status: null, title: null, verified: false })).toEqual({
      status: "ready",
      message: "Conexión establecida (HTTPS sin verificar).",
    });
  });

  test("un error conserva el mensaje del backend", () => {
    expect(
      describePreviewProbe({
        ...ready,
        ok: false,
        status: null,
        title: null,
        error: "No hay nadie escuchando en localhost:5173.",
      }),
    ).toEqual({
      status: "error",
      message: "No hay nadie escuchando en localhost:5173.",
    });
    expect(describePreviewProbe({ ...ready, ok: false, error: null }).message).toMatch(
      /No se pudo conectar/,
    );
  });

  test("los tamaños de dispositivo son los esperados", () => {
    expect(previewSize("desktop")).toEqual({ width: 1440, height: 900 });
    expect(previewSize("tablet")).toEqual({ width: 834, height: 1112 });
    expect(previewSize("mobile")).toEqual({ width: 390, height: 844 });
  });
});

describe("prompt para el agente", () => {
  test("numera URL, workspace, ruta, tamaño y estado", () => {
    const prompt = buildPreviewPrompt({
      workspaceName: "Demo",
      url: "http://localhost:5173",
      projectPath: "/tmp/demo",
      device: "tablet",
      probe: ready,
      note: "el menú no se abre",
    });

    expect(prompt).toContain("1. URL: http://localhost:5173");
    expect(prompt).toContain("2. Workspace: Demo");
    expect(prompt).toContain("3. Ruta local: /tmp/demo");
    expect(prompt).toContain("4. Vista: Tablet (834×1112)");
    expect(prompt).toContain("5. Estado: HTTP 200 · «Mi app»");
    expect(prompt).toContain("6. Petición: el menú no se abre");
  });

  test("incluye el aviso de marco bloqueado sin romper la numeración", () => {
    const prompt = buildPreviewPrompt({
      workspaceName: "Demo",
      url: "http://localhost:5173",
      projectPath: "/tmp/demo",
      device: "mobile",
      probe: { ...ready, frameBlocked: true },
    });

    expect(prompt).toContain("5. Aviso: el servidor prohíbe embeber");
    expect(prompt).toContain("7. Petición: revisa la vista");
  });

  test("recorta campos largos y el total", () => {
    const prompt = buildPreviewPrompt({
      workspaceName: "Demo".repeat(80),
      url: "http://localhost:5173",
      projectPath: "/tmp/demo",
      device: "desktop",
      probe: ready,
      note: "x".repeat(5000),
    });

    expect(prompt.length).toBeLessThanOrEqual(PREVIEW_PROMPT_MAX);
    expect(prompt).toContain("prompt recortado");
  });

  test("con error de conexión manda el error tal cual", () => {
    const prompt = buildPreviewPrompt({
      workspaceName: "Demo",
      url: "http://localhost:5173",
      projectPath: "/tmp/demo",
      device: "desktop",
      probe: { ...ready, ok: false, status: null, title: null, error: "Se agotó el tiempo." },
    });

    expect(prompt).toContain("Estado: error de conexión: Se agotó el tiempo.");
  });
});
