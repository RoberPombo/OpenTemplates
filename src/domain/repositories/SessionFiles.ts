/** Ficheros de sesión: diálogo nativo y lectura/escritura del JSON. */
export type SaveSessionFileResult =
  | { status: "saved"; path: string }
  | { status: "cancelled" }
  /** Ya hay un fichero en esa ruta; el llamador decide si sobrescribe. */
  | { status: "exists"; path: string };

export interface SessionFiles {
  /** Abre el diálogo de guardar y escribe; sin `overwrite` no pisa nada. */
  save(input: {
    suggestedName: string;
    contents: string;
    overwrite?: boolean;
  }): Promise<SaveSessionFileResult>;
  /** Abre el diálogo de abrir y devuelve el texto, o `null` si se cancela. */
  open(): Promise<{ path: string; contents: string } | null>;
}
