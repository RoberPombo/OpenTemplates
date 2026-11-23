import { describe, expect, test } from "vitest";
import {
  IMPORTED_TITLE,
  REDACTED_PATH,
  REDACTED_SECRET,
  SESSION_FILE_FORMAT,
  SESSION_FILE_VERSION,
  createSessionFile,
  importErrorMessage,
  parseSessionFile,
  prepareImport,
  sanitizeTransfer,
  serializeSessionFile,
  suggestedSessionFileName,
  type SessionTransfer,
} from "../chat/transfer";

function makeTransfer(overrides: Partial<SessionTransfer> = {}): SessionTransfer {
  return {
    info: {
      id: "ses_1",
      title: "Refactor de login",
      projectID: "proj_1",
      cost: 0.5,
      tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 2 },
      location: { directory: "/tmp/demo" },
    },
    messages: [
      { id: "msg_1", type: "user", text: "hola", time: { created: 1 } },
      { id: "msg_2", type: "assistant", content: [{ type: "text", text: "buenas" }] },
    ],
    ...overrides,
  };
}

function makeFileJson(overrides: Record<string, unknown> = {}): string {
  const file = createSessionFile(makeTransfer(), { sanitized: true, now: Date.UTC(2026, 10, 23) });
  return JSON.stringify({ ...file, ...overrides });
}

