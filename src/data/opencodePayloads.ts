/**
 * Estrechado de payloads del servidor opencode en la frontera.
 *
 * El puerto deja los datos en `unknown` a propósito; estas funciones son el
 * único lugar que conoce la forma del servidor y la convierten a los tipos
 * estructurales del dominio. Ante un payload inválido devuelven una entrada
 * vacía en vez de romper la UI.
 */
import type { AgentForm, FormField, FormOption, FormWhen } from "../domain/chat/forms";
import type { RawPart, RawSessionMessage } from "../domain/chat/messages";
import type { PermissionRequest, PermissionSource } from "../domain/chat/permissions";
import type { CatalogAgent, CatalogModel } from "../domain/chat/selection";
import type { ModelCost, ModelDetails } from "../domain/models/details";
import type { RawSessionSummary } from "../domain/chat/sessions";
import type { UsageBudget, UsageLimits, UsageMeter } from "../domain/chat/usage";
import type {
  FileChange,
  FileChangeStatus,
  FileChangeSummary,
  FileContent,
  FileEntryType,
  FileTreeEntry,
} from "../domain/workspace/changes";
import { decodeFileContent } from "../domain/workspace/changes";
import type { ChatServerEvent } from "../domain/repositories/ChatGateway";

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

/** Sesiones del workspace: solo los campos que pinta el panel de historial. */
export function toRawSessionSummaries(payload: unknown): RawSessionSummary[] {
  return list(payload).flatMap((item) => {
    const session = record(item);
    if (!session) return [];
    const id = text(session.id);
    if (!id) return [];
    const time = record(session.time);
    const tokens = record(session.tokens);
    const input = count(tokens?.input);
    const output = count(tokens?.output);
    return [
      {
        id,
        title: text(session.title),
        cost: count(session.cost),
        tokens: input !== undefined || output !== undefined ? { input, output } : undefined,
        time: time ? { created: count(time.created), updated: count(time.updated) } : undefined,
      },
    ];
  });
}

function toChangeStatus(value: unknown): FileChangeStatus | undefined {
  return value === "added" || value === "deleted" || value === "modified" ? value : undefined;
}

/**
 * Ficheros de `session.diff`/`vcs.diff` con su parche. La forma es la misma en
 * ambos endpoints (`FileDiff.Info`): el parche puede venir vacío si el servidor
 * solo lista el estado.
 */
export function toFileChanges(payload: unknown): FileChange[] {
  return list(payload).flatMap((item) => {
    const change = record(item);
    const file = text(change?.file);
    const status = toChangeStatus(change?.status);
    if (!change || !file || !status) return [];
    const summary: FileChangeSummary = {
      file,
      additions: count(change.additions) ?? 0,
      deletions: count(change.deletions) ?? 0,
      status,
    };
    return [
      {
        ...summary,
        patch: text(change.patch) ?? "",
        ...(change.more === true ? { more: true } : {}),
      },
    ];
  });
}

/** Ficheros de `vcs.status`: mismo estado y contadores, sin parche. */
export function toFileChangeSummaries(payload: unknown): FileChangeSummary[] {
  return toFileChanges(payload).map(({ file, additions, deletions, status }) => ({
    file,
    additions,
    deletions,
    status,
  }));
}

function toEntryType(value: unknown): FileEntryType | undefined {
  return value === "file" || value === "directory" ? value : undefined;
}

/** Hijos de una carpeta (`file.list`), con la ruta relativa que devuelve el servidor. */
export function toFileTreeEntries(payload: unknown): FileTreeEntry[] {
  return list(payload).flatMap((item) => {
    const entry = record(item);
    const path = text(entry?.path);
    const type = toEntryType(entry?.type);
    return path && type ? [{ path, type }] : [];
  });
}

/** Contenido de `file.read`: el SDK entrega bytes; aquí se decide texto o binario. */
export function toFileContent(payload: unknown): FileContent {
  return decodeFileContent(payload);
}

function toPermissionSource(value: unknown): PermissionSource | undefined {
  const source = record(value);
  const type = text(source?.type);
  const messageID = text(source?.messageID);
  const id = text(source?.id);
  if (!type || !messageID || !id) return undefined;
  return { type, messageID, id };
}

/** Una petición de permiso del servidor, o `null` si le falta lo esencial. */
export function toPermissionRequest(payload: unknown): PermissionRequest | null {
  const permission = record(payload);
  if (!permission) return null;
  const id = text(permission.id);
  const sessionID = text(permission.sessionID);
  const action = text(permission.action);
  if (!id || !sessionID || !action) return null;
  return {
    id,
    sessionID,
    action,
    resources: texts(permission.resources),
    save: texts(permission.save),
    message: text(permission.message),
    metadata: record(permission.metadata) ?? undefined,
    source: toPermissionSource(permission.source),
  };
}

/** Permisos pendientes de una sesión (`permission.list`). */
export function toPermissionRequests(payload: unknown): PermissionRequest[] {
  const entries = Array.isArray(payload) ? payload : list(record(payload)?.data);
  return entries.flatMap((item) => {
    const request = toPermissionRequest(item);
    return request ? [request] : [];
  });
}

