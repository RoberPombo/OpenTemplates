/** Puerto de uso de recursos (app, workspace, sistema). */
import type { ResourceUsage } from "../../types";

export interface ResourcesGateway {
  usage(pid?: number | null): Promise<ResourceUsage>;
}
