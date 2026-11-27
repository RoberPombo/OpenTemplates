/**
 * Sesiones por paso: qué perfil y agente usa cada tipo, en qué worktree vive,
 * qué artefacto escribe y qué encargo recibe. También decide cuándo se puede
 * lanzar y cómo se cierra el paso sin saltarse dependencias ni gates.
 *
 * El coordinador conserva su panel propio; este módulo resuelve también su
 * perfil para que la precedencia sea una sola.
 */
import type { ProfileManifest } from "../../types";
import type { Feature, FeatureStep, FeatureTarget, Result, StepStatus, StepType } from "./model";
import { rootDirectory, targetDirectory, transitionStep } from "./model";
import { readySteps, stepLabel } from "./flow";
import { slugify } from "../shared/paths";

export type StepRole = {
  label: string;
  /** Nombres e ids de perfil que se reconocen para el rol. */
  profileHints: string[];
  /** Nombres e ids de agente que se reconocen para el rol. */
  agentHints: string[];
};

export const STEP_ROLES: Record<StepType, StepRole> = {
  coordinate: {
    label: "coordinador",
    profileHints: ["coordinador", "coordinator"],
    agentHints: ["coordinador", "coordinator"],
  },
  recon: {
    label: "explorador",
    profileHints: ["recon", "explorador", "explorer", "research"],
    agentHints: ["recon", "explorador", "explorer", "research"],
  },
  plan: {
    label: "planificador",
    profileHints: ["plan", "planificador", "planner"],
    agentHints: ["plan", "planificador", "planner"],
  },
  implement: {
    label: "implementador",
    profileHints: ["implement", "implementador", "implementer", "dev"],
    agentHints: ["implement", "implementador", "implementer", "dev"],
  },
  verify: {
    label: "verificador",
    profileHints: ["verify", "verificador", "verifier", "qa"],
    agentHints: ["verify", "verificador", "verifier", "qa"],
  },
  integrate: {
    label: "integrador",
    profileHints: ["integrate", "integrador", "integrator", "release"],
    agentHints: ["integrate", "integrador", "integrator", "release"],
  },
};

export type StepProfileRef = { id: string; name: string };

export type StepLaunchContext = {
  profile: ProfileManifest | null;
  agentId: string | null;
  model: string | null;
  directory: string;
};

export type StepCheck = { step: FeatureStep } | { error: string };

export function stepTarget(feature: Feature, step: FeatureStep): FeatureTarget | null {
  if (!step.targetId) return null;
  return feature.targets.find((target) => target.id === step.targetId) ?? null;
}

/** Ruta del scope relativa al worktree del target; `.` para el repo entero. */
export function stepScopePath(feature: Feature, step: FeatureStep): string {
  const target = stepTarget(feature, step);
  if (!target || !step.scopeId) return ".";
  return target.scopes.find((scope) => scope.id === step.scopeId)?.path ?? ".";
}

/**
 * Worktree donde corre la sesión. Los pasos de feature (coordinación e
 * integración) viven en la raíz; el resto, en el worktree de su target.
 */
export function stepDirectory(feature: Feature, step: FeatureStep): string | null {
  const target = stepTarget(feature, step);
  if (target) return targetDirectory(feature, target);
  return rootDirectory(feature) ?? feature.directory;
}

export function stepWorkspaceId(featureId: string, stepId: string): string {
  return `feature:${featureId}:${stepId}`;
}

export function stepScopeKey(step: FeatureStep): string {
  return `feature-step:${step.id}`;
}

export function stepSessionTitle(feature: Feature, step: FeatureStep): string {
  return stepLabel(feature, step);
}

function matches(label: string, hints: string[]): boolean {
  const normalized = label.toLowerCase();
  return hints.some((hint) => normalized.includes(hint));
}

/**
 * Perfil del paso: antes de crear la sesión manda la elección explícita, luego
 * el perfil guardado en el paso, el que se llama como el rol, el perfil por
 * defecto de la app y, por último, el primero. Una sesión ya creada conserva
 * el perfil del paso.
 */
