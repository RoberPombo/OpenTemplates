/**
 * Catálogo declarativo de la paleta de comandos.
 *
 * El catálogo no conoce React ni los componentes: recibe un retrato del estado
 * (workspace activo, servidor, docks abiertos, handlers registrados) y devuelve
 * las acciones con su disponibilidad. La presentación solo pinta y ejecuta.
 */
import { shortcutFor, type Shortcut } from "./keybindings";

export type PaletteGroup = "Workspace" | "Sesión" | "Paneles" | "Carrera" | "Ir a";

export const PALETTE_GROUPS: readonly PaletteGroup[] = [
  "Workspace",
  "Sesión",
  "Paneles",
  "Carrera",
  "Ir a",
] as const;

export type PaletteCommand = {
  id: string;
  label: string;
  description?: string;
  group: PaletteGroup;
  keywords: string[];
  shortcut?: Shortcut;
  enabled: boolean;
  /** Motivo visible cuando la acción no se puede ejecutar. */
  reason?: string;
};

export type PaletteWorkspace = {
  id: string;
  name: string;
  detail?: string;
};

/** Estado que publica el registro de handlers montados en la UI. */
export type HandlerState = {
  enabled: boolean;
  reason?: string;
};

export type PaletteContext = {
  workspace: PaletteWorkspace | null;
  workspaces: PaletteWorkspace[];
  /** Ids de workspaces visitados, del más reciente al más antiguo. */
  recentWorkspaceIds: string[];
  hasServer: boolean;
  /** Handlers registrados ahora mismo, por id de acción. */
  handlers: Readonly<Record<string, HandlerState | undefined>>;
};

type Requirement = "always" | "workspace" | "server";

type Definition = {
  id: string;
  label: string;
  description: string;
  group: PaletteGroup;
  keywords: string[];
  requires: Requirement;
  /** La acción la ejecuta un componente montado y debe estar registrada. */
  handler?: boolean;
};