/** Datos de `permission.replied`: qué petición quedó resuelta. */
export function toPermissionReply(
  payload: unknown,
): { sessionID: string; requestID: string } | null {
  const data = record(payload);
  const sessionID = text(data?.sessionID);
  const requestID = text(data?.requestID);
  if (!sessionID || !requestID) return null;
  return { sessionID, requestID };
}

function toFormOptions(value: unknown): FormOption[] {
  return list(value).flatMap((item) => {
    const option = record(item);
    const optionValue = text(option?.value);
    const label = text(option?.label);
    if (!optionValue || !label) return [];
    return [{ value: optionValue, label, description: text(option?.description) }];
  });
}

function toFormWhen(value: unknown): FormWhen[] {
  return list(value).flatMap((item) => {
    const condition = record(item);
    const key = text(condition?.key);
    const op = text(condition?.op);
    const conditionValue = condition?.value;
    if (
      !key ||
      (op !== "eq" && op !== "neq") ||
      (typeof conditionValue !== "string" &&
        typeof conditionValue !== "number" &&
        typeof conditionValue !== "boolean")
    ) {
      return [];
    }
    return [{ key, op, value: conditionValue }];
  });
}

function toFormFormat(value: unknown): "email" | "uri" | "date" | "date-time" | undefined {
  return value === "email" || value === "uri" || value === "date" || value === "date-time"
    ? value
    : undefined;
}

function toFormField(payload: unknown): FormField | null {
  const field = record(payload);
  if (!field) return null;
  const key = text(field.key);
  const type = text(field.type);
  if (!key || !type) return null;
  const base = {
    key,
    title: text(field.title),
    description: text(field.description),
    required: typeof field.required === "boolean" ? field.required : undefined,
    hidden: typeof field.hidden === "boolean" ? field.hidden : undefined,
    when: toFormWhen(field.when),
  };
  switch (type) {
    case "string":
      return {
        ...base,
        type,
        format: toFormFormat(field.format),
        minLength: count(field.minLength),
        maxLength: count(field.maxLength),
        pattern: text(field.pattern),
        placeholder: text(field.placeholder),
        options: toFormOptions(field.options),
        default: text(field.default),
        custom: typeof field.custom === "boolean" ? field.custom : undefined,
      };
    case "number":
    case "integer":
      return {
        ...base,
        type,
        minimum: count(field.minimum),
        maximum: count(field.maximum),
        default: count(field.default),
      };
    case "boolean":
      return {
        ...base,
        type,
        default: typeof field.default === "boolean" ? field.default : undefined,
      };
    case "multiselect":
      return {
        ...base,
        type,
        options: toFormOptions(field.options),
        minItems: count(field.minItems),
        maxItems: count(field.maxItems),
        default: texts(field.default),
        custom: typeof field.custom === "boolean" ? field.custom : undefined,
      };
    case "external": {
      const url = text(field.url);
      return url ? { ...base, type, url } : null;
    }
    default:
      return null;
  }
}

/** Un formulario (pregunta del agente), o `null` si le falta lo esencial. */
export function toAgentForm(payload: unknown): AgentForm | null {
  const form = record(payload);
  if (!form) return null;
  const id = text(form.id);
  const sessionID = text(form.sessionID);
  if (!id || !sessionID) return null;
  return {
    id,
    sessionID,
    title: text(form.title) ?? "Pregunta del agente",
    metadata: record(form.metadata) ?? undefined,
    fields: list(form.fields).flatMap((item) => {
      const field = toFormField(item);
      return field ? [field] : [];
    }),
  };
}

/** Formularios pendientes de una sesión (`session.form.list`). */
export function toAgentForms(payload: unknown): AgentForm[] {
  const entries = Array.isArray(payload) ? payload : list(record(payload)?.data);
  return entries.flatMap((item) => {
    const form = toAgentForm(item);
    return form ? [form] : [];
  });
}

/** Datos de `form.replied`/`form.cancelled`: qué formulario quedó resuelto. */
export function toFormSettled(payload: unknown): { sessionID: string; formID: string } | null {
  const data = record(payload);
  const sessionID = text(data?.sessionID);
  const formID = text(data?.id);
  if (!sessionID || !formID) return null;
  return { sessionID, formID };
}

/**
 * Estrecha los eventos que la presentación consume tipados. El resto se deja
 * intacto: el reducer de streaming sigue leyendo `data` como `unknown`.
 */
export function toServerEvent(event: { type: string; data?: unknown }): ChatServerEvent {
  switch (event.type) {
    case "permission.asked": {
      const permission = toPermissionRequest(event.data);
      return permission ? { ...event, permission } : event;
    }
    case "permission.replied": {
      const permissionReply = toPermissionReply(event.data);
      return permissionReply ? { ...event, permissionReply } : event;
    }
    case "form.created": {
      const form = toAgentForm(record(event.data)?.form ?? event.data);
      return form ? { ...event, form } : event;
    }
    case "form.replied":
    case "form.cancelled": {
      const formSettled = toFormSettled(event.data);
      return formSettled ? { ...event, formSettled } : event;
    }
    default:
      return event;
  }
}
