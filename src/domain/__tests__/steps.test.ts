import { describe, expect, test } from "vitest";
import type { Feature, FeatureStep, StepType } from "../features/model";
import { transitionStep } from "../features/model";
import {
  advanceStep,
  canLaunchStep,
  resolveStepAgent,
  resolveStepProfile,
  stepArtifactName,
  stepDirectory,
  stepPrompt,
} from "../features/steps";
import type { ProfileManifest } from "../../types";
import { makeStartedFeature } from "../../tests/fixtures";

function profile(overrides: Partial<ProfileManifest> = {}): ProfileManifest {
  return {
    id: "implementador",
    name: "Implementador",
    description: "",
    version: 1,
    agents: ["implementer"],
    skills: [],
    mcps: [],
    commands: [],
    plugins: [],
    models: [],
    permissions: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function stepOf(feature: Feature, type: StepType): FeatureStep {
  const step = feature.steps.find((item) => item.type === type);
  if (!step) throw new Error(`Falta el paso ${type}`);
  return step;
}

function move(feature: Feature, type: StepType, to: "running" | "awaiting-review" | "done") {
  const result = transitionStep(feature, stepOf(feature, type).id, to, 3000);
  if ("error" in result) throw new Error(result.error);
  return result.feature;
}

function rootFeature(): Feature {
  return makeStartedFeature({
    root: { repoId: "main", name: "Main", repoPath: "/repos/main" },
    targets: [{ repoId: "front", name: "Front", repoPath: "/repos/front", scopes: ["front"] }],
  });
}

describe("stepDirectory", () => {
  test("la coordinación usa la raíz y los pasos de target su worktree", () => {
    const feature = rootFeature();
    expect(stepDirectory(feature, stepOf(feature, "coordinate"))).toBe(
      "/data/features/feat-1/main",
    );
    expect(stepDirectory(feature, stepOf(feature, "recon"))).toBe(
      "/data/features/feat-1/main/repos/front",
    );
  });

  test("sin raíz, la coordinación usa la carpeta de la feature", () => {
    const feature = makeStartedFeature();
    expect(stepDirectory(feature, stepOf(feature, "coordinate"))).toBe("/data/features/feat-1");
    expect(stepDirectory(feature, stepOf(feature, "implement"))).toBe("/data/features/feat-1/web");
  });
});

describe("resolveStepProfile", () => {
  const implement = stepOf(makeStartedFeature({ kind: "chore" }), "implement");

  test("el perfil del paso manda sobre la elección de sesión ya creada", () => {
    const withSession = { ...implement, profileId: "implementador", sessionId: "ses-1" };
    expect(
      resolveStepProfile(
        withSession,
        [profile(), profile({ id: "otro", name: "Otro" })],
        null,
        "otro",
      ),
    ).toBe("implementador");
  });

  test("antes de crear la sesión, la elección explícita manda", () => {
    expect(
      resolveStepProfile(
        { ...implement, profileId: "implementador" },
        [profile(), profile({ id: "otro", name: "Otro" })],
        null,
        "otro",
      ),
    ).toBe("otro");
  });

  test("sin binding, busca por rol, luego el perfil por defecto y luego el primero", () => {
    const profiles = [profile({ id: "base", name: "Base" }), profile()];
    expect(resolveStepProfile(implement, profiles, "base")).toBe("implementador");
    expect(resolveStepProfile(implement, [profile({ id: "base", name: "Base" })], "base")).toBe(
      "base",
    );
    expect(resolveStepProfile(implement, [profile({ id: "solo", name: "Solo" })])).toBe("solo");
  });
});

describe("resolveStepAgent", () => {
  test("respeta el agente del paso y, si no, busca por rol", () => {
    const implement = stepOf(makeStartedFeature({ kind: "chore" }), "implement");
    const manifest = profile({ agents: ["reviewer", "implementer"] });
    expect(resolveStepAgent({ ...implement, agentId: "reviewer" }, manifest)).toBe("reviewer");
    expect(resolveStepAgent(implement, manifest)).toBe("implementer");
    expect(resolveStepAgent(implement, profile({ agents: [] }))).toBeNull();
  });
});

describe("stepArtifactName y stepPrompt", () => {
  test("nombra el artefacto por scope y cita lo que lee y escribe", () => {
    const feature = rootFeature();
    const recon = stepOf(feature, "recon");
    const plan = stepOf(feature, "plan");
    const implement = stepOf(feature, "implement");
    const verify = stepOf(feature, "verify");
    const integrate = stepOf(feature, "integrate");

    expect(stepArtifactName(feature, recon)).toBe("RECON-front.md");
    expect(stepArtifactName(feature, plan)).toBe("PLAN-front.md");
    expect(stepArtifactName(feature, verify)).toBe("VERIFY-front.md");
    expect(stepArtifactName(feature, implement)).toBeNull();

    const multi = makeStartedFeature({
      targets: [
        { repoId: null, name: "Front", repoPath: "/repos/front" },
        { repoId: null, name: "Back", repoPath: "/repos/back" },
      ],
    });
    const frontRecon = multi.steps.find(
      (step) => step.type === "recon" && step.targetId === multi.targets[0].id,
    )!;
    const backRecon = multi.steps.find(
      (step) => step.type === "recon" && step.targetId === multi.targets[1].id,
    )!;
    expect(stepArtifactName(multi, frontRecon)).toBe("RECON-front.md");
    expect(stepArtifactName(multi, backRecon)).toBe("RECON-back.md");

    const context = {
      profile: profile(),
      agentId: "implementer",
      model: "provider/model",
      directory: "/data/features/feat-1/main/repos/front",
    };
    expect(stepPrompt(feature, recon, context)).toContain("RECON-front.md");
    expect(stepPrompt(feature, plan, context)).toContain("RECON-front.md");
    expect(stepPrompt(feature, implement, context)).toContain(
      "Cambios de código solo en el scope `front`",
    );
    expect(stepPrompt(feature, implement, context)).toContain("no hagas commit ni push");
    expect(stepPrompt(feature, verify, context)).toContain("VERIFY-front.md");
    expect(stepPrompt(feature, integrate, context)).toContain("Rebase sobre la base remota");
  });

  test("el flujo rápido no inventa plan", () => {
    const feature = makeStartedFeature({ kind: "chore" });
    const prompt = stepPrompt(feature, stepOf(feature, "implement"), {
      profile: null,
      agentId: null,
      model: null,
      directory: "/data/features/feat-1/web",
    });
    expect(prompt).toContain("Flujo rápido");
    expect(prompt).toContain("no hay coordinador ni plan");
  });

  test("coordinación se abre desde su panel, no con este encargo", () => {
    const feature = makeStartedFeature();
    expect(
      stepPrompt(feature, stepOf(feature, "coordinate"), {
        profile: null,
        agentId: null,
        model: null,
        directory: "/data/features/feat-1",
      }),
    ).toBeNull();
  });
});

describe("canLaunchStep y advanceStep", () => {
  test("solo lanza pasos listos y la coordinación tiene su panel", () => {
    let feature = makeStartedFeature();
    expect(canLaunchStep(feature, stepOf(feature, "coordinate").id)).toEqual({
      error: "La coordinación se abre desde el panel del coordinador.",
    });
    expect(canLaunchStep(feature, stepOf(feature, "recon").id)).toEqual({
      error: "El paso aún tiene dependencias pendientes o un gate sin aprobar.",
    });

    feature = move(feature, "coordinate", "done");
    expect(canLaunchStep(feature, stepOf(feature, "recon").id)).toHaveProperty("step");

    feature = move(feature, "recon", "running");
    feature = move(feature, "recon", "awaiting-review");
    expect(canLaunchStep(feature, stepOf(feature, "plan").id)).toEqual({
      error: "El paso aún tiene dependencias pendientes o un gate sin aprobar.",
    });
    feature = move(feature, "recon", "done");
    expect(canLaunchStep(feature, stepOf(feature, "plan").id)).toHaveProperty("step");
  });

  test("el plan en revisión bloquea la implementación hasta aprobarlo", () => {
    let feature = makeStartedFeature();
    feature = move(feature, "coordinate", "done");
    feature = move(feature, "recon", "done");
    feature = move(feature, "plan", "running");

    const finished = advanceStep(feature, stepOf(feature, "plan").id, "awaiting-review", 4000);
    expect("error" in finished).toBe(false);
    if ("error" in finished) return;
    expect(canLaunchStep(finished.feature, stepOf(feature, "implement").id)).toEqual({
      error: "El paso aún tiene dependencias pendientes o un gate sin aprobar.",
    });

    const approved = advanceStep(finished.feature, stepOf(feature, "plan").id, "done", 5000);
    expect("error" in approved).toBe(false);
    if ("error" in approved) return;
    expect(canLaunchStep(approved.feature, stepOf(feature, "implement").id)).toHaveProperty("step");
  });

  test("aprobar el último paso cierra la feature", () => {
    const feature = makeStartedFeature();
    const steps = feature.steps.map((step) =>
      step.type === "integrate"
        ? { ...step, status: "awaiting-review" as const }
        : { ...step, status: "done" as const },
    );
    const result = advanceStep(
      { ...feature, steps },
      stepOf(feature, "integrate").id,
      "done",
      6000,
    );
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.feature.status).toBe("done");
  });
});
