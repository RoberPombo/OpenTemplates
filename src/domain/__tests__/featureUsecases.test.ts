// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import type { Feature } from "../features/model";
import type { FeatureProvisionOutcome } from "../features/provision";
import type { FeatureRunnerInfo } from "../features/coordinator";
import type { FeatureGateway } from "../repositories/FeatureGateway";
import type { ChatServer } from "../repositories/ChatGateway";
import { ApproveDecomposition } from "../usecases/ApproveDecomposition";
import { LaunchCoordinator } from "../usecases/LaunchCoordinator";
import { LaunchStep } from "../usecases/LaunchStep";
import { AdvanceStep } from "../usecases/AdvanceStep";
import { StartFeature } from "../usecases/StartFeature";
import { DeleteFeature } from "../usecases/DeleteFeature";
import type { ProfileGateway } from "../repositories/ProfileGateway";
import type { ProfileManifest } from "../../types";
import { makeFeature, makeRunner, makeStartedFeature } from "../../tests/fixtures";

function fakeGateway(overrides: Partial<FeatureGateway> = {}): FeatureGateway {
  return {
    list: vi.fn(async () => []),
    bootstrapCandidates: vi.fn(async () => ({ candidates: [], truncated: false })),
    save: vi.fn(async (feature: Feature) => feature),
    deletePreview: vi.fn(async (id: string) => ({
      featureId: id,
      name: "Demo",
      directory: `/data/features/${id}`,
      worktrees: [],
      warnings: [],
    })),
    delete: vi.fn(async () => ({
      featureDeleted: true,
      removedWorktrees: [],
      removedBranches: [],
      keptBranches: [],
      errors: [],
      warnings: [],
    })),
    provision: vi.fn(async (): Promise<FeatureProvisionOutcome> => ({
      feature: makeFeature(),
      worktrees: [],
      warnings: [],
      errors: [],
      applied: [],
      blocked: false,
    })),
    artifacts: vi.fn(async () => []),
    writeArtifact: vi.fn(async (_id: string, name: string, content: string) => ({
      name,
      content,
    })),
    startRunner: vi.fn(async (id: string): Promise<FeatureRunnerInfo> => ({
      featureId: id,
      profileId: null,
      directory: "/data/features/feat-1",
      contextHash: "hash",
      server: {
        workspaceId: id,
        baseUrl: "http://127.0.0.1:1",
        password: "pw",
        port: 1,
        pid: 1,
      },
      warnings: [],
    })),
    startStepRunner: vi.fn(async (id: string): Promise<FeatureRunnerInfo> => ({
      featureId: id,
      profileId: null,
      directory: "/data/features/feat-1",
      contextHash: "hash",
      server: {
        workspaceId: id,
        baseUrl: "http://127.0.0.1:1",
        password: "pw",
        port: 1,
        pid: 1,
      },
      warnings: [],
    })),
    runnerStatus: vi.fn(async () => null),
    stopRunner: vi.fn(async () => undefined),
    ...overrides,
  };
}

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

function fakeProfiles(profiles: ProfileManifest[] = [profile()]): ProfileGateway {
  return {
    list: vi.fn(async () => profiles),
    save: vi.fn(async (manifest: ProfileManifest) => manifest),
    delete: vi.fn(async () => undefined),
    agentsMd: vi.fn(async () => ""),
    saveAgentsMd: vi.fn(async (_id: string, content: string) => content),
  };
}

