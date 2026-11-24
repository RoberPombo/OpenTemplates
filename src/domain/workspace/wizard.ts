/**
 * Reglas del wizard de creación de workspaces: identificadores, derivados,
 * conflictos de checkout principal y validación por paso.
 */
import type { Workspace } from "../../types";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function defaultBranch(slug: string): string {
  return slug || "rama";
}

export function defaultWorktreePath(worktreesRoot: string, repoName: string, slug: string): string {
  return `${worktreesRoot.replace(/\/$/, "")}/${slugify(repoName)}/${slug || "workspace"}`;
}

/** Workspaces en checkout principal del mismo repo (aviso de colisión). */
export function principalConflicts(workspaces: Workspace[], repoId: string): Workspace[] {
  return workspaces.filter(
    (workspace) => workspace.repoId === repoId && workspace.mode === "principal",
  );
}

/** Workspaces en checkout principal sobre la misma ruta. */
export function pathConflicts(workspaces: Workspace[], repoPath: string): Workspace[] {
  return workspaces.filter(
    (workspace) => workspace.mode === "principal" && workspace.projectPath === repoPath,
  );
}

export type WizardStepInput = {
  loose: boolean;
  loosePath: string;
  repoId: string | null;
  name: string;
  mode: "principal" | "worktree";
  useExisting: boolean;
  branch: string;
};

export function canContinue(step: number, input: WizardStepInput): boolean {
  const { loose, loosePath, repoId, name, mode, useExisting, branch } = input;
  if (step === 0) return loose ? loosePath.trim().length > 0 : repoId !== null;
  if (step === 1) return true;
  if (step === 2) {
    if (!name.trim()) return false;
    if (!loose && mode === "worktree" && useExisting && !branch.trim()) return false;
    return true;
  }
  return true;
}

export function quickProfileId(
  name: string,
  existingIds: string[],
): { id: string } | { error: string } {
  if (!name.trim()) {
    return { error: "Ponle un nombre al perfil." };
  }
  const id = slugify(name);
  if (!id) {
    return { error: "El nombre del perfil no genera un identificador válido." };
  }
  if (existingIds.includes(id)) {
    return { error: `Ya existe un perfil con el id "${id}".` };
  }
  return { id };
}

export function workspaceNameError(name: string): string | null {
  return name.trim() ? null : "Ponle un nombre al workspace.";
}