export function resolveStepProfile(
  step: FeatureStep,
  profiles: StepProfileRef[],
  defaultProfileId?: string | null,
  override?: string | null,
): string | null {
  const exists = (id: string | null | undefined) =>
    Boolean(id && profiles.some((profile) => profile.id === id));
  // La elección de la sesión manda antes de crearla; después manda el binding
  // que quedó guardado en el paso.
  if (!step.sessionId && exists(override)) return override!;
  if (exists(step.profileId)) return step.profileId!;
  if (exists(override)) return override!;
  const hints = STEP_ROLES[step.type].profileHints;
  const named = profiles.find((profile) => matches(`${profile.id} ${profile.name}`, hints));
  if (named) return named.id;
  if (exists(defaultProfileId)) return defaultProfileId!;
  return profiles[0]?.id ?? null;
}

/**
 * Agente del paso dentro del perfil resuelto. Si no hay coincidencia se deja
 * `null` para que use el agente por defecto del servidor.
 */
export function resolveStepAgent(
  step: FeatureStep,
  profile: ProfileManifest | null,
): string | null {
  if (!profile) return step.agentId;
  const exists = (id: string | null): id is string => Boolean(id && profile.agents.includes(id));
  if (exists(step.agentId)) return step.agentId;
  const hints = STEP_ROLES[step.type].agentHints;
  return profile.agents.find((agent) => matches(agent, hints)) ?? null;
}

function artifactFor(type: StepType, feature: Feature, step: FeatureStep): string | null {
  const prefix =
    type === "recon" ? "RECON" : type === "plan" ? "PLAN" : type === "verify" ? "VERIFY" : null;
  if (!prefix) return null;
  const parts = [prefix];
  const target = stepTarget(feature, step);
  // Con varios targets, el scope `.` de cada uno no puede compartir artefacto.
  if (target && feature.targets.length > 1) {
    parts.push(slugify(target.name) || slugify(target.id) || "repo");
  }
  const scope = stepScopePath(feature, step);
  if (scope !== ".") parts.push(slugify(scope) || "scope");
  return `${parts.join("-")}.md`;
}

/** `RECON-front.md`, `PLAN.md`, `VERIFY-api.md`… */
export function stepArtifactName(feature: Feature, step: FeatureStep): string | null {
  return artifactFor(step.type, feature, step);
}

function targetName(feature: Feature, step: FeatureStep): string {
  const target = stepTarget(feature, step);
  return target?.name ?? feature.root?.name ?? "feature";
}

function readsFor(feature: Feature, step: FeatureStep): string[] {
  const lines = [`- ${feature.directory}/BRIEF.md`];
  if (feature.flow === "standard") lines.push(`- ${feature.directory}/DECOMPOSITION.md`);
  if (step.type === "plan") {
    const recon = artifactFor("recon", feature, step);
    if (recon) lines.push(`- ${feature.directory}/${recon}`);
  }
  if (step.type === "implement" || step.type === "verify") {
    const plan = artifactFor("plan", feature, step);
    if (plan) lines.push(`- ${feature.directory}/${plan}`);
  }
  if (step.type === "integrate") {
    lines.push(`- Los VERIFY-*.md de cada target y scope en ${feature.directory}`);
  }
  return lines;
}

function writesFor(feature: Feature, step: FeatureStep): string[] {
  const directory = feature.directory;
  const artifact = stepArtifactName(feature, step);
  switch (step.type) {
    case "recon":
      return [`- ${directory}/${artifact} (rutas, restricciones y dudas; no edites código)`];
    case "plan":
      return [
        `- ${directory}/${artifact} (decisión, pasos y criterios de aceptación; no edites código)`,
      ];
    case "implement":
      return [
        `- Cambios de código solo en el scope \`${stepScopePath(feature, step)}\` del worktree ${stepDirectory(feature, step) ?? "(sin worktree)"}`,
        "- La verificación y el commit son otros pasos: no hagas commit ni push",
      ];
    case "verify":
      return [
        `- ${directory}/${artifact} (resultado de tests, diff revisado y riesgos; no edites código)`,
      ];
    case "integrate":
      return [
        "- Rebase sobre la base remota, commit, push y PR cuando el usuario lo pida",
        "- Sin lógica de negocio ni cambios de código",
      ];
    default:
      return [];
  }
}

/**
 * Encargo de la sesión de un paso. `null` para `coordinate`: su conversación
 * sigue abriéndose desde el panel del coordinador con `coordinatorPrompt`.
 */
