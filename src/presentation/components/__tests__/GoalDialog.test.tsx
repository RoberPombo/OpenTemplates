import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GoalDialog } from "../GoalDialog";
import { createGoal } from "../../../domain/chat/goals";
const now = 1_000;
const decisionModel = { providerID: "opencode", id: "jev-1.13-free" };
function baseProps() {
  return {
    decisionModel,
    error: null as string | null,
    onSave: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onRemove: vi.fn(),
    onClose: vi.fn(),
  };
}
describe("GoalDialog — crear", () => {
  test("parte de 5 turnos y guarda texto, límite y coste", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    render(<GoalDialog goal={null} {...props} />);
    expect(screen.getByLabelText("Límite de turnos")).toHaveValue(5);
    await user.type(screen.getByLabelText("Criterio de fin"), "  deja los tests en verde  ");
    await user.clear(screen.getByLabelText("Límite de turnos"));
    await user.type(screen.getByLabelText("Límite de turnos"), "7");
    await user.type(screen.getByLabelText("Límite de coste"), "1.5");
    await user.click(screen.getByRole("button", { name: "Crear objetivo" }));
    expect(props.onSave).toHaveBeenCalledWith({
      text: "deja los tests en verde",
      maxTurns: 7,
      maxCost: 1.5,
    });
    expect(props.onClose).toHaveBeenCalled();
  });
  test("no guarda sin texto", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    render(<GoalDialog goal={null} {...props} />);
    await user.click(screen.getByRole("button", { name: "Crear objetivo" }));
    expect(props.onSave).not.toHaveBeenCalled();
  });
  test("avisa si no hay modelo de decisión", () => {
    render(<GoalDialog goal={null} {...baseProps()} decisionModel={null} />);
    expect(screen.getByText(/no tiene un modelo con capacidad de decisión/)).toBeInTheDocument();
  });
});
describe("GoalDialog — editar", () => {
  test("muestra el progreso y permite pausar y quitar", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    const goal = { ...createGoal({ text: "lint limpio", now }), turns: 2, cost: 0.123 };
    render(<GoalDialog goal={goal} {...props} />);
    expect(screen.getByText(/2 de 5 turnos/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pausar" }));
    expect(props.onPause).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Quitar" }));
    expect(props.onRemove).toHaveBeenCalledOnce();
  });
  test("reanuda un objetivo pausado y guarda los cambios", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    const goal = { ...createGoal({ text: "lint limpio", now }), status: "paused" as const };
    render(<GoalDialog goal={goal} {...props} />);
    await user.click(screen.getByRole("button", { name: "Reanudar" }));
    expect(props.onResume).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(props.onSave).toHaveBeenCalledWith({
      text: "lint limpio",
      maxTurns: 5,
      maxCost: null,
    });
  });
  test("muestra el error del último chequeo", () => {
    render(
      <GoalDialog
        goal={createGoal({ text: "lint limpio", now })}
        {...baseProps()}
        error="modelo caído"
      />,
    );
    expect(screen.getByText("modelo caído")).toBeInTheDocument();
  });
});
