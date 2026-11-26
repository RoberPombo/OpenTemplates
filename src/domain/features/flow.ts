/**
 * Expansión del flujo de una feature a pasos concretos. La receta es la misma
 * para todos los tipos; lo que cambia es qué pasos entran (`standard` o `fast`)
 * y el fan-out por `targets × scopes`.
 */
import type { Feature, FeatureStep, FeatureTarget, Result, Scope, StepType } from "./model";
import { confirmFeature } from "./model";

export const STANDARD_STEPS: StepType[] = [
  "coordinate",
  "recon",
  "plan",
  "implement",
  "verify",
  "integrate",
];

export const FAST_STEPS: StepType[] = ["implement", "verify", "integrate"];

export function stepId(
  featureId: string,
  type: StepType,
  targetId: string | null,
  scopeId: string | null,
): string {
  return targetId && scopeId
    ? `${featureId}:${type}:${targetId}:${scopeId}`
    : `${featureId}:${type}`;
}

function scopesOf(target: FeatureTarget): Scope[] {
  return target.scopes.length > 0 ? target.scopes : [{ id: "scope-root", path: "." }];
}

/**
 * Genera el grafo de pasos. No lo guarda: `startFeature` confirma y expande.
 * Las dependencias son explícitas para que la app pueda avanzar el grafo.
 */
export function expandSteps(feature: Feature): FeatureStep[] {
  const steps: FeatureStep[] = [];
  const coordinateId = stepId(feature.id, "coordinate", null, null);

  const push = (
    type: StepType,
    target: FeatureTarget | null,
    scope: Scope | null,
    dependsOn: string[],
  ) => {
    steps.push({
      id: stepId(feature.id, type, target?.id ?? null, scope?.id ?? null),
      type,
      targetId: target?.id ?? null,
      scopeId: scope?.id ?? null,
      profileId: null,
      agentId: null,
      dependsOn,
      status: "pending",
      sessionId: null,
    });
  };

  if (feature.flow === "standard") {
    push("coordinate", null, null, []);
  }

  const verifyIds: string[] = [];

  for (const target of feature.targets) {
    for (const scope of scopesOf(target)) {
      const reconId = stepId(feature.id, "recon", target.id, scope.id);
      const planId = stepId(feature.id, "plan", target.id, scope.id);
      const implementId = stepId(feature.id, "implement", target.id, scope.id);
      const verifyId = stepId(feature.id, "verify", target.id, scope.id);

      if (feature.flow === "standard") {
        push("recon", target, scope, [coordinateId]);
        push("plan", target, scope, [reconId]);
        push("implement", target, scope, [planId]);
      } else {
        push("implement", target, scope, []);
      }
      push("verify", target, scope, [implementId]);
      verifyIds.push(verifyId);
    }
  }

  push("integrate", null, null, verifyIds);
  return steps;
}

/** Confirma el alcance y genera los pasos. Es el arranque de una feature. */
export function startFeature(feature: Feature, now: number): Result<Feature> {
  const confirmed = confirmFeature(feature, now);
  if ("error" in confirmed) return confirmed;
  return {
    feature: {
      ...confirmed.feature,
      steps: expandSteps(confirmed.feature),
      updatedAt: now,
    },
  };
}

/** Pasos pendientes cuyas dependencias ya están `done`. */
export function readySteps(feature: Feature): FeatureStep[] {
  const done = new Set(
    feature.steps.filter((step) => step.status === "done").map((step) => step.id),
  );
  return feature.steps.filter(
    (step) => step.status === "pending" && step.dependsOn.every((id) => done.has(id)),
  );
}

const STEP_LABELS: Record<StepType, string> = {
  coordinate: "Coordinación",
  recon: "Investigación",
  plan: "Plan",
  implement: "Implementación",
  verify: "Verificación",
  integrate: "Integración",
};

export function stepLabel(feature: Feature, step: FeatureStep): string {
  const label = STEP_LABELS[step.type];
  const target = feature.targets.find((item) => item.id === step.targetId);
  if (!target) return label;
  const scope = target.scopes.find((item) => item.id === step.scopeId);
  const where = scope && scope.path !== "." ? `${target.name} · ${scope.path}` : target.name;
  return `${label} · ${where}`;
}
