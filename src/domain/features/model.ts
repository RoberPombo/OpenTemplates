/**
 * Modelo de una feature: unidad de trabajo con un objetivo, uno o varios repos
 * (targets) y un flujo de pasos. Sin React, sin git y sin persistencia: solo
 * tipos, invariantes y transiciones, para poder probarlo con secuencias.
 *
 * Ver `docs/modelo-features.md`. El worktree es perezoso hasta confirmar el
 * alcance; este módulo no toca disco ni crea ramas, solo calcula nombres.
 */
import type { BootstrapEntry, IssueRef } from "../../types";
import { slugify } from "../shared/paths";

export const FEATURE_KINDS = ["feature", "fix", "hotfix", "chore"] as const;
export type FeatureKind = (typeof FEATURE_KINDS)[number];

export const STEP_TYPES = [
  "coordinate",
  "recon",
  "plan",
  "implement",
  "verify",
  "integrate",
] as const;
export type StepType = (typeof STEP_TYPES)[number];

export type FlowName = "standard" | "fast";

export type FeatureStatus =
  | "draft"
  | "confirmed"
  | "running"
  | "blocked"
  | "done"
  | "failed"
  | "cancelled";

export type StepStatus = "pending" | "running" | "awaiting-review" | "done" | "failed" | "skipped";

export type Scope = {
  /** Estable dentro del target: `scope-front`. */
  id: string;
  /** Ruta relativa al repo; `.` para el repo entero. */
  path: string;
};

export type FeatureRoot = {
  repoId: string | null;
  name: string;
  /** Checkout principal del metarepo (origen del worktree). */
  repoPath: string;
  baseBranch: string;
  branch: string;
  /** Ruta relativa dentro de la carpeta de la feature, p. ej. `multirepo`. */
  relativePath: string;
  /** Ficheros/dirs a traer del checkout principal al worktree. */
  bootstrap: BootstrapEntry[];
};

export type FeatureTarget = {
  id: string;
  repoId: string | null;
  name: string;
  /** Checkout principal del repo o subrepo (origen del worktree). */
  repoPath: string;
  baseBranch: string;
  branch: string;
  /** Ruta relativa dentro de la carpeta de la feature. */
  relativePath: string;
  scopes: Scope[];
  /** Ficheros/dirs a traer del checkout principal al worktree. */
  bootstrap: BootstrapEntry[];
};

export type FeatureStep = {
  id: string;
  type: StepType;
  /** `null` en los pasos que cubren la feature entera. */
  targetId: string | null;
  scopeId: string | null;
  /** Perfil y agente se resuelven al lanzar el paso. */
  profileId: string | null;
  agentId: string | null;
  dependsOn: string[];
  status: StepStatus;
  sessionId: string | null;
  /** Huella del contexto donde vive `sessionId`; `null` hasta lanzar el paso. */
  contextHash: string | null;
};

export type Feature = {
  id: string;
  name: string;
  kind: FeatureKind;
  flow: FlowName;
  status: FeatureStatus;
  brief: string;
  issue: IssueRef | null;
  /** Carpeta de la feature; puede no existir en disco todavía. */
  directory: string;
  root: FeatureRoot | null;
  targets: FeatureTarget[];
  steps: FeatureStep[];
  createdAt: number;
  updatedAt: number;
};

export type FeatureTargetInput = {
  id?: string;
  repoId: string | null;
  name: string;
  repoPath: string;
  baseBranch?: string;
  branch?: string;
  relativePath?: string;
  scopes?: string[];
  bootstrap?: BootstrapEntry[];
};

export type FeatureRootInput = {
  repoId: string | null;
  name: string;
  repoPath: string;
  baseBranch?: string;
  branch?: string;
  relativePath?: string;
  bootstrap?: BootstrapEntry[];
};

export type CreateFeatureInput = {
  id: string;
  name: string;
  kind: FeatureKind;
  brief?: string;
  issue?: IssueRef | null;
  directory: string;
  root?: FeatureRootInput | null;
  targets: FeatureTargetInput[];
  now: number;
};

export type Result<T> = { feature: T } | { error: string };

export const DEFAULT_BASE_BRANCH = "main";
/** Carpeta del metarepo donde viven los submódulos, como en el flujo real. */
export const SUBMODULES_DIR = "repos";

export function flowForKind(kind: FeatureKind): FlowName {
  return kind === "hotfix" || kind === "chore" ? "fast" : "standard";
}

export function branchPrefix(kind: FeatureKind): string {
  return kind === "feature" ? "feature" : kind;
}

