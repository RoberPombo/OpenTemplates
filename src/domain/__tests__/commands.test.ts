// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  detectSlashTrigger,
  filterChatMenu,
  parseCommandInput,
  resolveCommandInvocation,
  selectWorkspaceSkills,
  stripSlashTrigger,
  type ChatCommand,
  type ChatSkill,
} from "../chat/commands";

const commands: ChatCommand[] = [
  { name: "review", description: "Revisa cambios" },
  { name: "init", description: "Prepara AGENTS.md" },
  { name: "goal", description: "Persigue un objetivo" },
];

describe("detectSlashTrigger", () => {
  test("detecta la barra al principio con la consulta vacía", () => {
    expect(detectSlashTrigger("/", 1)).toEqual({ start: 0, query: "" });
  });

  test("detecta el token después de un espacio", () => {
    expect(detectSlashTrigger("hola /re", 8)).toEqual({ start: 5, query: "re" });
  });

  test("acepta el cursor en medio de la consulta", () => {
    expect(detectSlashTrigger("/review argumentos", 4)).toEqual({
      start: 0,
      query: "rev",
    });
  });

  test("cierra el token cuando la consulta ya tiene un espacio", () => {
    expect(detectSlashTrigger("/review argumentos", 17)).toBeNull();
  });

  test("no confunde rutas ni URLs con comandos", () => {
    expect(detectSlashTrigger("src/chat", 8)).toBeNull();
    expect(detectSlashTrigger("https://ejemplo", 15)).toBeNull();
  });

  test("recorta el cursor al tamaño del texto", () => {
    expect(detectSlashTrigger("/rev", 99)).toEqual({ start: 0, query: "rev" });
    expect(detectSlashTrigger("/rev", -4)).toBeNull();
  });
});

describe("stripSlashTrigger", () => {
  test("deja el borrador vacío al elegir sobre una barra sola", () => {
    expect(stripSlashTrigger("/", { start: 0, query: "" })).toBe("");
  });

  test("quita el token y conserva los argumentos que ya había", () => {
    expect(stripSlashTrigger("/rev rama main", { start: 0, query: "rev" })).toBe("rama main");
  });

  test("conserva el texto anterior al token", () => {
    expect(stripSlashTrigger("hola /rev", { start: 5, query: "rev" })).toBe("hola ");
  });
});

describe("parseCommandInput", () => {
  test("separa nombre y argumentos", () => {
    expect(parseCommandInput("/review branch main", commands)).toEqual({
      command: commands[0],
      args: "branch main",
    });
  });

  test("un comando sin argumentos devuelve texto vacío", () => {
    expect(parseCommandInput("/init", commands)).toEqual({
      command: commands[1],
      args: "",
    });
  });

  test("ignora espacios iniciales y no distingue mayúsculas", () => {
    expect(parseCommandInput("   /REVIEW rama", commands)).toEqual({
      command: commands[0],
      args: "rama",
    });
  });

  test("«/» sola no es una invocación", () => {
    expect(parseCommandInput("/", commands)).toBeNull();
    expect(parseCommandInput("/   ", commands)).toBeNull();
  });

  test("un comando inexistente no se inventa", () => {
    expect(parseCommandInput("/desconocido hola", commands)).toBeNull();
  });

  test("el texto normal no es una invocación", () => {
    expect(parseCommandInput("review branch", commands)).toBeNull();
    expect(parseCommandInput("hola /review", commands)).toBeNull();
  });
});

describe("resolveCommandInvocation", () => {
  test("el comando elegido en el menú gana y recibe el texto restante", () => {
    expect(
      resolveCommandInvocation({
        text: "  rama main ",
        selected: commands[0],
        commands,
      }),
    ).toEqual({ command: commands[0], args: "rama main" });
  });

  test("sin chip se reconoce un comando escrito a mano", () => {
    expect(resolveCommandInvocation({ text: "/init", selected: null, commands })).toEqual({
      command: commands[1],
      args: "",
    });
  });

  test("sin chip ni comando conocido no hay invocación", () => {
    expect(resolveCommandInvocation({ text: "/nada", selected: null, commands })).toBeNull();
  });
});

describe("filterChatMenu", () => {
  const skills: ChatSkill[] = [
    { id: "testing", name: "Testing", description: "Diseña pruebas" },
    { id: "diseno", name: "Diseño de API", description: "Contratos REST" },
  ];

  test("sin consulta muestra comandos y skills ordenados por nombre", () => {
    const groups = filterChatMenu(commands, skills, "");
    expect(groups.map((group) => group.label)).toEqual(["Comandos", "Skills"]);
    expect(groups[0].items.map((item) => item.name)).toEqual(["goal", "init", "review"]);
    expect(groups[1].items.map((item) => item.name)).toEqual(["Diseño de API", "Testing"]);
  });

  test("filtra por nombre de comando", () => {
    const groups = filterChatMenu(commands, skills, "rev");
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((item) => item.name)).toEqual(["review"]);
  });

  test("filtra por descripción y por id de skill", () => {
    expect(filterChatMenu(commands, skills, "objetivo")[0].items[0].name).toBe("goal");
    const byId = filterChatMenu(commands, skills, "testing");
    expect(byId.map((group) => group.kind)).toEqual(["skill"]);
  });

  test("ignora acentos y mayúsculas", () => {
    const groups = filterChatMenu(commands, skills, "DISENO");
    expect(groups).toHaveLength(1);
    expect(groups[0].items[0].name).toBe("Diseño de API");
  });

  test("no devuelve grupos vacíos", () => {
    expect(filterChatMenu(commands, [], "rev")).toHaveLength(1);
    expect(filterChatMenu([], [], "rev")).toEqual([]);
  });
});

describe("selectWorkspaceSkills", () => {
  const catalog: ChatSkill[] = [
    { id: "testing", name: "Testing", description: "Pruebas" },
    { id: "otra", name: "Otra", description: "No seleccionada" },
  ];

  test("solo conserva las permitidas, sin repetir y sin deshabilitadas", () => {
    expect(
      selectWorkspaceSkills(
        catalog,
        [{ id: "testing" }, { id: "testing" }, { id: "falta" }, { id: "otra" }],
        ["otra"],
      ),
    ).toEqual([
      { id: "falta", name: "falta" },
      { id: "testing", name: "Testing", description: "Pruebas" },
    ]);
  });

  test("sin catálogo conserva el id como nombre", () => {
    expect(selectWorkspaceSkills([], [{ id: "testing" }])).toEqual([
      { id: "testing", name: "testing" },
    ]);
  });
});
