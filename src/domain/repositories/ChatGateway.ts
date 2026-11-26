/**
 * Puerto del servidor opencode de un workspace: superficie estructural que
 * consumen Chat, Inspector y SettingsDialog. El adaptador en `data/` envuelve
 * el cliente HTTP real; aquí no hay tipos del SDK.
 *
 * `ChatGateway` modela el transporte crudo y deja los payloads en `unknown` a
 * propósito. `ChatServer` es la vista estrechada que produce el adaptador
 * opencode: los payloads que consume la presentación llegan ya mapeados a
 * tipos del dominio, sin casts en los componentes. Los datos opacos (eventos,
 * configuración MCP) siguen en `unknown`.
 */
import type { ChatCommand, ChatSkill } from "../chat/commands";
import type { AgentForm, FormAnswer } from "../chat/forms";
import type { GoalDecisionRequest, GoalDecisionResult } from "../chat/goals";
import type { RawSessionMessage } from "../chat/messages";
import type { PermissionDecision, PermissionRequest } from "../chat/permissions";
import type { CatalogAgent, CatalogModel } from "../chat/selection";
import type { RawSessionSummary } from "../chat/sessions";
import type {
  SessionTransfer,
  SessionTransferInfo,
  SessionTransferMessage,
} from "../chat/transfer";
import type { UsageLimits, UsageStatsInput, WorkspaceStats } from "../chat/usage";
import type { McpServerStatus } from "../chat/mcp";
import type {
  FileChange,
  FileChangeSummary,
  FileContent,
  FileTreeEntry,
} from "../workspace/changes";

export type ServerLocation = { directory: string };

/** Petición de `generate.text`; el modelo es opcional y lo resuelve el servidor. */
export type GenerateTextRequest = {
  prompt: string;
  model?: { providerID: string; id: string; variant?: string } | null;
};

/** Proyecto de opencode: el canonical es el checkout principal del repo. */
export type ProjectRef = { id: string; canonical: string };

/** Datos de una sesión que necesita el seguimiento de carreras. */
export type SessionRunInfo = {
  projectID?: string;
  cost: number;
  tokens: { input: number; output: number };
  /** `succeeded`/`failed`/`interrupted` cuando el servidor ya cerró el turno. */
  outcome?: string | null;
  idle?: boolean;
};

export type WorktreeCreateInput = {
  projectID: string;
  /** Referencia base que se comprueba en el worktree. */
  branch?: string;
  /** Carpeta padre; el servidor crea `directory/name`. */
  directory?: string;
  name?: string;
};

/** Evento SSE crudo del servidor. */
export type ChatGatewayEvent = { type: string; data?: unknown };

/**
 * Evento ya estrechado por el adaptador para la presentación. Los eventos de
 * permisos y formularios traen su payload mapeado; el resto conserva `data`
 * opaco para el reducer de streaming.
 */
export type ChatServerEvent = ChatGatewayEvent & {
  permission?: PermissionRequest;
  permissionReply?: { sessionID: string; requestID: string };
  form?: AgentForm;
  formSettled?: { sessionID: string; formID: string };
  mcp?: { server: string };
};

