/**
 * Slash commands y skills del composer.
 *
 * Aquí vive la lógica pura del menú: detectar el token `/` en el que está el
 * cursor, filtrar comandos y skills, quitar el token al elegir y decidir qué
 * invocación se envía. Ni React ni el SDK aparecen en este módulo.
 */

export type ChatCommand = {
  name: string;
  description?: string;
};

export type ChatSkill = {
  id: string;
  name: string;
  description?: string;
};

/** Token `/consulta` bajo el cursor. `start` apunta a la barra. */
export type SlashTrigger = {
  start: number;
  query: string;
};

export type ChatMenuItem =
  | {
      kind: "command";
      key: string;
      name: string;
      description?: string;
      command: ChatCommand;
    }
  | {
      kind: "skill";
      key: string;
      name: string;
      description?: string;
      skill: ChatSkill;
    };

export type ChatMenuGroup = {
  kind: "command" | "skill";
  label: string;
  items: ChatMenuItem[];
};

/** Invocación resuelta para `session.command` y sus argumentos. */
export type CommandInvocation = {
  command: ChatCommand;
  args: string;
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Detecta un token de comando que termina justo en el cursor. Solo cuenta si
 * la barra abre la línea o va precedida de espacio, para no confundir rutas
 * como `src/chat` o URLs con `/`.
 */
export function detectSlashTrigger(value: string, caret: number): SlashTrigger | null {
  const end = Math.max(0, Math.min(caret, value.length));
  const before = value.slice(0, end);
  const match = /(^|\s)\/([^\s]*)$/.exec(before);
  if (!match) return null;
  return { start: end - match[2].length - 1, query: match[2] };
}

/**
 * Quita el token `/consulta` del borrador al elegir un elemento del menú.
 * Si después del token hay un espacio, también se consume para no dejar un
 * hueco doble al empezar a escribir los argumentos.
 */
export function stripSlashTrigger(value: string, trigger: SlashTrigger): string {
  const end = trigger.start + 1 + trigger.query.length;
  const before = value.slice(0, trigger.start);
  const after = value.slice(end);
  return `${before}${after.startsWith(" ") ? after.slice(1) : after}`;
}

/**
 * Reconoce un comando escrito a mano al principio del borrador:
 * `/review branch main` → `{ command: review, args: "branch main" }`.
 * Devuelve `null` para `/` sola, comandos inexistentes y texto normal.
 */
export function parseCommandInput(
  value: string,
  commands: readonly ChatCommand[],
): CommandInvocation | null {
  const trimmed = value.replace(/^\s+/, "");
  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) return null;
  const name = match[1];
  const command = commands.find((item) => normalize(item.name) === normalize(name));
  if (!command) return null;
  return { command, args: (match[2] ?? "").trim() };
}

/**
 * Invocación efectiva de un envío: gana el comando elegido en el menú; si no
 * hay chip, se acepta un `/comando argumentos` escrito a mano.
 */
export function resolveCommandInvocation(input: {
  text: string;
  selected: ChatCommand | null;
  commands: readonly ChatCommand[];
}): CommandInvocation | null {
  if (input.selected) {
    return { command: input.selected, args: input.text.trim() };
  }
  return parseCommandInput(input.text, input.commands);
}

function commandItem(command: ChatCommand): ChatMenuItem {
  return {
    kind: "command",
    key: `command:${command.name}`,
    name: command.name,
    description: command.description,
    command,
  };
}

function skillItem(skill: ChatSkill): ChatMenuItem {
  return {
    kind: "skill",
    key: `skill:${skill.id}`,
    name: skill.name,
    description: skill.description,
    skill,
  };
}

function matches(query: string, fields: (string | undefined)[]): boolean {
  if (!query) return true;
  return fields.some((field) => field && normalize(field).includes(query));
}

/**
 * Agrupa comandos y skills filtrados por la consulta. La búsqueda ignora
 * mayúsculas y acentos y mira nombre, id y descripción. Los grupos vacíos no
 * se devuelven para no enseñar cabeceras sin contenido.
 */
export function filterChatMenu(
  commands: readonly ChatCommand[],
  skills: readonly ChatSkill[],
  rawQuery: string,
): ChatMenuGroup[] {
  const query = normalize(rawQuery.trim());
  const commandItems = commands
    .filter((command) => matches(query, [command.name, command.description]))
    .map(commandItem)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  const skillItems = skills
    .filter((skill) => matches(query, [skill.name, skill.id, skill.description]))
    .map(skillItem)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  return [
    { kind: "command" as const, label: "Comandos", items: commandItems },
    { kind: "skill" as const, label: "Skills", items: skillItems },
  ].filter((group) => group.items.length > 0);
}

/**
 * Skills que el workspace permite usar. El catálogo del servidor aporta id,
 * nombre y descripción; si una skill seleccionada no aparece en él se conserva
 * el id como nombre para que siga siendo invocable.
 */
export function selectWorkspaceSkills(
  catalog: readonly ChatSkill[],
  allowed: readonly { id: string }[],
  disabled: readonly string[] = [],
): ChatSkill[] {
  const blocked = new Set(disabled);
  const byId = new Map(catalog.map((skill) => [skill.id, skill]));
  const seen = new Set<string>();
  const selected: ChatSkill[] = [];

  for (const ref of allowed) {
    if (!ref.id || blocked.has(ref.id) || seen.has(ref.id)) continue;
    seen.add(ref.id);
    selected.push(byId.get(ref.id) ?? { id: ref.id, name: ref.id });
  }

  return selected.sort((a, b) => a.name.localeCompare(b.name, "es"));
}
