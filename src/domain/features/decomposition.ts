/**
 * Descomposición del coordinador: la sesión escribe `DECOMPOSITION.md` y deja un
 * bloque `feature-decomposition` con lo que pide a la app. La app valida y
 * ejecuta; el coordinador nunca crea sesiones ni pasos por su cuenta.
 *
 * El bloque es la representación de `feature.request_target` y
 * `feature.propose_steps`: no hay MCP ni herramienta propia que mantener.
 */
import type { Feature, FeatureStep, FeatureTarget, Scope } from "./model";
import { DEFAULT_BASE_BRANCH, SUBMODULES_DIR, branchName, joinPath, scopeId } from "./model";
import { expandSteps } from "./flow";
import { slugify } from "../shared/paths";

export const DECOMPOSITION_BLOCK = "feature-decomposition";

export type DecompositionTargetRequest = {
  name: string;
  repoId: string | null;
  repoPath: string;
  baseBranch: string;
  relativePath: string | null;
  scopes: string[];
};

export type DecompositionStepRequest = {
  targetId: string;
  scopes: string[] | null;
};

export type DecompositionProposal = {
  requestTargets: DecompositionTargetRequest[];
  proposeSteps: DecompositionStepRequest[];
};

export type DecompositionOutcome = {
  feature: Feature;
  /** Targets nuevos; sus worktrees aún hay que provisionarlos. */
  addedTargetIds: string[];
};

export type ProposalResult = { proposal: DecompositionProposal } | { error: string };
export type ApplyResult = DecompositionOutcome | { error: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length === value.length ? items : null;
}

/** Localiza el bloque de propuesta dentro del markdown. */
export function decompositionBlock(content: string): string | null {
  const match = content.match(
    new RegExp("```" + DECOMPOSITION_BLOCK + "[^\\n]*\\n([\\s\\S]*?)```", "m"),
  );
  return match ? match[1].trim() : null;
}

