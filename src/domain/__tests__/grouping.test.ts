// @vitest-environment node
import { describe, expect, test } from "vitest";
import { groupWorkspacesByRepo } from "../workspace/grouping";
import { makeWorkspace } from "../../tests/fakes";
import type { Repo } from "../../types";

const repoA: Repo = {
  id: "rA",
  name: "Alpha",
  path: "/alpha",
  remote: null,
  provider: "github",
  mainBranch: "main",
  createdAt: 0,
  updatedAt: 0,
};
const repoB: Repo = { ...repoA, id: "rB", name: "Beta", path: "/beta" };

describe("groupWorkspacesByRepo", () => {
  test("agrupa por repo en el orden de la lista de repos, con título y subtítulo", () => {
    const w1 = makeWorkspace({ id: "w1", repoId: "rB" });
    const w2 = makeWorkspace({ id: "w2", repoId: "rA" });
    const w3 = makeWorkspace({ id: "w3", repoId: "rA" });
    const groups = groupWorkspacesByRepo([w1, w2, w3], [repoA, repoB]);
    expect(groups.map((group) => group.key)).toEqual(["rA", "rB"]);
    expect(groups[0]).toEqual({ key: "rA", title: "Alpha", subtitle: "/alpha", items: [w2, w3] });
    expect(groups[1].items).toEqual([w1]);
  });

  test("repos sin workspaces no generan grupo", () => {
    const groups = groupWorkspacesByRepo([makeWorkspace({ repoId: "rA" })], [repoA, repoB]);
    expect(groups).toHaveLength(1);
  });

  test("sueltos y repos desconocidos caen en 'Sin repo' al final", () => {
    const loose = makeWorkspace({ id: "w1", repoId: null });
    const orphan = makeWorkspace({ id: "w2", repoId: "fantasma" });
    const grouped = makeWorkspace({ id: "w3", repoId: "rA" });
    const groups = groupWorkspacesByRepo([loose, orphan, grouped], [repoA]);
    expect(groups.map((group) => group.title)).toEqual(["Alpha", "Sin repo"]);
    expect(groups[1].key).toBe("");
    expect(groups[1].items.map((workspace) => workspace.id)).toEqual(["w1", "w2"]);
    expect(groups[1].subtitle).toBeUndefined();
  });

  test("sin workspaces → sin grupos", () => {
    expect(groupWorkspacesByRepo([], [repoA])).toEqual([]);
  });
});
