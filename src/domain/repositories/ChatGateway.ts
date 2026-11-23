/**
 * Puerto del servidor opencode de un workspace: superficie estructural que
 * consumen Chat, Inspector y SettingsPanel. El adaptador en `data/` envuelve
 * el cliente HTTP real; aquí no hay tipos del SDK.
 *
 * `ChatGateway` modela el transporte crudo y deja los payloads en `unknown` a
 * propósito. `ChatServer` es la vista estrechada que produce el adaptador
 * opencode: los payloads que consume la presentación llegan ya mapeados a
 * tipos del dominio, sin casts en los componentes. Los datos opacos (eventos,
 * configuración MCP) siguen en `unknown`.
 */
import type { AgentForm, FormAnswer } from "../chat/forms";
import type { RawSessionMessage } from "../chat/messages";
import type { PermissionDecision, PermissionRequest } from "../chat/permissions";
import type { CatalogAgent, CatalogModel } from "../chat/selection";
import type { UsageLimits } from "../chat/usage";

export type ServerLocation = { directory: string };

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
};

export interface ChatGateway {
  session: {
    create(input: { location: ServerLocation; title?: string }): Promise<{ id: string }>;
    get(input: { sessionID: string }): Promise<{ cost?: number } | null>;
    prompt(input: { sessionID: string; text: string }): Promise<unknown>;
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
  model: {
    list(input: { location: ServerLocation; types?: string[] }): Promise<{ data: unknown[] }>;
    default(input: {
      location: ServerLocation;
    }): Promise<{ data: { providerID: string; id: string } | null }>;
  };
  agent: {
    list(input: { location: ServerLocation }): Promise<{ data: unknown[] }>;
  };
  vcs: {
    get(input: {
      location: ServerLocation;
    }): Promise<{ data: { branch: { current?: string | null } } }>;
    status(input: {
      location: ServerLocation;
    }): Promise<{ data: { additions: number; deletions: number }[] }>;
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
    list(input: {
      location: ServerLocation;
    }): Promise<{ data: { name: string; status: unknown }[] }>;
    add(input: { server: string; config: unknown; location: ServerLocation }): Promise<unknown>;
    remove(input: { server: string; location: ServerLocation }): Promise<unknown>;
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
  message: {
    list(input: {
      sessionID: string;
      limit?: number;
      order?: "asc" | "desc";
    }): Promise<{ data: RawSessionMessage[] }>;
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
  usage: {
    limits(): Promise<{ data: UsageLimits | null }>;
  };
  permission: Omit<ChatGateway["permission"], "list"> & {
    list(input: { sessionID: string }): Promise<{ data: PermissionRequest[] }>;
  };
  form: Omit<ChatGateway["form"], "list"> & {
    list(input: { sessionID: string }): Promise<{ data: AgentForm[] }>;
  };
  event: {
    subscribe(input?: { signal?: AbortSignal }): AsyncIterable<ChatServerEvent>;
  };
}
