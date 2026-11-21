/** Puerto de la biblioteca global de opencode (agentes, skills, MCPs…). */
import type { Library, McpInfo, SkillInfo } from "../../types";

export interface LibraryGateway {
  library(): Promise<Library>;
  mcps(): Promise<McpInfo[]>;
  skills(projectPath?: string | null): Promise<SkillInfo[]>;
}
