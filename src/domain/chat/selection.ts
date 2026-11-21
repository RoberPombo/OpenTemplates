/**
 * Catálogo de modelos/agentes del workspace y resolución de la selección.
 * Prioridad de modelo: actual > guardado > workspace > default del servidor > primero.
 * Prioridad de agente: actual > guardado > "build" > primero.
 */

export type ModelOption = {
  key: string;
  providerID: string;
  id: string;
  name: string;
  variants: string[];
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

export function toModelOptions(list: CatalogModel[]): ModelOption[] {
  return list
    .filter((model) => model.enabled !== false && (!model.type || model.type === "chat"))
    .map((model) => ({
      key: modelKey(model),
      providerID: model.providerID,
      id: model.id,
      name: model.name,
      variants: model.variants.map((variant) => variant.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
