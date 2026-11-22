import type { InstallResult, UpdateGateway } from "../repositories/UpdateGateway";

/** Descarga e instala la actualización pendiente. */
export class InstallUpdate {
  private readonly updates: UpdateGateway;

  constructor(updates: UpdateGateway) {
    this.updates = updates;
  }

  execute(): Promise<InstallResult> {
    return this.updates.install();
  }
}
