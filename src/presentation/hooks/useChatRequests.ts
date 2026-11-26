/**
 * Solicitudes del agente: permisos y formularios pendientes de la sesión.
 *
 * Carga los pendientes al abrir o cambiar de sesión, expone las respuestas y
 * ofrece operaciones estrechas para que el bucle SSE mantenga el estado al
 * día. Sin DOM ni componentes: solo el puerto `ChatServer` y estado de React.
 */
import { useCallback, useEffect, useState } from "react";
import type { ChatServer } from "../../domain/repositories/ChatGateway";
import { errorTextOr } from "../../domain/shared";
import {
  removeAgentForm,
  upsertAgentForm,
  type AgentForm,
  type FormAnswer,
} from "../../domain/chat/forms";
import {
  removePermissionRequest,
  upsertPermissionRequest,
  type PermissionDecision,
  type PermissionRequest,
} from "../../domain/chat/permissions";

export type UseChatRequestsInput = {
  client: ChatServer;
  sessionId: string | null;
};

export function useChatRequests({ client, sessionId }: UseChatRequestsInput) {
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [forms, setForms] = useState<AgentForm[]>([]);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestBusy, setRequestBusy] = useState<string | null>(null);

  const loadPendingRequests = useCallback(
    async (id: string) => {
      try {
        const [permissionResponse, formResponse] = await Promise.all([
          client.permission.list({ sessionID: id }),
          client.form.list({ sessionID: id }),
        ]);
        setPermissions(permissionResponse.data);
        setForms(formResponse.data);
        setRequestError(null);
      } catch (err) {
        setPermissions([]);
        setForms([]);
        setRequestError(errorTextOr(err));
      }
    },
    [client],
  );

  // Los pendientes son de la sesión anterior: se limpian al cambiarla. El
  // efecto es la herramienta correcta porque además lanza la carga de la nueva
  // sesión y ambos pasos deben ocurrir en el mismo commit.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- reset y carga al cambiar de sesión
    setPermissions([]);
    setForms([]);
    setRequestError(null);
    setRequestBusy(null);
    if (!sessionId) return;
    void loadPendingRequests(sessionId);
  }, [sessionId, loadPendingRequests]);

  /** Refleja un `permission.asked` sin duplicar la petición. */
  const upsertPermission = useCallback((request: PermissionRequest) => {
    setPermissions((prev) => upsertPermissionRequest(prev, request));
  }, []);

  /** Retira un permiso ya resuelto (`permission.replied`). */
  const removePermission = useCallback((requestID: string) => {
    setPermissions((prev) => removePermissionRequest(prev, requestID));
  }, []);

  /** Refleja un `form.created` sin duplicar el formulario. */
  const upsertForm = useCallback((form: AgentForm) => {
    setForms((prev) => upsertAgentForm(prev, form));
  }, []);

  /** Retira un formulario ya cerrado (`form.cancelled`/`form.completed`). */
  const removeForm = useCallback((formID: string) => {
    setForms((prev) => removeAgentForm(prev, formID));
  }, []);

  const replyPermission = useCallback(
    async (request: PermissionRequest, decision: PermissionDecision) => {
      setRequestBusy(request.id);
      try {
        await client.permission.reply({
          sessionID: request.sessionID,
          requestID: request.id,
          decision,
        });
        setPermissions((prev) => removePermissionRequest(prev, request.id));
        setRequestError(null);
      } catch (err) {
        setRequestError(errorTextOr(err));
        void loadPendingRequests(request.sessionID);
      } finally {
        setRequestBusy(null);
      }
    },
    [client, loadPendingRequests],
  );

  const replyForm = useCallback(
    async (form: AgentForm, answer: FormAnswer) => {
      setRequestBusy(form.id);
      try {
        await client.form.reply({
          sessionID: form.sessionID,
          formID: form.id,
          answer,
        });
        setForms((prev) => removeAgentForm(prev, form.id));
        setRequestError(null);
      } catch (err) {
        setRequestError(errorTextOr(err));
        void loadPendingRequests(form.sessionID);
      } finally {
        setRequestBusy(null);
      }
    },
    [client, loadPendingRequests],
  );

  const cancelForm = useCallback(
    async (form: AgentForm) => {
      setRequestBusy(form.id);
      try {
        await client.form.cancel({ sessionID: form.sessionID, formID: form.id });
        setForms((prev) => removeAgentForm(prev, form.id));
        setRequestError(null);
      } catch (err) {
        setRequestError(errorTextOr(err));
        void loadPendingRequests(form.sessionID);
      } finally {
        setRequestBusy(null);
      }
    },
    [client, loadPendingRequests],
  );

  return {
    permissions,
    forms,
    requestError,
    requestBusy,
    replyPermission,
    replyForm,
    cancelForm,
    upsertPermission,
    removePermission,
    upsertForm,
    removeForm,
  };
}
