/** Puerto de actualizaciones: consultar, instalar y reiniciar. */

export interface UpdateInfo {
  /** Versión instalada ahora mismo. */
  currentVersion: string;
  /** Versión publicada a la que se puede saltar. */
  version: string;
  notes?: string;
}

export type InstallResult = { ok: true } | { ok: false; error: string };

export interface UpdateGateway {
  /** Devuelve la actualización disponible o null si ya está al día. */
  check(): Promise<UpdateInfo | null>;
  /** Descarga e instala la actualización pendiente. */
  install(): Promise<InstallResult>;
  /** Reinicia la app para aplicar la actualización instalada. */
  restart(): Promise<void>;
}
