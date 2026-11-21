// @vitest-environment node
import { describe, expect, test } from "vitest";
import { applyChatEvent, initialChatStreamState, type ChatStreamState } from "../chat/stream";

const SESSION = "s1";

function state(overrides: Partial<ChatStreamState> = {}): ChatStreamState {
  return {
    ...initialChatStreamState({ branch: "main", modelChoice: "", agentChoice: "", variant: "" }),
    ...overrides,
  };
}

function event(type: string, data?: Record<string, unknown>) {
  return { type, data };
}

function apply(
  current: ChatStreamState,
  type: string,
  data?: Record<string, unknown>,
  sessionId: string | null = SESSION,
) {
  return applyChatEvent(current, event(type, data), sessionId);
}

describe("applyChatEvent — filtrado por sesión", () => {
  test("eventos de otra sesión o sin sesión no cambian nada", () => {
    const current = state();
    for (const sessionId of [null, "otra"]) {
      const result = applyChatEvent(
        current,
        event("session.text.delta", { sessionID: SESSION, delta: "x" }),
        sessionId,
      );
      expect(result.state).toBe(current);
      expect(result.reload).toBe(false);
    }
    const mismatch = apply(current, "session.execution.started", { sessionID: "otra" });
    expect(mismatch.state).toBe(current);
  });

  test("tipo desconocido no cambia nada", () => {
    const current = state();
    const result = apply(current, "session.algo", { sessionID: SESSION });
    expect(result.state).toBe(current);
    expect(result.reload).toBe(false);
  });
});

describe("applyChatEvent — vcs.branch.updated", () => {
  test("actualiza la rama incluso sin sesión activa", () => {
    const result = apply(state(), "vcs.branch.updated", { branch: "feature" }, null);
    expect(result.state.branch).toBe("feature");
    expect(result.reload).toBe(false);
  });

  test("actualiza la rama aunque el evento sea de otra sesión", () => {
    const result = apply(state(), "vcs.branch.updated", { branch: "feature", sessionID: "otra" });
    expect(result.state.branch).toBe("feature");
  });

  test("branch no string se ignora", () => {
    const current = state();
    expect(apply(current, "vcs.branch.updated", { branch: 42 }).state).toBe(current);
    expect(apply(current, "vcs.branch.updated", {}).state).toBe(current);
  });
});

describe("applyChatEvent — streaming de texto y razonamiento", () => {
  test("text.started crea el part; repetido no duplica", () => {
    const first = apply(state(), "session.text.started", {
      sessionID: SESSION,
      assistantMessageID: "m1",
    });
    expect(first.state.streaming).toEqual([{ id: "m1", text: "", reasoning: "" }]);
    const again = applyChatEvent(
      first.state,
      event("session.text.started", { sessionID: SESSION, assistantMessageID: "m1" }),
      SESSION,
    );
    expect(again.state.streaming).toHaveLength(1);
  });

  test("sin assistantMessageID usa 'stream'", () => {
    const result = apply(state(), "session.text.started", { sessionID: SESSION });
    expect(result.state.streaming[0].id).toBe("stream");
  });

  test("text.delta acumula y crea el part si no existe", () => {
    let current = state();
    current = apply(current, "session.text.delta", {
      sessionID: SESSION,
      assistantMessageID: "m1",
      delta: "ho",
    }).state;
    current = apply(current, "session.text.delta", {
      sessionID: SESSION,
      assistantMessageID: "m1",
      delta: "la",
    }).state;
    expect(current.streaming).toEqual([{ id: "m1", text: "hola", reasoning: "" }]);
  });

  test("reasoning.delta acumula en reasoning", () => {
    let current = apply(state(), "session.text.started", {
      sessionID: SESSION,
      assistantMessageID: "m1",
    }).state;
    current = apply(current, "session.reasoning.delta", {
      sessionID: SESSION,
      assistantMessageID: "m1",
      delta: "pens",
    }).state;
    current = apply(current, "session.reasoning.delta", {
      sessionID: SESSION,
      assistantMessageID: "m1",
      delta: "ando",
    }).state;
    expect(current.streaming).toEqual([{ id: "m1", text: "", reasoning: "pensando" }]);
  });

  test("parts independientes conviven", () => {
    let current = state();
    current = apply(current, "session.text.delta", {
      sessionID: SESSION,
      assistantMessageID: "m1",
      delta: "a",
    }).state;
    current = apply(current, "session.text.delta", {
      sessionID: SESSION,
      assistantMessageID: "m2",
      delta: "b",
    }).state;
    expect(current.streaming).toEqual([
      { id: "m1", text: "a", reasoning: "" },
      { id: "m2", text: "b", reasoning: "" },
    ]);
  });

  test("delta ausente se trata como vacío", () => {
    const result = apply(state(), "session.text.delta", {
      sessionID: SESSION,
      assistantMessageID: "m1",
    });
    expect(result.state.streaming).toEqual([{ id: "m1", text: "", reasoning: "" }]);
  });
});