describe("LaunchStep", () => {
  test("crea la sesión en el worktree, guarda el paso antes del encargo y resuelve agente", async () => {
    const started = makeStartedFeature({ kind: "chore" });
    const implement = started.steps.find((step) => step.type === "implement")!;
    const runner = makeRunner(started.id, {
      profileId: "implementador",
      directory: "/data/features/feat-1/web",
      server: {
        ...makeRunner().server,
        model: "provider/model",
      },
    });
    const create = vi.fn(async () => ({ id: "ses-step" }));
    const prompt = vi.fn(async () => undefined);
    const client = {
      session: { create, prompt, remove: vi.fn(async () => undefined) },
    } as unknown as ChatServer;
    const gateway = fakeGateway({ startStepRunner: vi.fn(async () => runner) });

    const result = await new LaunchStep(gateway, fakeProfiles(), () => client).execute(
      started,
      implement.id,
      null,
      null,
      3000,
    );

    expect(gateway.startStepRunner).toHaveBeenCalledWith(started.id, implement.id, "implementador");
    expect(create).toHaveBeenCalledWith({
      location: { directory: runner.directory },
      title: expect.any(String),
      agent: "implementer",
      model: { providerID: "provider", id: "model" },
    });
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "ses-step",
        text: expect.stringContaining("Flujo rápido"),
      }),
    );
    const saved = result.feature.steps.find((step) => step.id === implement.id);
    expect(saved).toMatchObject({
      sessionId: "ses-step",
      profileId: "implementador",
      agentId: "implementer",
      contextHash: "hash",
      status: "running",
    });
    expect(result.feature.status).toBe("running");
  });

  test("reabre la sesión guardada sin crear otra ni repetir el encargo", async () => {
    const started = makeStartedFeature({ kind: "chore" });
    const implement = started.steps.find((step) => step.type === "implement")!;
    const withSession: Feature = {
      ...started,
      steps: started.steps.map((step) =>
        step.id === implement.id
          ? {
              ...step,
              sessionId: "ses-old",
              profileId: "implementador",
              contextHash: "hash",
            }
          : step,
      ),
    };
    const create = vi.fn();
    const prompt = vi.fn();
    const client = {
      session: { create, prompt, remove: vi.fn() },
    } as unknown as ChatServer;
    const runner = makeRunner(started.id, { profileId: "implementador" });
    const gateway = fakeGateway({ startStepRunner: vi.fn(async () => runner) });

    const result = await new LaunchStep(gateway, fakeProfiles(), () => client).execute(
      withSession,
      implement.id,
      null,
      null,
      3000,
    );

    expect(create).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
    expect(gateway.startStepRunner).toHaveBeenCalledWith(started.id, implement.id, "implementador");
    expect(result.feature).toBe(withSession);
    expect(result.sessionId).toBe("ses-old");
  });

  test("rechaza un paso que aún no está listo", async () => {
    const started = makeStartedFeature();
    const recon = started.steps.find((step) => step.type === "recon")!;
    const gateway = fakeGateway();

    await expect(
      new LaunchStep(gateway, fakeProfiles(), () => ({}) as ChatServer).execute(
        started,
        recon.id,
        null,
        null,
        3000,
      ),
    ).rejects.toThrow("dependencias pendientes");
    expect(gateway.startStepRunner).not.toHaveBeenCalled();
  });

  test("si no se puede guardar el paso, borra la sesión recién creada", async () => {
    const started = makeStartedFeature({ kind: "chore" });
    const implement = started.steps.find((step) => step.type === "implement")!;
    const remove = vi.fn(async () => undefined);
    const client = {
      session: {
        create: vi.fn(async () => ({ id: "ses-step" })),
        prompt: vi.fn(async () => undefined),
        remove,
      },
    } as unknown as ChatServer;
    const gateway = fakeGateway({
      save: vi.fn(async () => {
        throw new Error("disco lleno");
      }),
      startStepRunner: vi.fn(async () => makeRunner(started.id)),
    });

    await expect(
      new LaunchStep(gateway, fakeProfiles(), () => client).execute(
        started,
        implement.id,
        null,
        null,
        3000,
      ),
    ).rejects.toThrow("disco lleno");
    expect(remove).toHaveBeenCalledWith({ sessionID: "ses-step" });
  });
});

describe("AdvanceStep", () => {
  test("terminar deja el paso en revisión y aprobar lo cierra", async () => {
    const started = makeStartedFeature({ kind: "chore" });
    const implement = started.steps.find((step) => step.type === "implement")!;
    const running: Feature = {
      ...started,
      steps: started.steps.map((step) =>
        step.id === implement.id ? { ...step, status: "running", sessionId: "ses-step" } : step,
      ),
    };
    const gateway = fakeGateway();
    const usecase = new AdvanceStep(gateway);

    const review = await usecase.execute(running, implement.id, "finish", 3000);
    expect(review.steps.find((step) => step.id === implement.id)?.status).toBe("awaiting-review");

    const done = await usecase.execute(review, implement.id, "approve", 4000);
    expect(done.steps.find((step) => step.id === implement.id)?.status).toBe("done");
    expect(gateway.save).toHaveBeenCalledTimes(2);
  });

  test("no permite terminar un paso pendiente", async () => {
    const started = makeStartedFeature({ kind: "chore" });
    const implement = started.steps.find((step) => step.type === "implement")!;
    await expect(
      new AdvanceStep(fakeGateway()).execute(started, implement.id, "finish", 3000),
    ).rejects.toThrow("No se puede pasar");
  });
});

describe("StartFeature", () => {
  test("confirma, expande y guarda", async () => {
    const gateway = fakeGateway();
    const feature = await new StartFeature(gateway).execute(makeFeature(), 2000);

    expect(feature.status).toBe("confirmed");
    expect(feature.steps).toHaveLength(6);
    expect(gateway.save).toHaveBeenCalledWith(feature);
  });

  test("no guarda si falta el brief", async () => {
    const gateway = fakeGateway();
    await expect(new StartFeature(gateway).execute(makeFeature({ brief: " " }))).rejects.toThrow(
      "Describe la feature antes de confirmarla.",
    );
    expect(gateway.save).not.toHaveBeenCalled();
  });
});