export function stepPrompt(
  feature: Feature,
  step: FeatureStep,
  context: StepLaunchContext,
): string | null {
  if (step.type === "coordinate") return null;
  const role = STEP_ROLES[step.type];
  const directory = context.directory;
  const scope = stepScopePath(feature, step);
  const lines = [
    `Eres el ${role.label} de la feature «${feature.name}» (${feature.id}).`,
    "",
    "No creas sesiones ni cambias el grafo de pasos: la app ejecuta y el usuario revisa.",
    "",
    "## Feature",
    feature.brief.trim() || "(sin brief)",
  ];

  if (feature.issue) {
    lines.push(
      "",
      `Issue: #${feature.issue.number} - ${feature.issue.title}` +
        (feature.issue.url ? `\n${feature.issue.url}` : ""),
    );
  }

  lines.push(
    "",
    "## Paso",
    `- Tipo: ${step.type} (${role.label})`,
    `- Repo: ${targetName(feature, step)}`,
    `- Scope: ${scope}`,
    `- Worktree: ${directory}`,
    `- Perfil: ${context.profile?.name ?? context.profile?.id ?? "(sin perfil)"}` +
      ` · agente: ${context.agentId ?? "(por defecto)"}` +
      ` · modelo: ${context.model ?? "(por defecto)"}`,
  );

  if (context.profile) {
    const available = [
      context.profile.skills.length > 0 ? `skills [${context.profile.skills.join(", ")}]` : "",
      context.profile.mcps.length > 0 ? `MCPs [${context.profile.mcps.join(", ")}]` : "",
      context.profile.plugins.length > 0 ? `plugins [${context.profile.plugins.join(", ")}]` : "",
    ].filter(Boolean);
    if (available.length > 0) lines.push(`- Disponible: ${available.join(", ")}`);
  }

  lines.push(
    "",
    "## Lee",
    ...readsFor(feature, step),
    "",
    "## Escribe",
    ...writesFor(feature, step),
  );

  if (feature.flow === "fast" && step.type === "implement") {
    lines.push(
      "",
      "Flujo rápido: no hay coordinador ni plan. Trabaja con el brief y el alcance de arriba,",
      "sin inventar un plan separado; la verificación es el paso siguiente.",
    );
  }

  lines.push(
    "",
    "## Reglas",
    "- No edites fuera del scope indicado.",
    "- No hagas commit ni push salvo en el paso de integración.",
    "- Deja el resultado en el artefacto indicado; el usuario lo revisará antes de avanzar.",
  );
  return lines.join("\n");
}

/** Solo se lanza un paso pendiente cuyas dependencias ya están `done`. */
export function canLaunchStep(feature: Feature, stepId: string): StepCheck {
  if (feature.status === "draft") {
    return { error: "Confirma y prepara la feature antes de lanzar pasos." };
  }
  if (feature.status === "done" || feature.status === "failed" || feature.status === "cancelled") {
    return { error: `La feature está '${feature.status}': no se lanzan pasos.` };
  }
  const step = feature.steps.find((item) => item.id === stepId);
  if (!step) return { error: `El paso '${stepId}' no existe.` };
  // Reabrir una sesión ya creada es válido aunque el paso esté en revisión.
  if (step.sessionId) return { step };
  if (step.status !== "pending") {
    return { error: "Solo se lanzan pasos pendientes." };
  }
  if (!readySteps(feature).some((item) => item.id === step.id)) {
    return { error: "El paso aún tiene dependencias pendientes o un gate sin aprobar." };
  }
  if (step.type === "coordinate") {
    return { error: "La coordinación se abre desde el panel del coordinador." };
  }
  return { step };
}

function allCountedStepsDone(feature: Feature): boolean {
  const counted = feature.steps.filter((step) => step.status !== "skipped");
  return counted.length > 0 && counted.every((step) => step.status === "done");
}

/**
 * Cierra un paso. `awaiting-review` es el gate; `done` libera a sus
 * dependientes. Al aprobar el último paso, la feature queda `done`.
 */
export function advanceStep(
  feature: Feature,
  stepId: string,
  to: Extract<StepStatus, "awaiting-review" | "done">,
  now: number,
): Result<Feature> {
  const moved = transitionStep(feature, stepId, to, now);
  if ("error" in moved) return moved;
  if (to !== "done" || !allCountedStepsDone(moved.feature)) return moved;
  return { feature: { ...moved.feature, status: "done", updatedAt: now } };
}