export interface ChatGateway {
  session: {
    list(input: {
      directory: string;
      limit?: number;
      search?: string;
    }): Promise<{ data: unknown[] }>;
    update(input: { sessionID: string; title: string }): Promise<unknown>;
    remove(input: { sessionID: string }): Promise<unknown>;
    create(input: {
      location: ServerLocation;
      title?: string;
      agent?: string | null;
      model?: { id: string; providerID: string; variant?: string } | null;
    }): Promise<{ id: string }>;
    get(input: { sessionID: string }): Promise<{
      cost?: number;
      projectID?: string;
      tokens?: { input?: number; output?: number };
      outcome?: string | null;
    } | null>;
    diff(input: {
      sessionID: string;
      from?: string;
      to?: string;
      context?: number;
    }): Promise<{ data: unknown[] }>;
    stats(input?: UsageStatsInput): Promise<unknown>;
    export(input: { sessionID: string; sanitize?: boolean }): Promise<unknown>;
    import(input: {
      info: unknown;
      messages: unknown[];
      location: ServerLocation;
    }): Promise<unknown>;
    fork(input: { sessionID: string; before?: string }): Promise<{ id: string }>;
    prompt(input: { sessionID: string; text: string; skills?: { id: string }[] }): Promise<unknown>;
    command(input: {
      sessionID: string;
      name: string;
      text: string;
      skills?: { id: string }[];
    }): Promise<unknown>;
    interrupt(input: { sessionID: string }): Promise<unknown>;
    switchModel(input: {
      sessionID: string;
      model: { id: string; providerID: string; variant?: string };
    }): Promise<unknown>;
    switchAgent(input: { sessionID: string; agent: string }): Promise<unknown>;
  };
  message: {
    list(input: {
      sessionID: string;
      limit?: number;
      order?: "asc" | "desc";
    }): Promise<{ data: unknown[] }>;
  };
  project: {
    list(): Promise<{ data: unknown[] }>;
  };
  worktree: {
    list(input: { projectID: string }): Promise<{ data: unknown[] }>;
    create(input: WorktreeCreateInput): Promise<{ directory: string }>;
    remove(input: { projectID: string; directory: string; force: boolean }): Promise<void>;
  };
  model: {
    list(input: { location: ServerLocation; types?: string[] }): Promise<{ data: unknown[] }>;
    default(input: {
      location: ServerLocation;
    }): Promise<{ data: { providerID: string; id: string } | null }>;
  };
  agent: {
    list(input: { location: ServerLocation }): Promise<{ data: unknown[] }>;
  };
  command: {
    list(input: { location: ServerLocation }): Promise<{ data: unknown[] }>;
  };
  skill: {
    list(input: { location: ServerLocation }): Promise<{ data: unknown[] }>;
  };
  vcs: {
    get(input: {
      location: ServerLocation;
    }): Promise<{ data: { branch: { current?: string | null } } }>;
    status(input: { location: ServerLocation }): Promise<{ data: unknown[] }>;
    diff(input: {
      location: ServerLocation;
      mode: "working" | "branch" | "committed";
      base?: string;
      context?: number;
      untracked?: "files" | "folders";
    }): Promise<{ data: unknown[] }>;
  };
  file: {
    list(input: { location?: ServerLocation; path?: string }): Promise<{ data: unknown[] }>;
    read(input: { location?: ServerLocation; path: string }): Promise<{ data: unknown }>;
  };
  usage: {
    limits(): Promise<{ data: unknown }>;
  };
  permission: {
    list(input: { sessionID: string }): Promise<{ data: unknown[] }>;
    reply(input: {
      sessionID: string;
      requestID: string;
      decision: PermissionDecision;
      message?: string;
    }): Promise<unknown>;
  };
  form: {
    list(input: { sessionID: string }): Promise<{ data: unknown[] }>;
    reply(input: { sessionID: string; formID: string; answer: FormAnswer }): Promise<unknown>;
    cancel(input: { sessionID: string; formID: string; message?: string }): Promise<unknown>;
  };
  mcp: {
    list(input: { location: ServerLocation }): Promise<{ data: McpServerStatus[] }>;
    add(input: { server: string; config: unknown; location: ServerLocation }): Promise<unknown>;
    remove(input: { server: string; location: ServerLocation }): Promise<unknown>;
    /** Reconecta en caliente sin reescribir la config ni recargar la location. */
    connect(input: { server: string; location: ServerLocation }): Promise<unknown>;
    disconnect(input: { server: string; location: ServerLocation }): Promise<unknown>;
  };
  generate: {
    /** Evalúa el objetivo de sesión con el modelo de decisión del workspace. */
    decisions(input: GoalDecisionRequest): Promise<unknown>;
    /** Texto libre (mensaje de commit, resúmenes) con el modelo de decisión. */
    text(input: GenerateTextRequest): Promise<{ text: string }>;
  };
  location: {
    reload(): Promise<unknown>;
  };
  event: {
    subscribe(input?: { signal?: AbortSignal }): AsyncIterable<ChatGatewayEvent>;
  };
}

