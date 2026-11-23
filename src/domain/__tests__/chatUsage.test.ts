// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  activityBars,
  budgetAlertMessage,
  budgetDay,
  budgetLevel,
  budgetRatio,
  cacheRatio,
  contextRatio,
  crossedBudgetThresholds,
  formatActivityDay,
  formatCost,
  formatCount,
  formatTokens,
  parseBudgetUsd,
  sortModelUsage,
  toSessionUsage,
  totalTokens,
  usageStatsInput,
  type SessionUsage,
  type UsageModelBreakdown,
  type UsageTokens,
} from "../chat/usage";

const usage: SessionUsage = {
  cost: 0.02,
  input: 1000,
  output: 200,
  cacheRead: 3000,
  cacheWrite: 500,
  model: { providerID: "anthropic", id: "claude" },
};

describe("toSessionUsage", () => {
  const assistant = {
    type: "assistant",
    cost: 0.01,
    tokens: { input: 1000, output: 200, cache: { read: 3000, write: 500 } },
    model: { providerID: "anthropic", id: "claude" },
  };

  test("toma el primer asistente con tokens (lista en orden desc)", () => {
    const newer = {
      type: "assistant",
      cost: 0.5,
      tokens: { input: 1, output: 1, cache: { read: 0, write: 0 } },
    };
    const result = toSessionUsage([newer, assistant], null);
    expect(result?.input).toBe(1);
  });

  test("coste: info > assistant > 0", () => {
    expect(toSessionUsage([assistant], { cost: 0.9 })?.cost).toBe(0.9);
    expect(toSessionUsage([assistant], null)?.cost).toBe(0.01);
    expect(toSessionUsage([{ ...assistant, cost: undefined }], null)?.cost).toBe(0);
  });

  test("sin asistente con tokens → null", () => {
    expect(toSessionUsage([], null)).toBeNull();
    expect(toSessionUsage([{ type: "user" }], null)).toBeNull();
    expect(toSessionUsage([{ type: "assistant" }], null)).toBeNull();
  });

  test("model ausente → null", () => {
    const { model, ...withoutModel } = assistant;
    expect(toSessionUsage([withoutModel], null)?.model).toBeNull();
    expect(model).toBeDefined();
  });
});

describe("contextRatio", () => {
  test("used = input + cacheRead + cacheWrite sobre el límite", () => {
    expect(contextRatio(usage, 9000)).toBeCloseTo(4500 / 9000);
  });

  test("null sin sesión o sin límite (0 incluido)", () => {
    expect(contextRatio(null, 9000)).toBeNull();
    expect(contextRatio(usage, null)).toBeNull();
    expect(contextRatio(usage, undefined)).toBeNull();
    expect(contextRatio(usage, 0)).toBeNull();
  });
});

describe("cacheRatio", () => {
  test("cacheRead / (input + cacheRead)", () => {
    expect(cacheRatio(usage)).toBeCloseTo(3000 / 4000);
  });

  test("null sin sesión o sin tokens de entrada", () => {
    expect(cacheRatio(null)).toBeNull();
    expect(cacheRatio({ ...usage, input: 0, cacheRead: 0 })).toBeNull();
  });
});

describe("usageStatsInput", () => {
  test("7 y 30 días son ventanas móviles con to=now y tools none", () => {
    expect(usageStatsInput("7d", 10_000_000_000, "Europe/Madrid")).toEqual({
      from: 10_000_000_000 - 7 * 86_400_000,
      to: 10_000_000_000,
      timezone: "Europe/Madrid",
      tools: "none",
    });
    expect(usageStatsInput("30d", 10_000_000_000)).toEqual({
      from: 10_000_000_000 - 30 * 86_400_000,
      to: 10_000_000_000,
      timezone: undefined,
      tools: "none",
    });
  });

  test("total omite los extremos para usar todo el historial", () => {
    expect(usageStatsInput("total", 1, "UTC")).toEqual({ timezone: "UTC", tools: "none" });
  });
});

