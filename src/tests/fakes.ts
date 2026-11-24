import { vi } from "vitest";
import type { Workspace } from "../types";
import type { AgentForm } from "../domain/chat/forms";
import type { GoalDecisionRequest, GoalDecisionResult } from "../domain/chat/goals";
import type { McpServerStatus } from "../domain/chat/mcp";
import type { PermissionRequest } from "../domain/chat/permissions";
import type { SessionTransfer } from "../domain/chat/transfer";
import type { WorkspaceStats } from "../domain/chat/usage";
import type { TerminalInfo } from "../domain/terminal/terminals";
import type {
  TerminalChannel,
  TerminalConnectInput,
  TerminalGateway,
  TerminalHandlers,
} from "../domain/repositories/TerminalGateway";
import type {
  NotificationGateway,
  NotificationInput,
  NotificationPermission,
} from "../domain/repositories/NotificationGateway";
import type { SaveSessionFileResult, SessionFiles } from "../domain/repositories/SessionFiles";
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
  /** Mensajes por sesión; tiene prioridad sobre `messages`. */
  messagesBySession?: Record<string, unknown[]>;
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
  /** Diff por sesión; tiene prioridad sobre `sessionDiff`. */
  sessionDiffs?: Record<string, unknown[]>;
  vcsStatus?: unknown[];
  vcsDiff?: unknown[];
  fileEntries?: Record<string, unknown[]>;
  fileContents?: Record<string, unknown>;
  exportTransfer?: SessionTransfer;
  exportError?: unknown;
  importError?: unknown;
  forkError?: unknown;
  mcpServers?: McpServerStatus[];
  /** Modelos con capacidad de decisión para el objetivo de sesión. */
  decisionModels?: unknown[];
  /** Resultados de `generate.decisions`; se consumen en orden. */
  decisionResults?: GoalDecisionResult[];
  decisionError?: unknown;
  /** Coste acumulado que devuelve `session.get`. */
  sessionCost?: number;
  /** Proyectos de opencode que devuelve `project.list`. */
  projects?: Array<{ id: string; canonical: string }>;
  /** Datos extra de `session.get` por sesión (coste, tokens, outcome, proyecto). */
  runInfo?: Record<
    string,
    {
      projectID?: string;
      cost?: number;
      tokens?: { input: number; output: number };
      outcome?: string;
    }
  >;
  /** Falla la creación del worktree cuyo nombre coincida. */
  worktreeError?: { name?: string; error: unknown };
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
  const decisionModels = options.decisionModels ?? [
    {
      providerID: "opencode",
      id: "jev-1.13-free",
      name: "Jev",
      enabled: true,
      type: "decision",
      variants: [],
    },
  ];
  const decisions = [...(options.decisionResults ?? [])];
  const defaultDecision: GoalDecisionResult = {
    verdict: "continue",
    confidence: 0.8,
    cost: 0.001,
    tokens: { input: 10, output: 4 },
    error: null,
  };
  // Lista de sesiones viva: renombrar y eliminar se reflejan en el siguiente list.
  let sessionList = (options.sessions ?? []).map((item) => ({
    ...(item as Record<string, unknown>),
  }));
  // Sesiones creadas por el cliente, con el input original para inspecciones.
  const createdSessions: Array<{ id: string; input?: unknown }> = [];
  let worktrees: Array<{ directory: string }> = [];
  const projects = options.projects ?? [{ id: "p1", canonical: "/tmp/demo" }];

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
      create: vi.fn(
        async (input?: {
          location?: { directory: string };
          title?: string;
          agent?: string | null;
          model?: unknown;
        }) => {
          const id = `s${++sessionCounter}`;
          createdSessions.push({ id, input });
          return { id };
        },
      ),
      export: vi.fn(async (input: { sessionID: string; sanitize?: boolean }) => {
        if (options.exportError) throw options.exportError;
        if (options.exportTransfer) return options.exportTransfer;
        const source = sessionList.find((session) => session.id === input.sessionID);
        return {
          info: {
            id: input.sessionID,
            title: (source?.title as string | undefined) ?? "Sesión",
            location: { directory: "/tmp/demo" },
          },
          messages: [],
        };
      }),
      import: vi.fn(async (input: { info: { id: string; title?: string } }) => {
        if (options.importError) throw options.importError;
        sessionList = [
          ...sessionList,
          {
            id: input.info.id,
            title: input.info.title,
            cost: 0,
            time: { created: 5, updated: 5 },
          },
        ];
        return { id: input.info.id };
      }),
      fork: vi.fn(async (input: { sessionID: string; before?: string }) => {
        if (options.forkError) throw options.forkError;
        const id = `fork${++sessionCounter}`;
        const source = sessionList.find((session) => session.id === input.sessionID);
        sessionList = [
          ...sessionList,
          {
            id,
            title: `${(source?.title as string | undefined) ?? "Sesión"} (fork)`,
            cost: 0,
            time: { created: 6, updated: 6 },
          },
        ];
        return { id };
      }),
      prompt: vi.fn(
        async (_input: { sessionID: string; text: string; skills?: { id: string }[] }) => undefined,
      ),
      command: vi.fn(async () => undefined),
      interrupt: vi.fn(async () => undefined),
      switchModel: vi.fn(async () => undefined),
      switchAgent: vi.fn(async () => undefined),
      get: vi.fn(async (input?: { sessionID?: string }) => {
        const info = input?.sessionID ? options.runInfo?.[input.sessionID] : undefined;
        if (!info && options.sessionCost === undefined) return null;
        return {
          projectID: info?.projectID ?? projects[0]?.id,
          cost: info?.cost ?? options.sessionCost ?? 0,
          tokens: info?.tokens ?? { input: 0, output: 0 },
          outcome: info?.outcome ?? null,
        };
      }),
      diff: vi.fn(async (input?: { sessionID?: string }) => ({
        data:
          (input?.sessionID ? options.sessionDiffs?.[input.sessionID] : undefined) ??
          options.sessionDiff ??
          [],
      })),
      stats: vi.fn(async () => ({ data: options.stats ?? null })),
    },
    message: {
      list: vi.fn(async (input?: { sessionID?: string }) => ({
        data:
          (input?.sessionID ? options.messagesBySession?.[input.sessionID] : undefined) ?? messages,
      })),
    },
    project: {
      list: vi.fn(async () => ({ data: projects })),
    },
    worktree: {
      list: vi.fn(async () => ({ data: worktrees })),
      create: vi.fn(async (input: { projectID: string; directory?: string; name?: string }) => {
        if (options.worktreeError && options.worktreeError.name === input.name) {
          throw options.worktreeError.error;
        }
        const directory = input.directory
          ? `${input.directory.replace(/\/$/, "")}/${input.name ?? `wt${worktrees.length + 1}`}`
          : `/tmp/opencode-wt/${input.name ?? `wt${worktrees.length + 1}`}`;
        worktrees = [...worktrees, { directory }];
        return { directory };
      }),
      remove: vi.fn(async (input: { directory: string }) => {
        worktrees = worktrees.filter((item) => item.directory !== input.directory);
      }),
    },
    model: {
      list: vi.fn(async () => ({ data: [...models, ...decisionModels] })),
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
    mcp: {
      list: vi.fn(async () => ({ data: options.mcpServers ?? [] })),
      add: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
    },
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
    generate: {
      decisions: vi.fn(async (_input: GoalDecisionRequest) => {
        if (options.decisionError) throw options.decisionError;
        const next = decisions.shift() ?? defaultDecision;
        return { data: next };
      }),
    },
  };

  return {
    client,
    hub,
    createdSessions,
    get worktrees() {
      return worktrees;
    },
  };
}

