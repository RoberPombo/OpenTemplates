// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  buildGitStatus,
  checkCommit,
  commitMessagePrompt,
  parseAheadBehind,
  parseNumstat,
  parsePorcelainStatus,
  pushTarget,
  statusTotals,
  type GitStatus,
  type GitStatusRaw,
} from "../workspace/git";

function status(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    branch: "feat/x",
    upstream: "origin/feat/x",
    ahead: 0,
    behind: 0,
    remote: "git@github.com:acme/app.git",
    mainBranch: "main",
    files: [],
    ...overrides,
  };
}

const porcelain = [
  " M notas.txt\0",
  "A  nuevo.ts\0",
  "?? sin-seguir.txt\0",
  "R  nuevo/nombre.ts\0viejo/nombre.ts\0",
  " D borrado.txt\0",
  "UU conflicto.txt\0",
  "MM ambos.txt\0",
].join("");

describe("parsePorcelainStatus", () => {
  test("distingue staged, sin stage, añadidos, borrados y no rastreados", () => {
    const files = parsePorcelainStatus(porcelain);
    expect(files.map((file) => [file.path, file.status, file.staged])).toEqual([
      ["notas.txt", "modified", false],
      ["nuevo.ts", "added", true],
      ["sin-seguir.txt", "untracked", false],
      ["nuevo/nombre.ts", "renamed", true],
      ["borrado.txt", "deleted", false],
      ["conflicto.txt", "conflicted", true],
      ["ambos.txt", "modified", true],
    ]);
  });

  test("lee el renombrado en el orden nuevo, antiguo de porcelain -z", () => {
    const [renamed] = parsePorcelainStatus("R  nuevo.ts\0viejo.ts\0");
    expect(renamed?.path).toBe("nuevo.ts");
    expect(renamed?.oldPath).toBe("viejo.ts");
    expect(renamed?.index).toBe("R");
  });

  test("un fichero con cambios en índice y árbol queda preparado y modificado", () => {
    const [file] = parsePorcelainStatus("MM ambos.txt\0");
    expect(file?.staged).toBe(true);
    expect(file?.index).toBe("M");
    expect(file?.worktree).toBe("M");
  });
});

describe("parseNumstat y ahead/behind", () => {
  test("suma líneas y tolera binarios y renombrados", () => {
    const stats = parseNumstat(
      "2\t1\tnotas.txt\x00-\t-\tbin.png\x000\t0\t\x00viejo.ts\x00nuevo.ts\x00",
    );
    expect(stats.get("notas.txt")).toEqual({ additions: 2, deletions: 1, binary: false });
    expect(stats.get("bin.png")).toEqual({ additions: 0, deletions: 0, binary: true });
    expect(stats.get("nuevo.ts")).toEqual({ additions: 0, deletions: 0, binary: false });
  });

  test("ahead es el lado izquierdo y behind el derecho", () => {
    expect(parseAheadBehind("3\t2")).toEqual({ ahead: 3, behind: 2 });
    expect(parseAheadBehind("")).toEqual({ ahead: 0, behind: 0 });
    expect(parseAheadBehind(null)).toEqual({ ahead: 0, behind: 0 });
  });
});

describe("buildGitStatus", () => {
  test("cruza porcelain, numstat y no rastreados", () => {
    const raw: GitStatusRaw = {
      branch: "feat/x",
      upstream: "origin/feat/x",
      aheadBehind: "1\t2",
      remote: "git@github.com:acme/app.git",
      mainBranch: "main",
      porcelain: " M notas.txt\0?? sin-seguir.txt\0",
      numstat: "2\t1\tnotas.txt\0",
      untrackedStats: [{ path: "sin-seguir.txt", additions: 4, binary: false }],
    };
    const result = buildGitStatus(raw);
    expect(result.ahead).toBe(1);
    expect(result.behind).toBe(2);
    expect(result.files[0]).toMatchObject({ additions: 2, deletions: 1 });
    expect(result.files[1]).toMatchObject({ additions: 4, deletions: 0, status: "untracked" });
    expect(statusTotals(result)).toEqual({ files: 2, staged: 0, additions: 6, deletions: 1 });
  });
});

