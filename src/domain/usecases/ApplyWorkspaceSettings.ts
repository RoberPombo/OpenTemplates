/**
 * Aplicar ajustes del workspace: persistir la config, sincronizar los MCPs
 * del servidor en caliente (quitar sobrantes, añadir nuevos) y recargar la
 * configuración del servidor si cambiaron skills o modelo.
 */
import { configNeedsReload, diffMcps } from "../workspace/config";
import { errorText } from "../shared/errors";
import type { ChatGateway } from "../repositories/ChatGateway";
import type { WorkspaceGateway } from "../repositories/WorkspaceGateway";
import type { ConfigOutcome, McpInfo, SkillRef, Workspace } from "../../types";

export class ApplyWorkspaceSettings {
  private readonly workspaces: WorkspaceGateway;
  private readonly server: ChatGateway | null;

  constructor(workspaces: WorkspaceGateway, server: ChatGateway | null) {
    this.workspaces = workspaces;
    this.server = server;
  }

  async execute(input: {
    workspace: Workspace;
    mcpNames: string[];
    skills: SkillRef[];
    model: string;
    mcps: McpInfo[];
  }): Promise<{ outcome: ConfigOutcome; mcpErrors: string[] }> {
    const { workspace, mcpNames, skills, model, mcps } = input;
    const outcome = await this.workspaces.update({
      id: workspace.id,
      mcpNames,
      skills,
      model: model.trim() || null,
    });

    const mcpErrors: string[] = [];
    if (this.server) {
      const location = { directory: workspace.projectPath };
      const { removed, added } = diffMcps(workspace.mcpNames, mcpNames);

      for (const name of removed) {
        await this.server.mcp.remove({ server: name, location }).catch(() => undefined);
      }
      for (const name of added) {
        const info = mcps.find((item) => item.name === name);
        if (!info) continue;
        await this.server.mcp
          .add({
            server: name,
            config: { ...info.config, disabled: false },
            location,
          })
          .catch((err) => mcpErrors.push(errorText(err)));
      }

      if (
        configNeedsReload({
          beforeSkills: workspace.skills.map((skill) => skill.id),
          afterSkills: skills.map((skill) => skill.id),
          beforeModel: workspace.model,
          afterModel: model,
        })
      ) {
        await this.server.location.reload();
      }
    }

    return { outcome, mcpErrors };
  }
}
