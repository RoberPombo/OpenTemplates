import { vi } from "vitest";
import type { Workspace } from "../types";
import type { AgentForm } from "../domain/chat/forms";
import type { PermissionRequest } from "../domain/chat/permissions";
import type { WorkspaceStats } from "../domain/chat/usage";
import type {
  NotificationGateway,
  NotificationInput,
  NotificationPermission,
} from "../domain/repositories/NotificationGateway";
import { toServerEvent } from "../data/opencodePayloads";

/** Workspace mínimo para tests. */
export function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "w1",
    name: "Demo",
    repoId: null,
    projectPath: "/tmp/demo",
    mode: "adhoc",
    branch: null,
    worktreePath: null,
    templateId: null,
    templateVersion: null,
    issue: null,
    mcpNames: [],
    disabledMcps: [],
    skills: [],
    disabledSkills: [],
    agents: [],
    commands: [],
    plugins: [],
    model: null,
    models: [],
    createdAt: 0,
    updatedAt: 0,
    missing: false,
    ...overrides,
  };
}

export type FakeEvent = { type: string; data?: Record<string, unknown> };

async function* narrowEvents(events: AsyncIterable<FakeEvent>) {
  for await (const event of events) yield toServerEvent(event);
}

/** Hub de eventos SSE: cada suscripción tiene su cola; el test empuja a las activas. */
export function makeEventHub() {
  type Subscriber = { push: (event: FakeEvent) => void; finish: () => void };
  const subscribers = new Set<Subscriber>();

  return {
    subscribe(options?: { signal?: AbortSignal }) {
      const queue: FakeEvent[] = [];
      let notify: (() => void) | null = null;
      let done = false;
      const subscriber: Subscriber = {
        push(event) {
          if (done) return;
          queue.push(event);
          notify?.();
        },
        finish() {
          done = true;
          notify?.();
        },
      };
      subscribers.add(subscriber);
      options?.signal?.addEventListener("abort", () => {
        subscriber.finish();
        subscribers.delete(subscriber);
      });
      return {
        async *[Symbol.asyncIterator]() {
          while (!done) {
            if (queue.length > 0) {
              yield queue.shift() as FakeEvent;
              continue;
            }
            await new Promise<void>((resolve) => {
              notify = resolve;
            });
            notify = null;
          }
        },
      };
    },
    push(event: FakeEvent) {
      for (const subscriber of subscribers) subscriber.push(event);
    },
    get active() {
      return subscribers.size;
    },
  };
}

export type FakeClientOptions = {
  messages?: unknown[];
  models?: unknown[];
  agents?: unknown[];
  commands?: unknown[];
  skillsCatalog?: unknown[];
  defaultModel?: { providerID: string; id: string } | null;
  branch?: string | null;
  sessions?: unknown[];
  stats?: WorkspaceStats | null;
  permissions?: PermissionRequest[];
  forms?: AgentForm[];
  sessionDiff?: unknown[];
  vcsStatus?: unknown[];
  vcsDiff?: unknown[];
  fileEntries?: Record<string, unknown[]>;
  fileContents?: Record<string, unknown>;
};

/**
 * Cliente opencode fake con la superficie que usa Chat.
 * `hub` permite empujar eventos de streaming; `calls` registra las invocaciones.
 */
export function makeFakeClient(options: FakeClientOptions = {}) {
  const hub = makeEventHub();
  let sessionCounter = 0;
  const messages = options.messages ?? [];
  const models = options.models ?? [
    {
      providerID: "anthropic",
      id: "claude",
      name: "Claude",
      enabled: true,
      type: "chat",
      variants: [{ id: "high" }],
    },
    { providerID: "openai", id: "gpt", name: "GPT", enabled: true, type: "chat", variants: [] },
  ];
  const agents = options.agents ?? [
    { id: "build", name: "Build", hidden: false, mode: "primary" },
    { id: "plan", name: "Plan", hidden: false, mode: "primary" },
  ];
  // Lista de sesiones viva: renombrar y eliminar se reflejan en el siguiente list.
  let sessionList = (options.sessions ?? []).map((item) => ({
    ...(item as Record<string, unknown>),
  }));

  const client = {
    session: {
      list: vi.fn(async () => ({ data: sessionList })),
      update: vi.fn(async (input: { sessionID: string; title: string }) => {
        sessionList = sessionList.map((session) =>
          session.id === input.sessionID
            ? { ...session, title: input.title, time: { ...(session.time as object), updated: 2 } }
            : session,
        );
      }),
      remove: vi.fn(async (input: { sessionID: string }) => {
        sessionList = sessionList.filter((session) => session.id !== input.sessionID);
      }),
      create: vi.fn(async () => ({ id: `s${++sessionCounter}` })),
      prompt: vi.fn(async () => undefined),
      command: vi.fn(async () => undefined),
      interrupt: vi.fn(async () => undefined),
      switchModel: vi.fn(async () => undefined),
      switchAgent: vi.fn(async () => undefined),
      get: vi.fn(async () => null),
      diff: vi.fn(async () => ({ data: options.sessionDiff ?? [] })),
      stats: vi.fn(async () => ({ data: options.stats ?? null })),
    },
    message: {
      list: vi.fn(async () => ({ data: messages })),
    },
    model: {
      list: vi.fn(async () => ({ data: models })),
      default: vi.fn(async () =>
        options.defaultModel === null
          ? null
          : { data: options.defaultModel ?? { providerID: "anthropic", id: "claude" } },
      ),
    },
    agent: {
      list: vi.fn(async () => ({ data: agents })),
    },
    command: {
      list: vi.fn(async () => ({ data: options.commands ?? [] })),
    },
    skill: {
      list: vi.fn(async () => ({ data: options.skillsCatalog ?? [] })),
    },
    vcs: {
      get: vi.fn(async () => ({ data: { branch: { current: options.branch ?? null } } })),
      status: vi.fn(async () => ({ data: options.vcsStatus ?? [] })),
      diff: vi.fn(async () => ({ data: options.vcsDiff ?? [] })),
    },
    file: {
      list: vi.fn(async (input?: { path?: string }) => ({
        data: options.fileEntries?.[input?.path ?? ""] ?? [],
      })),
      read: vi.fn(async (input: { path: string }) => ({
        data: options.fileContents?.[input.path] ?? "",
      })),
    },
    event: {
      subscribe: vi.fn((opts?: { signal?: AbortSignal }) => narrowEvents(hub.subscribe(opts))),
    },
    location: { reload: vi.fn(async () => undefined) },
    mcp: { list: vi.fn(async () => ({ data: [] })), add: vi.fn(), remove: vi.fn() },
    usage: { limits: vi.fn(async () => ({ data: null })) },
    permission: {
      list: vi.fn(async () => ({ data: options.permissions ?? [] })),
      reply: vi.fn(async () => undefined),
    },
    form: {
      list: vi.fn(async () => ({ data: options.forms ?? [] })),
      reply: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
    },
  };

  return { client, hub };
}

/** Gateway de notificaciones fake: registra avisos y permite fijar el permiso. */
export function makeNotificationGateway(permission: NotificationPermission = "granted") {
  return {
    requestPermission: vi.fn(async (): Promise<NotificationPermission> => permission),
    notify: vi.fn(async (_input: NotificationInput) => undefined),
  } satisfies NotificationGateway;
}
