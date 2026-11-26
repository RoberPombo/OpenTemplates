/**
 * Ficheros de sesión: el diálogo nativo lo abre Rust y devuelve la ruta junto
 * a un token de un solo uso. El webview nunca puede elegir una ruta por su
 * cuenta: `write_text_file` y `read_text_file` exigen ese ticket.
 */
import type { SaveSessionFileResult, SessionFiles } from "../domain/repositories/SessionFiles";
import { api } from "./tauriCommands";

export class TauriSessionFiles implements SessionFiles {
  async save(input: {
    suggestedName: string;
    contents: string;
    overwrite?: boolean;
  }): Promise<SaveSessionFileResult> {
    const ticket = await api.beginSessionFile("write", input.suggestedName);
    if (!ticket) return { status: "cancelled" };
    const written = await api.writeTextFile(
      ticket.path,
      input.contents,
      input.overwrite ?? false,
      ticket.token,
    );
    return written
      ? { status: "saved", path: ticket.path }
      : { status: "exists", path: ticket.path };
  }

  async open(): Promise<{ path: string; contents: string } | null> {
    const ticket = await api.beginSessionFile("read");
    if (!ticket) return null;
    return { path: ticket.path, contents: await api.readTextFile(ticket.path, ticket.token) };
  }
}
