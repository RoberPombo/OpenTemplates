// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  buildReviewPrompt,
  checksSummary,
  draftPullRequest,
  failedChecks,
  passedChecks,
  pendingChecks,
  prStateLabel,
  type PullRequestCheck,
  type PullRequestInfo,
} from "../workspace/pullRequest";

function check(overrides: Partial<PullRequestCheck> = {}): PullRequestCheck {
  return {
    name: "tests",
    state: "FAILURE",
    bucket: "failed",
    url: "https://ci.example/1",
    workflow: "CI",
    ...overrides,
  };
}

function pullRequest(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    number: 12,
    title: "Flujo git",
    state: "OPEN",
    url: "https://github.com/acme/app/pull/12",
    isDraft: false,
    baseBranch: "develop",
    headBranch: "feat/git-y-pr",
    reviewDecision: "CHANGES_REQUESTED",
    reviews: [
      {
        author: "ana",
        state: "CHANGES_REQUESTED",
        body: "falta un test para el hook",
        submittedAt: "2026-01-01T00:00:00Z",
      },
    ],
    comments: [
      {
        author: "luis",
        body: "revisa los renombrados",
        createdAt: "2026-01-02T00:00:00Z",
        url: "https://github.com/acme/app/pull/12#c1",
      },
    ],
    ...overrides,
  };
}

describe("checks de la PR", () => {
  test("filtra fallidos, pendientes y verdes", () => {
    const checks = [
      check(),
      check({ name: "lint", state: "SUCCESS", bucket: "passed" }),
      check({ name: "deploy", state: "PENDING", bucket: "pending" }),
    ];
    expect(failedChecks(checks).map((item) => item.name)).toEqual(["tests"]);
    expect(passedChecks(checks).map((item) => item.name)).toEqual(["lint"]);
    expect(pendingChecks(checks).map((item) => item.name)).toEqual(["deploy"]);
    expect(checksSummary(checks)).toEqual({ passed: 1, failed: 1, pending: 1, total: 3 });
  });

  test("los buckets desconocidos no cuentan como fallo", () => {
    expect(failedChecks([check({ bucket: "failed", state: "CANCELLED" })])).toHaveLength(1);
    expect(failedChecks([check({ bucket: "skipped" })])).toHaveLength(0);
  });
});

describe("borrador de pull request", () => {
  test("usa el primer asunto como título y lista los commits", () => {
    const draft = draftPullRequest({
      branch: "feat/git-y-pr",
      base: "develop",
      commits: [
        { subject: "feat(git): stage por fichero", body: "" },
        { subject: "test(git): cubre renombrados", body: "" },
      ],
    });
    expect(draft.title).toBe("feat(git): stage por fichero");
    expect(draft.body).toContain("- feat(git): stage por fichero");
    expect(draft.body).toContain("- test(git): cubre renombrados");
    expect(draft.body).toContain("2 commit(s)");
  });

  test("sin commits propone un título con la rama y no inventa cuerpo", () => {
    const draft = draftPullRequest({ branch: "feat/vacia", base: "main", commits: [] });
    expect(draft.title).toBe("Cambios en feat/vacia");
    expect(draft.body).toContain("Cambios de la rama");
  });

  test("recorta títulos y limita la lista de commits", () => {
    const draft = draftPullRequest({
      branch: "x",
      base: "main",
      commits: Array.from({ length: 40 }, (_, index) => ({
        subject: `commit ${index} ${"x".repeat(90)}`,
        body: "",
      })),
    });
    expect(draft.title.length).toBeLessThanOrEqual(72);
    expect(draft.body.match(/- commit/g)).toHaveLength(30);
  });
});

describe("prompt de revisión", () => {
  test("incluye checks fallidos, revisiones y comentarios, sin los checks verdes", () => {
    const prompt = buildReviewPrompt({
      pullRequest: pullRequest(),
      checks: [check(), check({ name: "lint", state: "SUCCESS", bucket: "passed" })],
    });
    expect(prompt).toContain("pull request #12");
    expect(prompt).toContain("tests: FAILURE");
    expect(prompt).toContain("https://ci.example/1");
    expect(prompt).not.toContain("lint");
    expect(prompt).toContain("ana (CHANGES_REQUESTED): falta un test para el hook");
    expect(prompt).toContain("luis: revisa los renombrados");
  });

  test("recorta cuerpos largos y el total del prompt", () => {
    const long = "x".repeat(5_000);
    const prompt = buildReviewPrompt({
      pullRequest: pullRequest({
        reviews: [
          {
            author: "ana",
            state: "COMMENTED",
            body: long,
            submittedAt: null,
          },
        ],
        comments: [],
      }),
      checks: [check()],
    });
    expect(prompt.length).toBeLessThanOrEqual(4_000);
    expect(prompt).toContain("…");
    expect(prompt).not.toContain("x".repeat(500));
  });

  test("el total del prompt también se recorta", () => {
    const prompt = buildReviewPrompt({
      pullRequest: pullRequest(),
      checks: [check()],
      limit: 260,
    });
    expect(prompt.length).toBeLessThanOrEqual(260);
    expect(prompt.endsWith("… (recortado)")).toBe(true);
  });

  test("un cuerpo de revisión nunca se vuelca entero", () => {
    const prompt = buildReviewPrompt({
      pullRequest: pullRequest({
        reviews: [
          { author: "ana", state: "COMMENTED", body: "y".repeat(5_000), submittedAt: null },
        ],
        comments: [],
      }),
      checks: [],
      limit: 10_000,
    });
    expect(prompt.length).toBeLessThan(800);
  });

  test("devuelve vacío si no hay nada que corregir", () => {
    expect(
      buildReviewPrompt({
        pullRequest: pullRequest({ reviews: [], comments: [] }),
        checks: [check({ bucket: "passed", state: "SUCCESS" })],
      }),
    ).toBe("");
    expect(buildReviewPrompt({ pullRequest: null, checks: [] })).toBe("");
  });

  test("etiqueta los estados de la PR", () => {
    expect(prStateLabel("OPEN")).toBe("abierta");
    expect(prStateLabel("MERGED")).toBe("fusionada");
    expect(prStateLabel("CLOSED")).toBe("cerrada");
  });
});
