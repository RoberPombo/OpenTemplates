import { describe, expect, test } from "vitest";
import type { CreateFeatureInput, Feature, Result } from "../features/model";
import {
  branchName,
  branchPrefix,
  canTransitionStep,
  confirmFeature,
  createFeatureDraft,
  featureProgress,
  flowForKind,
  rootDirectory,
  scopeId,
  targetDirectory,
  transitionStep,
} from "../features/model";
import { expandSteps, readySteps, startFeature, stepLabel } from "../features/flow";

function draft(overrides: Partial<CreateFeatureInput> = {}): Feature {
  const result = createFeatureDraft({
    id: "feat-1",
    name: "Checkout con Stripe",
    kind: "feature",
    brief: "Añadir el checkout con Stripe",
    directory: "/data/features/feat-1",
    targets: [{ repoId: "repo-a", name: "Web", repoPath: "/repos/web" }],
    now: 1000,
    ...overrides,
  });
  if ("error" in result) throw new Error(result.error);
  return result.feature;
}

function expectFeature<T>(result: Result<T>): T {
  if ("error" in result) throw new Error(result.error);
  return result.feature;
}

function start(feature: Feature = draft(), now = 2000): Feature {
  return expectFeature(startFeature(feature, now));
}

function move(feature: Feature, stepId: string, to: Parameters<typeof transitionStep>[2]): Feature {
  return expectFeature(transitionStep(feature, stepId, to, 3000));
}

describe("createFeatureDraft", () => {
  test("crea un borrador con rama, base y scope por defecto", () => {
    const feature = draft();

    expect(feature.status).toBe("draft");
    expect(feature.flow).toBe("standard");
    expect(feature.steps).toEqual([]);
    expect(feature.targets).toHaveLength(1);

    const target = feature.targets[0];
    expect(target.branch).toBe("feature/checkout-con-stripe");
    expect(target.baseBranch).toBe("main");
    expect(target.relativePath).toBe("web");
    expect(target.scopes).toEqual([{ id: "scope-root", path: "." }]);
  });

  test("rechaza nombre vacío, sin targets y repos repetidos", () => {
    expect(
      createFeatureDraft({
        id: "f",
        name: "  ",
        kind: "feature",
        directory: "/d",
        targets: [{ repoId: null, name: "A", repoPath: "/a" }],
        now: 1,
      }),
    ).toEqual({ error: "Ponle un nombre a la feature." });

    expect(
      createFeatureDraft({
        id: "f",
        name: "A",
        kind: "feature",
        directory: "/d",
        targets: [],
        now: 1,
      }),
    ).toEqual({ error: "Elige al menos un repositorio." });

    expect(
      createFeatureDraft({
        id: "f",
        name: "A",
        kind: "feature",
        directory: "/d",
        targets: [
          { repoId: null, name: "A", repoPath: "/a" },
          { repoId: null, name: "B", repoPath: "/a" },
        ],
        now: 1,
      }),
    ).toEqual({ error: "El repositorio «B» está repetido en la feature." });
  });

  test("monta un multirepo con raíz y rutas de subrepo", () => {
    const feature = draft({
      root: { repoId: "main", name: "Main", repoPath: "/repos/main" },
      targets: [
        { repoId: "front", name: "Front", repoPath: "/repos/front", scopes: ["apps/web"] },
        { repoId: "back", name: "Back", repoPath: "/repos/back" },
      ],
    });

    expect(feature.root?.relativePath).toBe("main");
    expect(feature.root?.branch).toBe("feature/checkout-con-stripe");
    expect(feature.targets[0].relativePath).toBe("main/repos/front");
    expect(feature.targets[1].relativePath).toBe("main/repos/back");
    expect(rootDirectory(feature)).toBe("/data/features/feat-1/main");
    expect(targetDirectory(feature, feature.targets[0])).toBe(
      "/data/features/feat-1/main/repos/front",
    );
  });

  test("un monorepo es un target con varios scopes", () => {
    const feature = draft({
      targets: [{ repoId: "b", name: "B", repoPath: "/repos/b", scopes: ["front", "back"] }],
    });

    expect(feature.root).toBeNull();
    expect(feature.targets[0].scopes.map((scope) => scope.path)).toEqual(["front", "back"]);
    expect(targetDirectory(feature, feature.targets[0])).toBe("/data/features/feat-1/b");
  });

  test("desempata ids de scope repetidos", () => {
    expect(scopeId("front")).toBe("scope-front");
    expect(scopeId("front", ["scope-front"])).toBe("scope-front-2");

    const feature = draft({
      targets: [{ repoId: null, name: "A", repoPath: "/a", scopes: ["front", "front"] }],
    });
    expect(feature.targets[0].scopes.map((scope) => scope.id)).toEqual([
      "scope-front",
      "scope-front-2",
    ]);
  });
});