const DEFINITIONS: readonly Definition[] = [
  {
    id: "workspace.create",
    label: "Nuevo workspace",
    description: "Crear un workspace desde un repositorio y un perfil.",
    group: "Workspace",
    keywords: ["crear", "nuevo", "repositorio", "perfil", "wizard"],
    requires: "always",
  },
  {
    id: "workspace.next",
    label: "Workspace siguiente",
    description: "Cambiar al siguiente workspace de la lista.",
    group: "Workspace",
    keywords: ["siguiente", "cambiar", "navegar", "workspace"],
    requires: "always",
  },
  {
    id: "workspace.previous",
    label: "Workspace anterior",
    description: "Cambiar al workspace anterior de la lista.",
    group: "Workspace",
    keywords: ["anterior", "previo", "cambiar", "navegar", "workspace"],
    requires: "always",
  },
  {
    id: "workspace.settings",
    label: "Ajustes del workspace",
    description: "Revisar perfil, MCPs, skills, modelo y presupuesto.",
    group: "Workspace",
    keywords: ["ajustes", "configurar", "configuración", "preferencias", "mcps", "skills"],
    requires: "workspace",
    handler: true,
  },
  {
    id: "session.new",
    label: "Nueva sesión",
    description: "Empezar una conversación nueva en este workspace.",
    group: "Sesión",
    keywords: ["nueva", "conversación", "chat", "sesión", "limpiar"],
    requires: "server",
    handler: true,
  },
  {
    id: "session.stop",
    label: "Parar el turno",
    description: "Interrumpir el turno que el agente tiene en curso.",
    group: "Sesión",
    keywords: ["parar", "detener", "interrumpir", "cancelar", "stop"],
    requires: "server",
    handler: true,
  },
  {
    id: "session.export",
    label: "Exportar la sesión activa",
    description: "Guardar la sesión en un archivo JSON saneado para compartirla.",
    group: "Sesión",
    keywords: ["exportar", "guardar", "compartir", "json", "sesión"],
    requires: "server",
    handler: true,
  },
  {
    id: "session.goal",
    label: "Definir el objetivo",
    description: "Fijar o editar el objetivo persistente de la sesión.",
    group: "Sesión",
    keywords: ["objetivo", "meta", "goal", "criterio", "turnos"],
    requires: "server",
    handler: true,
  },
  {
    id: "panel.toggle",
    label: "Panel del workspace",
    description: "Mostrar u ocultar el inspector lateral.",
    group: "Paneles",
    keywords: ["panel", "inspector", "resumen", "lateral", "mostrar", "ocultar"],
    requires: "server",
    handler: true,
  },
  {
    id: "panel.sessions",
    label: "Panel de sesiones",
    description: "Mostrar u ocultar el historial de sesiones.",
    group: "Paneles",
    keywords: ["sesiones", "historial", "lista", "panel"],
    requires: "server",
    handler: true,
  },
  {
    id: "panel.diff",
    label: "Diff y cambios",
    description: "Abrir o cerrar el panel de cambios del agente y del árbol de trabajo.",
    group: "Paneles",
    keywords: ["diff", "cambios", "git", "ficheros", "revisar"],
    requires: "server",
    handler: true,
  },
  {
    id: "panel.terminal",
    label: "Terminal del workspace",
    description: "Abrir o cerrar el terminal dentro del workspace.",
    group: "Paneles",
    keywords: ["terminal", "shell", "pty", "consola", "comandos"],
    requires: "server",
    handler: true,
  },
  {
    id: "panel.preview",
    label: "Vista previa de la app",
    description: "Abrir la aplicación en marcha en un dock, con tamaños de dispositivo.",
    group: "Paneles",
    keywords: ["vista", "preview", "app", "navegador", "recargar", "dispositivo"],
    requires: "server",
    handler: true,
  },
  {
    id: "panel.close",
    label: "Cerrar panel o dock activo",
    description: "Cerrar el terminal, las sesiones o el inspector, en ese orden.",
    group: "Paneles",
    keywords: ["cerrar", "ocultar", "escape", "dock", "panel"],
    requires: "server",
    handler: true,
  },
  {
    id: "race.launch",
    label: "Lanzar carrera multi-run",
    description: "Enviar el mismo encargo a varios modelos y comparar resultados.",
    group: "Carrera",
    keywords: ["carrera", "race", "modelos", "comparar", "multi", "run"],
    requires: "server",
    handler: true,
  },
] as const;

function baseAvailability(definition: Definition, context: PaletteContext) {
  if (definition.id === "workspace.next" || definition.id === "workspace.previous") {
    const enabled = context.workspaces.length > 1;
    return { enabled, reason: enabled ? undefined : "Hace falta más de un workspace." };
  }
  if (definition.requires === "always") return { enabled: true, reason: undefined };
  if (!context.workspace) {
    return { enabled: false, reason: "Selecciona un workspace." };
  }
  if (definition.requires === "server" && !context.hasServer) {
    return { enabled: false, reason: "Arranca el workspace para usar esta acción." };
  }
  return { enabled: true, reason: undefined };
}

function buildFromDefinition(definition: Definition, context: PaletteContext): PaletteCommand {
  const base = baseAvailability(definition, context);
  let enabled = base.enabled;
  let reason = base.reason;

  if (definition.handler) {
    const handler = context.handlers[definition.id];
    if (!handler) {
      enabled = false;
      reason = reason ?? "Abre el workspace para usar esta acción.";
    } else if (!handler.enabled) {
      enabled = false;
      reason = handler.reason ?? "No disponible ahora.";
    }
  }

  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    group: definition.group,
    keywords: definition.keywords,
    shortcut: shortcutFor(definition.id),
    enabled,
    reason,
  };
}

function orderedWorkspaces(context: PaletteContext): PaletteWorkspace[] {
  const byId = new Map(context.workspaces.map((workspace) => [workspace.id, workspace]));
  const ordered: PaletteWorkspace[] = [];
  for (const id of context.recentWorkspaceIds) {
    const workspace = byId.get(id);
    if (workspace) {
      ordered.push(workspace);
      byId.delete(id);
    }
  }
  for (const workspace of context.workspaces) {
    if (byId.delete(workspace.id)) ordered.push(workspace);
  }
  return ordered;
}