/** Gateway de notificaciones fake: registra avisos y permite fijar el permiso. */ export function makeNotificationGateway(
  permission: NotificationPermission = "granted",
) {
  return {
    requestPermission: vi.fn(async (): Promise<NotificationPermission> => permission),
    notify: vi.fn(async (_input: NotificationInput) => undefined),
  } satisfies NotificationGateway;
}

/**
 * Ficheros de sesión fake: el diálogo devuelve lo que fije el test y las
 * escrituras quedan registradas para inspeccionar el JSON.
 */
export function makeSessionFiles(
  options: {
    file?: { path: string; contents: string } | null;
    saved?: SaveSessionFileResult["status"];
  } = {},
): SessionFiles & {
  saved: string[];
  saves: Array<{ suggestedName: string; contents: string; overwrite?: boolean }>;
  setResult: (status: SaveSessionFileResult["status"]) => void;
  save: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
} {
  let result = options.saved ?? "saved";
  const saved: string[] = [];
  const saves: Array<{ suggestedName: string; contents: string; overwrite?: boolean }> = [];
  return {
    saved,
    saves,
    setResult(status) {
      result = status;
    },
    save: vi.fn(async (input: { suggestedName: string; contents: string; overwrite?: boolean }) => {
      saves.push(input);
      if (result === "cancelled") return { status: "cancelled" } as SaveSessionFileResult;
      if (result === "exists" && !input.overwrite) {
        return { status: "exists", path: "/tmp/sesion.json" } as SaveSessionFileResult;
      }
      saved.push(input.contents);
      return { status: "saved", path: "/tmp/sesion.json" } as SaveSessionFileResult;
    }),
    open: vi.fn(async () => options.file ?? null),
  };
}

