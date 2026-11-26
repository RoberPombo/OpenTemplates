/**
 * Lanzar el coordinador de una feature estándar: arranca su contexto/servidor,
 * crea la sesión y le envía el encargo. La sesión la crea la app, nunca otra
 * sesión; el coordinador solo conversa y escribe artefactos.
 */
import type { Feature } from "../features/model";
import type { FeatureRunnerInfo } from "../features/coordinator";
import { coordinatorPrompt } from "../features/coordinator";
import type { FeatureGateway } from "../repositories/FeatureGateway";
import type { ChatServer } from "../repositories/ChatGateway";
import type { ServerInfo } from "../../types";

export type CoordinatorLaunch = {
  feature: Feature;
  runner: FeatureRunnerInfo;
  sessionId: string;
};

function modelRef(raw: string | null | undefined): { providerID: string; id: string } | null {
  const value = raw?.trim();
  if (!value) return null;
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return null;
  return { providerID: value.slice(0, slash), id: value.slice(slash + 1) };
}

export class LaunchCoordinator {
  private readonly features: FeatureGateway;
  private readonly chat: (server: ServerInfo) => ChatServer;

  constructor(features: FeatureGateway, chat: (server: ServerInfo) => ChatServer) {
    this.features = features;
    this.chat = chat;
  }

  async execute(
    feature: Feature,
    profileId: string | null,
    now: number = Date.now(),
  ): Promise<CoordinatorLaunch> {
    const prompt = coordinatorPrompt(feature);
    if (!prompt) throw new Error("El flujo rápido no tiene coordinador.");
    const coordinate = feature.steps.find((step) => step.type === "coordinate");
    if (!coordinate) throw new Error("La feature no tiene paso de coordinación.");

    const runner = await this.features.startRunner(feature.id, coordinate.profileId ?? profileId);
    if (coordinate.sessionId) {
      return { feature, runner, sessionId: coordinate.sessionId };
    }

    const client = this.chat(runner.server);
    const model = modelRef(runner.server.model);
    const session = await client.session.create({
      location: { directory: runner.directory },
      title: `Coordinación · ${feature.name}`,
      ...(model ? { model } : {}),
    });

    const updated: Feature = {
      ...feature,
      status: feature.status === "confirmed" ? "running" : feature.status,
      steps: feature.steps.map((step) =>
        step.id === coordinate.id
          ? {
              ...step,
              sessionId: session.id,
              profileId: runner.profileId ?? step.profileId,
              status: step.status === "pending" ? "running" : step.status,
            }
          : step,
      ),
      updatedAt: now,
    };
    const saved = await this.features.save(updated);
    // El encargo va al hilo después de guardar la sesión: si falla el envío, la
    // sesión queda recuperable desde la UI.
    await client.session.prompt({ sessionID: session.id, text: prompt });
    return { feature: saved, runner, sessionId: session.id };
  }
}
