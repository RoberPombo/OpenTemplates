/** Último segmento de una ruta (nombre de carpeta). */
export function folderName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/** Identificador estable a partir de un nombre (sin acentos, minúsculas, guiones). */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
