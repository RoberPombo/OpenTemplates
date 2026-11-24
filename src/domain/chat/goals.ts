/**
 * Objetivo de sesión («deja los tests en verde»): estado, persistencia y
 * avance del bucle que reintenta turnos hasta cumplirlo, bloquearse o agotar
 * el límite que fija el usuario.
 *
 * La evaluación no se deduce del texto: el servidor opencode expone
 * `generate.decisions` con una pregunta de tipo `choice` (continue/done/blocked).
 * Aquí solo vive la decisión ya parseada y las guardas que evitan bucles
 * infinitos: permiso o pregunta pendiente, parada manual, turno fallido,
 * decisión repetida sin progreso, turnos y coste.
 */
/** Turnos por defecto al crear un objetivo; el usuario puede subirlos o bajarlos. */
export const DEFAULT_GOAL_TURNS = 5;
export const MAX_GOAL_TURNS = 20;
/** Nombre de la pregunta de elección que responde el evaluador. */
export const GOAL_DECISION_NAME = "goal_state";
export const GOAL_VERDICTS = ["continue", "done", "blocked"] as const;
export type GoalVerdict = (typeof GOAL_VERDICTS)[number];
export type GoalStatus = "active" | "paused" | "done" | "blocked" | "exhausted";
export type GoalTokens = { input: number; output: number };
export type Goal = {
  text: string;
  status: GoalStatus;
  /** Turnos del agente consumidos por el objetivo (se incrementa al cerrar cada uno). */
  turns: number;
  maxTurns: number;
  /** Gasto de la sesión atribuido al objetivo desde que se creó. */
  cost: number;
  /** Coste de la sesión al crear el objetivo; el gasto es la diferencia. */
  costBaseline: number;
  maxCost: number | null;
  /** Tokens del evaluador acumulados en los chequeos. */
  tokens: GoalTokens;
  lastVerdict: GoalVerdict | null;
  /** Huella de la conversación en el último chequeo; detecta repeticiones sin progreso. */
  lastFingerprint: string | null;
  createdAt: number;
  updatedAt: number;
};
/** Decisión ya estrechada por el adaptador (sin tipos del SDK). */
export type GoalDecisionResult = {
  verdict: GoalVerdict | null;
  confidence: number | null;
  cost: number;
  tokens: GoalTokens;
  /** Motivo cuando el evaluador devolvió un error en vez de una elección. */
  error: string | null;
};
/** Petición a `generate.decisions`, con la forma que consume el servidor. */
export type GoalDecisionRequest = {
  model: { providerID: string; id: string; variant?: string };
  input: { type: "text"; text: string }[];
  questions: {
    type: "choice";
    name: string;
    instructions: string;
    choices: { value: GoalVerdict; description: string }[];
  }[];
};
export type GoalMessage = { id: string; role: "user" | "assistant"; text: string };
export type GoalCreateInput = {
  text: string;
  maxTurns?: number;
  maxCost?: number | null;
  now: number;
  /** Coste acumulado de la sesión al crear el objetivo. */
  sessionCost?: number;
};
export function clampTurns(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GOAL_TURNS;
  return Math.min(MAX_GOAL_TURNS, Math.max(1, Math.round(value)));
}
export function createGoal(input: GoalCreateInput): Goal {
  const baseline = Number.isFinite(input.sessionCost) ? Math.max(0, input.sessionCost ?? 0) : 0;
  return {
    text: input.text.trim(),
    status: "active",
    turns: 0,
    maxTurns: clampTurns(input.maxTurns ?? DEFAULT_GOAL_TURNS),
    cost: 0,
    costBaseline: baseline,
    maxCost:
      input.maxCost !== null && input.maxCost !== undefined && Number.isFinite(input.maxCost)
        ? Math.max(0, input.maxCost)
        : null,
    tokens: { input: 0, output: 0 },
    lastVerdict: null,
    lastFingerprint: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
/** Edita texto y límites sin tocar turnos, gasto ni estado. */
export function editGoal(
  goal: Goal,
  input: { text: string; maxTurns: number; maxCost: number | null; now: number },
): Goal {
  return {
    ...goal,
    text: input.text.trim(),
    maxTurns: clampTurns(input.maxTurns),
    maxCost:
      input.maxCost !== null && Number.isFinite(input.maxCost) ? Math.max(0, input.maxCost) : null,
    // El criterio cambió: la próxima evaluación no debe heredar la guarda de
    // repetición de la conversación anterior.
    lastVerdict: null,
    lastFingerprint: null,
    updatedAt: input.now,
  };
}
export function pauseGoal(goal: Goal, now: number): Goal {
  if (goal.status !== "active") return goal;
  return { ...goal, status: "paused", updatedAt: now };
}
/**
 * Reactiva un objetivo pausado, bloqueado o agotado. Limpia la última decisión
 * para que la guarda de repetición no lo detenga en el primer chequeo nuevo.
 */
export function resumeGoal(goal: Goal, now: number): Goal {
  if (goal.status === "done") return goal;
  return {
    ...goal,
    status: "active",
    lastVerdict: null,
    lastFingerprint: null,
    updatedAt: now,
  };
}
export function isGoalActive(goal: Goal | null): goal is Goal {
  return goal?.status === "active";
}
/** Primer modelo habilitado con capacidad de decisión (los de chat no valen). */
export function pickDecisionModel(
  models: {
    providerID: string;
    id: string;
    type?: string;
    enabled?: boolean;
  }[],
): { providerID: string; id: string } | null {
  const model = models.find((item) => item.type === "decision" && item.enabled !== false);
  return model ? { providerID: model.providerID, id: model.id } : null;
}
/** Límite alcanzado que impide continuar, si lo hay. */
export function goalLimitReason(goal: Goal): "max-turns" | "max-cost" | null {
  if (goal.turns >= goal.maxTurns) return "max-turns";
  if (goal.maxCost !== null && goal.cost >= goal.maxCost) return "max-cost";
  return null;
}
/** Texto del aviso nativo al parar o terminar el bucle. */
export function describeGoalStop(
  goal: Goal,
  reason: GoalStopReason,
): {
  title: string;
  body: string;
} {
  const progress = `${goal.turns}/${goal.maxTurns} turnos`;
  switch (reason) {
    case "done":
      return { title: "Objetivo cumplido", body: `«${goal.text}» · ${progress}` };
    case "blocked":
      return { title: "Objetivo bloqueado", body: `«${goal.text}» necesita tu intervención` };
    case "max-turns":
      return { title: "Objetivo agotado", body: `«${goal.text}» · ${progress}` };
    case "max-cost":
      return {
        title: "Objetivo agotado por coste",
        body: `«${goal.text}» · $${goal.cost.toFixed(3)} gastados`,
      };
    case "repeated-decision":
      return {
        title: "Objetivo detenido",
        body: `«${goal.text}» · el evaluador repite la decisión sin progreso`,
      };
    case "turn-failed":
      return { title: "Objetivo pausado", body: `«${goal.text}» · el turno falló` };
    case "user-stopped":
      return { title: "Objetivo pausado", body: `«${goal.text}» · paraste el turno` };
    case "no-decision":
      return { title: "Objetivo pausado", body: `«${goal.text}» · no se pudo evaluar` };
    case "pending-request":
    case "inactive":
      return { title: "Objetivo", body: `«${goal.text}»` };
  }
}
export type GoalStopReason =
  | "done"
  | "blocked"
  | "max-turns"
  | "max-cost"
  | "repeated-decision"
  | "pending-request"
  | "user-stopped"
  | "turn-failed"
  | "no-decision"
  | "inactive";
export type GoalAction =
  | { kind: "continue"; prompt: string }
  /** No hay que hacer nada todavía; el objetivo sigue igual. */
  | { kind: "wait"; reason: "pending-request" | "inactive" }
  | { kind: "stop"; reason: GoalStopReason };
export type GoalAdvanceInput = {
  decision: GoalDecisionResult | null;
  /** Coste acumulado de la sesión tras el turno. */
  sessionCost: number;
  /** Hay un permiso o una pregunta esperando respuesta. */
  pendingRequest: boolean;
  /** El usuario paró el turno a mano. */
  userStopped: boolean;
  /** El turno terminó con error. */
  turnFailed: boolean;
  /** Huella de la conversación al cerrar el turno. */
  fingerprint: string;
  now: number;
};
function accumulateCost(goal: Goal, sessionCost: number): number {
  const spent = Math.max(0, sessionCost - goal.costBaseline);
  return Math.round(Math.max(goal.cost, spent) * 1e6) / 1e6;
}
function addTokens(goal: Goal, decision: GoalDecisionResult | null): GoalTokens {
  if (!decision) return goal.tokens;
  return {
    input: goal.tokens.input + decision.tokens.input,
    output: goal.tokens.output + decision.tokens.output,
  };
}
function stop(
  goal: Goal,
  reason: GoalStopReason,
  status: GoalStatus,
): {
  goal: Goal;
  action: GoalAction;
} {
  return {
    goal: { ...goal, status, updatedAt: goal.updatedAt },
    action: { kind: "stop", reason },
  };
}
/**
 * Avanza el objetivo con el cierre de un turno. Devuelve el estado siguiente y
 * la acción que debe ejecutar el hook. No hace I/O ni mira relojes: recibe la
 * decisión, el coste y las guardas ya resueltas.
 */
export function advanceGoal(
  goal: Goal,
  input: GoalAdvanceInput,
): { goal: Goal; action: GoalAction } {
  if (goal.status !== "active") {
    return { goal, action: { kind: "wait", reason: "inactive" } };
  }
  if (input.pendingRequest) {
    return { goal, action: { kind: "wait", reason: "pending-request" } };
  }
  const turns = goal.turns + 1;
  const cost = accumulateCost(goal, input.sessionCost);
  const tokens = addTokens(goal, input.decision);
  const base: Goal = { ...goal, turns, cost, tokens, updatedAt: input.now };
  if (input.userStopped) {
    return stop({ ...base, status: "paused" }, "user-stopped", "paused");
  }
  if (input.turnFailed) {
    return stop({ ...base, status: "paused" }, "turn-failed", "paused");
  }
  const decision = input.decision;
  if (!decision?.verdict) {
    return stop({ ...base, status: "paused" }, "no-decision", "paused");
  }
  const decided: Goal = { ...base, lastVerdict: decision.verdict };
  if (decision.verdict === "done") {
    return stop({ ...decided, status: "done" }, "done", "done");
  }
  if (decision.verdict === "blocked") {
    return stop({ ...decided, status: "blocked" }, "blocked", "blocked");
  }
  if (turns >= decided.maxTurns) {
    return stop({ ...decided, status: "exhausted" }, "max-turns", "exhausted");
  }
  if (decided.maxCost !== null && cost >= decided.maxCost) {
    return stop({ ...decided, status: "exhausted" }, "max-cost", "exhausted");
  }
  if (goal.lastVerdict === "continue" && goal.lastFingerprint === input.fingerprint) {
    return stop({ ...decided, status: "blocked" }, "repeated-decision", "blocked");
  }
  const next: Goal = { ...decided, lastFingerprint: input.fingerprint };
  return { goal: next, action: { kind: "continue", prompt: goalContinuation(next) } };
}
/** Texto breve que recuerda el objetivo y el límite al agente. */
export function goalContinuation(goal: Goal): string {
  return [
    `Continúa con el objetivo: «${goal.text}».`,
    `Llevas ${goal.turns} de ${goal.maxTurns} turnos.`,
    "Revisa el estado actual, completa lo que falte y verifica el resultado antes de terminar.",
  ].join(" ");
}
/** Huella estable de la conversación: cambia si entran mensajes o crece el último. */
export function conversationFingerprint(messages: GoalMessage[]): string {
  const tail = messages
    .slice(-3)
    .map((message) => `${message.id}:${message.text.length}`)
    .join("|");
  return `${messages.length}|${tail}`;
}
/**
 * Petición de evaluación: objetivo + resumen recortado por caracteres (≈4
 * caracteres por token) de los mensajes más recientes.
 */
export function goalDecisionRequest(
  goal: Goal,
  messages: GoalMessage[],
  model: GoalDecisionRequest["model"],
  maxChars = 12_000,
): GoalDecisionRequest {
  const header = [
    `OBJETIVO: ${goal.text}`,
    `TURNOS: ${goal.turns} de ${goal.maxTurns}`,
    `COSTE ACUMULADO: $${goal.cost.toFixed(3)}`,
    "CONVERSACIÓN (más reciente al final):",
  ].join("\n");
  let budget = Math.max(500, maxChars) - header.length;
  const lines: string[] = [];
  for (let index = messages.length - 1; index >= 0 && budget > 0; index -= 1) {
    const message = messages[index];
    const text = message.text.trim();
    if (!text) continue;
    const label = message.role === "user" ? "usuario" : "agente";
    const line = `[${label}] ${text}`;
    if (line.length <= budget) {
      lines.unshift(line);
      budget -= line.length + 1;
      continue;
    }
    lines.unshift(`${line.slice(0, Math.max(0, budget))}…`);
    budget = 0;
  }
  const conversation = lines.length > 0 ? lines.join("\n") : "(sin mensajes todavía)";
  return {
    model,
    input: [{ type: "text", text: `${header}\n${conversation}` }],
    questions: [
      {
        type: "choice",
        name: GOAL_DECISION_NAME,
        instructions:
          "Evalúa si el agente ha cumplido el objetivo a partir de la conversación. " +
          "Elige «done» solo si hay evidencia de que el criterio se cumple; «continue» si " +
          "queda trabajo que el agente puede hacer solo; «blocked» si necesita una decisión, " +
          "una credencial o información que solo puede aportar el usuario.",
        choices: [
          { value: "continue", description: "Queda trabajo que el agente puede hacer solo" },
          { value: "done", description: "El objetivo está cumplido" },
          { value: "blocked", description: "Bloqueado a la espera del usuario" },
        ],
      },
    ],
  };
}
const STATUSES: GoalStatus[] = ["active", "paused", "done", "blocked", "exhausted"];
function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function verdict(value: unknown): GoalVerdict | null {
  return typeof value === "string" && (GOAL_VERDICTS as readonly string[]).includes(value)
    ? (value as GoalVerdict)
    : null;
}
/** Serializa el objetivo para preferences; JSON plano, sin campos derivados. */
export function serializeGoal(goal: Goal): string {
  return JSON.stringify(goal);
}
/** Lee un objetivo persistido; devuelve null si falta o está corrupto. */
export function parseGoal(raw: string | null): Goal | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!data || typeof data.text !== "string" || !data.text.trim()) return null;
    if (typeof data.status !== "string" || !STATUSES.includes(data.status as GoalStatus)) {
      return null;
    }
    const tokens = (data.tokens ?? {}) as Record<string, unknown>;
    const createdAt = number(data.createdAt);
    return {
      text: data.text.trim(),
      status: data.status as GoalStatus,
      turns: Math.max(0, Math.round(number(data.turns))),
      maxTurns: clampTurns(number(data.maxTurns, DEFAULT_GOAL_TURNS)),
      cost: Math.max(0, number(data.cost)),
      costBaseline: Math.max(0, number(data.costBaseline)),
      maxCost:
        data.maxCost === null || data.maxCost === undefined
          ? null
          : Math.max(0, number(data.maxCost)),
      tokens: {
        input: Math.max(0, Math.round(number(tokens.input))),
        output: Math.max(0, Math.round(number(tokens.output))),
      },
      lastVerdict: verdict(data.lastVerdict),
      lastFingerprint: typeof data.lastFingerprint === "string" ? data.lastFingerprint : null,
      createdAt,
      updatedAt: number(data.updatedAt, createdAt),
    };
  } catch {
    return null;
  }
}
