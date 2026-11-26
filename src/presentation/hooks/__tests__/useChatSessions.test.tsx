import { describe, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useChatSessions } from "../useChatSessions";
import { CompositionRoot } from "../../../CompositionRoot";
import type { ChatServer } from "../../../domain/repositories/ChatGateway";
import { prefKeys } from "../../../domain/repositories/Preferences";
import {
  makeFakeClient,
  makePreferences,
  makeWorkspace,
  type FakeClientOptions,
} from "../../../tests/fakes";

const rawMessages = [
  { type: "user", id: "u1", text: "hola", time: { created: 1 } },
  {
    type: "assistant",
    id: "a1",
    content: [{ type: "text", text: "respuesta" }],
    time: { created: 2 },
  },
];

type SetupOptions = {
  storedSession?: string;
  initialSessionId?: string | null;
  client?: FakeClientOptions;
};

function setup({
  storedSession,
  initialSessionId = null,
  client: clientOptions = {},
}: SetupOptions) {
  const key = prefKeys.session("w1");
  const { client } = makeFakeClient(clientOptions);
  const { preferences, store } = makePreferences(storedSession ? { [key]: storedSession } : {});
  const root = new CompositionRoot({ preferences });
  const onError = vi.fn();
  const onSessionReset = vi.fn();
  const onSessionOpened = vi.fn();
  const view = renderHook(
    ({ openSessionId }: { openSessionId: string | null }) =>
      useChatSessions({
        client: client as unknown as ChatServer,
        workspace: makeWorkspace(),
        root,
        initialSessionId,
        openSessionId,
        onError,
        onSessionReset,
        onSessionOpened,
      }),
    { initialProps: { openSessionId: null as string | null } },
  );
  return { key, client, store, onError, onSessionReset, onSessionOpened, ...view };
}

describe("useChatSessions", () => {
  test("reutiliza la sesión guardada y carga su historial", async () => {
    const { client, result, store, key } = setup({
      storedSession: "previa",
      client: { messages: rawMessages },
    });

    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    expect(result.current.sessionId).toBe("previa");
    expect(result.current.loadedSession).toBe("previa");
    expect(result.current.messages.map((message) => message.text)).toEqual(["hola", "respuesta"]);
    expect(client.session.create).not.toHaveBeenCalled();
    expect(client.message.list).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: "previa" }),
    );
    expect(store.get(key)).toBe("previa");
  });

  test("abre una sesión externa y la persiste como activa", async () => {
    const { client, result, store, key, rerender, onSessionOpened } = setup({
      storedSession: "previa",
      client: {
        messagesBySession: {
          "ses-carrera": [{ type: "user", id: "u9", text: "desde la carrera" }],
        },
      },
    });
    await waitFor(() => expect(result.current.sessionId).toBe("previa"));

    rerender({ openSessionId: "ses-carrera" });

    await waitFor(() => expect(result.current.sessionId).toBe("ses-carrera"));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0]?.text).toBe("desde la carrera");
    expect(client.message.list).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: "ses-carrera" }),
    );
    expect(store.get(key)).toBe("ses-carrera");
    expect(onSessionOpened).toHaveBeenCalled();
  });

  test("al cerrar un turno pide solo lo nuevo con el cursor y lo fusiona", async () => {
    const { client, result } = setup({
      storedSession: "previa",
      client: { messages: rawMessages, messageCursor: { next: "cursor-1" } },
    });
    await waitFor(() => expect(result.current.loadedSession).toBe("previa"));

    client.message.list.mockClear();
    client.message.list.mockResolvedValueOnce({
      data: [
        {
          type: "assistant",
          id: "a2",
          content: [{ type: "text", text: "final" }],
          time: { created: 3 },
        },
      ],
      cursor: { next: "cursor-2" },
    });

    await act(async () => {
      await result.current.reloadIncremental();
    });

    expect(client.message.list).toHaveBeenCalledWith({
      sessionID: "previa",
      cursor: "cursor-1",
      limit: 50,
    });
    expect(result.current.messages.map((message) => message.text)).toEqual([
      "hola",
      "respuesta",
      "final",
    ]);
  });

  test("sin cursor cae a la recarga completa", async () => {
    const { client, result } = setup({
      storedSession: "previa",
      client: { messages: rawMessages },
    });
    await waitFor(() => expect(result.current.loadedSession).toBe("previa"));

    client.message.list.mockClear();
    await act(async () => {
      await result.current.reloadIncremental();
    });

    expect(client.message.list).toHaveBeenCalledWith({
      sessionID: "previa",
      limit: 200,
      order: "asc",
    });
    expect(result.current.messages).toHaveLength(2);
  });

  test("borrar la sesión activa limpia el historial y la preferencia", async () => {
    const { client, result, store, key, onSessionReset } = setup({
      storedSession: "previa",
      initialSessionId: "previa",
      client: { messages: rawMessages },
    });
    await waitFor(() => expect(result.current.loadedSession).toBe("previa"));

    await act(async () => {
      await result.current.deleteSession("previa");
    });

    expect(client.session.remove).toHaveBeenCalledWith({ sessionID: "previa" });
    expect(result.current.sessionId).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(store.has(key)).toBe(false);
    expect(onSessionReset).toHaveBeenCalled();
    // Con `initialSessionId`, la sesión la aporta el coordinador: no se crea otra.
    expect(client.session.create).not.toHaveBeenCalled();
  });
});
