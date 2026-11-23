/**
 * Estado y conexiones del dock de terminal de un workspace. El hook guarda el
 * buffer de cada pestaña mientras el dock está abierto y cierra los canales al
 * desmontarse, pero nunca borra los PTYs: eso solo ocurre al cerrar la pestaña
 * o al parar/eliminar el workspace.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorText } from "../../domain/shared";
import type { TerminalChannel, TerminalGateway } from "../../domain/repositories/TerminalGateway";
import {
  acknowledgeCursor,
  addTab,
  appendOutput,
  emptyBuffer,
  establishCursor,
  mergeTerminalList,
  nextTerminalTitle,
  patchTab,
  prepareReconnect,
  removeTab,
  type TerminalBuffer,
  type TerminalInfo,
  type TerminalTab,
} from "../../domain/terminal/terminals";

type Args = {
  gateway: TerminalGateway;
  directory: string;
};

export type TerminalRegistry = ReturnType<typeof useTerminal>;

export function useTerminal({ gateway, directory }: Args) {
  const location = useMemo(() => ({ directory }), [directory]);
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tabsRef = useRef<TerminalTab[]>(tabs);
  const activeRef = useRef<string | null>(activeId);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);
  const buffers = useRef(new Map<string, TerminalBuffer>());
  const channels = useRef(new Map<string, TerminalChannel>());
  const listeners = useRef(new Map<string, Set<(text: string) => void>>());
  const connecting = useRef(new Set<string>());
  const alive = useRef(true);

  const bufferFor = useCallback((id: string) => {
    const current = buffers.current.get(id);
    if (current) return current;
    const created = emptyBuffer();
    buffers.current.set(id, created);
    return created;
  }, []);

  const notify = useCallback((id: string, text: string) => {
    for (const listener of listeners.current.get(id) ?? []) listener(text);
  }, []);

  const commitTabs = useCallback((next: TerminalTab[]) => {
    tabsRef.current = next;
    setTabs(next);
  }, []);
  const patch = useCallback((id: string, change: Partial<Omit<TerminalTab, "id">>) => {
    const next = patchTab(tabsRef.current, id, change);
    tabsRef.current = next;
    setTabs(next);
  }, []);

  const connect = useCallback(
    async (id: string) => {
      if (channels.current.has(id) || connecting.current.has(id)) return;
      const tab = tabsRef.current.find((item) => item.id === id);
      if (!tab || tab.state === "exited") return;
      connecting.current.add(id);
      patch(id, { state: "connecting", error: undefined });
      const prepared = prepareReconnect(bufferFor(id));
      if (prepared.text === "") buffers.current.set(id, emptyBuffer());
      let cursorSeen = prepared.cursor !== null;
      try {
        const channel = await gateway.connect({
          location,
          ptyID: id,
          cursor: prepared.cursor,
          handlers: {
            onData(chunk) {
              const buffer = appendOutput(bufferFor(id), chunk.text, chunk.bytes);
              buffers.current.set(id, buffer);
              notify(id, chunk.text);
            },
            onCursor(cursor) {
              const buffer = bufferFor(id);
              if (!cursorSeen) {
                cursorSeen = true;
                buffers.current.set(id, establishCursor(buffer, cursor));
                return;
              }
              buffers.current.set(id, acknowledgeCursor(buffer, cursor));
            },
            onClose(close) {
              channels.current.delete(id);
              if (!alive.current) return;
              const exited = close.code === 4404 || close.reason === "session exited";
              patch(id, {
                state: exited ? "exited" : "dropped",
                error: exited ? undefined : close.reason || "Conexión perdida",
              });
            },
          },
        });
        if (!alive.current) {
          channel.close();
          return;
        }
        channels.current.set(id, channel);
        patch(id, { state: "connected", error: undefined });
      } catch (err) {
        if (alive.current) patch(id, { state: "dropped", error: errorText(err) });
      } finally {
        connecting.current.delete(id);
      }
    },
    [bufferFor, gateway, location, notify, patch],
  );

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const infos = await gateway.list(location);
        if (cancelled) return;
        const merged = mergeTerminalList(tabsRef.current, infos);
        commitTabs(merged);
        const current = activeRef.current;
        const next =
          (current && merged.some((tab) => tab.id === current) ? current : null) ??
          merged.find((tab) => tab.state !== "exited")?.id ??
          merged[0]?.id ??
          null;
        setActiveId(next);
        for (const tab of merged) {
          if (tab.state !== "exited") void connect(tab.id);
        }
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const active = channels.current;
    return () => {
      cancelled = true;
      alive.current = false;
      for (const channel of active.values()) channel.close();
      active.clear();
    };
  }, [commitTabs, connect, gateway, location]);

  const selectTab = useCallback(
    (id: string) => {
      setActiveId(id);
      const tab = tabsRef.current.find((item) => item.id === id);
      if (tab && tab.state === "dropped") void connect(id);
    },
    [connect],
  );

  const newTerminal = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const info = await gateway.create(location, {
        cwd: directory,
        title: nextTerminalTitle(tabsRef.current),
      });
      if (!alive.current) return;
      const tab: TerminalTab = { id: info.id, title: info.title, state: "creating" };
      commitTabs(addTab(tabsRef.current, tab));
      setActiveId(info.id);
      setCreating(false);
      await connect(info.id);
    } catch (err) {
      if (alive.current) setError(errorText(err));
    } finally {
      if (alive.current) setCreating(false);
    }
  }, [commitTabs, connect, directory, gateway, location]);

  const closeTab = useCallback(
    async (id: string) => {
      channels.current.get(id)?.close();
      channels.current.delete(id);
      buffers.current.delete(id);
      listeners.current.delete(id);
      const next = removeTab(tabsRef.current, id);
      commitTabs(next);
      if (activeRef.current === id) {
        const candidate = next.find((tab) => tab.state !== "exited") ?? next[0] ?? null;
        setActiveId(candidate?.id ?? null);
        if (candidate) void connect(candidate.id);
      }
      try {
        await gateway.remove(location, id);
      } catch (err) {
        if (alive.current) setError(errorText(err));
      }
    },
    [commitTabs, connect, gateway, location],
  );

  const reconnect = useCallback(
    (id: string) => {
      void connect(id);
    },
    [connect],
  );

  const send = useCallback((id: string, data: string) => {
    channels.current.get(id)?.send(data);
  }, []);

  const resize = useCallback(
    (id: string, size: { cols: number; rows: number }) => {
      void gateway.resize(location, id, size).catch(() => undefined);
    },
    [gateway, location],
  );

  const removeAll = useCallback(async () => {
    for (const channel of channels.current.values()) channel.close();
    channels.current.clear();
    let ids = tabsRef.current.map((tab) => tab.id);
    try {
      const infos: TerminalInfo[] = await gateway.list(location);
      ids = [...new Set([...ids, ...infos.map((info) => info.id)])];
    } catch {
      // Si el servidor ya no responde, se intenta borrar lo que había en la UI.
    }
    await Promise.all(ids.map((id) => gateway.remove(location, id).catch(() => undefined)));
    buffers.current.clear();
    listeners.current.clear();
    commitTabs([]);
    setActiveId(null);
  }, [commitTabs, gateway, location]);

  const getBuffer = useCallback(
    (id: string) => {
      return bufferFor(id).text;
    },
    [bufferFor],
  );

  const subscribe = useCallback((id: string, listener: (text: string) => void) => {
    const set = listeners.current.get(id) ?? new Set();
    set.add(listener);
    listeners.current.set(id, set);
    return () => {
      set.delete(listener);
    };
  }, []);

  return {
    tabs,
    activeId,
    loading,
    creating,
    error,
    newTerminal,
    selectTab,
    closeTab,
    reconnect,
    send,
    resize,
    removeAll,
    getBuffer,
    subscribe,
  };
}
