/**
 * Estimación de tokens y coste de una carrera antes de lanzarla. No conoce el
 * estado de la carrera ni la UI: recibe el prompt y los precios del catálogo.
 */
import type { ModelDetails } from "../models/details";

/** Tokens de salida que se asumen al estimar el coste antes de lanzar. */
export const RACE_OUTPUT_TOKEN_ESTIMATE = 1200;
/** Margen de tokens de sistema/contexto que se suma al prompt estimado. */
export const RACE_PROMPT_OVERHEAD_TOKENS = 2000;

/** Tokens de entrada aproximados: texto/4 más el margen de sistema. */
export function estimateInputTokens(prompt: string): number {
  return Math.max(1, Math.ceil(prompt.trim().length / 4)) + RACE_PROMPT_OVERHEAD_TOKENS;
}

/** Coste estimado de una corrida; `null` si el catálogo no da precios. */
export function estimateRunCost(
  details: ModelDetails | undefined,
  prompt: string,
  outputTokens = RACE_OUTPUT_TOKEN_ESTIMATE,
): number | null {
  const cost = details?.cost;
  if (!cost) return null;
  const input = cost.input;
  const output = cost.output;
  if (input === undefined && output === undefined) return null;
  const inputTokens = estimateInputTokens(prompt);
  return ((input ?? 0) * inputTokens + (output ?? 0) * outputTokens) / 1_000_000;
}

export type RaceEstimate = {
  perRun: Array<number | null>;
  total: number | null;
};

/** Estimación por corrida y total; el total solo si todos los precios existen. */
export function estimateRaceCost(
  details: Array<ModelDetails | undefined>,
  prompt: string,
  outputTokens = RACE_OUTPUT_TOKEN_ESTIMATE,
): RaceEstimate {
  const perRun = details.map((model) => estimateRunCost(model, prompt, outputTokens));
  if (perRun.length === 0 || perRun.some((value) => value === null)) {
    return { perRun, total: null };
  }
  return { perRun, total: perRun.reduce<number>((sum, value) => sum + (value ?? 0), 0) };
}
