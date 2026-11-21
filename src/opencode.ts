import { OpenCode } from "@opencode/client";
import type { ServerInfo } from "./types";

export function makeClient(server: ServerInfo) {
  const token = btoa(`opencode:${server.password}`);
  return OpenCode.make({
    baseUrl: server.baseUrl,
    headers: { authorization: `Basic ${token}` },
  });
}

export type WorkspaceClient = ReturnType<typeof makeClient>;
