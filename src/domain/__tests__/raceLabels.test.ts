import { describe, expect, test } from "vitest";
import {
  createRace,
  finishRun,
  prepareRun,
  startRun,
  type CreateRaceInput,
  type Race,
  type RaceRunStatus,
} from "../race/state";
import {
  discardConfirmText,
  RACE_STATUS_LABELS,
  runStatusLabel,
  winnerConfirmText,
} from "../race/labels";

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

describe("etiquetas de estado", () => {
  test("traduce cada estado de corrida y de carrera", () => {
    const run = makeRace().runs[0];
    const labels: Array<[RaceRunStatus, string]> = [
      ["preparing", "preparando"],
      ["running", "ejecutando"],
      ["waiting", "esperando respuesta"],
      ["succeeded", "terminada"],
      ["failed", "fallida"],
      ["discarded", "descartada"],
      ["winner", "ganadora"],
    ];
    for (const [status, label] of labels) {
      expect(runStatusLabel({ ...run, status })).toBe(label);
    }
    expect(RACE_STATUS_LABELS).toEqual({
      running: "en curso",
      finished: "terminada",
      settled: "ganadora elegida",
    });
  });
});

describe("textos de confirmación", () => {
  function finishedRace(): Race {
    let race = makeRace();
    race = withSession(race, 0, "ses-a");
    race = withSession(race, 1, "ses-b");
    race = finishRun(race, race.runs[0].id, { cost: 1 }, 3000);
    race = finishRun(race, race.runs[1].id, { cost: 2 }, 3000);
    return race;
  }

  test("el mensaje de confirmación nombra perdedoras y worktrees", () => {
    const race = finishedRace();
    const message = winnerConfirmText(race, race.runs[0]);
    expect(message).toContain("Claude");
    expect(message).toContain("1 corridas");
    expect(message).toContain("worktree");
    expect(message).toContain("rama base");
  });

  test("descartar avisa del worktree o de la sesión", () => {
    const race = finishedRace();
    expect(discardConfirmText(race.runs[0])).toContain("Se eliminará su worktree");
    const prepared = prepareRun(race, race.runs[1].id, { directory: "/repo", worktree: null });
    expect(discardConfirmText(prepared.runs[1])).toBe(
      "¿Descartar la corrida de GPT? Se cerrará su sesión.",
    );
  });
});
