/**
 * Catálogo de modelos/agentes del workspace y resolución de la selección.
 * Prioridad de modelo: actual > guardado > workspace > default del servidor > primero.
 * Prioridad de agente: actual > guardado > "build" > primero.
 */
import type { ModelDetails } from "../models/details";

export type ModelOption = {
  key: string;
  providerID: string;
  id: string;
  name: string;
  variants: string[];
  details?: ModelDetails;
};

export type AgentOption = {
  id: string;
  name: string;
};

/** Forma estructural del catálogo del servidor (sin tipos del cliente). */
export type CatalogModel = {
  providerID: string;
  id: string;
  modelID?: string;
  name: string;
  enabled?: boolean;
  type?: string;
  variants: { id: string }[];
  limit?: { context?: number } | null;
  details?: ModelDetails;
};

export type CatalogAgent = {
  id: string;
  name: string;
  hidden?: boolean;
  mode?: string;
};

export function modelKey(model: { providerID: string; id: string }): string {
  return `${model.providerID}/${model.id}`;
}
/** Nombre visible de un modelo del catálogo; cae al id si ya no está. */
export function modelLabel(
  models: ModelOption[],
  model: { providerID: string; id: string } | undefined,
): string {
  if (!model) return "";
  return (
    models.find((item) => item.providerID === model.providerID && item.id === model.id)?.name ??
    model.id
  );
}
/** Nombre visible de un agente del catálogo; cae al id si ya no está. */
export function agentLabel(agents: AgentOption[], id: string | undefined): string {
  if (!id) return "";
  return agents.find((agent) => agent.id === id)?.name ?? id;
}
/** Agrupa el catálogo por proveedor conservando el orden de llegada. */
export function groupModelsByProvider(models: ModelOption[]): Array<[string, ModelOption[]]> {
  const groups = new Map<string, ModelOption[]>();
  for (const model of models) {
    const list = groups.get(model.providerID) ?? [];
    list.push(model);
    groups.set(model.providerID, list);
  }
  return [...groups.entries()];
}
/**
 * `providerID/modelID` → referencia. Devuelve `null` si falta el separador o
 * alguna de las dos partes; es la misma regla para perfil, feature y sesión.
 */
export function parseModelRef(
  raw: string | null | undefined,
): { providerID: string; id: string } | null {
  const value = raw?.trim();
  if (!value) return null;
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return null;
  return { providerID: value.slice(0, slash), id: value.slice(slash + 1) };
}

export function toModelOptions(list: CatalogModel[]): ModelOption[] {
  return list
    .filter((model) => model.enabled !== false && (!model.type || model.type === "chat"))
    .map((model) => ({
      key: modelKey(model),
      providerID: model.providerID,
      id: model.id,
      name: model.name,
      variants: model.variants.map((variant) => variant.id),
      details: model.details,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Limita el catálogo a los modelos permitidos por el workspace. Si el servidor
 * no ofrece ninguno de los permitidos (proveedor sin credenciales o catálogo
 * todavía caliente), devuelve el catálogo completo para no bloquear el selector.
 */
export function selectWorkspaceModels(
  options: ModelOption[],
  allowed: string[] | null | undefined,
): ModelOption[] {
  const keys = new Set(allowed ?? []);
  if (keys.size === 0) return options;
  const filtered = options.filter((model) => keys.has(model.key));
  return filtered.length > 0 ? filtered : options;
}

export function toAgentOptions(list: CatalogAgent[]): AgentOption[] {
  return list
    .filter((agent) => !agent.hidden && agent.mode !== "subagent")
    .map((agent) => ({ id: agent.id, name: agent.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveModelChoice(input: {
  current: string;
  saved: string | null;
  workspaceModel: string | null | undefined;
  serverDefault: { providerID: string; id: string } | null;
  options: ModelOption[];
}): string {
  const { current, saved, workspaceModel, serverDefault, options } = input;
  const available = (key: string) => options.some((model) => model.key === key);
  if (current && available(current)) return current;
  if (saved && available(saved)) return saved;
  const fromWorkspace = workspaceModel?.trim() || "";
  if (fromWorkspace && available(fromWorkspace)) return fromWorkspace;
  if (serverDefault) {
    const fallback = modelKey(serverDefault);
    if (available(fallback)) return fallback;
  }
  return options[0]?.key ?? "";
}

export function resolveAgentChoice(input: {
  current: string;
  saved: string | null;
  options: AgentOption[];
}): string {
  const { current, saved, options } = input;
  const available = (id: string) => options.some((agent) => agent.id === id);
  if (current && available(current)) return current;
  if (saved && available(saved)) return saved;
  if (available("build")) return "build";
  return options[0]?.id ?? "";
}

/** La variante solo vale si el modelo seleccionado la soporta. */
export function effectiveVariant(variant: string, model: ModelOption | null | undefined): string {
  if (!variant) return "";
  return model?.variants.includes(variant) ? variant : "";
}
