/**
 * Máquina de estados de una carrera multi-run: creación, transiciones de cada
 * corrida, eventos del servidor y derivados (totales, duración, limpieza).
 * Sin React ni cliente HTTP, para poder probarla con secuencias.
 *
 * Una corrida termina por evento del servidor (`session.idle`,
 * `session.execution.*`); el hook solo aporta I/O y datos (coste, cambios,
 * resumen). Elegir ganadora no borra nada por sí solo: devuelve la carrera con
 * la marca y el hook se encarga de cerrar y limpiar las perdedoras.
 */
import type { RawSessionMessage } from "../chat/messages";

export const MIN_RACE_RUNS = 2;
export const MAX_RACE_RUNS = 5;

/** Modelo ya resuelto para una corrida (no depende del catálogo al persistir). */
export type RaceModelRef = {
  key: string;
  providerID: string;
  id: string;
  name: string;
};

export type RaceStatus = "running" | "finished" | "settled";

export type RaceRunStatus =
  | "preparing"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "discarded"
  | "winner";

export type RaceRunWaiting = "permission" | "form";

export type RaceRunTokens = { input: number; output: number };

export type RaceRunChanges = {
  files: number;
  additions: number;
  deletions: number;
};

export type RaceRun = {
  id: string;
  model: RaceModelRef;
  status: RaceRunStatus;
  /** Carpeta donde corre la sesión (worktree propio o la del workspace). */
  directory: string;
  /** Ruta del worktree creado para esta corrida, si se pidieron worktrees. */
  worktree: string | null;
  /** Rama base de la que sale el worktree (informativa). */
  branch: string | null;
  sessionId: string | null;
  error: string | null;
  cleanupError: string | null;
  cost: number;
  tokens: RaceRunTokens;
  changes: RaceRunChanges | null;
  /** Último mensaje del agente, recortado para la tarjeta de comparación. */
  summary: string | null;
  waitingFor: RaceRunWaiting | null;
  startedAt: number | null;
  endedAt: number | null;
  cleanedAt: number | null;
};

/**
 * Hueco reservado para la fusión de resultados (siguiente paso). Hoy siempre
 * `null`; existe para que la persistencia y la UI no cambien de forma.
 */
export type RaceMerge = null;

export type Race = {
  id: string;
  workspaceId: string;
  prompt: string;
  agent: string | null;
  useWorktrees: boolean;
  status: RaceStatus;
  runs: RaceRun[];
  winnerRunId: string | null;
  createdAt: number;
  updatedAt: number;
  /** Identificador del arranque de la app que creó la carrera. */
  bootId: string | null;
  merge: RaceMerge;
};

export type RaceModelChoice = {
  key: string;
  providerID: string;
  id: string;
  name: string;
};

export type CreateRaceInput = {
  id: string;
  workspaceId: string;
  prompt: string;
  agent: string | null;
  useWorktrees: boolean;
  bootId: string | null;
  models: RaceModelChoice[];
  baseDirectory: string;
  baseBranch: string | null;
  now?: number;
};

export type CreateRaceResult = { race: Race } | { error: string };

const ACTIVE_RUNS: ReadonlySet<RaceRunStatus> = new Set(["preparing", "running", "waiting"]);

export function isActiveRun(run: RaceRun): boolean {
  return ACTIVE_RUNS.has(run.status);
}

export function raceIsLive(race: Race): boolean {
  return race.runs.some(isActiveRun);
}

/** Una corrida ya no depende del servidor: se puede cerrar y limpiar. */
export function runIsFinished(run: RaceRun): boolean {
  return (
    run.status === "succeeded" ||
    run.status === "failed" ||
    run.status === "discarded" ||
    run.status === "winner"
  );
}

export function canChooseWinner(run: RaceRun): boolean {
  return run.status === "succeeded";
}

export function raceStatus(race: Race): RaceStatus {
  if (race.winnerRunId) return "settled";
  return raceIsLive(race) ? "running" : "finished";
}

