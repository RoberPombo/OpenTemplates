/**
 * Estrechado de payloads del servidor opencode en la frontera.
 *
 * El puerto deja los datos en `unknown` a propósito; estas funciones son el
 * único lugar que conoce la forma del servidor y la convierten a los tipos
 * estructurales del dominio. Ante un payload inválido devuelven una entrada
 * vacía en vez de romper la UI.
 */
import type { RawPart, RawSessionMessage } from "../domain/chat/messages";
import type { CatalogAgent, CatalogModel } from "../domain/chat/selection";
import type { ModelCost, ModelDetails } from "../domain/models/details";
import type { UsageBudget, UsageLimits, UsageMeter } from "../domain/chat/usage";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function texts(value: unknown): string[] {
  return list(value).flatMap((item) => (typeof item === "string" ? [item] : []));
}

function toModelCost(value: unknown): ModelCost | undefined {
  const costs = list(value).flatMap((item) => {
    const entry = record(item);
    return entry ? [entry] : [];
  });
  const base = costs.find((entry) => !record(entry.tier)) ?? costs[0];
  if (!base) return undefined;
  const cache = record(base.cache);
  const input = count(base.input);
  const output = count(base.output);
  const cacheRead = count(cache?.read);
  const cacheWrite = count(cache?.write);
  if (
    input === undefined &&
    output === undefined &&
    cacheRead === undefined &&
    cacheWrite === undefined
  ) {
    return undefined;
  }
  return { input, output, cacheRead, cacheWrite };
}

/** Ficha del modelo con lo que expone el servidor (coste, límites, modalidades). */
function toModelDetails(
  model: Record<string, unknown>,
  providerID: string,
  id: string,
): ModelDetails {
  const capabilities = record(model.capabilities);
  const limit = record(model.limit);
  const released = count(record(model.time)?.released);
  const context = count(limit?.context);
  const inputLimit = count(limit?.input);
  const outputLimit = count(limit?.output);
  return {
    key: `${providerID}/${id}`,
    providerID,
    id,
    name: text(model.name) ?? id,
    family: text(model.family),
    status: text(model.status),
    tools: typeof capabilities?.tools === "boolean" ? capabilities.tools : undefined,
    temperature:
      typeof capabilities?.temperature === "boolean" ? capabilities.temperature : undefined,
    inputModalities: texts(capabilities?.input),
    outputModalities: texts(capabilities?.output),
    cost: toModelCost(model.cost),
    limit:
      context !== undefined || inputLimit !== undefined || outputLimit !== undefined
        ? { context, input: inputLimit, output: outputLimit }
        : undefined,
    releaseDate: released ? new Date(released).toISOString().slice(0, 10) : undefined,
  };
}

/** Modelos del catálogo del workspace (incluye límite de contexto para el inspector). */
export function toCatalogModels(payload: unknown): CatalogModel[] {
  return list(payload).flatMap((item) => {
    const model = record(item);
    if (!model) return [];
    const providerID = text(model.providerID);
    const id = text(model.id);
    if (!providerID || !id) return [];
    const limit = record(model.limit);
    return [
      {
        providerID,
        id,
        modelID: text(model.modelID),
        name: text(model.name) ?? id,
        enabled: typeof model.enabled === "boolean" ? model.enabled : undefined,
        type: text(model.type),
        variants: list(model.variants).flatMap((variant) => {
          const variantId = text(record(variant)?.id);
          return variantId ? [{ id: variantId }] : [];
        }),
        limit: limit ? { context: count(limit.context) } : null,
        details: toModelDetails(model, providerID, id),
      },
    ];
  });
}

/** Agentes del workspace, con los campos que filtra la selección. */
export function toCatalogAgents(payload: unknown): CatalogAgent[] {
  return list(payload).flatMap((item) => {
    const agent = record(item);
    if (!agent) return [];
    const id = text(agent.id);
    const name = text(agent.name);
    if (!id || !name) return [];
    return [
      {
        id,
        name,
        hidden: typeof agent.hidden === "boolean" ? agent.hidden : undefined,
        mode: text(agent.mode),
      },
    ];
  });
}

function toMeter(value: unknown): UsageMeter | null {
  const meter = record(value);
  if (!meter) return null;
  const percent = count(meter.percent);
  const resetsAt = count(meter.resetsAt);
  if (percent === undefined || resetsAt === undefined) return null;
  return { percent, resetsAt };
}

function toBudget(value: unknown): UsageBudget | null {
  const budget = record(value);
  if (!budget) return null;
  const id = text(budget.id);
  const limit = count(budget.limit);
  const spent = count(budget.spent);
  const resetsAt = count(budget.resetsAt);
  if (!id || limit === undefined || spent === undefined || resetsAt === undefined) return null;
  return { id, limit, spent, resetsAt };
}

/** Límites de uso del proveedor; `null` si el servidor no devuelve nada. */
export function toUsageLimits(payload: unknown): UsageLimits | null {
  const limits = record(payload);
  if (!limits) return null;
  const go = record(limits.go);
  return {
    go: go
      ? {
          rolling: toMeter(go.rolling),
          weekly: toMeter(go.weekly),
          monthly: toMeter(go.monthly),
        }
      : null,
    budgets: list(limits.budgets).flatMap((item) => {
      const budget = toBudget(item);
      return budget ? [budget] : [];
    }),
  };
}

function toRawPart(part: unknown): RawPart[] {
  const value = record(part);
  if (!value) return [];
  const state = record(value.state);
  return [
    {
      type: text(value.type),
      id: text(value.id),
      name: text(value.name),
      text: text(value.text),
      state: state
        ? { status: text(state.status), input: record(state.input) ?? undefined }
        : undefined,
    },
  ];
}

/** Mensajes de una sesión con la forma que consumen chat e inspector. */
export function toSessionMessages(payload: unknown): RawSessionMessage[] {
  return list(payload).flatMap((item) => {
    const message = record(item);
    if (!message) return [];
    const id = text(message.id);
    if (!id) return [];
    const time = record(message.time);
    const model = record(message.model);
    const providerID = text(model?.providerID);
    const modelID = text(model?.id);
    const tokens = record(message.tokens);
    const cache = record(tokens?.cache);
    const input = count(tokens?.input);
    const output = count(tokens?.output);
    const cacheRead = count(cache?.read);
    const cacheWrite = count(cache?.write);
    return [
      {
        type: text(message.type),
        id,
        text: text(message.text),
        content: list(message.content).flatMap(toRawPart),
        model: providerID && modelID ? { providerID, id: modelID } : undefined,
        agent: message.agent,
        time: time ? { created: count(time.created), completed: count(time.completed) } : undefined,
        cost: count(message.cost),
        tokens:
          input !== undefined &&
          output !== undefined &&
          cacheRead !== undefined &&
          cacheWrite !== undefined
            ? { input, output, cache: { read: cacheRead, write: cacheWrite } }
            : undefined,
      },
    ];
  });
}
