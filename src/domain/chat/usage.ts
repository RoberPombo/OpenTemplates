/**
 * Uso de la sesión y del workspace: mapeo desde los mensajes del servidor,
 * ratios del inspector, agregación de `session.stats` y formato de números.
 */

export type SessionUsage = {
  cost: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  model: { providerID: string; id: string } | null;
};

export type RawAssistantMessage = {
  type?: string;
  cost?: number;
  tokens?: {
    input: number;
    output: number;
    cache: { read: number; write: number };
  };
  model?: { providerID: string; id: string };
};

/** Primer asistente con tokens (la lista llega en orden descendente). */
export function toSessionUsage(
  messages: RawAssistantMessage[],
  info: { cost?: number } | null,
): SessionUsage | null {
  const assistant = messages.find((item) => item.type === "assistant" && item.tokens);
  if (!assistant?.tokens) return null;
  return {
    cost: info?.cost ?? assistant.cost ?? 0,
    input: assistant.tokens.input,
    output: assistant.tokens.output,
    cacheRead: assistant.tokens.cache.read,
    cacheWrite: assistant.tokens.cache.write,
    model: assistant.model ?? null,
  };
}

export function contextRatio(
  session: SessionUsage | null,
  contextLimit: number | null | undefined,
): number | null {
  if (!session || !contextLimit) return null;
  const used = session.input + session.cacheRead + session.cacheWrite;
  return used / contextLimit;
}

export function cacheRatio(session: SessionUsage | null): number | null {
  if (!session) return null;
  const total = session.input + session.cacheRead;
  return total > 0 ? session.cacheRead / total : null;
}

/** Medidor de consumo de una ventana (rolling/semanal/mensual). */
export type UsageMeter = { percent: number; resetsAt: number };

/** Presupuesto de gasto con su ventana de reinicio. */
export type UsageBudget = { id: string; limit: number; spent: number; resetsAt: number };

/** Límites de uso del proveedor que pinta el inspector. */
export type UsageLimits = {
  go?: {
    rolling?: UsageMeter | null;
    weekly?: UsageMeter | null;
    monthly?: UsageMeter | null;
  } | null;
  budgets?: UsageBudget[] | null;
};

/** Contadores de tokens tal como los agrupa `session.stats`. */
export type UsageTokens = {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
};

/** Modelo que consumió tokens; `variant` solo aparece si el servidor lo separa. */
export type UsageModelRef = {
  providerID: string;
  id: string;
  variant?: string;
};

export type UsageModelBreakdown = {
  model: UsageModelRef;
  steps: number;
  tokens: UsageTokens;
  cost: number;
};

export type UsageActivityDay = { date: string; steps: number };

/** Consumo acumulado de un workspace (`session.stats`) ya estrechado. */
export type WorkspaceStats = {
  range: { from: number; to: number };
  sessions: number;
  subagents: number;
  prompts: number;
  steps: number;
  tokens: UsageTokens;
  cost: number;
  activeDays: number;
  streak: number;
  activity: UsageActivityDay[];
  models: UsageModelBreakdown[];
};

/** Rangos que ofrece el Inspector para el consumo acumulado. */
export type UsageRange = "7d" | "30d" | "total";

/** Parámetros de `session.stats`; `tools: "none"` evita traer el detalle de tools. */
export type UsageStatsInput = {
  from?: number;
  to?: number;
  timezone?: string;
  tools?: "none" | "summary" | "detail";
};

const DAY_MS = 86_400_000;

/**
 * Ventana de consulta para un rango. Los rangos son móviles (desde `now`), no
 * naturales; `total` omite los extremos para que el servidor use todo el
 * historial del workspace.
 */
export function usageStatsInput(
  range: UsageRange,
  now: number,
  timezone?: string,
): UsageStatsInput {
  const base: UsageStatsInput = { timezone, tools: "none" };
  if (range === "total") return base;
  const days = range === "7d" ? 7 : 30;
  return { ...base, from: now - days * DAY_MS, to: now };
}

