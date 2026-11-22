import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type {
  InstallResult,
  UpdateGateway,
  UpdateInfo,
} from "../domain/repositories/UpdateGateway";

/** Updater de Tauri: `latest.json` publicado por el workflow de release. */
export class TauriUpdateGateway implements UpdateGateway {
  async check(): Promise<UpdateInfo | null> {
    try {
      const update = await check();
      if (!update) return null;
      const currentVersion = update.currentVersion ?? (await getVersion());
      return {
        currentVersion,
        version: update.version,
        notes: update.body ?? undefined,
      };
    } catch {
      // Sin releases, sin red o en el navegador (dev): simplemente no hay aviso.
      return null;
    }
  }

  async install(): Promise<InstallResult> {
    try {
      const update = await check();
      if (!update) return { ok: false, error: "No hay ninguna actualización pendiente" };
      await update.downloadAndInstall();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async restart(): Promise<void> {
    await relaunch();
  }
}
