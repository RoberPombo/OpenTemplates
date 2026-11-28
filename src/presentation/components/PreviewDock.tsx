/* oxlint-disable react/iframe-missing-sandbox — el preview corre en otro origen (localhost), no en el de la app */
/**
 * Dock de vista previa de la app en marcha del workspace.
 *
 * Carga la URL configurada en un iframe de otro origen. El estado sale del
 * sondeo del backend. «Seleccionar elemento» activa un proxy propio loopback
 * que inyecta un script: se elige un elemento y se manda contexto compacto
 * (selector CSS estable, etiqueta, rol, texto corto, estilos curados) a la
 * sesión activa. `postMessage` se valida (origen + source + nonce + esquema).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
import {
  PREVIEW_ELEMENT_SOURCE,
  PREVIEW_ELEMENT_VERSION,
  isPreviewSelectorMessage,
  sanitizePreviewElement,
  type PreviewElementContext,
  type PreviewProxySession,
} from "../../domain/preview/element";
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

  // Modo selección de elemento.
  const [selecting, setSelecting] = useState(false);
  const [proxy, setProxy] = useState<PreviewProxySession | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [elementSent, setElementSent] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const proxyRef = useRef<PreviewProxySession | null>(null);
  const selectingRef = useRef(false);
  const gatewayRef = useRef(gateway);
  useEffect(() => {
    gatewayRef.current = gateway;
  }, [gateway]);

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

  const sendText = useCallback(
    async (text: string) => {
      if (!client || !sessionId) return;
      await client.session.prompt({ sessionID: sessionId, text });
    },
    [client, sessionId],
  );

  async function sendToAgent() {
    if (!client || !sessionId) return;
    setSending(true);
    setSendError(null);
    setSent(false);
    try {
      await sendText(
        buildPreviewPrompt({
          workspaceName: workspace.name,
          url: preview.url,
          projectPath: workspace.projectPath,
          device: preview.device,
          probe: preview.probe,
          note,
        }),
      );
      setSent(true);
    } catch (error) {
      setSendError(errorText(error));
    } finally {
      setSending(false);
    }
  }

  // --- Selector de elemento ---

  const postToFrame = useCallback((type: "enter" | "exit") => {
    const session = proxyRef.current;
    const win = iframeRef.current?.contentWindow;
    if (!session || !win) return;
    win.postMessage(
      {
        source: PREVIEW_ELEMENT_SOURCE,
        version: PREVIEW_ELEMENT_VERSION,
        type,
        nonce: session.nonce,
      },
      session.proxyOrigin,
    );
  }, []);

  const stopProxy = useCallback(async () => {
    const session = proxyRef.current;
    proxyRef.current = null;
    setProxy(null);
    if (session) {
      try {
        await gatewayRef.current.stopElementPicker(session.token);
      } catch {
        /* limpieza best-effort */
      }
    }
  }, []);

  const exitSelection = useCallback(async () => {
    if (!selectingRef.current) return;
    selectingRef.current = false;
    setSelecting(false);
    postToFrame("exit");
    await stopProxy();
  }, [postToFrame, stopProxy]);

  async function toggleSelection() {
    if (selectingRef.current) {
      await exitSelection();
      return;
    }
    setSelectionError(null);
    setElementSent(false);
    try {
      const appOrigin = window.location.origin;
      const session = await gateway.startElementPicker(preview.url, appOrigin);
      proxyRef.current = session;
      setProxy(session);
      selectingRef.current = true;
      setSelecting(true);
    } catch (error) {
      setSelectionError(errorText(error));
    }
  }

  const sendElementToAgent = useCallback(
    async (element: PreviewElementContext) => {
      if (!client || !sessionId) return;
      setElementSent(false);
      try {
        let pageUrl = preview.url;
        if (element.url) {
          try {
            pageUrl = `${new URL(preview.url).origin}${element.url.startsWith("/") ? "" : "/"}${element.url}`;
          } catch {
            pageUrl = element.url;
          }
        }
        await sendText(
          buildPreviewPrompt({
            workspaceName: workspace.name,
            url: pageUrl,
            projectPath: workspace.projectPath,
            device: preview.device,
            probe: preview.probe,
            note,
            element,
          }),
        );
        setElementSent(true);
      } catch (error) {
        setSelectionError(errorText(error));
      }
    },
    [
      sendText,
      client,
      sessionId,
      preview.url,
      preview.device,
      preview.probe,
      workspace.name,
      workspace.projectPath,
      note,
    ],
  );

  // Escucha de postMessage validada: origen + source + nonce + esquema.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const session = proxyRef.current;
      if (!session) return;
      if (event.origin !== session.proxyOrigin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isPreviewSelectorMessage(event.data, session.nonce)) return;
      const data = event.data;
      if (data.type === "ready") {
        postToFrame("enter");
        return;
      }
      if (data.type === "exit") {
        void exitSelection();
        return;
      }
      if (data.type === "element") {
        const element = sanitizePreviewElement(data.element);
        if (element) void sendElementToAgent(element);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [postToFrame, exitSelection, sendElementToAgent]);

  // Escape en la app sale del modo selección.
  useEffect(() => {
    if (!selecting) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        void exitSelection();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selecting, exitSelection]);

  // Al salir de la página o desmontar, parar proxy y limpiar.
  useEffect(() => {
    return () => {
      const session = proxyRef.current;
      proxyRef.current = null;
      if (session) void gatewayRef.current.stopElementPicker(session.token).catch(() => {});
    };
  }, []);

  const ready = preview.status === "ready";

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

      {ready && (
        <div className="preview-stage">
          {preview.probe?.frameBlocked && !selecting && (
            <div className="callout warning preview-warning">
              El servidor prohíbe embeber la página (X-Frame-Options o frame-ancestors). Es posible
              que el marco aparezca vacío: ábrela con «Abrir» mientras ajustas el servidor.
            </div>
          )}
          <div className="preview-toolbar preview-select-bar">
            <Button
              size="small"
              variant={selecting ? "primary" : undefined}
              aria-pressed={selecting}
              title={
                selecting
                  ? "Seleccionando… haz clic en un elemento; Escape sale"
                  : "Elegir un elemento de la página y enviarlo al agente"
              }
              onClick={() => void toggleSelection()}
              disabled={!ready}
            >
              {selecting ? "Seleccionando… (Escape sale)" : "Seleccionar elemento"}
            </Button>
            {!sessionId && (
              <span className="muted small-text">Sin sesión activa no se enviará.</span>
            )}
            {elementSent && (
              <output className="preview-sent">Elemento enviado a la sesión activa.</output>
            )}
          </div>
          {selectionError && (
            <div className="inline-error preview-error" role="alert">
              {selectionError}
            </div>
          )}
          <div className="preview-frame-scroll">
            <div className="preview-frame" style={{ width: size.width }}>
              {/* El preview corre en otro origen (localhost), no en el de la app:
                  allow-same-origin le da su propio origen para storage/cookies,
                  no acceso al contexto de Tauri. En modo selección se sirve por
                  el proxy propio loopback con script inyectado; el contenido
                  remoto sigue sin acceso a IPC ni a Tauri. */}
              <iframe
                key={preview.frameKey}
                ref={iframeRef}
                src={selecting && proxy ? proxy.baseUrl : preview.url}
                title="Aplicación en marcha"
                // El preview es contenido de confianza del usuario, pero se
                // aísla igualmente: scripts y formularios sí, sin acceso al
                // contexto de la app ni a ventanas emergentes arbitrarias.
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads"
                onLoad={() => {
                  preview.onFrameLoad();
                  if (selectingRef.current) postToFrame("enter");
                }}
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
              setElementSent(false);
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
