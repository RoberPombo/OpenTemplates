// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  canContinue,
  defaultBranch,
  defaultWorktreePath,
  pathConflicts,
  principalConflicts,
  quickProfileId,
  slugify,
  workspaceNameError,
} from "../workspace/wizard";
import { makeWorkspace } from "../../tests/fakes";

describe("slugify", () => {
  test("minúsculas, espacios y símbolos a guiones, sin guiones extremos", () => {
    expect(slugify("Mi Workspace")).toBe("mi-workspace");
    expect(slugify("  Hola!! Mundo??  ")).toBe("hola-mundo");
    expect(slugify("A/B_C")).toBe("a-b-c");
  });

  test("unicode no ascii se elimina", () => {
    expect(slugify("Canción")).toBe("canci-n");
  });

  test("vacío o solo símbolos → vacío", () => {
    expect(slugify("")).toBe("");
    expect(slugify("!!!")).toBe("");
  });
});

describe("derivados del wizard", () => {
  test("defaultBranch usa el slug o 'rama'", () => {
    expect(defaultBranch("mi-rama")).toBe("mi-rama");
    expect(defaultBranch("")).toBe("rama");
  });

  test("defaultWorktreePath: raíz sin slash final + repo slug + slug o 'workspace'", () => {
    expect(defaultWorktreePath("/data/worktrees/", "Mi Repo", "feature")).toBe(
      "/data/worktrees/mi-repo/feature",
    );
    expect(defaultWorktreePath("/data/worktrees", "Repo", "")).toBe(
      "/data/worktrees/repo/workspace",
    );
  });
});

describe("conflictos de checkout principal", () => {
  const principal = makeWorkspace({
    id: "w1",
    repoId: "r1",
    mode: "principal",
    projectPath: "/repo",
  });
  const worktree = makeWorkspace({ id: "w2", repoId: "r1", mode: "worktree", projectPath: "/wt" });
  const otherRepo = makeWorkspace({
    id: "w3",
    repoId: "r2",
    mode: "principal",
    projectPath: "/repo2",
  });
  const loose = makeWorkspace({ id: "w4", repoId: null, mode: "principal", projectPath: "/repo" });

  test("principalConflicts: mismo repo y modo principal", () => {
    expect(principalConflicts([principal, worktree, otherRepo, loose], "r1")).toEqual([principal]);
    expect(principalConflicts([worktree], "r1")).toEqual([]);
  });

  test("pathConflicts: modo principal sobre la misma ruta", () => {
    expect(pathConflicts([principal, worktree, otherRepo, loose], "/repo")).toEqual([
      principal,
      loose,
    ]);
    expect(pathConflicts([worktree], "/repo")).toEqual([]);
  });
});

describe("canContinue", () => {
  const base = {
    loose: false,
    loosePath: "",
    repoId: "r1" as string | null,
    name: "",
    mode: "worktree" as "principal" | "worktree",
    useExisting: false,
    branch: "",
  };

  test("paso 0: repo seleccionado o carpeta suelta no vacía", () => {
    expect(canContinue(0, base)).toBe(true);
    expect(canContinue(0, { ...base, repoId: null })).toBe(false);
    expect(canContinue(0, { ...base, loose: true, loosePath: "  " })).toBe(false);
    expect(canContinue(0, { ...base, loose: true, loosePath: "/carpeta" })).toBe(true);
  });

  test("paso 1 siempre permite", () => {
    expect(canContinue(1, base)).toBe(true);
  });

  test("paso 2: nombre obligatorio; rama obligatoria solo en worktree con rama existente", () => {
    expect(canContinue(2, base)).toBe(false);
    expect(canContinue(2, { ...base, name: "  " })).toBe(false);
    expect(canContinue(2, { ...base, name: "ws" })).toBe(true);
    expect(canContinue(2, { ...base, name: "ws", useExisting: true })).toBe(false);
    expect(canContinue(2, { ...base, name: "ws", useExisting: true, branch: "dev" })).toBe(true);
    expect(canContinue(2, { ...base, name: "ws", useExisting: true, mode: "principal" })).toBe(
      true,
    );
    expect(canContinue(2, { ...base, name: "ws", useExisting: true, loose: true })).toBe(true);
  });

  test("paso 3 (resumen) siempre permite", () => {
    expect(canContinue(3, base)).toBe(true);
  });
});

describe("quickProfileId", () => {
  test("nombre vacío → error", () => {
    expect(quickProfileId("   ", [])).toEqual({ error: "Ponle un nombre al perfil." });
  });

  test("nombre sin slug válido → error", () => {
    expect(quickProfileId("!!!", [])).toEqual({
      error: "El nombre del perfil no genera un identificador válido.",
    });
  });

  test("id existente → error de colisión", () => {
    expect(quickProfileId("Mi Profile", ["mi-profile"])).toEqual({
      error: 'Ya existe un perfil con el id "mi-profile".',
    });
  });

  test("nombre válido → id", () => {
    expect(quickProfileId("Mi Profile", [])).toEqual({ id: "mi-profile" });
  });
});

describe("workspaceNameError", () => {
  test("nombre vacío o espacios → mensaje; nombre válido → null", () => {
    expect(workspaceNameError("")).toBe("Ponle un nombre al workspace.");
    expect(workspaceNameError("   ")).toBe("Ponle un nombre al workspace.");
    expect(workspaceNameError("ws")).toBeNull();
  });
});