/** Serializa un importe de presupuesto; vacío, cero, negativo o inválido → null. */
export function parseBudgetUsd(value: string | null | undefined): number | null {
  if (value == null) return null;
  const raw = value.trim().replace(",", ".");
  if (!raw) return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

/** Proporción gastada del presupuesto; null si no hay presupuesto válido. */
export function budgetRatio(cost: number, budget: number | null | undefined): number | null {
  if (budget == null || !Number.isFinite(budget) || budget <= 0) return null;
  if (!Number.isFinite(cost)) return null;
  return Math.max(0, cost) / budget;
}

export type BudgetLevel = "ok" | "warning" | "over";

/** Umbral de aviso visible y umbral de presupuesto superado. */
export const BUDGET_WARNING_RATIO = 0.8;
export const BUDGET_ALERT_THRESHOLDS = [BUDGET_WARNING_RATIO, 1] as const;

export function budgetLevel(cost: number, budget: number | null | undefined): BudgetLevel | null {
  const ratio = budgetRatio(cost, budget);
  if (ratio === null) return null;
  if (ratio >= 1) return "over";
  if (ratio >= BUDGET_WARNING_RATIO) return "warning";
  return "ok";
}

/** Umbrales alcanzados por el coste, para avisar una vez por umbral y día. */
export function crossedBudgetThresholds(cost: number, budget: number | null | undefined): number[] {
  const ratio = budgetRatio(cost, budget);
  if (ratio === null) return [];
  return BUDGET_ALERT_THRESHOLDS.filter((threshold) => ratio >= threshold);
}

/** Día local (`YYYY-MM-DD`) para deduplicar avisos de presupuesto. */
export function budgetDay(now: number, timezone?: string): string {
  const date = new Date(now);
  if (!Number.isFinite(now)) return "";
  if (timezone) {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
    } catch {
      // Zona horaria desconocida: se usa la local del navegador.
    }
  }
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Texto del aviso nativo; el componente decide cuándo enviarlo. */
export function budgetAlertMessage(input: {
  workspaceName: string;
  threshold: number;
  cost: number;
  budget: number;
}): { title: string; body: string } {
  const percent = Math.round((budgetRatio(input.cost, input.budget) ?? 0) * 100);
  return {
    title: `${input.workspaceName} · presupuesto`,
    body:
      input.threshold >= 1
        ? `Presupuesto superado: ${formatCost(input.cost)} de ${formatCost(input.budget)}.`
        : `Vas al ${percent}% del presupuesto: ${formatCost(input.cost)} de ${formatCost(input.budget)}.`,
  };
}

/** Suma de todos los tokens contabilizados (entrada, salida, razonamiento y caché). */
export function totalTokens(tokens: UsageTokens): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}

export type UsageActivityBar = UsageActivityDay & { ratio: number };

/**
 * Barras de actividad normalizadas al día con más pasos. Se muestran los
 * últimos `limit` días activos para que un rango total no infle el inspector.
 */
export function activityBars(activity: UsageActivityDay[], limit = 30): UsageActivityBar[] {
  if (limit <= 0) return [];
  const visible = activity.slice(-limit);
  const peak = visible.reduce((max, day) => Math.max(max, day.steps), 0);
  return visible.map((day) => ({
    ...day,
    ratio: peak > 0 ? Math.max(0, day.steps) / peak : 0,
  }));
}

/** Desglose por modelo ordenado por coste; empata por pasos y clave estable. */
export function sortModelUsage(models: UsageModelBreakdown[]): UsageModelBreakdown[] {
  return [...models].sort((a, b) => {
    if (b.cost !== a.cost) return b.cost - a.cost;
    if (b.steps !== a.steps) return b.steps - a.steps;
    return usageModelKey(a.model).localeCompare(usageModelKey(b.model));
  });
}

export function usageModelKey(model: UsageModelRef): string {
  return `${model.providerID}/${model.id}`;
}

const thousands = new Intl.NumberFormat("en-US");

/** Entero con separador de miles (`1,234`); nunca notación científica. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return thousands.format(Math.round(Math.max(0, value)));
}

/**
 * Tokens legibles: agrupados hasta 9.999 y abreviados con `k`/`M` a partir de
 * ahí, para que el inspector no muestre cifras de siete dígitos.
 */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  return formatCount(value);
}

/** Coste en USD: tres decimales solo por debajo de 1; el resto con dos y miles. */
export function formatCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.000";
  if (value < 1) return `$${value.toFixed(3)}`;
  const [integer, decimals] = value.toFixed(2).split(".");
  return `$${thousands.format(Number(integer))}.${decimals}`;
}

/** Etiqueta corta de un día de actividad (`2026-11-23` → `23/11`). */
export function formatActivityDay(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[3]}/${match[2]}` : date;
}