/** `feature/checkout-stripe`, `hotfix/caida-pagos`… */
export function branchName(kind: FeatureKind, name: string): string {
  return `${branchPrefix(kind)}/${slugify(name) || "trabajo"}`;
}

/** `scope-front`; dos rutas que colisionan se desempatan con sufijo. */
export function scopeId(path: string, taken: Iterable<string> = []): string {
  const base = `scope-${slugify(path === "." ? "root" : path) || "root"}`;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

export function joinPath(...parts: string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .map((part, index) => {
      if (index === 0) return part.replace(/\/+$/, "");
      return part.replace(/^\/+|\/+$/g, "");
    })
    .join("/");
}

export function rootDirectory(feature: Feature): string | null {
  return feature.root ? joinPath(feature.directory, feature.root.relativePath) : null;
}

export function targetDirectory(feature: Feature, target: FeatureTarget): string {
  return joinPath(feature.directory, target.relativePath);
}

const BOOTSTRAP_MODES: BootstrapEntry["mode"][] = ["auto", "copy", "link", "clone"];

/**
 * Normaliza la lista de bootstrap: rutas relativas seguras, modo conocido y sin
 * duplicados. `.` y `.git` quedan fuera a propósito: copiar el repo entero o su
 * metadata no es bootstrap.
 */
function normalizeBootstrap(
  raw: BootstrapEntry[] | undefined,
  label: string,
): { entries: BootstrapEntry[] } | { error: string } {
  const entries: BootstrapEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw ?? []) {
    const path = item.path.trim();
    if (!path || path === ".") {
      return { error: `«${label}»: una entrada de bootstrap no tiene ruta.` };
    }
    if (
      path.startsWith("/") ||
      path.split(/[\\/]/).includes("..") ||
      path === ".git" ||
      path.startsWith(".git/")
    ) {
      return { error: `«${label}»: ruta de bootstrap no válida: '${path}'.` };
    }
    if (!BOOTSTRAP_MODES.includes(item.mode)) {
      return { error: `«${label}»: modo de bootstrap desconocido: '${item.mode}'.` };
    }
    if (seen.has(path)) {
      return { error: `«${label}»: bootstrap repetido: '${path}'.` };
    }
    seen.add(path);
    entries.push({ path, mode: item.mode, required: Boolean(item.required) });
  }
  return { entries };
}

function normalizeScopes(raw: string[] | undefined, taken: string[]): Scope[] {
  const paths = raw && raw.length > 0 ? raw : ["."];
  const scopes: Scope[] = [];
  for (const path of paths) {
    const trimmed = path.trim() || ".";
    const id = scopeId(trimmed, taken);
    taken.push(id);
    scopes.push({ id, path: trimmed });
  }
  return scopes;
}

function targetRelativePath(input: FeatureTargetInput, root: FeatureRoot | null): string {
  if (input.relativePath?.trim()) return input.relativePath.trim();
  const own = slugify(input.name) || "repo";
  return root ? joinPath(root.relativePath, SUBMODULES_DIR, own) : own;
}