export function createRace(input: CreateRaceInput): CreateRaceResult {
  const prompt = input.prompt.trim();
  if (!prompt) return { error: "El encargo no puede estar vacío." };
  if (input.models.length < MIN_RACE_RUNS) {
    return { error: `Elige al menos ${MIN_RACE_RUNS} modelos.` };
  }
  if (input.models.length > MAX_RACE_RUNS) {
    return { error: `Como mucho ${MAX_RACE_RUNS} modelos por carrera.` };
  }
  const keys = input.models.map((model) => model.key);
  if (new Set(keys).size !== keys.length) {
    return { error: "Hay modelos repetidos en la carrera." };
  }
  const now = input.now ?? Date.now();
  const runs: RaceRun[] = input.models.map((model, index) => ({
    id: `${input.id}-run-${index + 1}`,
    model: { ...model },
    status: "preparing",
    directory: input.baseDirectory,
    worktree: null,
    branch: input.baseBranch,
    sessionId: null,
    error: null,
    cleanupError: null,
    cost: 0,
    tokens: { input: 0, output: 0 },
    changes: null,
    summary: null,
    waitingFor: null,
    startedAt: null,
    endedAt: null,
    cleanedAt: null,
  }));
  return {
    race: {
      id: input.id,
      workspaceId: input.workspaceId,
      prompt,
      agent: input.agent,
      useWorktrees: input.useWorktrees,
      status: "running",
      runs,
      winnerRunId: null,
      createdAt: now,
      updatedAt: now,
      bootId: input.bootId,
      merge: null,
    },
  };
}

function updateRun(race: Race, runId: string, update: (run: RaceRun) => RaceRun): Race {
  let changed = false;
  const runs = race.runs.map((run) => {
    if (run.id !== runId) return run;
    const next = update(run);
    if (next !== run) changed = true;
    return next;
  });
  if (!changed) return race;
  return { ...race, runs, updatedAt: Date.now() };
}

/** La corrida ya tiene worktree (o confirma que comparte carpeta). */
export function prepareRun(
  race: Race,
  runId: string,
  patch: { directory: string; worktree: string | null },
): Race {
  return updateRun(race, runId, (run) =>
    run.status === "discarded" || run.status === "winner"
      ? run
      : run.directory === patch.directory && run.worktree === patch.worktree
        ? run
        : { ...run, directory: patch.directory, worktree: patch.worktree },
  );
}

/** Sesión creada: desde aquí se sigue la corrida por sus eventos. */
export function startRun(race: Race, runId: string, sessionId: string, at: number): Race {
  return updateRun(race, runId, (run) =>
    run.status === "discarded" || run.status === "winner"
      ? run
      : run.sessionId === sessionId && run.status === "running" && run.startedAt !== null
        ? run
        : {
            ...run,
            sessionId,
            status: "running",
            startedAt: run.startedAt ?? at,
            endedAt: null,
            error: null,
          },
  );
}

export function failRun(race: Race, runId: string, error: string, at: number): Race {
  return updateRun(race, runId, (run) =>
    run.status === "discarded" || run.status === "winner"
      ? run
      : run.status === "failed" && run.error === error
        ? run
        : { ...run, status: "failed", error, endedAt: run.endedAt ?? at, waitingFor: null },
  );
}

export type FinishRunInput = {
  cost?: number;
  tokens?: RaceRunTokens;
  changes?: RaceRunChanges | null;
  summary?: string | null;
};

/** Datos de consumo y resultado que llegan después del evento de fin. */
export function setRunDetails(race: Race, runId: string, input: FinishRunInput): Race {
  return updateRun(race, runId, (run) => ({
    ...run,
    cost: input.cost ?? run.cost,
    tokens: input.tokens ?? run.tokens,
    changes: input.changes === undefined ? run.changes : input.changes,
    summary: input.summary === undefined ? run.summary : input.summary,
  }));
}

