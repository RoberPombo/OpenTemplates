/**
 * Registro de acciones de la paleta que ejecutan componentes montados.
 *
 * La app resuelve las acciones de workspace y navegación; las que dependen de
 * estado local (chat, docks, carrera) se registran mientras el componente vive.
 * Así el catálogo es declarativo y la paleta no necesita conocer los componentes.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { HandlerState } from "../../domain/palette/catalog";

type CommandHandler = HandlerState & {
  run: () => void | Promise<void>;
};

type CommandActionsValue = {
  entries: Readonly<Record<string, CommandHandler | undefined>>;
  register: (id: string, handler: CommandHandler) => () => void;
  run: (id: string) => boolean;
};

const CommandActionsContext = createContext<CommandActionsValue | null>(null);

export function CommandActionsProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, CommandHandler>>({});
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const register = useCallback((id: string, handler: CommandHandler) => {
    setEntries((prev) => ({ ...prev, [id]: handler }));
    return () => {
      setEntries((prev) => {
        if (prev[id] !== handler) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    };
  }, []);

  const run = useCallback((id: string) => {
    const handler = entriesRef.current[id];
    if (!handler?.enabled) return false;
    void handler.run();
    return true;
  }, []);

  return (
    <CommandActionsContext.Provider value={{ entries, register, run }}>
      {children}
    </CommandActionsContext.Provider>
  );
}

export function useCommandActions(): CommandActionsValue {
  const value = useContext(CommandActionsContext);
  if (!value) {
    throw new Error("useCommandActions debe usarse dentro de <CommandActionsProvider>");
  }
  return value;
}

/**
 * Registra una acción mientras el componente está montado. El handler se lee de
 * una ref para no re-registrar en cada render; solo cambian disponibilidad y motivo.
 */
export function useCommandAction(
  id: string,
  handler: () => void | Promise<void>,
  enabled = true,
  reason?: string,
): void {
  const { register } = useCommandActions();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(
    () =>
      register(id, {
        run: () => handlerRef.current(),
        enabled,
        reason,
      }),
    [register, id, enabled, reason],
  );
}
