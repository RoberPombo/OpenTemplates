import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import { useRace } from "../useRace";
import { makeFakeClient, makeWorkspace } from "../../../tests/fakes";
import type { Preferences } from "../../../domain/repositories/Preferences";
import type { ChatServer } from "../../../domain/repositories/ChatGateway";

function makePreferences(): Preferences & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: (key) => store.get(key) ?? null,
    set: (key, value) => {
      store.set(key, value);
    },
    remove: (key) => {
      store.delete(key);
    },
  };
}

function setup(options: Parameters<typeof makeFakeClient>[0] = {}) {
  const { client, hub } = makeFakeClient({ branch: "main", ...options });
  const preferences = makePreferences();
  const view = renderHook(() =>
    useRace({
      client: client as unknown as ChatServer,
      workspace: makeWorkspace(),
      worktreesRoot: "/wt",
      repoPath: "/tmp/demo",
      sessionId: null,
      preferences,
    }),
  );
  return { client, hub, preferences, ...view };
}

async function ready(result: ReturnType<typeof setup>["result"]) {
  await waitFor(() => expect(result.current.models).toHaveLength(2));
  expect(result.current.isGit).toBe(true);
  expect(result.current.projectID).toBe("p1");
}

describe("useRace — ejecución", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("lanza una sesión por modelo con el mismo encargo, modelo y agente", async () => {
    const { client, result } = setup();
    await ready(result);

    act(() => {
      expect(
        result.current.startRace({
          prompt: "Añade validación",
          modelKeys: ["anthropic/claude", "openai/gpt"],
          agent: "build",
          useWorktrees: true,
        }),
      ).toBeNull();
    });

    await waitFor(() => expect(client.session.prompt).toHaveBeenCalledTimes(2));
    expect(client.worktree.create).toHaveBeenCalledTimes(2);
    const names = client.worktree.create.mock.calls.map((call) => call[0].name);
    expect(names[0]).toMatch(/-1$/);
    expect(names[1]).toMatch(/-2$/);
    expect(client.worktree.create).toHaveBeenCalledWith(
      expect.objectContaining({ projectID: "p1", branch: "main", directory: "/wt/demo" }),
    );
    expect(client.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "build",
        model: { id: "claude", providerID: "anthropic" },
        location: { directory: `/wt/demo/${names[0]}` },
      }),
    );
    expect(client.session.prompt).toHaveBeenCalledWith({
      sessionID: "s1",
      text: "Añade validación",
    });
    expect(client.session.prompt).toHaveBeenCalledWith({
      sessionID: "s2",
      text: "Añade validación",
    });
    expect(result.current.race?.runs.every((run) => run.status === "running")).toBe(true);
  });

  test("el fallo de un worktree no tumba la otra corrida", async () => {
    const { client, result } = setup();
    await ready(result);
    client.worktree.create
      .mockImplementationOnce(async (input: { name?: string }) => ({
        directory: `/wt/demo/${input.name}`,
      }))
      .mockImplementationOnce(async () => {
        throw new Error("git worktree roto");
      });

    act(() => {
      result.current.startRace({
        prompt: "Hazlo",
        modelKeys: ["anthropic/claude", "openai/gpt"],
        agent: null,
        useWorktrees: true,
      });
    });

    await waitFor(() => expect(result.current.race?.runs[1].status).toBe("failed"));
    expect(result.current.race?.runs[1].error).toBe("git worktree roto");
    expect(result.current.race?.runs[0].status).toBe("running");
    expect(client.session.create).toHaveBeenCalledTimes(1);
    expect(client.session.prompt).toHaveBeenCalledTimes(1);
  });

  test("sin worktrees todas las corridas comparten la carpeta del workspace", async () => {
    const { client, result } = setup();
    await ready(result);
    act(() => {
      result.current.startRace({
        prompt: "Hazlo",
        modelKeys: ["anthropic/claude", "openai/gpt"],
        agent: null,
        useWorktrees: false,
      });
    });
    await waitFor(() => expect(client.session.create).toHaveBeenCalledTimes(2));
    expect(client.worktree.create).not.toHaveBeenCalled();
    expect(client.session.create).toHaveBeenCalledWith(
      expect.objectContaining({ location: { directory: "/tmp/demo" } }),
    );
  });

  test("una carrera terminada sin ganadora libera sus worktrees al olvidarla", async () => {
    const { client, hub, result } = setup();
    await ready(result);
    client.session.create
      .mockImplementationOnce(async () => ({ id: "s1" }))
      .mockImplementationOnce(async () => {
        throw new Error("sin sesión");
      });
    act(() => {
      result.current.startRace({
        prompt: "Hazlo",
        modelKeys: ["anthropic/claude", "openai/gpt"],
        agent: null,
        useWorktrees: true,
      });
    });
    await waitFor(() => expect(result.current.race?.runs[1].status).toBe("failed"));
    await waitFor(() => expect(hub.active).toBeGreaterThan(0));
    act(() => {
      hub.push({ type: "session.idle", data: { sessionID: "s1" } });
    });
    await waitFor(() => expect(result.current.race?.runs[0].status).toBe("succeeded"));

    const directories = result.current.race?.runs.map((run) => run.worktree) ?? [];
    await result.current.clearRace();
    await waitFor(() => expect(result.current.race).toBeNull());
    for (const directory of directories) {
      expect(client.worktree.remove).toHaveBeenCalledWith(
        expect.objectContaining({ directory, force: true }),
      );
    }
  });

  test("los eventos cierran la corrida y elegir ganadora limpia la perdedora", async () => {
    const { client, hub, result, unmount } = setup();
    await ready(result);
    act(() => {
      result.current.startRace({
        prompt: "Hazlo",
        modelKeys: ["anthropic/claude", "openai/gpt"],
        agent: null,
        useWorktrees: true,
      });
    });
    await waitFor(() => expect(client.session.prompt).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hub.active).toBeGreaterThan(0));

    act(() => {
      hub.push({ type: "session.idle", data: { sessionID: "s1" } });
      hub.push({ type: "session.idle", data: { sessionID: "s2" } });
    });
    await waitFor(() =>
      expect(result.current.race?.runs.map((run) => run.status)).toEqual([
        "succeeded",
        "succeeded",
      ]),
    );

    const winner = result.current.race?.runs[0];
    const loser = result.current.race?.runs[1];
    expect(winner && loser).toBeTruthy();
    await result.current.keepWinner(winner!.id);
    await waitFor(() => expect(result.current.race?.winnerRunId).toBe(winner!.id));

    expect(client.session.remove).toHaveBeenCalledWith({ sessionID: "s2" });
    expect(client.worktree.remove).toHaveBeenCalledWith(
      expect.objectContaining({ projectID: "p1", directory: loser!.directory, force: true }),
    );
    await waitFor(() => expect(result.current.race?.runs[1].cleanedAt).not.toBeNull());

    unmount();
  });
});
