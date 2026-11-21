/** Crear un workspace: valida el nombre y delega en el gateway. */
import { workspaceNameError } from "../workspace/wizard";
import type { WorkspaceGateway } from "../repositories/WorkspaceGateway";
import type { ConfigOutcome, CreateWorkspaceInput } from "../../types";

export class CreateWorkspace {
  private readonly workspaces: WorkspaceGateway;

  constructor(workspaces: WorkspaceGateway) {
    this.workspaces = workspaces;
  }

  async execute(input: CreateWorkspaceInput): Promise<ConfigOutcome> {
    const nameError = workspaceNameError(input.name);
    if (nameError) throw new Error(nameError);
    return this.workspaces.create(input);
  }
}