/** Fin correcto: coste, tokens, cambios y resumen ya resueltos por el hook. */
export function finishRun(race: Race, runId: string, input: FinishRunInput, at: number): Race {
  return updateRun(race, runId, (run) => {
    if (run.status === "discarded" || run.status === "winner") return run;
    return {
      ...run,
      status: "succeeded",
      error: null,
      waitingFor: null,
      cost: input.cost ?? run.cost,
      tokens: input.tokens ?? run.tokens,
      changes: input.changes === undefined ? run.changes : input.changes,
      summary: input.summary === undefined ? run.summary : input.summary,
      endedAt: run.endedAt ?? at,
    };
  });
}

/** El agente espera una aprobación o una respuesta: se atiende desde el chat. */
export function waitRun(race: Race, runId: string, waitingFor: RaceRunWaiting): Race {
  return updateRun(race, runId, (run) =>
    run.status !== "running" && run.status !== "waiting"
      ? run
      : run.status === "waiting" && run.waitingFor === waitingFor
        ? run
        : { ...run, status: "waiting", waitingFor },
  );
}

/** Se respondió el permiso o formulario; la corrida vuelve a ejecutar. */
export function resumeRun(race: Race, runId: string): Race {
  return updateRun(race, runId, (run) =>
    run.status === "waiting"
      ? { ...run, status: "running", waitingFor: null }
      : run.waitingFor === null
        ? run
        : { ...run, waitingFor: null },
  );
}

/**
 * Marca la ganadora. Solo una corrida con éxito puede ganar. Las demás se
 * dejan como están (su estado cuenta lo que pasó) y el hook las limpia.
 */
export function chooseWinner(race: Race, runId: string, at: number): Race {
  const run = race.runs.find((item) => item.id === runId);
  if (!run || !canChooseWinner(run)) return race;
  return {
    ...race,
    winnerRunId: runId,
    status: "settled",
    updatedAt: at,
    runs: race.runs.map((item) =>
      item.id === runId
        ? { ...item, status: "winner", waitingFor: null, endedAt: item.endedAt ?? at }
        : item,
    ),
  };
}

/** Descarta una corrida concreta (no la ganadora). */
export function discardRun(race: Race, runId: string, at: number): Race {
  if (race.winnerRunId === runId) return race;
  return updateRun(race, runId, (run) =>
    run.status === "discarded"
      ? run
      : { ...run, status: "discarded", waitingFor: null, endedAt: run.endedAt ?? at },
  );
}

export function markCleaned(race: Race, runId: string, error: string | null, at: number): Race {
  return updateRun(race, runId, (run) => ({
    ...run,
    cleanedAt: at,
    cleanupError: error,
  }));
}

/** Corridas con recursos que liberar: sesión abierta o worktree, sin limpiar. */
export function runsNeedingCleanup(race: Race): RaceRun[] {
  return race.runs.filter(
    (run) =>
      run.id !== race.winnerRunId &&
      run.cleanedAt === null &&
      (run.worktree !== null || run.sessionId !== null),
  );
}

export type RaceTotals = {
  cost: number;
  tokens: RaceRunTokens;
  files: number;
  additions: number;
  deletions: number;
  finished: number;
  total: number;
};

export function raceTotals(race: Race): RaceTotals {
  const totals: RaceTotals = {
    cost: 0,
    tokens: { input: 0, output: 0 },
    files: 0,
    additions: 0,
    deletions: 0,
    finished: 0,
    total: race.runs.length,
  };
  for (const run of race.runs) {
    totals.cost += run.cost;
    totals.tokens.input += run.tokens.input;
    totals.tokens.output += run.tokens.output;
    totals.files += run.changes?.files ?? 0;
    totals.additions += run.changes?.additions ?? 0;
    totals.deletions += run.changes?.deletions ?? 0;
    if (runIsFinished(run)) totals.finished += 1;
  }
  return totals;
}

