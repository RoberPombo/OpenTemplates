import { describe, expect, test } from "vitest";
import {
  DEFAULT_GOAL_TURNS,
  advanceGoal,
  conversationFingerprint,
  createGoal,
  describeGoalStop,
  editGoal,
  goalDecisionRequest,
  goalLimitReason,
  parseGoal,
  pauseGoal,
  pickDecisionModel,
  resumeGoal,
  serializeGoal,
  type Goal,
  type GoalDecisionResult,
} from "../chat/goals";
const now = 1_000;
function goal(overrides: Partial<Goal> = {}): Goal {
  return { ...createGoal({ text: "deja los tests en verde", now }), ...overrides };
}
function decision(verdict: GoalDecisionResult["verdict"]): GoalDecisionResult {
  return {
    verdict,
    confidence: 0.9,
    cost: 0.002,
    tokens: { input: 100, output: 20 },
    error: null,
  };
}
function advance(
  base: Goal,
  input: Partial<Parameters<typeof advanceGoal>[1]> = {},
): ReturnType<typeof advanceGoal> {
  return advanceGoal(base, {
    decision: decision("continue"),
    sessionCost: 0,
    pendingRequest: false,
    userStopped: false,
    turnFailed: false,
    fingerprint: "f1",
    now: now + 1,
    ...input,
  });
}
describe("objetivo — estado y persistencia", () => {
  test("crea con turnos por defecto y límites normalizados", () => {
    const created = createGoal({ text: "  arregla el lint  ", now, maxTurns: 99, maxCost: 1.5 });
    expect(created).toMatchObject({
      text: "arregla el lint",
      status: "active",
      turns: 0,
      maxTurns: 20,
      maxCost: 1.5,
      lastVerdict: null,
    });
    const fallback = createGoal({ text: "x", now, maxTurns: Number.NaN });
    expect(fallback.maxTurns).toBe(DEFAULT_GOAL_TURNS);
  });
  test("serializa y recupera; un valor corrupto se descarta", () => {
    const created = goal({ turns: 2, cost: 0.12, lastVerdict: "continue" });
    expect(parseGoal(serializeGoal(created))).toEqual(created);
    expect(parseGoal("{no es json")).toBeNull();
    expect(parseGoal(JSON.stringify({ text: "", status: "active" }))).toBeNull();
    expect(parseGoal(JSON.stringify({ text: "x", status: "raro" }))).toBeNull();
    expect(parseGoal(null)).toBeNull();
  });
  test("editar conserva progreso; reanudar limpia la última decisión", () => {
    const edited = editGoal(goal({ turns: 2 }), {
      text: "nuevo criterio",
      maxTurns: 8,
      maxCost: 2,
      now: now + 5,
    });
    expect(edited).toMatchObject({ text: "nuevo criterio", maxTurns: 8, turns: 2, maxCost: 2 });
    expect(edited.status).toBe("active");
    expect(pauseGoal(edited, now + 6).status).toBe("paused");
    const resumed = resumeGoal(
      { ...edited, status: "blocked", lastVerdict: "blocked", lastFingerprint: "f" },
      now + 7,
    );
    expect(resumed).toMatchObject({ status: "active", lastVerdict: null, lastFingerprint: null });
  });
});
describe("objetivo — avance del bucle", () => {
  test("continuar suma el turno, el coste y pide un prompt que recuerda el objetivo", () => {
    const { goal: next, action } = advance(goal({ costBaseline: 0.5 }), {
      sessionCost: 0.8,
      decision: decision("continue"),
    });
    expect(action.kind).toBe("continue");
    if (action.kind === "continue") {
      expect(action.prompt).toContain("deja los tests en verde");
      expect(action.prompt).toContain("1 de 5 turnos");
    }
    expect(next).toMatchObject({ status: "active", turns: 1, cost: 0.3, lastVerdict: "continue" });
    expect(next.tokens).toEqual({ input: 100, output: 20 });
  });
  test("cumplido y bloqueado paran con su estado", () => {
    const done = advance(goal(), { decision: decision("done") });
    expect(done.goal.status).toBe("done");
    expect(done.action).toEqual({ kind: "stop", reason: "done" });
    const blocked = advance(goal(), { decision: decision("blocked") });
    expect(blocked.goal.status).toBe("blocked");
    expect(blocked.action).toEqual({ kind: "stop", reason: "blocked" });
  });
  test("agota turnos y coste sin volver a pedir un turno", () => {
    const turns = advance(goal({ turns: 4, maxTurns: 5 }), {});
    expect(turns.goal.status).toBe("exhausted");
    expect(turns.action).toEqual({ kind: "stop", reason: "max-turns" });
    const cost = advance(goal({ costBaseline: 1, maxCost: 0.5 }), { sessionCost: 1.6 });
    expect(cost.goal.status).toBe("exhausted");
    expect(cost.action).toEqual({ kind: "stop", reason: "max-cost" });
    expect(goalLimitReason(cost.goal)).toBe("max-cost");
  });
  test("un permiso o pregunta pendiente espera sin consumir turno", () => {
    const { goal: next, action } = advance(goal(), { pendingRequest: true });
    expect(action).toEqual({ kind: "wait", reason: "pending-request" });
    expect(next.turns).toBe(0);
    expect(next.status).toBe("active");
  });
  test("parada manual y turno fallido pausan el objetivo", () => {
    const stopped = advance(goal(), { userStopped: true });
    expect(stopped.goal.status).toBe("paused");
    expect(stopped.action).toEqual({ kind: "stop", reason: "user-stopped" });
    const failed = advance(goal(), { turnFailed: true, decision: null });
    expect(failed.goal.status).toBe("paused");
    expect(failed.action).toEqual({ kind: "stop", reason: "turn-failed" });
  });
  test("una decisión repetida con la misma conversación bloquea el bucle", () => {
    const first = advance(goal(), { fingerprint: "misma" });
    expect(first.action.kind).toBe("continue");
    const repeated = advance(first.goal, { fingerprint: "misma" });
    expect(repeated.goal.status).toBe("blocked");
    expect(repeated.action).toEqual({ kind: "stop", reason: "repeated-decision" });
    const progressed = advance(first.goal, { fingerprint: "otra" });
    expect(progressed.action.kind).toBe("continue");
  });
  test("sin decisión válida se pausa en vez de seguir a ciegas", () => {
    const { goal: next, action } = advance(goal(), {
      decision: {
        verdict: null,
        confidence: null,
        cost: 0,
        tokens: { input: 0, output: 0 },
        error: "modelo caído",
      },
    });
    expect(next.status).toBe("paused");
    expect(action).toEqual({ kind: "stop", reason: "no-decision" });
  });
  test("inactivo no hace nada", () => {
    const paused = goal({ status: "paused" });
    expect(advance(paused).action).toEqual({ kind: "wait", reason: "inactive" });
  });
});
describe("objetivo — evaluación", () => {
  test("la petición incluye el objetivo, el modelo y las tres opciones", () => {
    const request = goalDecisionRequest(goal({ turns: 2 }), [], {
      providerID: "opencode",
      id: "jev",
    });
    expect(request.model).toEqual({ providerID: "opencode", id: "jev" });
    expect(request.questions[0]?.name).toBe("goal_state");
    expect(request.questions[0]?.choices.map((choice) => choice.value)).toEqual([
      "continue",
      "done",
      "blocked",
    ]);
    expect(request.input[0]?.text).toContain("deja los tests en verde");
    expect(request.input[0]?.text).toContain("(sin mensajes todavía)");
  });
  test("recorta por caracteres conservando lo más reciente", () => {
    const messages = [
      { id: "u1", role: "user" as const, text: "antiguo ".repeat(200) },
      { id: "a1", role: "assistant" as const, text: "reciente ok" },
    ];
    const request = goalDecisionRequest(goal(), messages, { providerID: "p", id: "m" }, 700);
    const text = request.input[0]?.text ?? "";
    expect(text.length).toBeLessThanOrEqual(700 + 200);
    expect(text).toContain("reciente ok");
  });
  test("elige solo un modelo con capacidad de decisión", () => {
    expect(
      pickDecisionModel([
        { providerID: "p", id: "chat", type: "chat" },
        { providerID: "p", id: "off", type: "decision", enabled: false },
        { providerID: "p", id: "dec", type: "decision", enabled: true },
      ]),
    ).toEqual({ providerID: "p", id: "dec" });
    expect(pickDecisionModel([])).toBeNull();
  });
  test("la huella cambia cuando entra un mensaje nuevo", () => {
    const one = conversationFingerprint([{ id: "a", role: "assistant", text: "hola" }]);
    const two = conversationFingerprint([
      { id: "a", role: "assistant", text: "hola" },
      { id: "b", role: "user", text: "sigue" },
    ]);
    expect(two).not.toBe(one);
  });
  test("describe el aviso de cada parada", () => {
    expect(describeGoalStop(goal(), "done").title).toBe("Objetivo cumplido");
    expect(describeGoalStop(goal({ cost: 0.4 }), "max-cost").body).toContain("$0.400");
  });
});
