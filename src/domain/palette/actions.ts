/**
 * Despacho de las acciones de la paleta. Recibe el id de la acción y un
 * retrato del estado (workspaces, selección y handlers montados) y devuelve
 * qué debe ejecutar la vista. La decisión es pura: la presentación solo llama
 * a `select`, abre un diálogo o delega en el handler registrado.
 */
import { cycleWorkspaceIndex } from "../workspace/navigation";

export type PaletteAction =
  | { kind: "create" }
  | { kind: "select"; workspaceId: string }
  /** `workspaceId` es null cuando no hay a qué cambiar (menos de dos). */
  | { kind: "cycle"; workspaceId: string | null; delta: 1 | -1 }
  | { kind: "openPalette" }
  | { kind: "delegate"; id: string }
  | { kind: "unknown"; id: string };

export type PaletteActionState = {
  /** Workspaces existentes, en el orden en que se navega entre ellos. */
  workspaces: readonly { id: string }[];
  selectedId: string | null;
  /** Handlers montados ahora mismo, indexados por id de acción. */
  handlers: Readonly<Record<string, unknown>>;
};

const SELECT_PREFIX = "workspace.select:";

function cycle(
  id: "workspace.next" | "workspace.previous",
  state: PaletteActionState,
): PaletteAction {
  const delta = id === "workspace.next" ? 1 : -1;
  if (state.workspaces.length < 2) return { kind: "cycle", workspaceId: null, delta };

  const current = state.workspaces.findIndex((workspace) => workspace.id === state.selectedId);
  const index = cycleWorkspaceIndex(current, state.workspaces.length, delta);
  return {
    kind: "cycle",
    workspaceId: index < 0 ? null : (state.workspaces[index]?.id ?? null),
    delta,
  };
}

/** Resuelve el id de una acción de paleta o atajo a la operación a ejecutar. */
export function resolvePaletteAction(id: string, state: PaletteActionState): PaletteAction {
  if (id === "workspace.create") return { kind: "create" };

  if (id === "workspace.next" || id === "workspace.previous") return cycle(id, state);

  if (id.startsWith(SELECT_PREFIX)) {
    const workspaceId = id.slice(SELECT_PREFIX.length);
    const exists = state.workspaces.some((workspace) => workspace.id === workspaceId);
    return exists ? { kind: "select", workspaceId } : { kind: "unknown", id };
  }

  if (id === "palette.open") return { kind: "openPalette" };

  if (state.handlers[id]) return { kind: "delegate", id };

  return { kind: "unknown", id };
}
