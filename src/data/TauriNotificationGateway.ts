/**
 * Adaptador de notificaciones nativas con el plugin oficial de Tauri.
 *
 * Fuera de Tauri (navegador, `pnpm dev`, tests) todo degrada a no-op: importar
 * el plugin es seguro porque solo se llama cuando hay runtime de Tauri.
 */
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type {
  NotificationGateway,
  NotificationInput,
  NotificationPermission,
} from "../domain/repositories/NotificationGateway";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export class TauriNotificationGateway implements NotificationGateway {
  async requestPermission(): Promise<NotificationPermission> {
    if (!inTauri()) return "unsupported";
    try {
      if (await isPermissionGranted()) return "granted";
      return await requestPermission();
    } catch {
      return "unsupported";
    }
  }

  async notify(input: NotificationInput): Promise<void> {
    if (!inTauri()) return;
    try {
      if (!(await isPermissionGranted())) return;
      sendNotification({
        title: input.title,
        body: input.body,
        group: input.workspaceId,
      });
    } catch {
      // Un fallo del sistema de notificaciones no debe romper el chat.
    }
  }
}
