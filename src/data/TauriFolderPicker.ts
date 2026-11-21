/** Selector de carpetas nativo (plugin dialog de Tauri). */
import { open } from "@tauri-apps/plugin-dialog";
import type { FolderPicker } from "../domain/repositories/Dialogs";

export class TauriFolderPicker implements FolderPicker {
  async pickDirectory(title: string): Promise<string | null> {
    const picked = await open({ directory: true, multiple: false, title });
    return typeof picked === "string" ? picked : null;
  }
}
