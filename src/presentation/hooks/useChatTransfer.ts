/**
 * Transferencia de sesiones: exportar (con confirmación de sobrescritura),
 * importar (con errores legibles) y bifurcar (con `before` y bloqueo si el
 * turno está en curso).
 *
 * La lógica pura vive en `domain/chat/transfer`; este hook solo orquesta los
 * puertos (cliente, ficheros, confirmación) y el feedback del panel. El estado
 * de avisos lo posee `useChatSessions` —se comparte con renombrar y borrar—,
 * así que entra por callbacks y la vista sigue mostrando un único mensaje.
 */
import { useCallback, type RefObject } from "react";
import type { CompositionRoot } from "../../CompositionRoot";
import type { ChatServer } from "../../domain/repositories/ChatGateway";
import type { Workspace } from "../../types";
import { errorTextOr } from "../../domain/shared";
import type { SessionSummary } from "../../domain/chat/sessions";
import {
  createSessionFile,
  importErrorMessage,
  parseSessionFile,
  prepareImport,
  serializeSessionFile,
  suggestedSessionFileName,
} from "../../domain/chat/transfer";

export type UseChatTransferInput = {
  client: ChatServer;
  root: CompositionRoot;
  workspace: Workspace;
  /** Lista actual de sesiones: de ahí sale el título del fichero exportado. */
  sessionsRef: RefObject<SessionSummary[]>;
  refreshSessions: () => Promise<void>;
  selectSession: (id: string) => void;
  /** Turno en curso: no se puede bifurcar hasta que termine. */
  busy: boolean;
  /** Aviso de error del panel de sesiones (estado compartido). */
  setSessionsError: (message: string | null) => void;
  /** Aviso informativo del panel de sesiones (estado compartido). */
  setSessionsNotice: (message: string | null) => void;
};

export function useChatTransfer({
  client,
  root,
  workspace,
  sessionsRef,
  refreshSessions,
  selectSession,
  busy,
  setSessionsError,
  setSessionsNotice,
}: UseChatTransferInput) {
  const clearFeedback = useCallback(() => {
    setSessionsError(null);
    setSessionsNotice(null);
  }, [setSessionsError, setSessionsNotice]);

  const exportSession = useCallback(
    async (id: string, sanitize: boolean) => {
      clearFeedback();
      const title = sessionsRef.current.find((session) => session.id === id)?.title ?? "";
      try {
        const transfer = await client.session.export({ sessionID: id, sanitize });
        const contents = serializeSessionFile(createSessionFile(transfer, { sanitized: sanitize }));
        const suggestedName = suggestedSessionFileName(title);
        let result = await root.sessionFiles.save({ suggestedName, contents });
        if (result.status === "exists") {
          const overwrite = root.confirm.confirm(
            `Ya existe un archivo en ${result.path}. ¿Sobrescribirlo?`,
          );
          if (!overwrite) return;
          result = await root.sessionFiles.save({ suggestedName, contents, overwrite: true });
        }
        if (result.status === "saved") {
          setSessionsNotice(`Sesión exportada en ${result.path}`);
        }
      } catch (err) {
        setSessionsError(errorTextOr(err));
      }
    },
    [clearFeedback, client, root, sessionsRef, setSessionsError, setSessionsNotice],
  );

  const importSession = useCallback(async () => {
    clearFeedback();
    try {
      const picked = await root.sessionFiles.open();
      if (!picked) return;
      const parsed = parseSessionFile(picked.contents);
      if (!parsed.ok) {
        setSessionsError(parsed.error);
        return;
      }
      const payload = prepareImport(parsed.file, {
        directory: workspace.projectPath,
        title: `Importada · ${workspace.name}`,
      });
      try {
        const created = await client.session.import(payload);
        await refreshSessions();
        selectSession(created.id);
        setSessionsNotice(`Sesión importada desde ${picked.path}`);
      } catch (err) {
        setSessionsError(importErrorMessage(err, payload.info.id));
      }
    } catch (err) {
      setSessionsError(errorTextOr(err));
    }
  }, [
    clearFeedback,
    client,
    root,
    refreshSessions,
    selectSession,
    setSessionsError,
    setSessionsNotice,
    workspace.name,
    workspace.projectPath,
  ]);

  const forkSession = useCallback(
    async (id: string, before?: string) => {
      if (busy) {
        setSessionsError("Espera a que termine el turno en curso para duplicar la sesión.");
        return;
      }
      clearFeedback();
      try {
        const created = await client.session.fork({ sessionID: id, before });
        await refreshSessions();
        selectSession(created.id);
        setSessionsNotice(before ? "Sesión duplicada hasta ese mensaje." : "Sesión duplicada.");
      } catch (err) {
        setSessionsError(errorTextOr(err));
      }
    },
    [
      busy,
      clearFeedback,
      client,
      refreshSessions,
      selectSession,
      setSessionsError,
      setSessionsNotice,
    ],
  );

  return { exportSession, importSession, forkSession };
}
