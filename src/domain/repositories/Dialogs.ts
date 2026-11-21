/** Puertos de interacción con el usuario: confirmaciones y selector de carpetas. */
export interface ConfirmDialog {
  confirm(message: string): boolean;
}

export interface FolderPicker {
  pickDirectory(title: string): Promise<string | null>;
}
