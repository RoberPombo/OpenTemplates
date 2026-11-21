/** Confirmaciones nativas del webview (window.confirm). */
import type { ConfirmDialog } from "../domain/repositories/Dialogs";

export class WindowConfirmDialog implements ConfirmDialog {
  confirm(message: string): boolean {
    return window.confirm(message);
  }
}