describe("applyChatEvent — selección de modelo y agente", () => {
  test("model.selected actualiza choice, variant y firma aplicada", () => {
    const result = apply(state(), "session.model.selected", {
      sessionID: SESSION,
      model: { providerID: "anthropic", id: "claude", variant: "high" },
    });
    expect(result.state.modelChoice).toBe("anthropic/claude");
    expect(result.state.variant).toBe("high");
    expect(result.state.appliedModel).toBe("s1|anthropic/claude|high");
  });

  test("model.selected sin variant deja variant vacío y firma con ''", () => {
    const result = apply(state(), "session.model.selected", {
      sessionID: SESSION,
      model: { providerID: "openai", id: "gpt" },
    });
    expect(result.state.variant).toBe("");
    expect(result.state.appliedModel).toBe("s1|openai/gpt|");
  });

  test("model inválido (sin providerID o id string) se ignora", () => {
    const current = state();
    expect(
      apply(current, "session.model.selected", { sessionID: SESSION, model: { providerID: "x" } })
        .state,
    ).toBe(current);
    expect(
      apply(current, "session.model.selected", { sessionID: SESSION, model: null }).state,
    ).toBe(current);
    expect(apply(current, "session.model.selected", { sessionID: SESSION }).state).toBe(current);
  });

  test("agent.selected string actualiza choice y firma", () => {
    const result = apply(state(), "session.agent.selected", { sessionID: SESSION, agent: "plan" });
    expect(result.state.agentChoice).toBe("plan");
    expect(result.state.appliedAgent).toBe("s1|plan");
  });

  test("agent no string se ignora", () => {
    const current = state();
    expect(apply(current, "session.agent.selected", { sessionID: SESSION, agent: 7 }).state).toBe(
      current,
    );
  });
});

describe("applyChatEvent — ciclo de ejecución", () => {
  test("tool.called incrementa liveTools", () => {
    let current = state();
    current = apply(current, "session.tool.called", { sessionID: SESSION }).state;
    current = apply(current, "session.tool.called", { sessionID: SESSION }).state;
    expect(current.liveTools).toBe(2);
  });

  test("execution.started pone busy y resetea liveTools", () => {
    const result = apply(state({ liveTools: 3 }), "session.execution.started", {
      sessionID: SESSION,
    });
    expect(result.state.busy).toBe(true);
    expect(result.state.liveTools).toBe(0);
    expect(result.reload).toBe(false);
  });

  test.each(["session.idle", "session.execution.succeeded", "session.execution.interrupted"])(
    "%s termina la ejecución y pide reload",
    (type) => {
      const result = apply(state({ busy: true, liveTools: 2 }), type, { sessionID: SESSION });
      expect(result.state.busy).toBe(false);
      expect(result.state.liveTools).toBe(0);
      expect(result.reload).toBe(true);
    },
  );

  test("execution.failed usa error.message, luego error.name, luego default", () => {
    const withMessage = apply(state(), "session.execution.failed", {
      sessionID: SESSION,
      error: { message: "boom", name: "E" },
    });
    expect(withMessage.state.error).toBe("boom");
    expect(withMessage.state.busy).toBe(false);
    expect(withMessage.reload).toBe(true);

    const withName = apply(state(), "session.execution.failed", {
      sessionID: SESSION,
      error: { name: "RateLimit" },
    });
    expect(withName.state.error).toBe("RateLimit");

    const bare = apply(state(), "session.execution.failed", { sessionID: SESSION });
    expect(bare.state.error).toBe("La ejecución falló");
  });

  test("eventos sin data se tratan como objeto vacío (filtra la sesión)", () => {
    const current = state();
    const result = applyChatEvent(current, { type: "session.execution.started" }, SESSION);
    expect(result.state).toBe(current);
    const branch = applyChatEvent(current, { type: "vcs.branch.updated" }, SESSION);
    expect(branch.state).toBe(current);
  });
});

describe("applyChatEvent — pureza", () => {
  test("no muta el estado anterior", () => {
    const current = state({ streaming: [{ id: "m1", text: "a", reasoning: "" }] });
    const frozen = JSON.stringify(current);
    apply(current, "session.text.delta", {
      sessionID: SESSION,
      assistantMessageID: "m1",
      delta: "b",
    });
    apply(current, "session.execution.started", { sessionID: SESSION });
    expect(JSON.stringify(current)).toBe(frozen);
  });
});
