/** Puerto de perfiles globales. */
import type { ProfileManifest } from "../../types";

export interface ProfileGateway {
  list(): Promise<ProfileManifest[]>;
  save(manifest: ProfileManifest): Promise<ProfileManifest>;
  delete(id: string): Promise<void>;
  agentsMd(id: string): Promise<string>;
  saveAgentsMd(id: string, content: string): Promise<string>;
}
