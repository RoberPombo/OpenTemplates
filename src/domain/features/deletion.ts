/**
 * Borrado de una feature: tipos del plan que calcula Rust y decisiones puras
 * que la UI necesita antes de confirmar. No toca git ni React.
 */

export type FeatureDeleteEntry = {
  /** `root` o `target`. */
  role: "root" | "target";
  name: string;
  repoPath: string;
  path: string;
  branch: string;
  baseBranch: string;
  exists: boolean;
  dirty: boolean;
  branchExists: boolean;
  /** La rama existe en `origin` o tiene upstream configurado. */
  branchPublished: boolean;
  /** Worktree ajeno que tiene checkouteada la rama. */
  branchInUse: string | null;
  /** Motivo por el que se conserva; `null` si se puede borrar. */
  protectReason: string | null;
};

export type FeatureDeletePreview = {
  featureId: string;
  name: string;
  directory: string;
  worktrees: FeatureDeleteEntry[];
  warnings: string[];
};

export type FeatureDeleteSkip = {
  repoPath: string;
  branch: string;
  reason: string;
};

export type FeatureDeleteOutcome = {
  featureDeleted: boolean;
  removedWorktrees: string[];
  removedBranches: string[];
  keptBranches: FeatureDeleteSkip[];
  errors: string[];
  warnings: string[];
};

export function dirtyWorktrees(preview: FeatureDeletePreview): FeatureDeleteEntry[] {
  return preview.worktrees.filter((entry) => entry.dirty);
}

export function needsDirtyConfirmation(preview: FeatureDeletePreview): boolean {
  return dirtyWorktrees(preview).length > 0;
}

/** El botón de confirmar solo se habilita si no hay sucios o se aceptó perderlos. */
export function canConfirmDeletion(preview: FeatureDeletePreview, forceDirty: boolean): boolean {
  return !needsDirtyConfirmation(preview) || forceDirty;
}

export function branchStatusLabel(entry: FeatureDeleteEntry): string {
  if (!entry.branchExists) return "no existe";
  if (entry.protectReason) return `se conserva: ${entry.protectReason}`;
  return "se borra";
}

export function deletionNotice(outcome: FeatureDeleteOutcome): string {
  const parts = [
    `Feature eliminada · ${outcome.removedWorktrees.length} worktree(s) y ${outcome.removedBranches.length} rama(s)`,
  ];
  if (outcome.keptBranches.length > 0) {
    parts.push(`${outcome.keptBranches.length} rama(s) conservadas`);
  }
  return `${parts.join(" · ")}.`;
}

export function deletionError(outcome: FeatureDeleteOutcome): string {
  const errors = outcome.errors.length > 0 ? outcome.errors.join(" ") : "No se pudo completar.";
  return `${errors} La feature sigue en la lista para poder reintentar.`;
}