describe("bootstrap", () => {
  test("normaliza las entradas de target y metarepo", () => {
    const feature = draft({
      root: {
        repoId: "main",
        name: "Main",
        repoPath: "/repos/main",
        bootstrap: [{ path: ".env.local", mode: "clone" }],
      },
      targets: [
        {
          repoId: "front",
          name: "Front",
          repoPath: "/repos/front",
          bootstrap: [
            { path: ".env", mode: "copy" },
            { path: "node_modules", mode: "auto", required: true },
          ],
        },
      ],
    });

    expect(feature.root?.bootstrap).toEqual([
      { path: ".env.local", mode: "clone", required: false },
    ]);
    expect(feature.targets[0].bootstrap).toEqual([
      { path: ".env", mode: "copy", required: false },
      { path: "node_modules", mode: "auto", required: true },
    ]);
  });

  test("rechaza rutas inseguras, modos desconocidos y duplicados", () => {
    const target = (bootstrap: unknown) =>
      createFeatureDraft({
        id: "f",
        name: "Demo",
        kind: "feature",
        directory: "/d",
        targets: [{ repoId: null, name: "Web", repoPath: "/web", bootstrap: bootstrap as never }],
        now: 1,
      });

    expect(target([{ path: "../fuera", mode: "copy" }])).toEqual({
      error: "«Web»: ruta de bootstrap no válida: '../fuera'.",
    });
    expect(target([{ path: ".git/config", mode: "copy" }])).toEqual({
      error: "«Web»: ruta de bootstrap no válida: '.git/config'.",
    });
    expect(target([{ path: ".env", mode: "symlink" }])).toEqual({
      error: "«Web»: modo de bootstrap desconocido: 'symlink'.",
    });
    expect(
      target([
        { path: ".env", mode: "copy" },
        { path: ".env", mode: "link" },
      ]),
    ).toEqual({
      error: "«Web»: bootstrap repetido: '.env'.",
    });
  });
});

describe("tipos y ramas", () => {
  test("feature y fix van por standard; hotfix y chore por fast", () => {
    expect(flowForKind("feature")).toBe("standard");
    expect(flowForKind("fix")).toBe("standard");
    expect(flowForKind("hotfix")).toBe("fast");
    expect(flowForKind("chore")).toBe("fast");
  });

  test("el prefijo de rama sigue al tipo", () => {
    expect(branchPrefix("feature")).toBe("feature");
    expect(branchPrefix("fix")).toBe("fix");
    expect(branchName("hotfix", "Caída de pagos")).toBe("hotfix/caida-de-pagos");
    expect(branchName("chore", "Actualizar CI")).toBe("chore/actualizar-ci");
  });
});

