/** Puerto de ajustes de la app y carga inicial. */
import type { AppSettings, Bootstrap } from "../../types";

export interface SettingsGateway {
  get(): Promise<AppSettings>;
  save(settings: AppSettings): Promise<AppSettings>;
}

export interface BootstrapGateway {
  bootstrap(): Promise<Bootstrap>;
}
