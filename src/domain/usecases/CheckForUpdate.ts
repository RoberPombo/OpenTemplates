import type { UpdateGateway, UpdateInfo } from "../repositories/UpdateGateway";

/** Consulta si hay una versión nueva publicada. */
export class CheckForUpdate {
  private readonly updates: UpdateGateway;

  constructor(updates: UpdateGateway) {
    this.updates = updates;
  }

  execute(): Promise<UpdateInfo | null> {
    return this.updates.check();
  }
}
