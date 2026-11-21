/**
 * Política de aplicación de ajustes del workspace: qué MCPs quitar/añadir
 * y cuándo hace falta recargar la configuración del servidor.
 */

export function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((value) => set.has(value));
}

export function diffMcps(
  before: string[],
  after: string[],
): { removed: string[]; added: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    removed: [...beforeSet].filter((name) => !afterSet.has(name)),
    added: [...afterSet].filter((name) => !beforeSet.has(name)),
  };
}

/** Skills o modelo cambiaron → el servidor debe recargar su configuración. */
export function configNeedsReload(input: {
  beforeSkills: string[];
  afterSkills: string[];
  beforeModel: string | null | undefined;
  afterModel: string;
}): boolean {
  const skillsChanged = !sameSet(input.beforeSkills, input.afterSkills);
  const modelChanged = (input.beforeModel ?? "") !== input.afterModel.trim();
  return skillsChanged || modelChanged;
}
