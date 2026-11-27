/**
 * Persistencia de la carrera: serializar, parsear, normalizar datos antiguos y
 * recuperar corridas vivas tras reabrir la app. El formato y su tolerancia no
 * dependen de la UI.
 */
import {
  isActiveRun,
  raceStatus,
  type Race,
  type RaceMerge,
  type RaceMergeStatus,
  type RaceRun,
  type RaceRunStatus,
} from "./state";

const SERIAL_VERSION = 1;

export function serializeRace(race: Race): string {
  return JSON.stringify({ version: SERIAL_VERSION, race });
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeRun(value: unknown): RaceRun | null {
  if (!value || typeof value !== "object") return null;
  const run = value as Record<string, unknown>;
  const model = run.model as Record<string, unknown> | undefined;
  if (
    typeof run.id !== "string" ||
    typeof run.status !== "string" ||
    !model ||
    typeof model.key !== "string" ||
    typeof model.providerID !== "string" ||
    typeof model.id !== "string"
  ) {
    return null;
  }
  const tokens = (run.tokens ?? {}) as Record<string, unknown>;
  const changes = run.changes as Record<string, unknown> | null | undefined;
  return {
    id: run.id,
    model: {
      key: model.key,
      providerID: model.providerID,
      id: model.id,
      name: typeof model.name === "string" ? model.name : model.id,
    },
    status: run.status as RaceRunStatus,
    directory: stringOrNull(run.directory) ?? "",
    worktree: stringOrNull(run.worktree),
    branch: stringOrNull(run.branch),
    sessionId: stringOrNull(run.sessionId),
    error: stringOrNull(run.error),
    cleanupError: stringOrNull(run.cleanupError),
    cost: numberOr(run.cost, 0),
    tokens: { input: numberOr(tokens.input, 0), output: numberOr(tokens.output, 0) },
    changes: changes
      ? {
          files: numberOr(changes.files, 0),
          additions: numberOr(changes.additions, 0),
          deletions: numberOr(changes.deletions, 0),
        }
      : null,
    summary: stringOrNull(run.summary),
    waitingFor:
      run.waitingFor === "permission" || run.waitingFor === "form" ? run.waitingFor : null,
    startedAt: typeof run.startedAt === "number" ? run.startedAt : null,
    endedAt: typeof run.endedAt === "number" ? run.endedAt : null,
    cleanedAt: typeof run.cleanedAt === "number" ? run.cleanedAt : null,
  };
}

function normalizeMerge(value: unknown): RaceMerge | null {
  if (!value || typeof value !== "object") return null;
  const merge = value as Record<string, unknown>;
  if (typeof merge.runId !== "string") return null;
  const status = merge.status;
  if (status !== "merged" && status !== "empty" && status !== "conflict" && status !== "failed") {
    return null;
  }
  return {
    runId: merge.runId,
    status: status as RaceMergeStatus,
    files: numberOr(merge.files, 0),
    additions: numberOr(merge.additions, 0),
    deletions: numberOr(merge.deletions, 0),
    conflicts: Array.isArray(merge.conflicts)
      ? merge.conflicts.filter((path): path is string => typeof path === "string")
      : [],
    message: stringOrNull(merge.message),
    at: numberOr(merge.at, 0),
  };
}

/** Lee una carrera persistida; `null` si el JSON no tiene la forma esperada. */
export function parseRace(raw: string | null): Race | null {
  if (!raw) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const wrapper = payload as Record<string, unknown>;
  if (wrapper.version !== SERIAL_VERSION || !wrapper.race || typeof wrapper.race !== "object") {
    return null;
  }
  const race = wrapper.race as Record<string, unknown>;
  if (
    typeof race.id !== "string" ||
    typeof race.workspaceId !== "string" ||
    typeof race.prompt !== "string" ||
    !Array.isArray(race.runs)
  ) {
    return null;
  }
  const runs = race.runs.map(normalizeRun);
  if (runs.some((run) => run === null)) return null;
  const winnerRunId = stringOrNull(race.winnerRunId);
  const normalized: Race = {
    id: race.id,
    workspaceId: race.workspaceId,
    prompt: race.prompt,
    agent: stringOrNull(race.agent),
    useWorktrees: race.useWorktrees === true,
    status: "finished",
    runs: runs as RaceRun[],
    winnerRunId:
      winnerRunId && (runs as RaceRun[]).some((run) => run.id === winnerRunId) ? winnerRunId : null,
    createdAt: numberOr(race.createdAt, 0),
    updatedAt: numberOr(race.updatedAt, 0),
    bootId: stringOrNull(race.bootId),
    merge: normalizeMerge(race.merge),
  };
  return { ...normalized, status: raceStatus(normalized) };
}

/**
 * Tras reabrir la app las corridas activas ya no tienen quien las escuche.
 * Se marcan como fallidas para no fingir que siguen vivas.
 */
export function recoverRace(race: Race, bootId: string, at: number): Race {
  if (race.bootId === bootId) return race;
  const runs = race.runs.map((run) =>
    isActiveRun(run)
      ? {
          ...run,
          status: "failed" as const,
          error: "La app se cerró durante la carrera.",
          waitingFor: null,
          endedAt: run.endedAt ?? at,
        }
      : run,
  );
  return { ...race, runs, status: raceStatus({ ...race, runs }), updatedAt: at };
}