describe("formato de números", () => {
  test("coste: tres decimales solo por debajo de 1 y miles agrupados", () => {
    expect(formatCost(0)).toBe("$0.000");
    expect(formatCost(0.0123)).toBe("$0.012");
    expect(formatCost(0.5)).toBe("$0.500");
    expect(formatCost(1)).toBe("$1.00");
    expect(formatCost(12.345)).toBe("$12.35");
    expect(formatCost(1234.5)).toBe("$1,234.50");
  });

  test("tokens: agrupa hasta 9.999 y abrevia con k/M", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(6710)).toBe("6,710");
    expect(formatTokens(12_345)).toBe("12.3k");
    expect(formatTokens(100_000)).toBe("100.0k");
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });

  test("contadores enteros con separador de miles", () => {
    expect(formatCount(12_345)).toBe("12,345");
    expect(formatCount(Number.NaN)).toBe("0");
  });

  test("día de actividad y suma de tokens", () => {
    expect(formatActivityDay("2026-11-23")).toBe("23/11");
    expect(formatActivityDay("sin-fecha")).toBe("sin-fecha");
    const tokens: UsageTokens = {
      input: 10,
      output: 5,
      reasoning: 2,
      cache: { read: 3, write: 1 },
    };
    expect(totalTokens(tokens)).toBe(21);
  });
});

describe("actividad y modelos", () => {
  test("normaliza las barras al día con más pasos y recorta al límite", () => {
    expect(
      activityBars(
        [
          { date: "2026-11-20", steps: 1 },
          { date: "2026-11-21", steps: 4 },
          { date: "2026-11-22", steps: 2 },
        ],
        2,
      ),
    ).toEqual([
      { date: "2026-11-21", steps: 4, ratio: 1 },
      { date: "2026-11-22", steps: 2, ratio: 0.5 },
    ]);
    expect(activityBars([{ date: "2026-11-20", steps: 0 }])[0]?.ratio).toBe(0);
    expect(activityBars([], 10)).toEqual([]);
    expect(activityBars([{ date: "2026-11-20", steps: 1 }], 0)).toEqual([]);
  });

  test("ordena el desglose por coste, luego pasos y clave estable", () => {
    const tokens: UsageTokens = {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    };
    const model = (id: string, cost: number, steps: number): UsageModelBreakdown => ({
      model: { providerID: "p", id },
      steps,
      tokens,
      cost,
    });
    const sorted = sortModelUsage([model("b", 1, 2), model("a", 1, 2), model("c", 2, 1)]);
    expect(sorted.map((entry) => entry.model.id)).toEqual(["c", "a", "b"]);
  });
});

describe("presupuesto", () => {
  test("parsea importes positivos y descarta vacío, cero o inválido", () => {
    expect(parseBudgetUsd(" 12,5 ")).toBe(12.5);
    expect(parseBudgetUsd("20")).toBe(20);
    expect(parseBudgetUsd("")).toBeNull();
    expect(parseBudgetUsd("0")).toBeNull();
    expect(parseBudgetUsd("-3")).toBeNull();
    expect(parseBudgetUsd("abc")).toBeNull();
    expect(parseBudgetUsd(null)).toBeNull();
  });

  test("ratio y nivel: aviso al 80 % y superado al 100 %", () => {
    expect(budgetRatio(5, 10)).toBe(0.5);
    expect(budgetRatio(5, null)).toBeNull();
    expect(budgetRatio(-5, 10)).toBe(0);
    expect(budgetLevel(7.9, 10)).toBe("ok");
    expect(budgetLevel(8, 10)).toBe("warning");
    expect(budgetLevel(10, 10)).toBe("over");
    expect(budgetLevel(1, null)).toBeNull();
  });

  test("umbrales alcanzados y aviso único por umbral", () => {
    expect(crossedBudgetThresholds(5, 10)).toEqual([]);
    expect(crossedBudgetThresholds(8, 10)).toEqual([0.8]);
    expect(crossedBudgetThresholds(12, 10)).toEqual([0.8, 1]);
    expect(crossedBudgetThresholds(12, null)).toEqual([]);
    expect(
      budgetAlertMessage({ workspaceName: "Demo", threshold: 1, cost: 12, budget: 10 }),
    ).toEqual({
      title: "Demo · presupuesto",
      body: "Presupuesto superado: $12.00 de $10.00.",
    });
    expect(
      budgetAlertMessage({ workspaceName: "Demo", threshold: 0.8, cost: 8, budget: 10 }),
    ).toEqual({
      title: "Demo · presupuesto",
      body: "Vas al 80% del presupuesto: $8.00 de $10.00.",
    });
  });

  test("día de deduplicación por zona horaria", () => {
    const now = Date.UTC(2026, 10, 23, 23, 30);
    expect(budgetDay(now, "UTC")).toBe("2026-11-23");
    expect(budgetDay(now, "Europe/Madrid")).toBe("2026-11-24");
    expect(budgetDay(Number.NaN)).toBe("");
  });
});
