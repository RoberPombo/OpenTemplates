/* oxlint-disable react/iframe-missing-sandbox — el preview corre en otro origen (localhost), no en el de la app */
/**
 * Dock de vista previa de la app en marcha del workspace.
 *
 * Carga la URL configurada en un iframe de otro origen. No hay inspector de
 * elementos: leer el DOM del iframe es imposible sin un proxy propio. El estado
 * sale del sondeo del backend y lo que se manda al agente es la URL, la ruta, el
 * tamaño, el estado y la petición del usuario, recortado y numerado.
 */
import { useState, type FormEvent } from "react";
import type { ChatServer } from "../../domain/repositories/ChatGateway";
import type { PreviewGateway } from "../../domain/repositories/PreviewGateway";
import type { Preferences } from "../../domain/repositories/Preferences";
import type { Workspace } from "../../types";
import {
  DEFAULT_PREVIEW_URL,
  PREVIEW_DEVICES,
  buildPreviewPrompt,
  previewSize,
  type PreviewDevice,
} from "../../domain/preview/preview";
import { errorText } from "../../domain/shared/errors";
import { usePreview } from "../hooks/usePreview";
import { Button } from "./ui";

type Props = {
  gateway: PreviewGateway;
  preferences: Preferences;
  workspace: Workspace;
  client: ChatServer | null;
  sessionId: string | null;
  onClose: () => void;
};

const DEVICE_ORDER: PreviewDevice[] = ["desktop", "tablet", "mobile"];

export function PreviewDock({
  gateway,
  preferences,
  workspace,
  client,
  sessionId,
  onClose,
}: Props) {
  const preview = usePreview({
    gateway,
    preferences,
    workspaceId: workspace.id,
  });
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [externalError, setExternalError] = useState<string | null>(null);
  const size = previewSize(preview.device);

  function submitUrl(event: FormEvent) {
    event.preventDefault();
    setSent(false);
    preview.applyUrl();
  }

  async function openExternal() {
    setExternalError(null);
    try {
      await gateway.openExternal(preview.url);
    } catch (error) {
      setExternalError(errorText(error));
    }
  }

  async function sendToAgent() {
    if (!client || !sessionId) return;
    setSending(true);
    setSendError(null);
    setSent(false);
    try {
      await client.session.prompt({
        sessionID: sessionId,
        text: buildPreviewPrompt({
          workspaceName: workspace.name,
          url: preview.url,
          projectPath: workspace.projectPath,
          device: preview.device,
          probe: preview.probe,
          note,
        }),
      });
      setSent(true);
    } catch (error) {
      setSendError(errorText(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="preview-dock" aria-label="Vista previa de la aplicación">
      <header className="preview-head">
        <div className="preview-title">
          <strong>Vista previa</strong>
          <span className={`preview-dot ${preview.status}`} aria-hidden="true" />
          <output className="preview-message" title={preview.message}>
            {preview.message}
          </output>
        </div>
        <div className="row preview-actions">
          <Button onClick={() => void openExternal()} title="Abrir la URL en el navegador externo">
            Abrir
          </Button>
          <Button onClick={preview.reload} title="Volver a comprobar y cargar la página">
            Recargar
          </Button>
          <Button
            variant="icon"
            aria-label="Cerrar vista previa"
            title="Cerrar el dock"
            onClick={onClose}
          >
            ×
          </Button>
        </div>
      </header>

      <div className="preview-toolbar">
        <form className="preview-url" onSubmit={submitUrl}>
          <input
            aria-label="URL o puerto de la aplicación"
            value={preview.urlInput}
            onChange={(event) => preview.updateInput(event.target.value)}
            placeholder={DEFAULT_PREVIEW_URL}
            spellCheck={false}
          />
          <Button type="submit" title="Aplicar la URL y comprobarla">
            Aplicar
          </Button>
        </form>
        <div className="preview-devices">
          {DEVICE_ORDER.map((device) => (
            <Button
              key={device}
              size="small"
              className={preview.device === device ? "active" : ""}
              aria-pressed={preview.device === device}
              onClick={() => preview.setDevice(device)}
            >
              {PREVIEW_DEVICES[device].label}
            </Button>
          ))}
        </div>
      </div>

      {preview.urlError && (
        <div className="inline-error preview-error" role="alert">
          {preview.urlError}
        </div>
      )}
      {externalError && (
        <div className="inline-error preview-error" role="alert">
          {externalError}
        </div>
      )}

      {preview.status === "loading" && (
        <div className="preview-state">
          <output className="preview-state-message">Comprobando {preview.url}…</output>
          <span className="muted small-text">
            Aún no se pinta la página hasta saber que responde.
          </span>
        </div>
      )}

      {preview.status === "error" && (
        <div className="preview-state preview-state-error">
          <p className="preview-state-message" role="alert">
            {preview.message}
          </p>
          <span className="muted small-text" title={preview.url}>
            {preview.url}
          </span>
          <div className="row">
            <Button variant="primary" onClick={preview.reload}>
              Reintentar
            </Button>
            <Button onClick={() => void openExternal()}>Abrir en el navegador</Button>
          </div>
        </div>
      )}

      {preview.status === "ready" && (
        <div className="preview-stage">
          {preview.probe?.frameBlocked && (
            <div className="callout warning preview-warning">
              El servidor prohíbe embeber la página (X-Frame-Options o frame-ancestors). Es posible
              que el marco aparezca vacío: ábrela con «Abrir» mientras ajustas el servidor.
            </div>
          )}
          <div className="preview-frame-scroll">
            <div className="preview-frame" style={{ width: size.width }}>
              {/* El preview corre en otro origen (localhost), no en el de la app:
                  allow-same-origin le da su propio origen para storage/cookies,
                  no acceso al contexto de Tauri. */}
              <iframe
                key={preview.frameKey}
                src={preview.url}
                title="Aplicación en marcha"
                // El preview es contenido de confianza del usuario, pero se
                // aísla igualmente: scripts y formularios sí, sin acceso al
                // contexto de la app ni a ventanas emergentes arbitrarias.
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads"
                onLoad={preview.onFrameLoad}
              />
              {preview.frameLoading && (
                <div className="preview-frame-loading">Cargando la página…</div>
              )}
            </div>
          </div>
        </div>
      )}

      <footer className="preview-send">
        <label className="preview-note">
          <span>¿Qué quieres que revise el agente?</span>
          <textarea
            rows={2}
            value={note}
            placeholder="Por ejemplo: el botón de guardar no responde en móvil"
            onChange={(event) => {
              setNote(event.target.value);
              setSent(false);
            }}
          />
        </label>
        <div className="row preview-send-actions">
          <Button
            variant="primary"
            onClick={() => void sendToAgent()}
            disabled={sending || !sessionId || !client}
            title={
              !sessionId
                ? "No hay sesión activa: escribe en el chat para crear una"
                : "Enviar URL, ruta, tamaño y estado a la sesión activa"
            }
          >
            {sending ? "Enviando…" : "Enviar al agente"}
          </Button>
          <span className="muted small-text">
            {sessionId
              ? "Se enviará a la sesión activa, recortado y numerado."
              : "No hay sesión activa: escribe en el chat para crear una."}
          </span>
        </div>
        {sendError && (
          <div className="inline-error preview-error" role="alert">
            {sendError}
          </div>
        )}
        {sent && <output className="preview-sent">Prompt enviado a la sesión activa.</output>}
      </footer>
    </section>
  );
}
