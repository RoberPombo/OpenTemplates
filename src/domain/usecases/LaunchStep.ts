/**
 * Lanzar o reabrir la sesión de un paso. La app crea la sesión, la guarda en el
 * paso antes de enviar el encargo y reutiliza `sessionId` al reabrir, nunca la
 * duplica. El worktree y el perfil salen del propio paso.
 */
import type { Feature } from "../features/model";
import type { FeatureRunnerInfo } from "../features/coordinator";
import {
  canLaunchStep,
  resolveStepAgent,
  resolveStepProfile,
  stepPrompt,
  stepSessionTitle,
} from "../features/steps";
import { parseModelRef } from "../chat/selection";
import type { FeatureGateway } from "../repositories/FeatureGateway";
import type { ProfileGateway } from "../repositories/ProfileGateway";
import type { ChatServer } from "../repositories/ChatGateway";

export type StepLaunch = {
  feature: Feature;
  runner: FeatureRunnerInfo;
  stepId: string;
  sessionId: string;
};

export class LaunchStep {
  private readonly features: FeatureGateway;
  private readonly profiles: ProfileGateway;
  private readonly chat: (server: FeatureRunnerInfo["server"]) => ChatServer;

  constructor(
    features: FeatureGateway,
    profiles: ProfileGateway,
    chat: (server: FeatureRunnerInfo["server"]) => ChatServer,
  ) {
    this.features = features;
    this.profiles = profiles;
    this.chat = chat;
  }

  async execute(
    feature: Feature,
    stepId: string,
    profileId: string | null = null,
    defaultProfileId: string | null = null,
    now: number = Date.now(),
  ): Promise<StepLaunch> {
    const check = canLaunchStep(feature, stepId);
    if ("error" in check) throw new Error(check.error);
    const step = check.step;
    const profiles = await this.profiles.list();
    const resolvedProfile = resolveStepProfile(step, profiles, defaultProfileId, profileId);
    if (!resolvedProfile) {
      throw new Error("Crea un perfil antes de lanzar la sesión del paso.");
    }
    const manifest = profiles.find((profile) => profile.id === resolvedProfile) ?? null;
    const agentId = resolveStepAgent(step, manifest);

    const runner = await this.features.startStepRunner(feature.id, step.id, resolvedProfile);
    if (step.sessionId) {
      if (step.contextHash && step.contextHash !== runner.contextHash) {
        runner.warnings.push(
          "El contexto del paso cambió; la sesión guardada puede no estar en este servidor.",
        );
      }
      return { feature, runner, stepId: step.id, sessionId: step.sessionId };
    }

    const client = this.chat(runner.server);
    const model = parseModelRef(runner.server.model);
    const session = await client.session.create({
      location: { directory: runner.directory },
      title: stepSessionTitle(feature, step),
      ...(agentId ? { agent: agentId } : {}),
      ...(model ? { model } : {}),
    });

    const prompt = stepPrompt(feature, step, {
      profile: manifest,
      agentId,
      model: runner.server.model ?? null,
      directory: runner.directory,
    });
    if (!prompt) throw new Error("Este paso se abre desde el panel del coordinador.");

    const updated: Feature = {
      ...feature,
      status: feature.status === "confirmed" ? "running" : feature.status,
      steps: feature.steps.map((item) =>
        item.id === step.id
          ? {
              ...item,
              sessionId: session.id,
              profileId: resolvedProfile,
              agentId,
              contextHash: runner.contextHash,
              status: item.status === "pending" ? "running" : item.status,
            }
          : item,
      ),
      updatedAt: now,
    };

    let saved: Feature;
    try {
      saved = await this.features.save(updated);
    } catch (error) {
      // Si no se pudo guardar el paso, la sesión no debe quedar huérfana.
      try {
        await client.session.remove({ sessionID: session.id });
      } catch {
        // El error original es el que importa.
      }
      throw error;
    }

    // El encargo va después de guardar: si falla el envío, la sesión queda
    // recuperable desde el paso.
    await client.session.prompt({ sessionID: session.id, text: prompt });
    return { feature: saved, runner, stepId: step.id, sessionId: session.id };
  }
}
