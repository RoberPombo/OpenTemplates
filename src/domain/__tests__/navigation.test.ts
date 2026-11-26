// @vitest-environment node
import { describe, expect, test } from "vitest";
import { cycleWorkspaceIndex } from "../workspace/navigation";

describe("cycleWorkspaceIndex", () => {
  test("avanza y retrocede en círculo", () => {
    expect(cycleWorkspaceIndex(0, 3, 1)).toBe(1);
    expect(cycleWorkspaceIndex(2, 3, 1)).toBe(0);
    expect(cycleWorkspaceIndex(0, 3, -1)).toBe(2);
  });
  test("sin selección: avanzar empieza por el primero y retroceder por el último", () => {
    expect(cycleWorkspaceIndex(-1, 3, 1)).toBe(0);
    expect(cycleWorkspaceIndex(-1, 3, -1)).toBe(2);
  });
  test("índice fuera de rango se normaliza", () => {
    expect(cycleWorkspaceIndex(9, 3, 1)).toBe(1);
    expect(cycleWorkspaceIndex(-9, 3, -1)).toBe(2);
  });
  test("sin workspaces o sin delta → -1", () => {
    expect(cycleWorkspaceIndex(0, 0, 1)).toBe(-1);
    expect(cycleWorkspaceIndex(0, 3, 0)).toBe(-1);
  });
});