describe("fichero de sesión", () => {
  test("serializa un sobre versionado y lo vuelve a leer sin pérdidas", () => {
    const file = createSessionFile(makeTransfer(), { sanitized: true, now: 0 });
    const parsed = parseSessionFile(serializeSessionFile(file));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.file.format).toBe(SESSION_FILE_FORMAT);
    expect(parsed.file.version).toBe(SESSION_FILE_VERSION);
    expect(parsed.file.sanitized).toBe(true);
    expect(parsed.file.session.info.id).toBe("ses_1");
    expect(parsed.file.session.messages).toHaveLength(2);
    expect(parsed.file.session.messages[1]?.id).toBe("msg_2");
  });

  test("el JSON termina en salto de línea y conserva el título", () => {
    const contents = serializeSessionFile(
      createSessionFile(makeTransfer(), { sanitized: false, now: 0 }),
    );
    expect(contents.endsWith("\n")).toBe(true);
    expect(contents).toContain('"title": "Refactor de login"');
  });

  test("rechaza un JSON que no es de OpenTemplates", () => {
    const parsed = parseSessionFile('{"info":{},"messages":[]}');
    expect(parsed).toEqual({ ok: false, error: "El archivo no es una sesión de OpenTemplates." });
  });

  test("rechaza versión desconocida con un mensaje accionable", () => {
    const parsed = parseSessionFile(makeFileJson({ version: 2 }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("versión del archivo (2)");
    expect(parsed.error).toContain(`admite la ${SESSION_FILE_VERSION}`);
  });

  test("rechaza una versión que no es un entero", () => {
    const parsed = parseSessionFile(makeFileJson({ version: "uno" }));
    expect(parsed).toEqual({ ok: false, error: "El archivo no indica una versión válida." });
  });

  test("rechaza JSON inválido", () => {
    expect(parseSessionFile("{no es json")).toEqual({
      ok: false,
      error: "El archivo no es JSON válido.",
    });
  });

  test("señala el mensaje corrupto por su posición", () => {
    const file = createSessionFile(makeTransfer(), { sanitized: true, now: 0 });
    const broken = {
      ...file,
      session: {
        ...file.session,
        messages: [file.session.messages[0], { type: "assistant" }],
      },
    };
    const parsed = parseSessionFile(JSON.stringify(broken));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("posición 2");
  });

  test("rechaza una sesión sin identificador", () => {
    const file = createSessionFile(makeTransfer(), { sanitized: true, now: 0 });
    const broken = { ...file, session: { ...file.session, info: { title: "sin id" } } };
    const parsed = parseSessionFile(JSON.stringify(broken));
    expect(parsed).toEqual({
      ok: false,
      error: "La sesión del archivo no tiene identificador.",
    });
  });

  test("rechaza mensajes que no son una lista", () => {
    const file = createSessionFile(makeTransfer(), { sanitized: true, now: 0 });
    const broken = { ...file, session: { ...file.session, messages: "ninguno" } };
    expect(parseSessionFile(JSON.stringify(broken))).toEqual({
      ok: false,
      error: "El archivo no contiene la lista de mensajes de la sesión.",
    });
  });
});

describe("saneado del export", () => {
  test("quita rutas personales y del workspace, y conserva el resto del texto", () => {
    const transfer = makeTransfer({
      info: {
        ...makeTransfer().info,
        title: "Despliegue en /home/ana/proyectos/tienda",
        location: { directory: "/home/ana/proyectos/tienda" },
      },
      messages: [
        {
          id: "msg_1",
          type: "user",
          text: "Revisa /home/ana/proyectos/tienda/src y C:\\Users\\ana\\tienda",
        },
      ],
    });

    const clean = sanitizeTransfer(transfer);
    expect(clean.info.title).toBe(`Despliegue en ${REDACTED_PATH}`);
    expect(clean.info.location).toEqual({ directory: REDACTED_PATH });
    expect(clean.messages[0]?.text).toBe(`Revisa ${REDACTED_PATH} y ${REDACTED_PATH}`);
  });

  test("sustituye credenciales sin tocar las métricas de tokens", () => {
    const transfer = makeTransfer({
      messages: [
        {
          id: "msg_1",
          type: "assistant",
          text: "usa sk-abcdefghijklmnopqrstuvwx y ghp_abcdefghijklmnopqrstuvwxyz0123456789",
          content: [
            { type: "tool", input: { authorization: "Bearer abc.def.ghi", args: "gh auth" } },
          ],
        },
      ],
    });

    const clean = sanitizeTransfer(transfer);
    const message = clean.messages[0] as Record<string, unknown>;
    expect(message.text).toBe(`usa ${REDACTED_SECRET} y ${REDACTED_SECRET}`);
    expect((message.content as Record<string, unknown>[])[0]?.input).toEqual({
      authorization: REDACTED_SECRET,
      args: "gh auth",
    });
    expect(clean.info.tokens).toEqual(transfer.info.tokens);
  });

  test("no modifica la transferencia original", () => {
    const transfer = makeTransfer({
      info: { ...makeTransfer().info, title: "En /home/ana/tienda" },
    });
    sanitizeTransfer(transfer);
    expect(transfer.info.title).toBe("En /home/ana/tienda");
  });

  test("sin sanear, el título y la ruta viajan tal cual", () => {
    const transfer = makeTransfer({
      info: { ...makeTransfer().info, title: "En /home/ana/tienda" },
    });
    const file = createSessionFile(transfer, { sanitized: false, now: 0 });
    expect(file.session.info.title).toBe("En /home/ana/tienda");
    expect(file.session.info.location).toEqual({ directory: "/tmp/demo" });
  });
});

describe("importación", () => {
  test("apunta la sesión al workspace de destino y conserva id y mensajes", () => {
    const file = createSessionFile(makeTransfer(), { sanitized: true, now: 0 });
    const payload = prepareImport(file, { directory: "/tmp/otro", title: "Importada · Otro" });

    expect(payload.info.id).toBe("ses_1");
    expect(payload.info.title).toBe("Refactor de login");
    expect(payload.info.location).toEqual({ directory: "/tmp/otro" });
    expect(payload.location).toEqual({ directory: "/tmp/otro" });
    expect(payload.messages).toHaveLength(2);
  });

  test("recupera el título cuando el servidor lo dejó redactado", () => {
    const file = createSessionFile(
      makeTransfer({
        info: { ...makeTransfer().info, title: "[redacted:session-title:ses_1]" },
      }),
      { sanitized: true, now: 0 },
    );
    const payload = prepareImport(file, { directory: "/tmp/otro" });
    expect(payload.info.title).toBe(IMPORTED_TITLE);
  });

  test("un título vacío también cae al de reserva", () => {
    const file = createSessionFile(
      makeTransfer({ info: { ...makeTransfer().info, title: "   " } }),
      { sanitized: true, now: 0 },
    );
    expect(prepareImport(file, { directory: "/tmp/otro" }).info.title).toBe(IMPORTED_TITLE);
  });

  test("explica la colisión de id del servidor", () => {
    const message = importErrorMessage(new Error("Session already exists: ses_1"), "ses_1");
    expect(message).toContain("Ya existe una sesión con el identificador ses_1");
    expect(message).toContain("Bórrala o importa el archivo en otro workspace");
  });

  test("explica el rechazo por mensajes ya presentes", () => {
    const message = importErrorMessage(new Error("UnexpectedStatus: 500"), "ses_1");
    expect(message).toContain("rechazó la importación");
    expect(message).toContain("Borra la copia anterior");
  });

  test("deja pasar cualquier otro error del servidor", () => {
    expect(importErrorMessage(new Error("sin conexión"), "ses_1")).toBe("sin conexión");
  });
});

describe("nombre de fichero sugerido", () => {
  test("usa un slug del título y la fecha", () => {
    expect(suggestedSessionFileName("Refactor de sesión ñ", Date.UTC(2026, 10, 23))).toBe(
      "sesion-refactor-de-sesion-n-20261123.json",
    );
  });

  test("cae a «sesion» si el título no deja letras", () => {
    expect(suggestedSessionFileName("***", Date.UTC(2026, 0, 5))).toBe("sesion-20260105.json");
  });
});
