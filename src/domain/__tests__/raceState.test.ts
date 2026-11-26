import { describe, expect, test } from "vitest";
import type { RawSessionMessage } from "../chat/messages";
import {
  applyRaceEvent,
  canChooseWinner,
  chooseWinner,
  createRace,
  discardRun,
  expectedRunDirectory,
  failRun,
  finishRun,
  markCleaned,
  prepareRun,
  projectIdFor,
  raceIsLive,
  raceStatus,
  raceTotals,
  runDuration,
  runsNeedingCleanup,
  runSummaryFromMessages,
  setRunDetails,
  startRun,
  waitRun,
  worktreeRunName,
  type CreateRaceInput,
  type Race,
} from "../race/state";

const MODELS = [
  { key: "anthropic/claude", providerID: "anthropic", id: "claude", name: "Claude" },
  { key: "openai/gpt", providerID: "openai", id: "gpt", name: "GPT" },
  { key: "google/gemini", providerID: "google", id: "gemini", name: "Gemini" },
];

function input(overrides: Partial<CreateRaceInput> = {}): CreateRaceInput {
  return {
    id: "race-1",
    workspaceId: "w1",
    prompt: "Añade validación y tests",
    agent: "build",
    useWorktrees: true,
    bootId: "boot-a",
    models: MODELS.slice(0, 2),
    baseDirectory: "/repo",
    baseBranch: "main",
    now: 1000,
    ...overrides,
  };
}

function makeRace(overrides: Partial<CreateRaceInput> = {}): Race {
  const result = createRace(input(overrides));
  if ("error" in result) throw new Error(result.error);
  return result.race;
}

function withSession(race: Race, index = 0, sessionId = "ses-1"): Race {
  const run = race.runs[index];
  const prepared = prepareRun(race, run.id, {
    directory: `/worktrees/run-${index + 1}`,
    worktree: `/worktrees/run-${index + 1}`,
  });
  return startRun(prepared, run.id, sessionId, 2000);
}

describe("creación de la carrera", () => {
  test("exige encargo y de 2 a 5 modelos sin repetir", () => {
    expect(createRace(input({ prompt: "   " }))).toEqual({
      error: "El encargo no puede estar vacío.",
    });
    expect(createRace(input({ models: [MODELS[0]] }))).toEqual({
      error: "Elige al menos 2 modelos.",
    });
    expect(
      createRace(input({ models: [MODELS[0], MODELS[1], MODELS[2], MODELS[0], MODELS[1]] })),
    ).toEqual({ error: "Hay modelos repetidos en la carrera." });
    expect(
      createRace(
        input({
          models: Array.from({ length: 6 }, (_, index) => ({ ...MODELS[0], key: `m${index}` })),
        }),
      ),
    ).toEqual({ error: "Como mucho 5 modelos por carrera." });
  });

  test("crea una corrida por modelo, preparada y sin sesión", () => {
    const race = makeRace();
    expect(race.runs).toHaveLength(2);
    expect(race.runs.map((run) => run.id)).toEqual(["race-1-run-1", "race-1-run-2"]);
    expect(race.runs.every((run) => run.status === "preparing")).toBe(true);
    expect(race.runs.every((run) => run.directory === "/repo")).toBe(true);
    expect(race.runs.every((run) => run.branch === "main")).toBe(true);
    expect(race.status).toBe("running");
    expect(race.merge).toBeNull();
    expect(raceIsLive(race)).toBe(true);
  });

  test("nombre y ruta esperada del worktree por corrida", () => {
    expect(worktreeRunName("Race-1", 0)).toBe("race-1-1");
    expect(worktreeRunName("  ", 4)).toBe("carrera-5");
    expect(expectedRunDirectory("/wt/repo/", "race-1", 1)).toBe("/wt/repo/race-1-2");
  });
});

