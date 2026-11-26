// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import type { Feature } from "../features/model";
import type { FeatureProvisionOutcome } from "../features/provision";
import type { FeatureRunnerInfo } from "../features/coordinator";
import type { FeatureGateway } from "../repositories/FeatureGateway";
import type { ChatServer } from "../repositories/ChatGateway";
import { ApproveDecomposition } from "../usecases/ApproveDecomposition";
import { LaunchCoordinator } from "../usecases/LaunchCoordinator";
import { DeleteFeature } from "../usecases/DeleteFeature";
import { ProvisionFeature } from "../usecases/ProvisionFeature";
import { SaveFeature } from "../usecases/SaveFeature";
import { StartFeature } from "../usecases/StartFeature";
import { makeFeature } from "../../tests/fixtures";

function fakeGateway(overrides: Partial<FeatureGateway> = {}): FeatureGateway {
  return {
    list: vi.fn(async () => []),
    save: vi.fn(async (feature: Feature) => feature),
    remove: vi.fn(async () => undefined),
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
    runnerStatus: vi.fn(async () => null),
    stopRunner: vi.fn(async () => undefined),
    ...overrides,
  };
}

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

describe("SaveFeature", () => {
  test("delega en el gateway", async () => {
    const feature = makeFeature();
    const gateway = fakeGateway({
      save: vi.fn(async (): Promise<Feature> => ({ ...feature, status: "running" })),
    });
    const saved = await new SaveFeature(gateway).execute(feature);
    expect(saved.status).toBe("running");
    expect(gateway.save).toHaveBeenCalledWith(feature);
  });
});

describe("DeleteFeature", () => {
  test("borra por id", async () => {
    const gateway = fakeGateway();
    await new DeleteFeature(gateway).execute("feat-1");
    expect(gateway.remove).toHaveBeenCalledWith("feat-1");
  });
});

describe("ProvisionFeature", () => {
  test("pide materializar y devuelve el resultado", async () => {
    const outcome: FeatureProvisionOutcome = {
      feature: makeFeature(),
      worktrees: [
        {
          role: "root",
          repoPath: "/repos/main",
          path: "/data/features/feat-1/main",
          branch: "feature/checkout-con-stripe",
          base: "origin/develop",
        },
      ],
      warnings: ["aviso"],
      errors: [],
      applied: [".env listo"],
      blocked: false,
    };
    const gateway = fakeGateway({ provision: vi.fn(async () => outcome) });

    const result = await new ProvisionFeature(gateway).execute("feat-1");

    expect(result).toBe(outcome);
    expect(gateway.provision).toHaveBeenCalledWith("feat-1");
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
