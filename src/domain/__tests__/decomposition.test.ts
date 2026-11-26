import { describe, expect, test } from "vitest";
import type { CreateFeatureInput, Feature } from "../features/model";
import { createFeatureDraft } from "../features/model";
import { startFeature } from "../features/flow";
import {
  applyDecomposition,
  parseDecomposition,
  type DecompositionProposal,
} from "../features/decomposition";
import { coordinatorProfileId } from "../features/coordinator";

function feature(overrides: Partial<CreateFeatureInput> = {}): Feature {
  const draft = createFeatureDraft({
    id: "feat-1",
    name: "Checkout con Stripe",
    kind: "feature",
    brief: "Cobrar con Stripe",
    directory: "/data/features/feat-1",
    root: { repoId: "main", name: "Main", repoPath: "/repos/main" },
    targets: [{ repoId: "front", name: "Front", repoPath: "/repos/front", scopes: ["front"] }],
    now: 1,
    ...overrides,
  });
  if ("error" in draft) throw new Error(draft.error);
  const started = startFeature(draft.feature, 2);
  if ("error" in started) throw new Error(started.error);
  return started.feature;
}

function block(value: unknown): string {
  return `# Plan\n\n\`\`\`feature-decomposition\n${JSON.stringify(value)}\n\`\`\`\n`;
}

const emptyProposal: DecompositionProposal = { requestTargets: [], proposeSteps: [] };

describe("parseDecomposition", () => {
  test("exige el bloque con la propuesta", () => {
    const result = parseDecomposition("# Sin bloque");
    expect("error" in result && result.error).toMatch(/feature-decomposition/);
  });

  test("lee targets y scopes y rechaza JSON roto", () => {
    const result = parseDecomposition(
      block({
        requestTargets: [{ name: "Back", repoPath: "/repos/back", scopes: ["api"] }],
        proposeSteps: [{ targetId: "target-front", scopes: ["src"] }],
      }),
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.proposal.requestTargets[0]).toMatchObject({
      name: "Back",
      repoPath: "/repos/back",
      baseBranch: "main",
    });
    expect(result.proposal.proposeSteps[0]).toEqual({
      targetId: "target-front",
      scopes: ["src"],
    });

    expect(parseDecomposition("```feature-decomposition\n{no json}\n```")).toHaveProperty("error");
  });

  test("rechaza scopes que se salen de la carpeta", () => {
    const result = parseDecomposition(
      block({ proposeSteps: [{ targetId: "target-front", scopes: ["../fuera"] }] }),
    );
    expect("error" in result && result.error).toMatch(/no válido/);
  });
});

describe("applyDecomposition", () => {
  test("marca coordinación como hecha y conserva su sesión", () => {
    const base = feature();
    const withSession: Feature = {
      ...base,
      steps: base.steps.map((step) =>
        step.type === "coordinate" ? { ...step, sessionId: "ses-1", status: "running" } : step,
      ),
    };

    const result = applyDecomposition(withSession, emptyProposal, 3);
    if ("error" in result) throw new Error(result.error);

    const coordinate = result.feature.steps.find((step) => step.type === "coordinate");
    expect(coordinate?.status).toBe("done");
    expect(coordinate?.sessionId).toBe("ses-1");
    expect(result.feature.status).toBe("running");
    expect(result.addedTargetIds).toEqual([]);
  });

  test("añade un target, le calcula worktree y refresca sus pasos", () => {
    const result = applyDecomposition(
      feature(),
      {
        requestTargets: [
          {
            name: "Back",
            repoId: "back",
            repoPath: "/repos/back",
            baseBranch: "develop",
            relativePath: null,
            scopes: ["api", "db"],
          },
        ],
        proposeSteps: [{ targetId: "target-front", scopes: ["web", "shared"] }],
      },
      3,
    );
    if ("error" in result) throw new Error(result.error);

    const back = result.feature.targets.find((target) => target.name === "Back");
    expect(result.addedTargetIds).toEqual([back?.id]);
    expect(back?.relativePath).toBe("main/repos/back");
    expect(back?.baseBranch).toBe("develop");
    expect(back?.scopes.map((scope) => scope.path)).toEqual(["api", "db"]);

    const front = result.feature.targets.find((target) => target.name === "Front");
    expect(front?.scopes.map((scope) => scope.path)).toEqual(["web", "shared"]);

    const backPlans = result.feature.steps.filter(
      (step) => step.targetId === back?.id && step.type === "plan",
    );
    expect(backPlans).toHaveLength(2);
    expect(result.feature.steps.filter((step) => step.type === "recon")).toHaveLength(4);
  });

  test("reutiliza un target si ya existe por ruta y rechaza ids desconocidos", () => {
    const reused = applyDecomposition(
      feature(),
      {
        requestTargets: [
          {
            name: "Front otra vez",
            repoId: "front",
            repoPath: "/repos/front",
            baseBranch: "main",
            relativePath: null,
            scopes: ["unico"],
          },
        ],
        proposeSteps: [],
      },
      3,
    );
    if ("error" in reused) throw new Error(reused.error);
    expect(reused.addedTargetIds).toEqual([]);
    expect(reused.feature.targets[0].scopes.map((scope) => scope.path)).toEqual(["unico"]);

    const unknown = applyDecomposition(
      feature(),
      { requestTargets: [], proposeSteps: [{ targetId: "nope", scopes: null }] },
      3,
    );
    expect("error" in unknown && unknown.error).toMatch(/no existe/);
  });

  test("en flujo rápido no se aplica", () => {
    const fast = feature({ kind: "hotfix" });
    const result = applyDecomposition(fast, emptyProposal, 3);
    expect("error" in result && result.error).toMatch(/flujo rápido/);
  });
});

describe("coordinatorProfileId", () => {
  const profiles = [
    { id: "front", name: "Front" },
    { id: "coord", name: "Coordinador barato" },
    { id: "back", name: "Back" },
  ];

  test("prioriza el perfil del paso y luego el de coordinador", () => {
    const base = feature();
    expect(coordinatorProfileId(base, profiles, "back")).toBe("coord");

    const explicit: Feature = {
      ...base,
      steps: base.steps.map((step) =>
        step.type === "coordinate" ? { ...step, profileId: "front" } : step,
      ),
    };
    expect(coordinatorProfileId(explicit, profiles, "back")).toBe("front");
  });

  test("cae al perfil por defecto y al primero", () => {
    const noNamed = profiles.filter((profile) => profile.id !== "coord");
    expect(coordinatorProfileId(feature(), noNamed, "back")).toBe("back");
    expect(coordinatorProfileId(feature(), [{ id: "solo", name: "Solo" }], null)).toBe("solo");
    expect(coordinatorProfileId(feature(), [], null)).toBeNull();
  });
});