function workspaceCommands(context: PaletteContext): PaletteCommand[] {
  return orderedWorkspaces(context).map((workspace) => {
    const active = context.workspace?.id === workspace.id;
    return {
      id: `workspace.select:${workspace.id}`,
      label: active ? `Ir a ${workspace.name} (actual)` : `Ir a ${workspace.name}`,
      description: workspace.detail ?? "Cambiar a este workspace.",
      group: "Ir a",
      keywords: ["ir", "cambiar", "workspace", workspace.name],
      enabled: !active,
      reason: active ? "Ya estás en este workspace." : undefined,
    };
  });
}

/** Catálogo completo, en orden de grupos y con los workspaces al final. */
export function buildPaletteCommands(context: PaletteContext): PaletteCommand[] {
  const groupIndex = (group: PaletteGroup) => PALETTE_GROUPS.indexOf(group);
  const commands = [
    ...DEFINITIONS.map((definition) => buildFromDefinition(definition, context)),
    ...workspaceCommands(context),
  ];
  return commands.sort((a, b) => groupIndex(a.group) - groupIndex(b.group));
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function scoreToken(token: string, label: string, words: string[], keywords: string[]): number {
  if (label === token) return 1000;
  if (label.startsWith(token)) return 420;
  if (words.some((word) => word.startsWith(token))) return 320;
  if (keywords.some((keyword) => keyword.startsWith(token))) return 240;
  if (label.includes(token)) return 140;
  if (keywords.some((keyword) => keyword.includes(token))) return 90;
  return 0;
}

/**
 * Búsqueda incremental: cada palabra de la consulta debe coincidir con la
 * etiqueta o las palabras clave. Premia prefijos y coincidencia al inicio.
 */
export function filterPaletteCommands(
  commands: readonly PaletteCommand[],
  query: string,
): PaletteCommand[] {
  const normalized = normalize(query.trim());
  if (!normalized) return [...commands];
  const tokens = normalized.split(/\s+/).filter(Boolean);

  return commands
    .map((command, index) => {
      const label = normalize(command.label);
      const words = label.split(/[^a-z0-9]+/).filter(Boolean);
      const keywords = command.keywords.map(normalize);
      let score = 0;
      for (const token of tokens) {
        const tokenScore = scoreToken(token, label, words, keywords);
        if (tokenScore === 0) return { command, score: 0, index };
        score += tokenScore;
      }
      if (label === normalized) score += 600;
      else if (label.startsWith(normalized)) score += 200;
      return { command, score, index };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command);
}

/** Primer índice habilitado desde `from`; -1 si no hay ninguno. */
export function firstEnabledIndex(commands: readonly PaletteCommand[], from = 0): number {
  if (commands.length === 0) return -1;
  for (let offset = 0; offset < commands.length; offset += 1) {
    const index = (from + offset) % commands.length;
    if (commands[index]?.enabled) return index;
  }
  return -1;
}

/** Último índice habilitado del catálogo; -1 si no hay ninguno. */
export function lastEnabledIndex(commands: readonly PaletteCommand[]): number {
  for (let index = commands.length - 1; index >= 0; index -= 1) {
    if (commands[index]?.enabled) return index;
  }
  return -1;
}

/** Mueve la selección saltando acciones deshabilitadas, con vueltas. */
export function movePaletteSelection(
  commands: readonly PaletteCommand[],
  current: number,
  delta: 1 | -1,
): number {
  if (commands.length === 0) return -1;
  const start = current < 0 ? 0 : current;
  for (let offset = 1; offset <= commands.length; offset += 1) {
    const index =
      (((start + delta * offset) % commands.length) + commands.length) % commands.length;
    if (commands[index]?.enabled) return index;
  }
  return current >= 0 && commands[current]?.enabled ? current : -1;
}
