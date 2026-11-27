// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  branchStatusLabel,
  canConfirmDeletion,
  deletionError,
  deletionNotice,
  dirtyWorktrees,
  needsDirtyConfirmation,
  type FeatureDeleteEntry,
  type FeatureDeletePreview,
} from "../features/deletion";

function entry(overrides: Partial<FeatureDeleteEntry> = {}): FeatureDeleteEntry {
  return {
    role: "root",
    name: "Meta",
    repoPath: "/repos/meta",
    path: "/data/features/feat-1/meta",
    branch: "feature/demo",
    baseBranch: "main",
    exists: true,
    dirty: false,
    branchExists: true,
    branchPublished: false,
    branchInUse: null,
    protectReason: null,
    ...overrides,
  };
}

function preview(worktrees: FeatureDeleteEntry[]): FeatureDeletePreview {
  return {
    featureId: "feat-1",
    name: "Demo",
    directory: "/data/features/feat-1",
    worktrees,
    warnings: [],
  };
}

describe("borrado de features", () => {
  test("detecta los worktrees sucios y bloquea hasta aceptarlos", () => {
    const dirty = preview([entry({ dirty: true }), entry({ path: "/otro" })]);
    expect(dirtyWorktrees(dirty)).toHaveLength(1);
    expect(needsDirtyConfirmation(dirty)).toBe(true);
    expect(canConfirmDeletion(dirty, false)).toBe(false);
    expect(canConfirmDeletion(dirty, true)).toBe(true);
    expect(canConfirmDeletion(preview([entry()]), false)).toBe(true);
  });

  test("etiqueta las ramas que se borran y las protegidas", () => {
    expect(branchStatusLabel(entry())).toBe("se borra");
    expect(branchStatusLabel(entry({ protectReason: "rama base" }))).toBe("se conserva: rama base");
    expect(branchStatusLabel(entry({ branchExists: false }))).toBe("no existe");
  });

  test("resume el resultado y explica el fallo parcial", () => {
    const notice = deletionNotice({
      featureDeleted: true,
      removedWorktrees: ["/a", "/b"],
      removedBranches: ["feature/demo"],
      keptBranches: [{ repoPath: "/r", branch: "feature/demo", reason: "publicada en origin" }],
      errors: [],
      warnings: [],
    });
    expect(notice).toBe("Feature eliminada · 2 worktree(s) y 1 rama(s) · 1 rama(s) conservadas.");

    const error = deletionError({
      featureDeleted: false,
      removedWorktrees: ["/a"],
      removedBranches: [],
      keptBranches: [],
      errors: ["No se pudo quitar /b"],
      warnings: [],
    });
    expect(error).toContain("No se pudo quitar /b");
    expect(error).toContain("sigue en la lista");
  });
});
