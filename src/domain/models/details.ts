/**
 * Ficha de un modelo accesible desde las suscripciones configuradas. Es común
 * al selector del chat (catálogo del servidor) y al de templates (CLI y caché
 * de models.dev), para que ambos muestren la misma información.
 */
export type ModelCost = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
};

export type ModelLimit = {
  context?: number;
  input?: number;
  output?: number;
};

export type ModelDetails = {
  key: string;
  providerID: string;
  id: string;
  name: string;
  description?: string;
  family?: string;
  reasoning?: boolean;
  tools?: boolean;
  attachment?: boolean;
  temperature?: boolean;
  inputModalities: string[];
  outputModalities: string[];
  cost?: ModelCost;
  limit?: ModelLimit;
  /** Corte de conocimiento, en `YYYY-MM` o `YYYY-MM-DD`. */
  knowledge?: string;
  /** Fecha de lanzamiento, en `YYYY-MM-DD`. */
  releaseDate?: string;
  lastUpdated?: string;
  status?: string;
  openWeights?: boolean;
};
