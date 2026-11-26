import { describe, expect, test } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useChatRequests } from "../useChatRequests";
import type { ChatServer } from "../../../domain/repositories/ChatGateway";
import type { AgentForm } from "../../../domain/chat/forms";
import type { PermissionRequest } from "../../../domain/chat/permissions";
import { makeFakeClient, type FakeClientOptions } from "../../../tests/fakes";

const pendingPermission: PermissionRequest = {
  id: "per_1",
  sessionID: "s1",
  action: "bash",
  resources: ["pnpm test"],
};

const pendingForm: AgentForm = {
  id: "frm_1",
  sessionID: "s1",
  title: "¿Qué entorno preparo?",
  fields: [{ key: "entorno", type: "string", title: "Entorno", required: true }],
};

function setup(options: FakeClientOptions = {}, sessionId: string | null = "s1") {
  const { client } = makeFakeClient(options);
  const view = renderHook(
    ({ id }: { id: string | null }) =>
      useChatRequests({ client: client as unknown as ChatServer, sessionId: id }),
    { initialProps: { id: sessionId } },
  );
  return { client, ...view };
}

describe("useChatRequests", () => {
  test("carga los permisos y formularios pendientes de la sesión", async () => {
    const { client, result } = setup({
      permissions: [pendingPermission],
      forms: [pendingForm],
    });

    await waitFor(() => expect(result.current.permissions).toEqual([pendingPermission]));
    expect(result.current.forms).toEqual([pendingForm]);
    expect(client.permission.list).toHaveBeenCalledWith({ sessionID: "s1" });
    expect(client.form.list).toHaveBeenCalledWith({ sessionID: "s1" });
    expect(result.current.requestError).toBeNull();
  });

  test("responde un permiso y lo retira de los pendientes", async () => {
    const { client, result } = setup({ permissions: [pendingPermission] });
    await waitFor(() => expect(result.current.permissions).toHaveLength(1));

    await act(async () => {
      await result.current.replyPermission(pendingPermission, "once");
    });

    expect(client.permission.reply).toHaveBeenCalledWith({
      sessionID: "s1",
      requestID: "per_1",
      decision: "once",
    });
    expect(result.current.permissions).toEqual([]);
    expect(result.current.requestBusy).toBeNull();
  });

  test("responde un formulario y lo retira de los pendientes", async () => {
    const { client, result } = setup({ forms: [pendingForm] });
    await waitFor(() => expect(result.current.forms).toHaveLength(1));

    await act(async () => {
      await result.current.replyForm(pendingForm, { entorno: "dev" });
    });

    expect(client.form.reply).toHaveBeenCalledWith({
      sessionID: "s1",
      formID: "frm_1",
      answer: { entorno: "dev" },
    });
    expect(result.current.forms).toEqual([]);
    expect(result.current.requestBusy).toBeNull();
  });

  test("cancela un formulario y lo retira de los pendientes", async () => {
    const { client, result } = setup({ forms: [pendingForm] });
    await waitFor(() => expect(result.current.forms).toHaveLength(1));

    await act(async () => {
      await result.current.cancelForm(pendingForm);
    });

    expect(client.form.cancel).toHaveBeenCalledWith({ sessionID: "s1", formID: "frm_1" });
    expect(result.current.forms).toEqual([]);
    expect(result.current.requestBusy).toBeNull();
  });

  test("si la respuesta falla expone el error y recarga los pendientes", async () => {
    const { client, result } = setup({ permissions: [pendingPermission] });
    await waitFor(() => expect(result.current.permissions).toHaveLength(1));
    client.permission.reply.mockRejectedValueOnce(new Error("sin conexión"));
    client.permission.list.mockRejectedValueOnce(new Error("recarga fallida"));

    await act(async () => {
      await result.current.replyPermission(pendingPermission, "reject");
    });

    expect(result.current.requestError).toBe("recarga fallida");
    expect(result.current.permissions).toEqual([]);
    expect(client.permission.list).toHaveBeenCalledTimes(2);
  });

  test("al cambiar de sesión limpia los pendientes y carga los de la nueva", async () => {
    const { client, result, rerender } = setup({ permissions: [pendingPermission] });
    await waitFor(() => expect(result.current.permissions).toHaveLength(1));

    rerender({ id: null });
    expect(result.current.permissions).toEqual([]);
    expect(result.current.forms).toEqual([]);
    expect(client.permission.list).toHaveBeenCalledTimes(1);

    rerender({ id: "s2" });
    await waitFor(() => expect(client.permission.list).toHaveBeenCalledWith({ sessionID: "s2" }));
  });

  test("las operaciones del bucle SSE actualizan sin duplicar", () => {
    const { result } = setup({});

    act(() => result.current.upsertPermission(pendingPermission));
    act(() =>
      result.current.upsertPermission({
        ...pendingPermission,
        resources: ["pnpm build"],
      }),
    );
    expect(result.current.permissions).toHaveLength(1);
    expect(result.current.permissions[0]?.resources).toEqual(["pnpm build"]);

    act(() => result.current.removePermission("per_1"));
    expect(result.current.permissions).toEqual([]);

    act(() => result.current.upsertForm(pendingForm));
    act(() => result.current.upsertForm({ ...pendingForm, title: "Otra pregunta" }));
    expect(result.current.forms).toHaveLength(1);
    expect(result.current.forms[0]?.title).toBe("Otra pregunta");

    act(() => result.current.removeForm("frm_1"));
    expect(result.current.forms).toEqual([]);
  });
});