describe("LaunchCoordinator", () => {
  test("arranca el runner, crea la sesión y guarda la coordinación", async () => {
    const started = await new StartFeature(fakeGateway()).execute(makeFeature(), 2000);
    const runner: FeatureRunnerInfo = {
      featureId: started.id,
      profileId: "coord",
      directory: "/data/features/feat-1/web",
      contextHash: "hash",
      server: {
        workspaceId: started.id,
        baseUrl: "http://127.0.0.1:4100",
        password: "pw",
        port: 4100,
        pid: 10,
      },
      warnings: [],
    };
    const prompt = vi.fn(async () => undefined);
    const client = {
      session: {
        create: vi.fn(async () => ({ id: "ses-coord" })),
        prompt,
      },
    } as unknown as ChatServer;
    const gateway = fakeGateway({ startRunner: vi.fn(async () => runner) });

    const result = await new LaunchCoordinator(gateway, () => client).execute(
      started,
      "coord",
      3000,
    );

    expect(gateway.startRunner).toHaveBeenCalledWith(started.id, "coord");
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "ses-coord",
        text: expect.stringContaining("Eres el coordinador"),
      }),
    );
    const coordinate = result.feature.steps.find((step) => step.type === "coordinate");
    expect(coordinate).toMatchObject({
      sessionId: "ses-coord",
      profileId: "coord",
      status: "running",
    });
    expect(result.feature.status).toBe("running");
    expect(result.sessionId).toBe("ses-coord");
  });

  test("reutiliza la sesión existente sin volver a enviar el encargo", async () => {
    const started = await new StartFeature(fakeGateway()).execute(makeFeature(), 2000);
    const withSession: Feature = {
      ...started,
      steps: started.steps.map((step) =>
        step.type === "coordinate" ? { ...step, sessionId: "ses-old", profileId: "coord" } : step,
      ),
    };
    const prompt = vi.fn(async () => undefined);
    const client = {
      session: { create: vi.fn(), prompt },
    } as unknown as ChatServer;
    const gateway = fakeGateway();

    const result = await new LaunchCoordinator(gateway, () => client).execute(
      withSession,
      null,
      3000,
    );

    expect(client.session.create).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
    expect(gateway.startRunner).toHaveBeenCalledWith(started.id, "coord");
    expect(result.sessionId).toBe("ses-old");
  });
});

describe("DeleteFeature", () => {
  test("pide la preview y ejecuta la limpieza con la confirmación de sucios", async () => {
    const preview = {
      featureId: "feat-1",
      name: "Demo",
      directory: "/data/features/feat-1",
      worktrees: [],
      warnings: [],
    };
    const outcome = {
      featureDeleted: true,
      removedWorktrees: ["/data/features/feat-1/meta"],
      removedBranches: ["feature/demo"],
      keptBranches: [],
      errors: [],
      warnings: [],
    };
    const gateway = fakeGateway({
      deletePreview: vi.fn(async () => preview),
      delete: vi.fn(async () => outcome),
    });
    const usecase = new DeleteFeature(gateway);

    expect(await usecase.preview("feat-1")).toEqual(preview);
    expect(await usecase.execute("feat-1", true)).toEqual(outcome);
    expect(gateway.deletePreview).toHaveBeenCalledWith("feat-1");
    expect(gateway.delete).toHaveBeenCalledWith("feat-1", true);
  });
});

describe("ApproveDecomposition", () => {
  test("guarda el artefacto, refresca pasos y provisiona targets nuevos", async () => {
    const started = await new StartFeature(fakeGateway()).execute(makeFeature(), 2000);
    const content = `\`\`\`feature-decomposition
{
  "requestTargets": [{ "name": "Back", "repoPath": "/repos/back", "scopes": ["api"] }],
  "proposeSteps": [{ "targetId": "target-web", "scopes": ["src"] }]
}
\`\`\``;
    let saved = started;
    const gateway = fakeGateway({
      save: vi.fn(async (feature: Feature) => {
        saved = feature;
        return feature;
      }),
      provision: vi.fn(async (): Promise<FeatureProvisionOutcome> => ({
        feature: saved,
        worktrees: [],
        warnings: [],
        errors: [],
        applied: [],
        blocked: false,
      })),
    });
    const result = await new ApproveDecomposition(gateway).execute(started, content, 3000);

    expect(gateway.writeArtifact).toHaveBeenCalledWith(started.id, "DECOMPOSITION.md", content);
    expect(result.addedTargets).toBe(1);
    expect(gateway.provision).toHaveBeenCalledWith(started.id);
    const back = result.feature.targets.find((target) => target.name === "Back");
    expect(back?.relativePath).toBe("back");
    const coordinate = result.feature.steps.find((step) => step.type === "coordinate");
    expect(coordinate?.status).toBe("done");
  });
});