describe("checkCommit", () => {
  test("exige mensaje y cambios preparados", () => {
    expect(checkCommit(status(), " ")).toEqual({
      ok: false,
      error: "Escribe un mensaje de commit.",
    });
    expect(
      checkCommit(
        status({
          files: [
            {
              path: "a",
              status: "modified",
              staged: false,
              oldPath: null,
              index: null,
              worktree: "M",
              additions: 1,
              deletions: 0,
              binary: false,
            },
          ],
        }),
        "feat",
      ),
    ).toEqual({ ok: false, error: "No hay cambios preparados para el commit." });
  });

  test("confirma los ficheros que no entrarían en el commit", () => {
    const result = checkCommit(
      status({
        files: [
          {
            path: "a.txt",
            status: "modified",
            staged: true,
            oldPath: null,
            index: "M",
            worktree: null,
            additions: 1,
            deletions: 0,
            binary: false,
          },
          {
            path: "b.txt",
            status: "modified",
            staged: false,
            oldPath: null,
            index: null,
            worktree: "M",
            additions: 1,
            deletions: 0,
            binary: false,
          },
        ],
      }),
      "feat: a",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.needsConfirmation).toBe(true);
      expect(result.unstaged).toEqual(["b.txt"]);
    }
  });

  test("rechaza conflictos aunque haya algo preparado", () => {
    const result = checkCommit(
      status({
        files: [
          {
            path: "a.txt",
            status: "modified",
            staged: true,
            oldPath: null,
            index: "M",
            worktree: null,
            additions: 1,
            deletions: 0,
            binary: false,
          },
          {
            path: "c.txt",
            status: "conflicted",
            staged: true,
            oldPath: null,
            index: "U",
            worktree: "U",
            additions: 0,
            deletions: 0,
            binary: false,
          },
        ],
      }),
      "feat: a",
    );
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("conflictos");
  });

  test("pasa con confirmación explícita de lo no preparado", () => {
    const result = checkCommit(
      status({
        files: [
          {
            path: "a.txt",
            status: "modified",
            staged: true,
            oldPath: null,
            index: "M",
            worktree: "M",
            additions: 1,
            deletions: 0,
            binary: false,
          },
          {
            path: "b.txt",
            status: "untracked",
            staged: false,
            oldPath: null,
            index: null,
            worktree: null,
            additions: 2,
            deletions: 0,
            binary: false,
          },
        ],
      }),
      "feat: a",
      { confirmedUnstaged: true },
    );
    expect(result).toEqual({ ok: true, unstaged: ["a.txt", "b.txt"] });
  });
});

describe("pushTarget", () => {
  test("con upstream hace push normal y muestra rama y remoto", () => {
    expect(pushTarget(status())).toEqual({
      branch: "feat/x",
      setUpstream: false,
      remote: "origin",
      label: "Push a origin/feat/x",
    });
  });

  test("sin upstream propone publicar con -u", () => {
    expect(pushTarget(status({ upstream: null }))).toEqual({
      branch: "feat/x",
      setUpstream: true,
      remote: "origin",
      label: "Publicar rama (push -u origin/feat/x)",
    });
  });

  test("sin rama no deja publicar", () => {
    expect(pushTarget(status({ branch: null }))).toEqual({
      error: "La rama está desacoplada; cambia a una rama antes de publicar.",
    });
  });
});

describe("commitMessagePrompt", () => {
  test("incluye el diff y lo recorta si es enorme", () => {
    const prompt = commitMessagePrompt("+linea", 100);
    expect(prompt).toContain("conventional commits");
    expect(prompt).toContain("+linea");
    const long = commitMessagePrompt("x".repeat(200), 100);
    expect(long).toContain("[diff recortado por tamaño]");
    expect(long.length).toBeLessThan(600);
    expect(long).not.toContain("x".repeat(150));
  });
});
