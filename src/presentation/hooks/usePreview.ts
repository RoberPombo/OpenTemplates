/**
 * Estado del preview de un workspace: URL recordada, sondeo del servidor,
 * tamaño de dispositivo y remontaje del iframe al recargar.
 *
 * El iframe es de otro origen, así que el estado no se deduce de su DOM: lo
 * dice el sondeo del backend. Mientras no hay resultado no se pinta un iframe
 * en blanco, se pinta el estado con su mensaje.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { prefKeys, type Preferences } from "../../domain/repositories/Preferences";
import type { PreviewGateway } from "../../domain/repositories/PreviewGateway";
import {
  DEFAULT_PREVIEW_URL,
  describePreviewProbe,
  isPreviewDevice,
  normalizePreviewUrl,
  type PreviewDevice,
  type PreviewProbe,
} from "../../domain/preview/preview";
import { errorText } from "../../domain/shared/errors";

export type PreviewStatus = "loading" | "ready" | "error";

type UsePreviewInput = {
  gateway: PreviewGateway;
  preferences: Preferences;
  workspaceId: string;
};

export function usePreview({ gateway, preferences, workspaceId }: UsePreviewInput) {
  const urlKey = prefKeys.previewUrl(workspaceId);
  const deviceKey = prefKeys.previewDevice(workspaceId);

  const [url, setUrl] = useState(() => {
    const saved = preferences.get(urlKey);
    if (!saved) return DEFAULT_PREVIEW_URL;
    const result = normalizePreviewUrl(saved);
    return result.ok ? result.url : DEFAULT_PREVIEW_URL;
  });
  const [urlInput, setUrlInput] = useState(url);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [device, setDeviceState] = useState<PreviewDevice>(() => {
    const saved = preferences.get(deviceKey);
    return isPreviewDevice(saved) ? saved : "desktop";
  });
  const [status, setStatus] = useState<PreviewStatus>("loading");
  const [probe, setProbe] = useState<PreviewProbe | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [frameLoading, setFrameLoading] = useState(true);
  const sequence = useRef(0);

  const runProbe = useCallback(
    async (target: string) => {
      const ticket = ++sequence.current;
      setStatus("loading");
      setProbeError(null);
      setFrameLoading(true);
      try {
        const result = await gateway.probe(target);
        if (ticket !== sequence.current) return;
        setProbe(result);
        setStatus(result.ok ? "ready" : "error");
      } catch (error) {
        if (ticket !== sequence.current) return;
        setProbe(null);
        setProbeError(errorText(error));
        setStatus("error");
      }
    },
    [gateway],
  );

  useEffect(() => {
    void runProbe(url);
  }, [url, runProbe]);

  const updateInput = useCallback((value: string) => {
    setUrlInput(value);
    setUrlError(null);
  }, []);

  /** Aplica la URL escrita; devuelve false y deja el error si no es válida. */
  const applyUrl = useCallback(
    (raw: string = urlInput) => {
      const result = normalizePreviewUrl(raw);
      if (!result.ok) {
        setUrlError(result.error);
        return false;
      }
      setUrlError(null);
      setUrlInput(result.url);
      preferences.set(urlKey, result.url);
      setReloadToken((value) => value + 1);
      if (result.url === url) void runProbe(result.url);
      else setUrl(result.url);
      return true;
    },
    [preferences, runProbe, url, urlInput, urlKey],
  );

  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
    void runProbe(url);
  }, [runProbe, url]);

  const setDevice = useCallback(
    (next: PreviewDevice) => {
      setDeviceState(next);
      preferences.set(deviceKey, next);
      setReloadToken((value) => value + 1);
    },
    [deviceKey, preferences],
  );

  const onFrameLoad = useCallback(() => setFrameLoading(false), []);

  const message =
    status === "error"
      ? (probeError ?? (probe ? describePreviewProbe(probe).message : "No se pudo conectar."))
      : status === "loading"
        ? "Comprobando la aplicación…"
        : probe
          ? describePreviewProbe(probe).message
          : "Lista.";

  return {
    url,
    urlInput,
    updateInput,
    urlError,
    applyUrl,
    device,
    setDevice,
    status,
    message,
    probe,
    reload,
    frameKey: `${url}#${reloadToken}`,
    frameLoading,
    onFrameLoad,
  };
}