export function runDuration(run: RaceRun): number {
  if (run.startedAt === null) return 0;
  return Math.max(0, (run.endedAt ?? Date.now()) - run.startedAt);
}

/** Nombre de carpeta/rama de una corrida; el servidor lo usa bajo la raíz. */
export function worktreeRunName(raceId: string, index: number): string {
  const base = raceId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "carrera"}-${index + 1}`;
}

/**
 * Ruta que devolverá `worktree.create` cuando se le pasa la carpeta padre y el
 * nombre de la corrida. Coincide con la que usa el servidor (padre/nombre).
 */
export function expectedRunDirectory(parent: string, raceId: string, index: number): string {
  return `${parent.replace(/\/$/, "")}/${worktreeRunName(raceId, index)}`;
}

/**
 * Proyecto de opencode al que pertenece el workspace. El canonical del proyecto
 * es el checkout principal, así que también vale para workspaces en worktree.
 */
export function projectIdFor(
  projects: Array<{ id: string; canonical: string }>,
  input: { projectPath: string; repoPath: string | null },
): string | null {
  const normalize = (value: string) => value.replace(/\/$/, "");
  const projectPath = normalize(input.projectPath);
  const repoPath = input.repoPath ? normalize(input.repoPath) : null;
  const exact =
    (repoPath && projects.find((project) => normalize(project.canonical) === repoPath)) ||
    projects.find((project) => normalize(project.canonical) === projectPath);
  if (exact) return exact.id;
  const inside = projects.find((project) => {
    const canonical = normalize(project.canonical);
    return (
      projectPath === canonical ||
      projectPath.startsWith(`${canonical}/`) ||
      (repoPath !== null && (repoPath === canonical || repoPath.startsWith(`${canonical}/`)))
    );
  });
  if (inside) return inside.id;
  return projects.length === 1 ? projects[0].id : null;
}

/** Resumen de la corrida: primer mensaje del asistente con texto, recortado. */
export function runSummaryFromMessages(
  messages: RawSessionMessage[],
  maxLength = 240,
): string | null {
  for (const message of messages) {
    if (message.type !== "assistant") continue;
    const text = (message.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("\n\n")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
    if (!text) continue;
    return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
  }
  return null;
}

/** Eventos que cambian el estado de una corrida; el resto se ignora. */
export function applyRaceEvent(
  race: Race,
  event: { type: string; data?: unknown },
  at: number,
): Race {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const sessionID = typeof data.sessionID === "string" ? data.sessionID : null;
  if (!sessionID) return race;
  const run = race.runs.find((item) => item.sessionId === sessionID);
  if (!run) return race;

  switch (event.type) {
    case "session.execution.started":
      if (run.status !== "preparing" && run.status !== "running" && run.status !== "waiting") {
        return race;
      }
      return run.status === "running" ? race : startRun(race, run.id, sessionID, at);
    case "session.idle":
    case "session.execution.succeeded":
      // Solo cierra una corrida que llegó a ejecutar; un idle previo al prompt
      // no debe darla por terminada.
      if (run.status !== "running" && run.status !== "waiting") return race;
      return finishRun(race, run.id, {}, at);
    case "session.execution.failed": {
      if (run.status !== "running" && run.status !== "waiting") return race;
      const error = data.error as { message?: string; name?: string } | undefined;
      return failRun(race, run.id, error?.message ?? error?.name ?? "La ejecución falló", at);
    }
    case "session.execution.interrupted":
      if (run.status !== "running" && run.status !== "waiting") return race;
      return failRun(race, run.id, "La ejecución se interrumpió", at);
    case "permission.asked":
      return waitRun(race, run.id, "permission");
    case "form.created":
      return waitRun(race, run.id, "form");
    case "permission.replied":
    case "form.replied":
    case "form.cancelled":
      return resumeRun(race, run.id);
    default:
      return race;
  }
}
