import { describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useChatTransfer } from "../useChatTransfer";
import { CompositionRoot } from "../../../CompositionRoot";
import type { ChatServer } from "../../../domain/repositories/ChatGateway";
import type { SessionSummary } from "../../../domain/chat/sessions";
import { createSessionFile, serializeSessionFile } from "../../../domain/chat/transfer";
import {
  makeFakeClient,
  makeSessionFiles,
  makeWorkspace,
  type FakeClientOptions,
} from "../../../tests/fakes";

const session: SessionSummary = {
  id: "s1",
  title: "Chat · Demo",
  created: 1,
  updated: 2,
  cost: 0,
  tokens: { input: 0, output: 0 },
};

const transfer = {
  info: {
    id: "ses_compartida",
    title: "Sesión compartida",
    location: { directory: "/home/ana/otro" },
  },
  messages: [{ id: "msg_1", type: "user", text: "hola" }],
};

const importFile = {
  path: "/tmp/sesion.json",
  contents: serializeSessionFile(createSessionFile(transfer, { sanitized: true, now: 0 })),
};

function setup({
  client: clientOptions = {},
  files,
  confirm = true,
  busy = false,
}: {
  client?: FakeClientOptions;
  files?: Parameters<typeof makeSessionFiles>[0];
  confirm?: boolean;
  busy?: boolean;
} = {}) {
  const { client } = makeFakeClient(clientOptions);
  const sessionFiles = makeSessionFiles(files);
  const confirmFn = vi.fn(() => confirm);
  const root = new CompositionRoot({
    sessionFiles,
    confirm: { confirm: confirmFn },
  });
  const setSessionsError = vi.fn();
  const setSessionsNotice = vi.fn();
  const refreshSessions = vi.fn(async () => undefined);
  const selectSession = vi.fn();
  const sessionsRef = { current: [session] };
  const view = renderHook(() =>
    useChatTransfer({
      client: client as unknown as ChatServer,
      root,
      workspace: makeWorkspace(),
      sessionsRef,
      refreshSessions,
      selectSession,
      busy,
      setSessionsError,
      setSessionsNotice,
    }),
  );
  return {
    client,
    sessionFiles,
    confirmFn,
    refreshSessions,
    selectSession,
    setSessionsError,
    setSessionsNotice,
    ...view,
  };
}

describe("useChatTransfer", () => {
  test("una exportación cancelada no sobrescribe ni avisa", async () => {
    const { result, sessionFiles, confirmFn, setSessionsError, setSessionsNotice } = setup({
      files: { saved: "cancelled" },
    });

    await act(async () => {
      await result.current.exportSession("s1", true);
    });

    expect(sessionFiles.saves).toHaveLength(1);
    expect(sessionFiles.saved).toHaveLength(0);
    expect(confirmFn).not.toHaveBeenCalled();
    expect(setSessionsNotice.mock.calls).toEqual([[null]]);
    expect(setSessionsError.mock.calls).toEqual([[null]]);
  });

  test("una colisión de id al importar se explica y no selecciona la sesión", async () => {
    const { result, client, refreshSessions, selectSession, setSessionsError } = setup({
      client: { importError: new Error("Session already exists: ses_compartida") },
      files: { file: importFile },
    });

    await act(async () => {
      await result.current.importSession();
    });

    expect(client.session.import).toHaveBeenCalledWith(
      expect.objectContaining({ info: expect.objectContaining({ id: "ses_compartida" }) }),
    );
    expect(setSessionsError).toHaveBeenCalledWith(
      "Ya existe una sesión con el identificador ses_compartida en este workspace. Bórrala o importa el archivo en otro workspace.",
    );
    expect(refreshSessions).not.toHaveBeenCalled();
    expect(selectSession).not.toHaveBeenCalled();
  });
});
