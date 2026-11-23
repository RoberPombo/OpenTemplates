/**
 * Adaptador del servidor opencode: construye el cliente HTTP con auth básica,
 * estrecha los payloads en la frontera y lo expone como `ChatServer` para la
 * presentación. Aquí termina todo conocimiento del SDK.
 */
import { OpenCode } from "@opencode/client";
import type { ChatServer } from "../domain/repositories/ChatGateway";
import type { ServerInfo } from "../types";
import {
  toAgentForms,
  toCatalogAgents,
  toCatalogModels,
  toPermissionRequests,
  toRawSessionSummaries,
  toServerEvent,
  toSessionMessages,
  toUsageLimits,
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
      get: (input) => sdk.session.get(input),
      prompt: (input) => sdk.session.prompt(input),
      interrupt: (input) => sdk.session.interrupt(input),
      switchModel: (input) => sdk.session.switchModel(input),
      switchAgent: (input) => sdk.session.switchAgent(input),
      update: (input) => sdk.session.update(input),
      remove: (input) => sdk.session.remove(input),
      list: async (input) => ({
        data: toRawSessionSummaries((await sdk.session.list(input)).data),
      }),
    },
    message: {
      list: async (input) => ({
        data: toSessionMessages((await sdk.message.list(input)).data),
      }),
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
    vcs: sdk.vcs,
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
      list: async (input) => {
        const response = await sdk.mcp.list(input);
        return { data: response.data.map((item) => ({ name: item.name, status: item.status })) };
      },
      // El SDK tipa `mcp.add` con una unión discriminada experimental, pero la
      // app reenvía la config opaca que devuelve mcp.list (McpInfo.config). La
      // coerción vive aquí, en la frontera.
      add: (input) => sdk.mcp.add(input as Parameters<typeof sdk.mcp.add>[0]),
      remove: (input) => sdk.mcp.remove(input),
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