/** Payloads estrechados por el adaptador opencode para la presentación. */
export interface ChatServer extends ChatGateway {
  session: Omit<ChatGateway["session"], "list" | "diff" | "stats" | "export" | "import" | "get"> & {
    get(input: { sessionID: string }): Promise<SessionRunInfo | null>;
    list(input: {
      directory: string;
      limit?: number;
      search?: string;
    }): Promise<{ data: RawSessionSummary[] }>;
    diff(input: {
      sessionID: string;
      from?: string;
      to?: string;
      context?: number;
    }): Promise<{ data: FileChange[] }>;
    stats(input?: UsageStatsInput): Promise<{ data: WorkspaceStats | null }>;
    /** Transferencia ya saneada si se pide; siempre lista para reimportar. */
    export(input: { sessionID: string; sanitize?: boolean }): Promise<SessionTransfer>;
    import(input: {
      info: SessionTransferInfo;
      messages: SessionTransferMessage[];
      location: ServerLocation;
    }): Promise<{ id: string }>;
  };
  message: {
    list(input: {
      sessionID: string;
      limit?: number;
      order?: "asc" | "desc";
    }): Promise<{ data: RawSessionMessage[] }>;
  };
  project: {
    list(): Promise<{ data: ProjectRef[] }>;
  };
  worktree: {
    list(input: { projectID: string }): Promise<{ data: Array<{ directory: string }> }>;
    create(input: WorktreeCreateInput): Promise<{ directory: string }>;
    remove(input: { projectID: string; directory: string; force: boolean }): Promise<void>;
  };
  model: {
    list(input: { location: ServerLocation; types?: string[] }): Promise<{ data: CatalogModel[] }>;
    default(input: {
      location: ServerLocation;
    }): Promise<{ data: { providerID: string; id: string } | null }>;
  };
  agent: {
    list(input: { location: ServerLocation }): Promise<{ data: CatalogAgent[] }>;
  };
  command: {
    list(input: { location: ServerLocation }): Promise<{ data: ChatCommand[] }>;
  };
  skill: {
    list(input: { location: ServerLocation }): Promise<{ data: ChatSkill[] }>;
  };
  vcs: Omit<ChatGateway["vcs"], "status" | "diff"> & {
    status(input: { location: ServerLocation }): Promise<{ data: FileChangeSummary[] }>;
    diff(input: {
      location: ServerLocation;
      mode: "working" | "branch" | "committed";
      base?: string;
      context?: number;
      untracked?: "files" | "folders";
    }): Promise<{ data: FileChange[] }>;
  };
  file: {
    list(input: { location?: ServerLocation; path?: string }): Promise<{ data: FileTreeEntry[] }>;
    read(input: { location?: ServerLocation; path: string }): Promise<{ data: FileContent }>;
  };
  usage: {
    limits(): Promise<{ data: UsageLimits | null }>;
  };
  permission: Omit<ChatGateway["permission"], "list"> & {
    list(input: { sessionID: string }): Promise<{ data: PermissionRequest[] }>;
  };
  form: Omit<ChatGateway["form"], "list"> & {
    list(input: { sessionID: string }): Promise<{ data: AgentForm[] }>;
  };
  generate: {
    decisions(input: GoalDecisionRequest): Promise<{ data: GoalDecisionResult }>;
    text(input: GenerateTextRequest): Promise<{ text: string }>;
  };
  event: {
    subscribe(input?: { signal?: AbortSignal }): AsyncIterable<ChatServerEvent>;
  };
}
