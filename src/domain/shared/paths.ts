/** Último segmento de una ruta (nombre de carpeta). */
export function folderName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}
