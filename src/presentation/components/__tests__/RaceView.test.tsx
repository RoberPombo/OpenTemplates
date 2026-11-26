import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import {
  chooseWinner,
  createRace,
  discardRun,
  failRun,
  finishRun,
  prepareRun,
  startRun,
  waitRun,
  type Race,
} from "../../../domain/race/races";
import { RaceView } from "../RaceView";

function makeNewRace(): Race {
  const result = createRace({
    id: "race-1",
    workspaceId: "w1",
    prompt: "Añade validación al formulario",
    agent: "build",
    useWorktrees: true,
    bootId: "boot",
    models: [
      { key: "anthropic/claude", providerID: "anthropic", id: "claude", name: "Claude" },
      { key: "openai/gpt", providerID: "openai", id: "gpt", name: "GPT" },
    ],
    baseDirectory: "/repo",
    baseBranch: "main",
    now: 1000,
  });
  if ("error" in result) throw new Error(result.error);
  return result.race;
}

function makeRace(): Race {
  let race = makeNewRace();
  for (const [index, session] of ["ses-a", "ses-b"].entries()) {
    const run = race.runs[index];
    race = prepareRun(race, run.id, {
      directory: `/wt/run-${index + 1}`,
      worktree: `/wt/run-${index + 1}`,
    });
    race = startRun(race, run.id, session, 2000 + index);
  }
  return race;
}

function setup(race: Race, overrides: Partial<React.ComponentProps<typeof RaceView>> = {}) {
  const props = {
    race,
    busy: false,
    onClose: vi.fn(),
    onNewRace: vi.fn(),
    onOpenSession: vi.fn(),
    onOpenDiff: vi.fn(),
    onKeepWinner: vi.fn(),
    onDiscard: vi.fn(),
    ...overrides,
  };
  render(<RaceView {...props} />);
  return props;
}