describe("máquina de estados de una corrida", () => {
  test("preparar, arrancar y terminar con datos de consumo", () => {
    let race = makeRace();
    const run = race.runs[0];
    race = prepareRun(race, run.id, { directory: "/wt/a", worktree: "/wt/a" });
    race = startRun(race, run.id, "ses-1", 2000);
    expect(race.runs[0]).toMatchObject({
      status: "running",
      directory: "/wt/a",
      worktree: "/wt/a",
      sessionId: "ses-1",
      startedAt: 2000,
    });
    race = finishRun(
      race,
      run.id,
      {
        cost: 0.42,
        tokens: { input: 1000, output: 500 },
        changes: { files: 3, additions: 10, deletions: 2 },
        summary: "Listo",
      },
      4000,
    );
    expect(race.runs[0]).toMatchObject({
      status: "succeeded",
      cost: 0.42,
      tokens: { input: 1000, output: 500 },
      changes: { files: 3, additions: 10, deletions: 2 },
      summary: "Listo",
      endedAt: 4000,
    });
    expect(runDuration(race.runs[0])).toBe(2000);
    expect(canChooseWinner(race.runs[0])).toBe(true);
  });

  test("un fallo no altera las demás corridas", () => {
    let race = makeRace();
    race = withSession(race, 0, "ses-a");
    race = withSession(race, 1, "ses-b");
    race = failRun(race, race.runs[0].id, "boom", 3000);
    expect(race.runs[0].status).toBe("failed");
    expect(race.runs[0].error).toBe("boom");
    expect(race.runs[1].status).toBe("running");
    expect(race.runs[1].sessionId).toBe("ses-b");
  });

  test("los datos de consumo llegan después del fin sin cambiar el estado", () => {
    let race = makeRace();
    race = withSession(race);
    race = finishRun(race, race.runs[0].id, {}, 3000);
    race = setRunDetails(race, race.runs[0].id, {
      cost: 0.1,
      tokens: { input: 5, output: 6 },
      summary: "hecho",
    });
    expect(race.runs[0].status).toBe("succeeded");
    expect(race.runs[0].cost).toBe(0.1);
    expect(race.runs[0].summary).toBe("hecho");
  });
});

describe("eventos del servidor", () => {
  test("ignora el idle anterior al arranque de la corrida", () => {
    const race = withSession(makeRace());
    const idle = applyRaceEvent(race, { type: "session.idle", data: { sessionID: "ses-1" } }, 3000);
    expect(idle.runs[0].status).toBe("succeeded");
  });

  test("idle con sesión preparada no la cierra", () => {
    const race = makeRace();
    const prepared = prepareRun(race, race.runs[0].id, {
      directory: "/wt",
      worktree: "/wt",
    });
    const updated = {
      ...prepared,
      runs: prepared.runs.map((run, index) => (index === 0 ? { ...run, sessionId: "ses-1" } : run)),
    };
    const idle = applyRaceEvent(
      updated,
      { type: "session.idle", data: { sessionID: "ses-1" } },
      3000,
    );
    expect(idle.runs[0].status).toBe("preparing");
  });

  test("started, failed, waiting y replied", () => {
    let race = withSession(makeRace());
    race = applyRaceEvent(
      race,
      { type: "session.execution.started", data: { sessionID: "ses-1" } },
      3000,
    );
    expect(race.runs[0].status).toBe("running");

    race = applyRaceEvent(race, { type: "permission.asked", data: { sessionID: "ses-1" } }, 3100);
    expect(race.runs[0].status).toBe("waiting");
    expect(race.runs[0].waitingFor).toBe("permission");

    race = applyRaceEvent(race, { type: "permission.replied", data: { sessionID: "ses-1" } }, 3200);
    expect(race.runs[0].status).toBe("running");
    expect(race.runs[0].waitingFor).toBeNull();

    race = applyRaceEvent(
      race,
      {
        type: "session.execution.failed",
        data: { sessionID: "ses-1", error: { message: "sin cuota" } },
      },
      3300,
    );
    expect(race.runs[0].status).toBe("failed");
    expect(race.runs[0].error).toBe("sin cuota");
  });

  test("los eventos de otras sesiones se ignoran", () => {
    const race = withSession(makeRace());
    expect(applyRaceEvent(race, { type: "session.idle", data: { sessionID: "otra" } }, 3000)).toBe(
      race,
    );
    expect(applyRaceEvent(race, { type: "session.idle" }, 3000)).toBe(race);
  });
});

