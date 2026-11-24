import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GoalChip } from "../GoalChip";
import { createGoal } from "../../../domain/chat/goals";
const now = 1_000;
describe("GoalChip", () => {
  test("muestra el texto y abre el diálogo al pulsar", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <GoalChip
        goal={createGoal({ text: "deja los tests en verde", now, maxTurns: 5 })}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByText("deja los tests en verde")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Objetivo activo/ }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
  test("pinta el turno y el coste acumulados", () => {
    const base = createGoal({ text: "lint limpio", now, maxTurns: 5 });
    render(<GoalChip goal={{ ...base, turns: 2, cost: 0.123 }} onOpen={() => undefined} />);
    expect(screen.getByText("lint limpio")).toBeInTheDocument();
    expect(screen.getByText("Turno 2/5 · $0.123")).toBeInTheDocument();
    expect(screen.getByText("activo")).toBeInTheDocument();
  });
  test("marca el estado bloqueado", () => {
    const base = createGoal({ text: "lint limpio", now });
    render(<GoalChip goal={{ ...base, status: "blocked" }} onOpen={() => undefined} />);
    expect(screen.getByText("bloqueado")).toBeInTheDocument();
  });
});