function targetId(input: FeatureTargetInput, taken: Iterable<string>): string {
  if (input.id?.trim()) return input.id.trim();
  const base = `target-${slugify(input.name) || "repo"}`;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

/**
 * Crea el borrador. No toca disco ni valida el alcance: eso es `startFeature`.
 */
export function createFeatureDraft(input: CreateFeatureInput): Result<Feature> {
  const name = input.name.trim();
  if (!name) return { error: "Ponle un nombre a la feature." };
  if (!input.directory.trim()) return { error: "La feature necesita una carpeta." };
  if (!FEATURE_KINDS.includes(input.kind)) {
    return { error: `Tipo de feature desconocido: '${input.kind}'.` };
  }
  if (input.targets.length === 0) {
    return { error: "Elige al menos un repositorio." };
  }

  const rootRelative = input.root?.relativePath?.trim() || slugify(input.root?.name ?? "");
  if (input.root && !rootRelative) {
    return { error: "El metarepo necesita un nombre válido." };
  }
  let rootBootstrap: BootstrapEntry[] = [];
  if (input.root) {
    const normalized = normalizeBootstrap(
      input.root.bootstrap,
      input.root.name.trim() || "metarepo",
    );
    if ("error" in normalized) return normalized;
    rootBootstrap = normalized.entries;
  }
  const root: FeatureRoot | null = input.root
    ? {
        repoId: input.root.repoId,
        name: input.root.name.trim(),
        repoPath: input.root.repoPath.trim(),
        baseBranch: input.root.baseBranch?.trim() || DEFAULT_BASE_BRANCH,
        branch: input.root.branch?.trim() || branchName(input.kind, name),
        relativePath: rootRelative,
        bootstrap: rootBootstrap,
      }
    : null;
  if (root && (!root.name || !root.repoPath)) {
    return { error: "El metarepo necesita nombre y ruta." };
  }

  const repoPaths = new Set<string>();
  if (root) repoPaths.add(root.repoPath);
  const targetIds: string[] = [];
  const scopeIds: string[] = [];
  const targets: FeatureTarget[] = [];

  for (const raw of input.targets) {
    const targetName = raw.name.trim();
    const repoPath = raw.repoPath.trim();
    if (!targetName) return { error: "Cada repositorio necesita un nombre." };
    if (!repoPath) return { error: `El repositorio «${targetName}» necesita una ruta.` };
    if (repoPaths.has(repoPath)) {
      return { error: `El repositorio «${targetName}» está repetido en la feature.` };
    }
    repoPaths.add(repoPath);

    const normalizedBootstrap = normalizeBootstrap(raw.bootstrap, targetName);
    if ("error" in normalizedBootstrap) return normalizedBootstrap;

    targets.push({
      id: targetId(raw, targetIds),
      repoId: raw.repoId,
      name: targetName,
      repoPath,
      baseBranch: raw.baseBranch?.trim() || DEFAULT_BASE_BRANCH,
      branch: raw.branch?.trim() || branchName(input.kind, name),
      relativePath: targetRelativePath({ ...raw, name: targetName }, root),
      scopes: normalizeScopes(raw.scopes, scopeIds),
      bootstrap: normalizedBootstrap.entries,
    });
    targetIds.push(targets[targets.length - 1].id);
  }

  return {
    feature: {
      id: input.id,
      name,
      kind: input.kind,
      flow: flowForKind(input.kind),
      status: "draft",
      brief: input.brief?.trim() ?? "",
      issue: input.issue ?? null,
      directory: input.directory.trim(),
      root,
      targets,
      steps: [],
      createdAt: input.now,
      updatedAt: input.now,
    },
  };
}

/** Cierra el alcance: issue, brief y scopes. No crea worktrees ni pasos. */
export function confirmFeature(feature: Feature, now: number): Result<Feature> {
  if (feature.status !== "draft") {
    return { error: "Solo se confirma una feature en borrador." };
  }
  if (!feature.brief.trim()) {
    return { error: "Describe la feature antes de confirmarla." };
  }
  if (feature.targets.length === 0) {
    return { error: "La feature necesita al menos un repositorio." };
  }
  if (feature.targets.some((target) => target.scopes.length === 0)) {
    return { error: "Cada repositorio necesita al menos un scope." };
  }
  return { feature: { ...feature, status: "confirmed", updatedAt: now } };
}

const ALLOWED_TRANSITIONS: Record<StepStatus, StepStatus[]> = {
  pending: ["running", "done", "skipped", "failed"],
  running: ["awaiting-review", "done", "failed"],
  "awaiting-review": ["running", "done", "failed"],
  done: [],
  failed: ["running", "skipped"],
  skipped: ["pending"],
};

export function canTransitionStep(from: StepStatus, to: StepStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Mueve un paso. `awaiting-review` es el gate (plan aprobado, verificación en
 * verde); el usuario lo cierra con `done`.
 */
export function transitionStep(
  feature: Feature,
  stepId: string,
  to: StepStatus,
  now: number,
): Result<Feature> {
  const step = feature.steps.find((item) => item.id === stepId);
  if (!step) return { error: `El paso '${stepId}' no existe.` };
  if (!canTransitionStep(step.status, to)) {
    return { error: `No se puede pasar de '${step.status}' a '${to}'.` };
  }
  return {
    feature: {
      ...feature,
      status: feature.status === "confirmed" ? "running" : feature.status,
      steps: feature.steps.map((item) => (item.id === stepId ? { ...item, status: to } : item)),
      updatedAt: now,
    },
  };
}

export function featureProgress(feature: Feature): { done: number; total: number } {
  const counted = feature.steps.filter((step) => step.status !== "skipped");
  return {
    done: counted.filter((step) => step.status === "done").length,
    total: counted.length,
  };
}

export function isFeatureClosed(feature: Feature): boolean {
  return feature.status === "done" || feature.status === "failed" || feature.status === "cancelled";
}
