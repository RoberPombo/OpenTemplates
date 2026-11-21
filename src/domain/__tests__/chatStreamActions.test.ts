// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  chatStreamReducer,
  eventRequestsReload,
  initialChatStreamState,
  type ChatStreamState,
} from "../chat/stream";
import type { ModelOption } from "../chat/selection";

function state(overrides: Partial<ChatStreamState> = {}): ChatStreamState {
  return {
    ...initialChatStreamState({
      branch: null,
      modelChoice: "a/b",
      agentChoice: "build",
      variant: "",
    }),
    ...overrides,
  };
}

const claude: ModelOption = {
  key: "anthropic/claude",
  providerID: "anthropic",
  id: "claude",
  name: "Claude",
  variants: ["high"],
};

describe("eventRequestsReload", () => {
  test("solo eventos terminales de la sesión activa", () => {
    const idle = { type: "session.idle", data: { sessionID: "s1" } };
    expect(eventRequestsReload(idle, "s1")).toBe(true);
    expect(eventRequestsReload(idle, "s2")).toBe(false);
    expect(eventRequestsReload(idle, null)).toBe(false);
    expect(
      eventRequestsReload({ type: "session.text.delta", data: { sessionID: "s1" } }, "s1"),
    ).toBe(false);
    expect(
      eventRequestsReload({ type: "session.execution.failed", data: { sessionID: "s1" } }, "s1"),
    ).toBe(true);
  });
});

describe("chatStreamReducer — acciones de UI", () => {
  test("reset limpia streaming, busy, error y firmas, sin tocar choices ni rama", () => {
    const current = state({
      streaming: [{ id: "m1", text: "x", reasoning: "" }],
      busy: true,
      liveTools: 3,
      error: "fallo",
      appliedModel: "s1|a/b|",
      appliedAgent: "s1|build",
      branch: "main",
    });
    const next = chatStreamReducer(current, { kind: "reset" });
    expect(next).toEqual({
      ...current,
      streaming: [],
      busy: false,
      liveTools: 0,
      error: null,
      appliedModel: "",
      appliedAgent: "",
    });
    expect(next.modelChoice).toBe("a/b");
    expect(next.branch).toBe("main");
  });

  test("workspaceChanged resetea y recarga las choices guardadas", () => {
    const current = state({ busy: true, appliedModel: "x" });
    const next = chatStreamReducer(current, {
      kind: "workspaceChanged",
      modelChoice: "openai/gpt",
      agentChoice: "plan",
      variant: "high",
    });
    expect(next.modelChoice).toBe("openai/gpt");
    expect(next.agentChoice).toBe("plan");
    expect(next.variant).toBe("high");
    expect(next.busy).toBe(false);
    expect(next.appliedModel).toBe("");
  });

  test("modelChosen conserva la variante solo si el nuevo modelo la soporta", () => {
    const current = state({ variant: "high" });
    expect(
      chatStreamReducer(current, { kind: "modelChosen", key: claude.key, model: claude }).variant,
    ).toBe("high");
    const gpt: ModelOption = { ...claude, key: "openai/gpt", id: "gpt", variants: [] };
    expect(
      chatStreamReducer(current, { kind: "modelChosen", key: gpt.key, model: gpt }).variant,
    ).toBe("");
    expect(
      chatStreamReducer(current, { kind: "modelChosen", key: "x/y", model: undefined }).modelChoice,
    ).toBe("x/y");
  });

  test("choices actualiza solo los campos presentes", () => {
    const current = state();
    const next = chatStreamReducer(current, { kind: "choices", agentChoice: "plan" });
    expect(next.agentChoice).toBe("plan");
    expect(next.modelChoice).toBe(current.modelChoice);
  });

  test("catalogResolved aplica la prioridad con el estado actual", () => {
    const current = state({ modelChoice: "", agentChoice: "" });
    const next = chatStreamReducer(current, {
      kind: "catalogResolved",
      models: [claude],
      agents: [{ id: "build", name: "Build" }],
      savedModel: null,
      savedAgent: null,
      workspaceModel: "anthropic/claude",
      serverDefault: null,
    });
    expect(next.modelChoice).toBe("anthropic/claude");
    expect(next.agentChoice).toBe("build");
  });

  test("executionStarted / executionStopped / streamCleared / error / branch / applied", () => {
    let current = state({ liveTools: 2 });
    current = chatStreamReducer(current, { kind: "executionStarted" });
    expect(current.busy).toBe(true);
    expect(current.liveTools).toBe(0);

    current = chatStreamReducer(current, {
      kind: "event",
      event: {
        type: "session.text.delta",
        data: { sessionID: "s1", assistantMessageID: "m", delta: "t" },
      },
      sessionId: "s1",
    });
    expect(current.streaming).toHaveLength(1);
    current = chatStreamReducer(current, { kind: "streamCleared" });
    expect(current.streaming).toEqual([]);

    current = chatStreamReducer(current, { kind: "executionStopped" });
    expect(current.busy).toBe(false);

    current = chatStreamReducer(current, { kind: "busy", busy: true });
    expect(current.busy).toBe(true);
    expect(current.liveTools).toBe(0);

    current = chatStreamReducer(current, { kind: "error", error: "boom" });
    expect(current.error).toBe("boom");
    current = chatStreamReducer(current, { kind: "error", error: null });
    expect(current.error).toBeNull();

    current = chatStreamReducer(current, { kind: "branch", branch: "dev" });
    expect(current.branch).toBe("dev");

    current = chatStreamReducer(current, { kind: "applied", model: "s1|a/b|", agent: "s1|build" });
    expect(current.appliedModel).toBe("s1|a/b|");
    expect(current.appliedAgent).toBe("s1|build");
  });

  test("event delega en applyChatEvent", () => {
    const current = state();
    const next = chatStreamReducer(current, {
      kind: "event",
      event: { type: "session.tool.called", data: { sessionID: "s1" } },
      sessionId: "s1",
    });
    expect(next.liveTools).toBe(1);
  });
});
