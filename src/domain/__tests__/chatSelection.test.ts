// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  effectiveVariant,
  modelKey,
  parseModelRef,
  resolveAgentChoice,
  resolveModelChoice,
  selectWorkspaceModels,
  toAgentOptions,
  toModelOptions,
  type AgentOption,
  type CatalogAgent,
  type CatalogModel,
  type ModelOption,
} from "../chat/selection";

const catalog: CatalogModel[] = [
  { providerID: "anthropic", id: "claude", name: "Claude", variants: [{ id: "high" }] },
  { providerID: "openai", id: "gpt", name: "GPT", variants: [] },
  { providerID: "x", id: "disabled", name: "Disabled", enabled: false, variants: [] },
  { providerID: "x", id: "embed", name: "Embed", type: "embedding", variants: [] },
  { providerID: "x", id: "chat-explicit", name: "Chat Explicit", type: "chat", variants: [] },
];

describe("modelKey", () => {
  test("provider/id", () => {
    expect(modelKey({ providerID: "anthropic", id: "claude" })).toBe("anthropic/claude");
  });
});

describe("toModelOptions", () => {
  test("filtra disabled y no-chat, ordena por nombre", () => {
    const options = toModelOptions(catalog);
    expect(options.map((option) => option.name)).toEqual(["Chat Explicit", "Claude", "GPT"]);
    expect(options[1]).toEqual({
      key: "anthropic/claude",
      providerID: "anthropic",
      id: "claude",
      name: "Claude",
      variants: ["high"],
    });
  });

  test("type ausente se acepta como chat", () => {
    expect(toModelOptions(catalog).some((option) => option.id === "gpt")).toBe(true);
  });
});

describe("selectWorkspaceModels — respeta la lista del workspace, con fallback", () => {
  const options: ModelOption[] = toModelOptions(catalog);

  test("sin lista permitida devuelve todo el catálogo", () => {
    expect(selectWorkspaceModels(options, [])).toEqual(options);
  });

  test("con lista permitida devuelve solo esos modelos", () => {
    expect(selectWorkspaceModels(options, ["openai/gpt"]).map((model) => model.key)).toEqual([
      "openai/gpt",
    ]);
  });

  test("si ningún permitido está disponible no deja el selector vacío", () => {
    expect(selectWorkspaceModels(options, ["opencode-go/deepseek-v4.1-flash"])).toEqual(options);
  });
});

describe("toAgentOptions", () => {
  const agents: CatalogAgent[] = [
    { id: "build", name: "Build" },
    { id: "plan", name: "Plan" },
    { id: "hidden", name: "Hidden", hidden: true },
    { id: "sub", name: "Sub", mode: "subagent" },
  ];

  test("filtra hidden y subagent, ordena por nombre", () => {
    expect(toAgentOptions(agents)).toEqual([
      { id: "build", name: "Build" },
      { id: "plan", name: "Plan" },
    ]);
  });
});

describe("resolveModelChoice — prioridad actual > guardado > workspace > default > primero", () => {
  const options: ModelOption[] = toModelOptions(catalog);
  const base = {
    current: "",
    saved: null as string | null,
    workspaceModel: null as string | null,
    serverDefault: null as { providerID: string; id: string } | null,
    options,
  };

  test("actual disponible gana", () => {
    expect(resolveModelChoice({ ...base, current: "openai/gpt", saved: "anthropic/claude" })).toBe(
      "openai/gpt",
    );
  });

  test("actual no disponible cae al guardado", () => {
    expect(resolveModelChoice({ ...base, current: "x/no", saved: "anthropic/claude" })).toBe(
      "anthropic/claude",
    );
  });

  test("guardado no disponible cae al workspace (con trim)", () => {
    expect(resolveModelChoice({ ...base, saved: "x/no", workspaceModel: "  openai/gpt  " })).toBe(
      "openai/gpt",
    );
  });

  test("workspace vacío o no disponible cae al default del servidor", () => {
    expect(
      resolveModelChoice({
        ...base,
        workspaceModel: "   ",
        serverDefault: { providerID: "anthropic", id: "claude" },
      }),
    ).toBe("anthropic/claude");
    expect(
      resolveModelChoice({
        ...base,
        workspaceModel: "x/no",
        serverDefault: { providerID: "openai", id: "gpt" },
      }),
    ).toBe("openai/gpt");
  });

  test("default no disponible cae al primero", () => {
    expect(resolveModelChoice({ ...base, serverDefault: { providerID: "x", id: "no" } })).toBe(
      options[0].key,
    );
  });

  test("sin nada, el primero; catálogo vacío, cadena vacía", () => {
    expect(resolveModelChoice(base)).toBe(options[0].key);
    expect(resolveModelChoice({ ...base, options: [] })).toBe("");
  });
});

describe("resolveAgentChoice — prioridad actual > guardado > build > primero", () => {
  const options: AgentOption[] = [
    { id: "plan", name: "Plan" },
    { id: "build", name: "Build" },
  ];
  const base = { current: "", saved: null as string | null, options };

  test("actual disponible gana", () => {
    expect(resolveAgentChoice({ ...base, current: "plan", saved: "build" })).toBe("plan");
  });

  test("guardado disponible gana a build", () => {
    expect(resolveAgentChoice({ ...base, current: "x", saved: "plan" })).toBe("plan");
  });

  test("sin actual ni guardado, build si existe", () => {
    expect(resolveAgentChoice(base)).toBe("build");
  });

  test("sin build, el primero; catálogo vacío, cadena vacía", () => {
    expect(resolveAgentChoice({ ...base, options: [{ id: "plan", name: "Plan" }] })).toBe("plan");
    expect(resolveAgentChoice({ ...base, options: [] })).toBe("");
  });
});

describe("effectiveVariant", () => {
  const model: ModelOption = {
    key: "anthropic/claude",
    providerID: "anthropic",
    id: "claude",
    name: "Claude",
    variants: ["high", "max"],
  };

  test("variante soportada se conserva", () => {
    expect(effectiveVariant("high", model)).toBe("high");
  });

  test("variante no soportada, modelo sin variantes o ausente → vacío", () => {
    expect(effectiveVariant("low", model)).toBe("");
    expect(effectiveVariant("high", { ...model, variants: [] })).toBe("");
    expect(effectiveVariant("high", null)).toBe("");
    expect(effectiveVariant("high", undefined)).toBe("");
  });

  test("sin variante → vacío", () => {
    expect(effectiveVariant("", model)).toBe("");
  });
});

describe("parseModelRef", () => {
  test("separa provider e id por el primer slash", () => {
    expect(parseModelRef("anthropic/claude")).toEqual({ providerID: "anthropic", id: "claude" });
    expect(parseModelRef(" openai/gpt/extra ")).toEqual({ providerID: "openai", id: "gpt/extra" });
  });
  test("sin separador o con una parte vacía → null", () => {
    expect(parseModelRef("claude")).toBeNull();
    expect(parseModelRef("/claude")).toBeNull();
    expect(parseModelRef("anthropic/")).toBeNull();
    expect(parseModelRef("")).toBeNull();
    expect(parseModelRef(null)).toBeNull();
  });
});
