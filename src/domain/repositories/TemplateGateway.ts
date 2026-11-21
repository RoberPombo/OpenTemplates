/** Puerto de templates globales. */
import type { TemplateManifest } from "../../types";

export interface TemplateGateway {
  list(): Promise<TemplateManifest[]>;
  save(manifest: TemplateManifest): Promise<TemplateManifest>;
  delete(id: string): Promise<void>;
  agentsMd(id: string): Promise<string>;
  saveAgentsMd(id: string, content: string): Promise<string>;
}
