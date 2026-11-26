import { beforeEach, describe, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useChatGoal } from "../useChatGoal";
import { CompositionRoot } from "../../../CompositionRoot";
import type { ChatServer } from "../../../domain/repositories/ChatGateway";
import { prefKeys } from "../../../domain/repositories/Preferences";
import { createGoal, parseGoal, serializeGoal } from "../../../domain/chat/goals";
import { makeFakeClient, makeNotificationGateway, makeWorkspace } from "../../../tests/fakes";

function setup(
  clientOptions: Parameters<typeof makeFakeClient>[0] = {},
  prepare?: (root: CompositionRoot) => void,
) {
  const { client } = makeFakeClient(clientOptions);
  const root = new CompositionRoot({ notifications: makeNotificationGateway() });
  prepare?.(root);
  const dispatch = vi.fn();
  const view = renderHook(() =>
    useChatGoal({
      client: client as unknown as ChatServer,
      sessionId: "s1",
      workspace: makeWorkspace(),
      root,
      sessions: [],
      messages: [],
      sessionsRef: { current: [] },
      busy: false,
      permissionsCount: 0,
      formsCount: 0,
      dispatch,
    }),
  );
  return { client, root, dispatch, ...view };
}

function persistActiveGoal(root: CompositionRoot) {
  const goal = createGoal({ text: "deja los tests en verde", now: 1 });
  root.preferences.set(prefKeys.goal("w1", "s1"), serializeGoal(goal));
}

beforeEach(() => {
  localStorage.clear();
});

describe("useChatGoal", () => {
  test("reanuda un objetivo activo cuando la sesión ya está cargada", async () => {
    const { client, dispatch, result } = setup({}, persistActiveGoal);
    await waitFor(() => expect(result.current.goal?.status).toBe("active"));
    // El modelo de decisión llega del catálogo: la reanudación lo espera.
    await waitFor(() => expect(result.current.decisionModel).not.toBeNull());

    act(() => result.current.markSessionLoaded("s1"));

    await waitFor(() => expect(client.session.prompt).toHaveBeenCalled());
    expect(client.session.prompt).toHaveBeenCalledWith({
      sessionID: "s1",
      text: expect.stringContaining("Continúa con el objetivo: «deja los tests en verde»"),
    });
    expect(dispatch).toHaveBeenCalledWith({ kind: "executionStarted" });
  });

  test("pausar persiste el objetivo y no reanuda la sesión", async () => {
    const { client, root, result } = setup({}, persistActiveGoal);
    await waitFor(() => expect(result.current.goal?.status).toBe("active"));

    act(() => result.current.pauseGoal());

    expect(result.current.goal?.status).toBe("paused");
    const stored = parseGoal(root.preferences.get(prefKeys.goal("w1", "s1")));
    expect(stored?.status).toBe("paused");
    expect(client.session.prompt).not.toHaveBeenCalled();
  });
});
