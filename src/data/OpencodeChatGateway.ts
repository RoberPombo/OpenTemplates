/**
 * Adaptador del servidor opencode: construye el cliente HTTP con auth básica,
 * estrecha los payloads en la frontera y lo expone como `ChatServer` para la
 * presentación. Aquí termina todo conocimiento del SDK.
 */
import { OpenCode } from "@opencode/client";
import type { ChatServer } from "../domain/repositories/ChatGateway";
import { sanitizeTransfer } from "../domain/chat/transfer";
import type { ServerInfo } from "../types";
import {
  toAgentForms,
  toCatalogAgents,
  toCatalogModels,
  toChatCommands,
  toChatSkills,
  toFileChangeSummaries,
  toFileChanges,
  toFileContent,
  toFileTreeEntries,
  toGoalDecisionResult,
  toMcpServerStatuses,
  toPermissionRequests,
  toRawSessionSummaries,
  toServerEvent,
  toSessionMessages,
  toSessionTransfer,
  toUsageLimits,
  toWorkspaceStats,
} from "./opencodePayloads";

export function createChatGateway(server: ServerInfo): ChatServer {
  const token = btoa(`opencode:${server.password}`);
  const sdk = OpenCode.make({
    baseUrl: server.baseUrl,
    headers: { authorization: `Basic ${token}` },
  });

  return {
    session: {
      create: (input) => sdk.session.create(input),
      get: async (input) => {
        const session = await sdk.session.get(input);
        return {
          projectID: session.projectID,
          cost: session.cost,
          tokens: { input: session.tokens?.input ?? 0, output: session.tokens?.output ?? 0 },
          outcome: session.outcome ?? null,
          idle: session.time?.idle !== undefined,
        };
      },
      diff: async (input) => ({
        data: toFileChanges(await sdk.session.diff(input)),
      }),
      stats: async (input) => ({
        data: toWorkspaceStats(await sdk.session.stats(input)),
      }),
      prompt: (input) => sdk.session.prompt(input),
      command: (input) => sdk.session.command(input),
      interrupt: (input) => sdk.session.interrupt(input),
      switchModel: (input) => sdk.session.switchModel(input),
      switchAgent: (input) => sdk.session.switchAgent(input),
      update: (input) => sdk.session.update(input),
      remove: (input) => sdk.session.remove(input),
      // El sanitize del servidor sustituye todos los textos por
      // `[redacted:...]`: la sesión deja de ser legible. Se pide siempre en
      // crudo y se sanea en dominio, que conserva el contenido y quita rutas y
      // credenciales.
      export: async (input) => {
        const transfer = toSessionTransfer(
          await sdk.session.export({ sessionID: input.sessionID, sanitize: false }),
        );
        return input.sanitize === false ? transfer : sanitizeTransfer(transfer);
      },
      import: async (input) => {
        // El SDK tipa `info` con la sesión completa; el import solo necesita
        // los campos del fichero (el servidor rellena proyecto y tiempos).
        const session = await sdk.session.import(
          input as unknown as Parameters<typeof sdk.session.import>[0],
        );
        return { id: session.id };
      },
      fork: (input) => sdk.session.fork(input),
      list: async (input) => ({
        data: toRawSessionSummaries((await sdk.session.list(input)).data),
      }),
    },
    message: {
      list: async (input) => ({
        data: toSessionMessages((await sdk.message.list(input)).data),
      }),
    },
    project: {
      list: async () => ({
        data: (await sdk.project.list()).map((project) => ({
          id: project.id,
          canonical: project.canonical,
        })),
      }),
    },
    worktree: {
      list: async (input) => ({
        data: (await sdk.worktree.list(input)).map((item) => ({ directory: item.directory })),
      }),
      create: (input) => sdk.worktree.create(input),
      remove: (input) => sdk.worktree.remove(input),
    },
    model: {
      list: async (input) => ({
        data: toCatalogModels((await sdk.model.list(input)).data),
      }),
      default: (input) => sdk.model.default(input),
    },
    agent: {
      list: async (input) => ({
        data: toCatalogAgents((await sdk.agent.list(input)).data),
      }),
    },
    command: {
      list: async (input) => ({
        data: toChatCommands((await sdk.command.list(input)).data),
      }),
    },
    skill: {
      list: async (input) => ({
        data: toChatSkills((await sdk.skill.list(input)).data),
      }),
    },
    vcs: {
      get: (input) => sdk.vcs.get(input),
      status: async (input) => ({
        data: toFileChangeSummaries((await sdk.vcs.status(input)).data),
      }),
      diff: async (input) => ({
        data: toFileChanges((await sdk.vcs.diff(input)).data),
      }),
    },
    file: {
      list: async (input) => ({
        data: toFileTreeEntries((await sdk.file.list(input)).data),
      }),
      read: async (input) => ({
        data: toFileContent(await sdk.file.read(input)),
      }),
    },
    usage: {
      limits: async () => ({ data: toUsageLimits((await sdk.usage.limits()).data) }),
    },
    permission: {
      list: async (input) => ({
        data: toPermissionRequests(await sdk.permission.list(input)),
      }),
      reply: (input) => sdk.permission.reply(input),
    },
    form: {
      list: async (input) => ({
        data: toAgentForms(await sdk.session.form.list(input)),
      }),
      reply: (input) => sdk.session.form.reply(input),
      cancel: (input) => sdk.session.form.cancel(input),
    },
    mcp: {
      list: async (input) => ({
        data: toMcpServerStatuses(await sdk.mcp.list(input)),
      }),
      // El SDK tipa `mcp.add` con una unión discriminada experimental, pero la
      // app reenvía la config opaca que devuelve mcp.list (McpInfo.config). La
      // coerción vive aquí, en la frontera.
      add: (input) => sdk.mcp.add(input as Parameters<typeof sdk.mcp.add>[0]),
      remove: (input) => sdk.mcp.remove(input),
      // Conectar/desconectar en caliente vive en `experimental.mcp`; los
      // métodos de `mcp` están deprecados en el SDK 2.3.2.
      connect: (input) => sdk.experimental.mcp.connect(input),
      disconnect: (input) => sdk.experimental.mcp.disconnect(input),
    },
    generate: {
      // `generate.decisions` exige un modelo con capacidad de decisión; el
      // modelo de chat de la sesión se rechaza (UnsupportedModelError). El
      // modelo llega ya elegido por el hook desde `model.list({types})`.
      decisions: async (input) => ({
        data: toGoalDecisionResult(await sdk.experimental.generate.decisions(input)),
      }),
      text: (input) => sdk.experimental.generate.text(input),
    },
    location: sdk.location,
    event: {
      async *subscribe(input) {
        for await (const event of sdk.event.subscribe(input)) {
          yield toServerEvent(event);
        }
      },
    },
  };
}
