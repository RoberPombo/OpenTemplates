import { describe, expect, test } from "vitest";
import type { ModelDetails } from "../models/details";
import { estimateRaceCost, estimateRunCost } from "../race/estimate";

describe("estimación de coste", () => {
  const details = (input: number, output: number): ModelDetails => ({
    key: "anthropic/claude",
    providerID: "anthropic",
    id: "claude",
    name: "Claude",
    inputModalities: [],
    outputModalities: [],
    cost: { input, output },
  });

  test("suma prompt y tokens de salida con los precios por millón", () => {
    // 40 caracteres → 10 tokens + 2000 de margen; 1200 de salida.
    const cost = estimateRunCost(details(3, 15), "x".repeat(40));
    expect(cost).toBeCloseTo((2010 * 3 + 1200 * 15) / 1_000_000, 8);
  });

  test("sin precios devuelve null; el total exige todos", () => {
    expect(estimateRunCost({ ...details(0, 0), cost: undefined }, "hola")).toBeNull();
    expect(estimateRunCost(details(3, 15), "")).toBeGreaterThan(0);
    const partial = estimateRaceCost([details(3, 15), undefined], "hola");
    expect(partial.perRun[1]).toBeNull();
    expect(partial.total).toBeNull();
    const total = estimateRaceCost([details(1, 2), details(2, 4)], "hola");
    expect(total.total).toBeGreaterThan(0);
  });
});
