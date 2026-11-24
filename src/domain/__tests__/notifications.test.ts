/**
 * Lógica pura de avisos: tipo de evento, foco, preferencia y throttling.
 * Sin React, sin Tauri y sin reloj real (la hora entra por parámetro).
 */
import { describe, expect, test } from "vitest";
import {
  NOTIFICATION_THROTTLE_MS,
  NOTIFICATIONS_ON,
  decideNotification,
  describeNotification,
  eventSessionId,
  isThrottledKind,
  notificationsEnabled,
} from "../chat/notifications";

const workspace = { id: "w1", name: "Demo" };
const context = { workspace, sessionTitle: "Diseño de API" };
const enabled = { enabled: true, focused: false, now: 1_000_000 };

function idle(data: Record<string, unknown> = { sessionID: "s1" }) {
  return { type: "session.idle", data };
}

describe("notificationsEnabled", () => {
  test("solo el valor explícito activa la preferencia", () => {
    expect(notificationsEnabled(NOTIFICATIONS_ON)).toBe(true);
    expect(notificationsEnabled("0")).toBe(false);
    expect(notificationsEnabled(null)).toBe(false);
    expect(notificationsEnabled("")).toBe(false);
  });
});

describe("eventSessionId", () => {
  test("lee la sesión del payload y de los eventos estrechados", () => {
    expect(eventSessionId({ type: "session.idle", data: { sessionID: "s1" } })).toBe("s1");
    expect(
      eventSessionId({ type: "permission.asked", permission: { id: "p1", sessionID: "s2" } }),
    ).toBe("s2");
    expect(eventSessionId({ type: "form.created", form: { id: "f1", sessionID: "s3" } })).toBe(
      "s3",
    );
    expect(eventSessionId({ type: "session.idle", data: {} })).toBeNull();
    expect(eventSessionId({ type: "session.idle", data: "basura" })).toBeNull();
  });
});

describe("describeNotification", () => {
  test("turno terminado: título con workspace y sesión, cuerpo esencial", () => {
    expect(describeNotification(idle(), context)).toEqual({
      kind: "turn-finished",
      workspaceId: "w1",
      sessionId: "s1",
      title: "Demo · Diseño de API",
      body: "Turno terminado",
    });
  });

  test("sin título de sesión cae a un identificador corto", () => {
    expect(describeNotification(idle(), { workspace })?.title).toBe("Demo · Sesión s1");
    expect(describeNotification(idle({ sessionID: "abcdef123456" }), { workspace })?.title).toBe(
      "Demo · Sesión abcdef",
    );
  });

  test("succeeded e interrupted también cierran el turno", () => {
    expect(
      describeNotification(
        { type: "session.execution.succeeded", data: { sessionID: "s1" } },
        context,
      ),
    ).toMatchObject({ kind: "turn-finished", body: "Turno terminado" });
    expect(
      describeNotification(
        { type: "session.execution.interrupted", data: { sessionID: "s1" } },
        context,
      ),
    ).toMatchObject({ kind: "turn-interrupted", body: "Turno interrumpido" });
  });

  test("execution.failed incluye el mensaje del error", () => {
    expect(
      describeNotification(
        {
          type: "session.execution.failed",
          data: { sessionID: "s1", error: { message: "boom" } },
        },
        context,
      ),
    ).toMatchObject({ kind: "turn-failed", body: "El turno falló: boom" });
  });

  test("permiso y pregunta pendientes tienen sus propios cuerpos y requestId", () => {
    expect(
      describeNotification(
        {
          type: "permission.asked",
          data: { sessionID: "s1" },
          permission: { id: "per_1", sessionID: "s1" },
        },
        context,
      ),
    ).toMatchObject({
      kind: "approval",
      body: "Esperando tu aprobación",
      requestId: "per_1",
    });
    expect(
      describeNotification(
        { type: "form.created", data: { sessionID: "s1" }, form: { id: "frm_1", sessionID: "s1" } },
        context,
      ),
    ).toMatchObject({
      kind: "question",
      body: "El agente espera tu respuesta",
      requestId: "frm_1",
    });
  });

  test("un permission.asked sin payload estrechado sigue avisando", () => {
    expect(
      describeNotification({ type: "permission.asked", data: { sessionID: "s1" } }, context),
    ).toMatchObject({ kind: "approval" });
  });

  test("los eventos sin sesión o sin interés no generan aviso", () => {
    expect(describeNotification({ type: "session.idle", data: {} }, context)).toBeNull();
    expect(
      describeNotification({ type: "session.text.delta", data: { sessionID: "s1" } }, context),
    ).toBeNull();
    expect(
      describeNotification({ type: "vcs.branch.updated", data: { sessionID: "s1" } }, context),
    ).toBeNull();
  });
});

describe("decideNotification", () => {
  test("con preferencia activa y sin foco avisa", () => {
    expect(decideNotification(idle(), context, enabled)).toMatchObject({ kind: "turn-finished" });
  });

  test("con la preferencia desactivada no avisa", () => {
    expect(decideNotification(idle(), context, { ...enabled, enabled: false })).toBeNull();
  });

  test("con la ventana enfocada no avisa", () => {
    expect(decideNotification(idle(), context, { ...enabled, focused: true })).toBeNull();
  });

  test("throttling: no repite un turno de la misma sesión antes del margen", () => {
    const now = enabled.now;
    expect(
      decideNotification(idle(), context, {
        ...enabled,
        lastNotifiedAt: now - (NOTIFICATION_THROTTLE_MS - 1),
      }),
    ).toBeNull();
    expect(
      decideNotification(idle(), context, {
        ...enabled,
        lastNotifiedAt: now - NOTIFICATION_THROTTLE_MS,
      }),
    ).not.toBeNull();
    expect(
      decideNotification(idle(), context, { ...enabled, throttleMs: 0, lastNotifiedAt: now }),
    ).not.toBeNull();
  });

  test("permisos y preguntas no entran en el throttling de turnos", () => {
    const permission = {
      type: "permission.asked",
      data: { sessionID: "s1" },
      permission: { id: "per_1", sessionID: "s1" },
    };
    expect(
      decideNotification(permission, context, { ...enabled, lastNotifiedAt: enabled.now }),
    ).toMatchObject({ kind: "approval" });
  });

  test("isThrottledKind solo agrupa los cierres de turno", () => {
    expect(isThrottledKind("turn-finished")).toBe(true);
    expect(isThrottledKind("turn-failed")).toBe(true);
    expect(isThrottledKind("turn-interrupted")).toBe(true);
    expect(isThrottledKind("approval")).toBe(false);
    expect(isThrottledKind("question")).toBe(false);
  });
});
