import { describe, expect, test } from "vitest";
import {
  buildPaletteCommands,
  filterPaletteCommands,
  firstEnabledIndex,
  lastEnabledIndex,
  movePaletteSelection,
  type PaletteCommand,
  type PaletteContext,
} from "../palette/catalog";

const ALL_HANDLERS = [
  "workspace.settings",
  "session.new",
  "session.stop",
  "session.export",
  "session.goal",
  "panel.toggle",
  "panel.sessions",
  "panel.diff",
  "panel.terminal",
  "panel.preview",
  "panel.close",
  "race.launch",
] as const;

function context(overrides: Partial<PaletteContext> = {}): PaletteContext {
  const handlers = Object.fromEntries(
    ALL_HANDLERS.map((id) => [id, { enabled: true }]),
  ) as PaletteContext["handlers"];
  return {
    workspace: { id: "w1", name: "Demo" },
    workspaces: [
      { id: "w1", name: "Demo" },
      { id: "w2", name: "Segundo" },
    ],
    recentWorkspaceIds: [],
    hasServer: true,
    handlers,
    ...overrides,
  };
}

function find(commands: readonly PaletteCommand[], id: string): PaletteCommand {
  const command = commands.find((item) => item.id === id);
  if (!command) throw new Error(`No existe la acción ${id}`);
  return command;
}

describe("catálogo de la paleta", () => {
  test("sin workspace solo deja crear y navegar", () => {
    const commands = buildPaletteCommands(
      context({ workspace: null, hasServer: false, handlers: {} }),
    );

    expect(find(commands, "workspace.create").enabled).toBe(true);
    expect(find(commands, "workspace.next").enabled).toBe(true);
    const settings = find(commands, "workspace.settings");
    expect(settings.enabled).toBe(false);
    expect(settings.reason).toMatch(/Selecciona un workspace/);
    expect(find(commands, "session.new").enabled).toBe(false);
  });

  test("con workspace parado las acciones de servidor piden arrancarlo", () => {
    const commands = buildPaletteCommands(context({ hasServer: false, handlers: {} }));
    const terminal = find(commands, "panel.terminal");
    expect(terminal.enabled).toBe(false);
    expect(terminal.reason).toMatch(/Arranca el workspace/);
  });

  test("los handlers deciden disponibilidad y motivo", () => {
    const commands = buildPaletteCommands(
      context({
        handlers: {
          ...context().handlers,
          "session.stop": { enabled: false, reason: "No hay ningún turno en curso." },
        },
      }),
    );
    const stop = find(commands, "session.stop");
    expect(stop.enabled).toBe(false);
    expect(stop.reason).toBe("No hay ningún turno en curso.");
  });

  test("los workspaces recientes van primero y el activo no se repite", () => {
    const commands = buildPaletteCommands(
      context({
        workspaces: [
          { id: "w1", name: "Demo" },
          { id: "w2", name: "Segundo" },
          { id: "w3", name: "Tercero" },
        ],
        recentWorkspaceIds: ["w3", "w1"],
      }),
    );
    const workspaceCommands = commands.filter((command) =>
      command.id.startsWith("workspace.select:"),
    );
    expect(workspaceCommands.map((command) => command.id)).toEqual([
      "workspace.select:w3",
      "workspace.select:w1",
      "workspace.select:w2",
    ]);
    const active = find(commands, "workspace.select:w1");
    expect(active.enabled).toBe(false);
    expect(active.label).toMatch(/actual/);
  });

  test("cada acción declara grupo, palabras clave y atajos cuando toca", () => {
    const commands = buildPaletteCommands(context());
    expect(find(commands, "panel.terminal").shortcut).toEqual({ key: "`", mod: true });
    expect(find(commands, "panel.preview").shortcut).toEqual({ key: "v", mod: true, shift: true });
    expect(find(commands, "session.new").shortcut).toEqual({ key: "n", mod: true });
    expect(find(commands, "session.goal").group).toBe("Sesión");
    expect(find(commands, "race.launch").keywords).toContain("comparar");
  });
});

describe("filtrado de la paleta", () => {
  const commands = buildPaletteCommands(context());

  test("busca por prefijo y por palabra", () => {
    const prefix = filterPaletteCommands(commands, "term");
    expect(prefix[0]?.id).toBe("panel.terminal");

    const word = filterPaletteCommands(commands, "objetivo");
    expect(word[0]?.id).toBe("session.goal");
  });

  test("ignora mayúsculas y acentos", () => {
    expect(filterPaletteCommands(commands, "SESIÓN")[0]?.id).toBe("session.new");
    expect(filterPaletteCommands(commands, "carrera")[0]?.id).toBe("race.launch");
  });

  test("varias palabras deben coincidir todas", () => {
    expect(filterPaletteCommands(commands, "parar turno")[0]?.id).toBe("session.stop");
    expect(filterPaletteCommands(commands, "parar terminal")).toHaveLength(0);
  });

  test("premia la coincidencia al inicio de la etiqueta", () => {
    const results = filterPaletteCommands(commands, "nueva");
    expect(results[0]?.id).toBe("session.new");
  });

  test("mantiene las acciones deshabilitadas para explicar el motivo", () => {
    const withoutWorkspace = buildPaletteCommands(context({ workspace: null, handlers: {} }));
    const results = filterPaletteCommands(withoutWorkspace, "terminal");
    expect(results[0]?.enabled).toBe(false);
    expect(results[0]?.reason).toBeTruthy();
  });

  test("sin consulta conserva el orden del catálogo", () => {
    expect(filterPaletteCommands(commands, "  ")).toEqual(commands);
  });
});

describe("navegación de la paleta", () => {
  const commands: PaletteCommand[] = [
    { id: "a", label: "A", group: "Workspace", keywords: [], enabled: true },
    { id: "b", label: "B", group: "Workspace", keywords: [], enabled: false },
    { id: "c", label: "C", group: "Workspace", keywords: [], enabled: true },
  ];

  test("primero y último habilitados", () => {
    expect(firstEnabledIndex(commands)).toBe(0);
    expect(lastEnabledIndex(commands)).toBe(2);
  });

  test("salta deshabilitadas y da la vuelta", () => {
    expect(movePaletteSelection(commands, 0, 1)).toBe(2);
    expect(movePaletteSelection(commands, 2, 1)).toBe(0);
    expect(movePaletteSelection(commands, 0, -1)).toBe(2);
  });

  test("sin opciones habilitadas no hay selección", () => {
    const disabled = commands.map((command) => ({ ...command, enabled: false }));
    expect(firstEnabledIndex(disabled)).toBe(-1);
    expect(lastEnabledIndex(disabled)).toBe(-1);
    expect(movePaletteSelection(disabled, 0, 1)).toBe(-1);
  });
});
