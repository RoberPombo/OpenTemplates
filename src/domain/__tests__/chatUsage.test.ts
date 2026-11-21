// @vitest-environment node
import { describe, expect, test } from "vitest";
import { cacheRatio, contextRatio, toSessionUsage, type SessionUsage } from "../chat/usage";

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