describe("elección de ganadora y limpieza", () => {
  function finishedRace(): Race {
    let race = makeRace();
    race = withSession(race, 0, "ses-a");
    race = withSession(race, 1, "ses-b");
    race = finishRun(race, race.runs[0].id, { cost: 1 }, 3000);
    race = finishRun(race, race.runs[1].id, { cost: 2 }, 3000);
    return race;
  }

  test("solo gana una corrida con éxito", () => {
    let race = makeRace();
    race = withSession(race, 0, "ses-a");
    race = startRun(race, race.runs[1].id, "ses-b", 2000);
    expect(chooseWinner(race, race.runs[0].id, 3000)).toBe(race);
    race = finishRun(race, race.runs[0].id, {}, 3000);
    const chosen = chooseWinner(race, race.runs[0].id, 4000);
    expect(chosen.winnerRunId).toBe(race.runs[0].id);
    expect(chosen.runs[0].status).toBe("winner");
    expect(chosen.runs[1].status).toBe("running");
    expect(raceStatus(chosen)).toBe("settled");
  });

  test("la limpieza cubre perdedoras con sesión o worktree, nunca la ganadora", () => {
    const race = finishedRace();
    const chosen = chooseWinner(race, race.runs[0].id, 4000);
    expect(runsNeedingCleanup(chosen).map((run) => run.id)).toEqual([race.runs[1].id]);
    const cleaned = markCleaned(chosen, race.runs[1].id, null, 5000);
    expect(runsNeedingCleanup(cleaned)).toEqual([]);
    expect(cleaned.runs[1].cleanedAt).toBe(5000);
  });

  test("descartar no permite quitar la ganadora", () => {
    const race = chooseWinner(finishedRace(), "race-1-run-1", 4000);
    expect(discardRun(race, "race-1-run-1", 5000)).toBe(race);
    const discarded = discardRun(race, "race-1-run-2", 5000);
    expect(discarded.runs[1].status).toBe("discarded");
    expect(discarded.runs[1].endedAt).toBe(3000);
  });

  test("una corrida descartada no revive con eventos tardíos", () => {
    let race = withSession(makeRace());
    race = discardRun(race, race.runs[0].id, 3000);
    race = failRun(race, race.runs[0].id, "tarde", 4000);
    race = waitRun(race, race.runs[0].id, "permission");
    race = startRun(race, race.runs[0].id, "ses-1", 5000);
    expect(race.runs[0].status).toBe("discarded");
    expect(race.runs[0].error).toBeNull();
  });

  test("totales de la carrera", () => {
    const race = finishedRace();
    expect(raceTotals(race)).toEqual({
      cost: 3,
      tokens: { input: 0, output: 0 },
      files: 0,
      additions: 0,
      deletions: 0,
      finished: 2,
      total: 2,
    });
  });
});

describe("utilidades de contexto y resumen", () => {
  test("resuelve el proyecto por ruta canónica o por prefijo", () => {
    const projects = [
      { id: "p1", canonical: "/repo" },
      { id: "p2", canonical: "/otro" },
    ];
    expect(projectIdFor(projects, { projectPath: "/repo", repoPath: null })).toBe("p1");
    expect(projectIdFor(projects, { projectPath: "/repo/wt/a", repoPath: "/repo" })).toBe("p1");
    expect(projectIdFor(projects, { projectPath: "/desconocido", repoPath: null })).toBeNull();
    expect(
      projectIdFor([{ id: "solo", canonical: "/x" }], { projectPath: "/y", repoPath: null }),
    ).toBe("solo");
  });

  test("resume el primer mensaje del asistente y recorta", () => {
    const messages: RawSessionMessage[] = [
      { type: "user", id: "u1", text: "hola" },
      {
        type: "assistant",
        id: "a1",
        content: [
          { type: "reasoning", text: "pensando" },
          { type: "text", text: "  hecho  " },
        ],
      },
    ];
    expect(runSummaryFromMessages(messages)).toBe("hecho");
    expect(
      runSummaryFromMessages(
        [{ type: "assistant", id: "a2", content: [{ type: "text", text: "x".repeat(20) }] }],
        10,
      ),
    ).toBe("xxxxxxxxx…");
    expect(runSummaryFromMessages([{ type: "user", id: "u", text: "solo" }])).toBeNull();
  });

  test("una corrida en espera no cuenta como viva tras cambiar a ganadora", () => {
    let race = withSession(makeRace());
    race = waitRun(race, race.runs[0].id, "form");
    expect(race.runs[0].status).toBe("waiting");
    expect(raceIsLive(race)).toBe(true);
  });
});
