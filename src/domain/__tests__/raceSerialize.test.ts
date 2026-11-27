import { describe, expect, test } from "vitest";
import {
  chooseWinner,
  createRace,
  finishRun,
  prepareRun,
  recordMerge,
  startRun,
  type CreateRaceInput,
  type Race,
} from "../race/state";
import { parseRace, recoverRace, serializeRace } from "../race/serialize";

const MODELS = [
  { key: "anthropic/claude", providerID: "anthropic", id: "claude", name: "Claude" },
  { key: "openai/gpt", providerID: "openai", id: "gpt", name: "GPT" },
];

function input(overrides: Partial<CreateRaceInput> = {}): CreateRaceInput {
  return {
    id: "race-1",
    workspaceId: "w1",
    prompt: "Añade validación y tests",
    agent: "build",
    useWorktrees: true,
    bootId: "boot-a",
    models: MODELS,
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

describe("persistencia y recuperación", () => {
  test("serializa y vuelve a leer la carrera", () => {
    const race = chooseWinner(
      finishRun(withSession(makeRace()), "race-1-run-1", { cost: 1 }, 3000),
      "race-1-run-1",
      4000,
    );
    const parsed = parseRace(serializeRace(race));
    expect(parsed).toMatchObject({
      id: race.id,
      prompt: race.prompt,
      winnerRunId: "race-1-run-1",
      status: "settled",
    });
    expect(parsed?.runs[0].status).toBe("winner");
    expect(parsed?.runs[0].sessionId).toBe("ses-1");
  });

  test("persiste el resultado de la fusión", () => {
    const finished = finishRun(withSession(makeRace()), "race-1-run-1", {}, 3000);
    const chosen = chooseWinner(finished, "race-1-run-1", 4000);
    const merged = recordMerge(
      chosen,
      {
        status: "conflict",
        files: 2,
        additions: 5,
        deletions: 1,
        conflicts: ["src/a.ts"],
        message: "no aplica",
      },
      5000,
    );
    const parsed = parseRace(serializeRace(merged));
    expect(parsed?.merge).toEqual({
      runId: "race-1-run-1",
      status: "conflict",
      files: 2,
      additions: 5,
      deletions: 1,
      conflicts: ["src/a.ts"],
      message: "no aplica",
      at: 5000,
    });
  });

  test("un JSON inválido o con otra versión se descarta", () => {
    expect(parseRace(null)).toBeNull();
    expect(parseRace("nope")).toBeNull();
    expect(parseRace(JSON.stringify({ version: 99, race: {} }))).toBeNull();
    expect(parseRace(JSON.stringify({ version: 1, race: { id: "x" } }))).toBeNull();
  });

  test("normaliza los campos que faltan en datos antiguos", () => {
    const raw = JSON.stringify({
      version: 1,
      race: {
        id: "vieja",
        workspaceId: "w1",
        prompt: "encargo",
        useWorktrees: true,
        winnerRunId: "vieja-run-1",
        runs: [
          {
            id: "vieja-run-1",
            status: "succeeded",
            model: { key: "anthropic/claude", providerID: "anthropic", id: "claude" },
          },
          {
            id: "vieja-run-2",
            status: "failed",
            model: { key: "openai/gpt", providerID: "openai", id: "gpt", name: "GPT" },
          },
        ],
      },
    });
    const race = parseRace(raw);
    expect(race).not.toBeNull();
    expect(race?.status).toBe("settled");
    expect(race?.createdAt).toBe(0);
    expect(race?.runs[0]).toMatchObject({
      directory: "",
      worktree: null,
      sessionId: null,
      cost: 0,
      tokens: { input: 0, output: 0 },
      changes: null,
      summary: null,
      waitingFor: null,
      startedAt: null,
      endedAt: null,
      cleanedAt: null,
      model: { key: "anthropic/claude", providerID: "anthropic", id: "claude", name: "claude" },
    });
    expect(race?.runs[1].model.name).toBe("GPT");
    expect(race?.merge).toBeNull();
  });

  test("al reabrir la app, las corridas vivas quedan fallidas", () => {
    const race = withSession(makeRace());
    const recovered = recoverRace(race, "boot-b", 9000);
    expect(recovered.runs[0].status).toBe("failed");
    expect(recovered.runs[0].error).toBe("La app se cerró durante la carrera.");
    expect(recovered.status).toBe("finished");
    expect(recoverRace(race, "boot-a", 9000)).toBe(race);
  });
});