describe("RaceView", () => {
  test("pinta una tarjeta por corrida con estado, coste, cambios y resumen", () => {
    let race = makeRace();
    race = finishRun(
      race,
      race.runs[0].id,
      {
        cost: 0.12,
        tokens: { input: 1000, output: 500 },
        changes: { files: 2, additions: 8, deletions: 1 },
        summary: "Validación añadida y tests en verde.",
      },
      4000,
    );
    setup(race);

    const claude = screen.getByRole("article", { name: "Corrida de Claude" });
    expect(within(claude).getByText("terminada")).toBeInTheDocument();
    expect(within(claude).getByText("$0.120")).toBeInTheDocument();
    expect(within(claude).getByText("2 ficheros +8 −1")).toBeInTheDocument();
    expect(within(claude).getByText("Validación añadida y tests en verde.")).toBeInTheDocument();

    const gpt = screen.getByRole("article", { name: "Corrida de GPT" });
    expect(within(gpt).getByText("ejecutando")).toBeInTheDocument();
    expect(within(gpt).getByText("Ejecutando el encargo…")).toBeInTheDocument();
  });

  test("una carrera recién creada muestra las corridas preparando y sin sesión que abrir", () => {
    setup(makeNewRace());

    expect(screen.getByText("en curso")).toBeInTheDocument();
    expect(screen.getByText(/0\/2 terminadas/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nueva carrera" })).toBeDisabled();

    for (const name of ["Claude", "GPT"]) {
      const card = screen.getByRole("article", { name: `Corrida de ${name}` });
      expect(within(card).getByText("preparando")).toBeInTheDocument();
      expect(within(card).getByText("Preparando worktree y sesión…")).toBeInTheDocument();
      expect(within(card).getByRole("button", { name: "Abrir sesión" })).toBeDisabled();
      expect(within(card).getByRole("button", { name: "Ver diff" })).toBeDisabled();
    }
  });

  test("una corrida en espera avisa de la aprobación o la respuesta pendiente", () => {
    let race = makeRace();
    race = waitRun(race, race.runs[0].id, "permission");
    race = waitRun(race, race.runs[1].id, "form");
    setup(race);

    expect(screen.getByText("en curso")).toBeInTheDocument();

    const claude = screen.getByRole("article", { name: "Corrida de Claude" });
    expect(within(claude).getByText("esperando respuesta")).toBeInTheDocument();
    expect(
      within(claude).getByText("Esperando una aprobación; ábrela en el chat."),
    ).toBeInTheDocument();

    const gpt = screen.getByRole("article", { name: "Corrida de GPT" });
    expect(within(gpt).getByText("esperando respuesta")).toBeInTheDocument();
    expect(
      within(gpt).getByText("Esperando una respuesta; ábrela en el chat."),
    ).toBeInTheDocument();

    expect(screen.getByText(/0\/2 terminadas/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nueva carrera" })).toBeDisabled();
  });

  test("una corrida fallida enseña el error, no ofrece ganar y no oculta a las demás", () => {
    let race = makeRace();
    race = failRun(race, race.runs[0].id, "Sin cuota en el proveedor", 3500);
    setup(race);

    const failed = screen.getByRole("article", { name: "Corrida de Claude" });
    expect(within(failed).getByText("fallida")).toBeInTheDocument();
    expect(within(failed).getByText("Sin cuota en el proveedor")).toBeInTheDocument();
    expect(within(failed).queryByRole("button", { name: "Quedarse con esta" })).toBeNull();
    expect(within(failed).getByRole("button", { name: "Descartar" })).toBeInTheDocument();

    const running = screen.getByRole("article", { name: "Corrida de GPT" });
    expect(within(running).getByText("ejecutando")).toBeInTheDocument();
  });

  test("las acciones pasan la corrida correcta y los botones dependen de su estado", async () => {
    const user = userEvent.setup();
    let race = makeRace();
    race = finishRun(race, race.runs[0].id, { cost: 1 }, 3000);
    race = failRun(race, race.runs[1].id, "boom", 3100);
    const props = setup(race);

    const claude = screen.getByRole("article", { name: "Corrida de Claude" });
    await user.click(within(claude).getByRole("button", { name: "Abrir sesión" }));
    expect(props.onOpenSession).toHaveBeenCalledWith(race.runs[0]);
    await user.click(within(claude).getByRole("button", { name: "Ver diff" }));
    expect(props.onOpenDiff).toHaveBeenCalledWith(race.runs[0]);
    await user.click(within(claude).getByRole("button", { name: "Quedarse con esta" }));
    expect(props.onKeepWinner).toHaveBeenCalledWith(race.runs[0]);
    await user.click(within(claude).getByRole("button", { name: "Descartar" }));
    expect(props.onDiscard).toHaveBeenCalledWith(race.runs[0]);

    const gpt = screen.getByRole("article", { name: "Corrida de GPT" });
    expect(within(gpt).queryByRole("button", { name: "Quedarse con esta" })).toBeNull();
    expect(within(gpt).getByRole("button", { name: "Abrir sesión" })).toBeEnabled();
  });

  test("una carrera terminada sin ganadora deja elegir entre las corridas", async () => {
    const user = userEvent.setup();
    let race = makeRace();
    race = finishRun(race, race.runs[0].id, { summary: "Una propuesta." }, 3000);
    race = finishRun(race, race.runs[1].id, { summary: "Otra propuesta." }, 3100);
    const props = setup(race);

    expect(screen.getByText(/2\/2 terminadas/)).toBeInTheDocument();
    expect(screen.queryByText("ganadora elegida")).toBeNull();
    expect(screen.getByRole("button", { name: "Nueva carrera" })).toBeEnabled();

    const claude = screen.getByRole("article", { name: "Corrida de Claude" });
    const gpt = screen.getByRole("article", { name: "Corrida de GPT" });
    expect(within(claude).getByRole("button", { name: "Quedarse con esta" })).toBeEnabled();
    expect(within(gpt).getByRole("button", { name: "Quedarse con esta" })).toBeEnabled();

    await user.click(within(gpt).getByRole("button", { name: "Quedarse con esta" }));
    expect(props.onKeepWinner).toHaveBeenCalledWith(race.runs[1]);
  });

  test("marca la ganadora y permite lanzar otra carrera al terminar", () => {
    let race = makeRace();
    race = finishRun(race, race.runs[0].id, {}, 3000);
    race = finishRun(race, race.runs[1].id, {}, 3000);
    race = chooseWinner(race, race.runs[0].id, 4000);
    setup(race);
    const winner = screen.getByRole("article", { name: "Corrida de Claude" });
    expect(within(winner).getByText("ganadora")).toBeInTheDocument();
    expect(screen.getByText("ganadora elegida")).toBeInTheDocument();
    expect(screen.getByText(/2\/2 terminadas/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nueva carrera" })).toBeEnabled();
    expect(within(winner).queryByRole("button", { name: "Quedarse con esta" })).toBeNull();
    expect(within(winner).queryByRole("button", { name: "Descartar" })).toBeNull();
    expect(within(winner).getByRole("button", { name: "Abrir sesión" })).toBeEnabled();
    expect(within(winner).getByRole("button", { name: "Ver diff" })).toBeEnabled();
  });

  test("una carrera viva no permite lanzar otra y muestra el total de terminadas", () => {
    let race = makeRace();
    race = discardRun(race, race.runs[1].id, 3500);
    setup(race);
    expect(screen.getByText(/1\/2 terminadas/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nueva carrera" })).toBeDisabled();
  });

  test("una corrida descartada queda marcada y ya no ofrece ganar ni descartar", () => {
    let race = makeRace();
    race = discardRun(race, race.runs[0].id, 3500);
    setup(race);

    const discarded = screen.getByRole("article", { name: "Corrida de Claude" });
    expect(within(discarded).getByText("descartada")).toBeInTheDocument();
    expect(within(discarded).getByText("Corrida descartada.")).toBeInTheDocument();
    expect(within(discarded).queryByRole("button", { name: "Quedarse con esta" })).toBeNull();
    expect(within(discarded).queryByRole("button", { name: "Descartar" })).toBeNull();
    expect(within(discarded).getByRole("button", { name: "Abrir sesión" })).toBeEnabled();

    const running = screen.getByRole("article", { name: "Corrida de GPT" });
    expect(within(running).getByText("ejecutando")).toBeInTheDocument();
  });

  test("el modal se cierra con el botón de la cabecera y el del pie", async () => {
    const user = userEvent.setup();
    const props = setup(makeRace());
    const closers = screen.getAllByRole("button", { name: "Cerrar" });
    expect(closers).toHaveLength(2);
    for (const closer of closers) await user.click(closer);
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