/** Info de PTY para tests, con valores razonables. */
export function makeTerminalInfo(overrides: Partial<TerminalInfo> = {}): TerminalInfo {
  return {
    id: "pty_1",
    title: "Terminal 1",
    status: "running",
    cwd: "/tmp/demo",
    pid: 1001,
    ...overrides,
  };
}

/**
 * Gateway de terminal fake y en memoria: sin WebSocket. Permite empujar salida,
 * confirmar cursores y simular caídas para probar la reconexión del dock.
 */
export function makeTerminalGateway(initial: TerminalInfo[] = []) {
  const infos = new Map(initial.map((info) => [info.id, { ...info }] as const));
  const connections = new Map<string, { handlers: TerminalHandlers; closed: boolean }>();
  const sent: Array<{ ptyID: string; data: string | Uint8Array }> = [];
  const cursors: Array<number | null | undefined> = [];
  let sequence = initial.length;
  let connectError: unknown = null;

  const list = vi.fn(async () => [...infos.values()].map((info) => ({ ...info })));
  const create = vi.fn(
    async (
      _location: { directory: string },
      input: { cwd: string; title?: string; command?: string; args?: string[] },
    ): Promise<TerminalInfo> => {
      sequence += 1;
      const info: TerminalInfo = {
        id: `pty_${sequence}`,
        title: input.title ?? `Terminal ${sequence}`,
        status: "running",
        cwd: input.cwd,
        pid: 1000 + sequence,
      };
      infos.set(info.id, info);
      return { ...info };
    },
  );
  const remove = vi.fn(async (_location: { directory: string }, ptyID: string) => {
    infos.delete(ptyID);
    connections.delete(ptyID);
  });
  const resize = vi.fn(async () => undefined);
  const connect = vi.fn(async (input: TerminalConnectInput): Promise<TerminalChannel> => {
    if (connectError) {
      const error = connectError;
      connectError = null;
      throw error;
    }
    if (!infos.has(input.ptyID)) throw new Error("PTY no encontrado");
    const record = { handlers: input.handlers, closed: false };
    connections.set(input.ptyID, record);
    cursors.push(input.cursor);
    return {
      send(data) {
        sent.push({ ptyID: input.ptyID, data });
      },
      close() {
        record.closed = true;
        connections.delete(input.ptyID);
      },
    };
  });

  const gateway: TerminalGateway = { list, create, remove, resize, connect };

  return {
    gateway,
    infos,
    connections,
    sent,
    cursors,
    list,
    create,
    remove,
    resize,
    connect,
    emit(ptyID: string, text: string, bytes = text.length) {
      connections.get(ptyID)?.handlers.onData({ text, bytes });
    },
    acknowledge(ptyID: string, cursor: number) {
      connections.get(ptyID)?.handlers.onCursor(cursor);
    },
    drop(ptyID: string, close = { code: 1006, reason: "conexión perdida" }) {
      const record = connections.get(ptyID);
      if (!record) return;
      record.closed = true;
      connections.delete(ptyID);
      record.handlers.onClose(close);
    },
    failNextConnect(error: unknown) {
      connectError = error;
    },
  };
}