describe("startFeature", () => {
  test("confirma y expande un repo a 6 pasos con dependencias", () => {
    const feature = start();

    expect(feature.status).toBe("confirmed");
    expect(feature.steps.map((step) => step.type)).toEqual([
      "coordinate",
      "recon",
      "plan",
      "implement",
      "verify",
      "integrate",
    ]);
    expect(new Set(feature.steps.map((step) => step.id)).size).toBe(feature.steps.length);

    const byType = (type: string) => feature.steps.find((step) => step.type === type);
    expect(byType("integrate")?.dependsOn).toEqual([byType("verify")?.id]);
    expect(byType("recon")?.dependsOn).toEqual([byType("coordinate")?.id]);
    expect(byType("coordinate")?.dependsOn).toEqual([]);
  });

  test("con dos scopes duplica recon, plan, implementación y verificación", () => {
    const feature = start(
      draft({
        targets: [{ repoId: null, name: "B", repoPath: "/b", scopes: ["front", "back"] }],
      }),
    );

    expect(feature.steps).toHaveLength(10);
    expect(feature.steps.filter((step) => step.type === "recon")).toHaveLength(2);
    expect(feature.steps.filter((step) => step.type === "plan")).toHaveLength(2);
    expect(feature.steps.find((step) => step.type === "integrate")?.dependsOn).toHaveLength(2);
  });

  test("un hotfix va por fast: implementar, verificar e integrar", () => {
    const feature = start(draft({ kind: "hotfix" }));

    expect(feature.flow).toBe("fast");
    expect(feature.steps.map((step) => step.type)).toEqual(["implement", "verify", "integrate"]);
    expect(feature.steps[0].dependsOn).toEqual([]);
  });

  test("no confirma sin brief", () => {
    expect(confirmFeature(draft({ brief: "  " }), 2)).toEqual({
      error: "Describe la feature antes de confirmarla.",
    });
  });

  test("no confirma dos veces", () => {
    const feature = start();
    expect(confirmFeature(feature, 2)).toEqual({
      error: "Solo se confirma una feature en borrador.",
    });
  });
});

describe("readySteps", () => {
  test("en standard solo arranca coordinación; el resto espera", () => {
    const feature = start();
    expect(readySteps(feature).map((step) => step.type)).toEqual(["coordinate"]);
  });

  test("en fast la implementación está lista desde el principio", () => {
    const feature = start(draft({ kind: "chore" }));
    expect(readySteps(feature).map((step) => step.type)).toEqual(["implement"]);
  });

  test("avanza por dependencias y respeta el gate del plan", () => {
    let feature = start();
    const id = (type: string) => feature.steps.find((step) => step.type === type)?.id ?? "";

    feature = move(feature, id("coordinate"), "done");
    expect(feature.status).toBe("running");
    expect(readySteps(feature).map((step) => step.type)).toEqual(["recon"]);

    feature = move(feature, id("recon"), "done");
    expect(readySteps(feature).map((step) => step.type)).toEqual(["plan"]);

    feature = move(feature, id("plan"), "running");
    feature = move(feature, id("plan"), "awaiting-review");
    expect(readySteps(feature)).toEqual([]);

    feature = move(feature, id("plan"), "done");
    expect(readySteps(feature).map((step) => step.type)).toEqual(["implement"]);
  });

  test("no permite saltarse estados", () => {
    const feature = start();
    const id = feature.steps.find((step) => step.type === "coordinate")?.id ?? "";
    expect(canTransitionStep("pending", "awaiting-review")).toBe(false);
    expect(canTransitionStep("done", "running")).toBe(false);
    expect(canTransitionStep("running", "awaiting-review")).toBe(true);
    const done = move(feature, id, "done");
    expect(transitionStep(done, id, "running", 3)).toEqual({
      error: "No se puede pasar de 'done' a 'running'.",
    });
  });

  test("calcula progreso sin contar los omitidos", () => {
    let feature = start();
    const id = feature.steps.find((step) => step.type === "coordinate")?.id ?? "";
    feature = move(feature, id, "skipped");
    expect(featureProgress(feature)).toEqual({ done: 0, total: 5 });
  });
});

describe("expandSteps y etiquetas", () => {
  test("es determinista y no toca el estado del paso", () => {
    const feature = draft();
    const first = expandSteps(feature);
    const second = expandSteps(feature);
    expect(first).toEqual(second);
    expect(first.every((step) => step.status === "pending")).toBe(true);
  });

  test("la etiqueta incluye target y scope", () => {
    const feature = start(
      draft({
        targets: [{ repoId: null, name: "B", repoPath: "/b", scopes: ["front"] }],
      }),
    );
    const plan = feature.steps.find((step) => step.type === "plan");
    expect(plan && stepLabel(feature, plan)).toBe("Plan · B · front");
  });
});
