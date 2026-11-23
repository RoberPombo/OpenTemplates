/** Ficheros de sesión con el diálogo nativo de Tauri y comandos de texto. */
import { open, save } from "@tauri-apps/plugin-dialog";
import type { SaveSessionFileResult, SessionFiles } from "../domain/repositories/SessionFiles";
import { api } from "./tauriCommands";

const FILTERS = [{ name: "Sesión de OpenTemplates", extensions: ["json"] }];

export class TauriSessionFiles implements SessionFiles {
  async save(input: {
    suggestedName: string;
    contents: string;
    overwrite?: boolean;
  }): Promise<SaveSessionFileResult> {
    const path = await save({
      title: "Exportar sesión",
      defaultPath: input.suggestedName,
      filters: FILTERS,
    });
    if (typeof path !== "string" || !path) return { status: "cancelled" };
    const written = await api.writeTextFile(path, input.contents, input.overwrite ?? false);
    return written ? { status: "saved", path } : { status: "exists", path };
  }

  async open(): Promise<{ path: string; contents: string } | null> {
    const path = await open({
      title: "Importar sesión",
      multiple: false,
      directory: false,
      filters: FILTERS,
    });
    if (typeof path !== "string" || !path) return null;
    return { path, contents: await api.readTextFile(path) };
  }
}
