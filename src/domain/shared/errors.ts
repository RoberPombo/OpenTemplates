/** Texto legible de un error desconocido (semántica original de App/CreateWorkspace). */
export function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Igual que `errorText`, con texto propio cuando el error es vacío. */
export function errorTextOr(error: unknown, fallback = "Error desconocido"): string {
  return error ? errorText(error) : fallback;
}