/** Lee y valida la propuesta; cualquier duda se devuelve como error legible. */
export function parseDecomposition(content: string): ProposalResult {
  const raw = decompositionBlock(content);
  if (!raw) {
    return {
      error:
        `Falta el bloque \`\`\`${DECOMPOSITION_BLOCK} en DECOMPOSITION.md. ` +
        "La app no puede aplicar una descomposición sin él.",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { error: `El bloque ${DECOMPOSITION_BLOCK} no es JSON válido: ${String(err)}` };
  }
  const object = asRecord(parsed);
  if (!object) return { error: `El bloque ${DECOMPOSITION_BLOCK} debe ser un objeto JSON.` };

  const requestTargets: DecompositionTargetRequest[] = [];
  const rawTargets = object.requestTargets ?? [];
  if (!Array.isArray(rawTargets)) {
    return { error: "`requestTargets` debe ser una lista." };
  }
  for (const item of rawTargets) {
    const target = asRecord(item);
    if (!target) return { error: "Cada entrada de `requestTargets` debe ser un objeto." };
    const name = stringValue(target.name);
    const repoPath = stringValue(target.repoPath);
    if (!name || !repoPath) {
      return { error: "Cada target nuevo necesita `name` y `repoPath`." };
    }
    const baseBranch = stringValue(target.baseBranch) ?? DEFAULT_BASE_BRANCH;
    const relativePath = stringValue(target.relativePath);
    const scopes = target.scopes === undefined ? ["."] : stringList(target.scopes);
    if (!scopes) {
      return { error: `Target «${name}»: \`scopes\` debe ser una lista de rutas.` };
    }
    const scopeError = validateScopes(scopes);
    if (scopeError) return { error: `Target «${name}»: ${scopeError}` };
    requestTargets.push({
      name,
      repoId: stringValue(target.repoId),
      repoPath,
      baseBranch,
      relativePath,
      scopes,
    });
  }

  const proposeSteps: DecompositionStepRequest[] = [];
  const rawSteps = object.proposeSteps ?? [];
  if (!Array.isArray(rawSteps)) {
    return { error: "`proposeSteps` debe ser una lista." };
  }
  for (const item of rawSteps) {
    const step = asRecord(item);
    if (!step) return { error: "Cada entrada de `proposeSteps` debe ser un objeto." };
    const targetId = stringValue(step.targetId);
    if (!targetId) return { error: "Cada entrada de `proposeSteps` necesita `targetId`." };
    const scopes = step.scopes === undefined ? null : stringList(step.scopes);
    if (scopes === null && step.scopes !== undefined) {
      return { error: `Target «${targetId}»: \`scopes\` debe ser una lista de rutas.` };
    }
    if (scopes) {
      const scopeError = validateScopes(scopes);
      if (scopeError) return { error: `Target «${targetId}»: ${scopeError}` };
    }
    proposeSteps.push({ targetId, scopes });
  }

  return { proposal: { requestTargets, proposeSteps } };
}

function validateScopes(scopes: string[]): string | null {
  if (scopes.length === 0) return "necesita al menos un scope.";
  for (const raw of scopes) {
    const path = raw.trim();
    if (!path) return "un scope está vacío.";
    if (path.startsWith("/") || path.split(/[\\/]/).includes("..")) {
      return `scope no válido: '${path}'.`;
    }
  }
  return null;
}

function uniqueScopes(paths: string[]): Scope[] {
  const scopes: Scope[] = [];
  const taken: string[] = [];
  for (const raw of paths) {
    const path = raw.trim() || ".";
    const id = scopeId(path, taken);
    taken.push(id);
    scopes.push({ id, path });
  }
  return scopes;
}

function nextTargetId(name: string, taken: Iterable<string>): string {
  const base = `target-${slugify(name) || "repo"}`;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function addTarget(feature: Feature, request: DecompositionTargetRequest): FeatureTarget {
  const taken = feature.targets.map((target) => target.id);
  const details = request.relativePath
    ? request.relativePath
    : feature.root
      ? joinPath(feature.root.relativePath, SUBMODULES_DIR, slugify(request.name) || "repo")
      : slugify(request.name) || "repo";
  return {
    id: nextTargetId(request.name, taken),
    repoId: request.repoId,
    name: request.name,
    repoPath: request.repoPath,
    baseBranch: request.baseBranch || DEFAULT_BASE_BRANCH,
    branch: branchName(feature.kind, feature.name),
    relativePath: details,
    scopes: uniqueScopes(request.scopes),
    bootstrap: [],
  };
}

function withScopes(target: FeatureTarget, paths: string[]): FeatureTarget {
  return { ...target, scopes: uniqueScopes(paths) };
}

function mergeStep(generated: FeatureStep, previous: FeatureStep | undefined): FeatureStep {
  if (!previous) return generated;
  return {
    ...generated,
    status: previous.status,
    sessionId: previous.sessionId,
    profileId: previous.profileId,
    agentId: previous.agentId,
  };
}

/**
 * Aplica una propuesta ya validada. Solo flujo estándar: en `fast` no hay
 * coordinador. Aprobar marca `coordinate` como hecho y refresca el grafo,
 * conservando el estado de los pasos que siguen existiendo.
 */
export function applyDecomposition(
  feature: Feature,
  proposal: DecompositionProposal,
  now: number,
): ApplyResult {
  if (feature.flow !== "standard") {
    return { error: "El flujo rápido no tiene coordinador ni descomposición." };
  }
  const coordinate = feature.steps.find((step) => step.type === "coordinate");
  if (!coordinate) {
    return { error: "La feature no tiene paso de coordinación." };
  }

  let targets = feature.targets.map((target) => ({ ...target }));
  const addedTargetIds: string[] = [];

  for (const request of proposal.requestTargets) {
    const existing = targets.find((target) => target.repoPath === request.repoPath);
    if (existing) {
      targets = targets.map((target) =>
        target.id === existing.id ? withScopes(target, request.scopes) : target,
      );
      continue;
    }
    if (feature.root?.repoPath === request.repoPath) {
      return {
        error: `«${request.name}» es el metarepo: no puede entrar también como target.`,
      };
    }
    const target = addTarget({ ...feature, targets }, request);
    targets.push(target);
    addedTargetIds.push(target.id);
  }

  for (const request of proposal.proposeSteps) {
    const target = targets.find((item) => item.id === request.targetId);
    if (!target) {
      return { error: `El target '${request.targetId}' no existe en la feature.` };
    }
    if (request.scopes) {
      targets = targets.map((item) =>
        item.id === target.id ? withScopes(item, request.scopes!) : item,
      );
    }
  }

  let updated: Feature = { ...feature, targets, updatedAt: now };
  const generated = expandSteps(updated);
  const previous = new Map(feature.steps.map((step) => [step.id, step]));
  const steps = generated.map((step) => {
    if (step.type === "coordinate") {
      return {
        ...step,
        status: "done" as const,
        sessionId: coordinate.sessionId,
        profileId: coordinate.profileId,
        agentId: coordinate.agentId,
      };
    }
    return mergeStep(step, previous.get(step.id));
  });

  updated = {
    ...updated,
    status: feature.status === "blocked" ? "blocked" : "running",
    steps,
  };
  return { feature: updated, addedTargetIds };
}
