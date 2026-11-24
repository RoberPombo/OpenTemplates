/** Inyección del CompositionRoot en el árbol React. */
import { createContext, useContext, useState, type ReactNode } from "react";
import { CompositionRoot } from "../../CompositionRoot";
import { CommandActionsProvider } from "./CommandActions";

const AppContext = createContext<CompositionRoot | null>(null);

export function AppProvider({ children, root }: { children: ReactNode; root?: CompositionRoot }) {
  const [value] = useState(() => root ?? CompositionRoot.getInstance());
  return (
    <AppContext.Provider value={value}>
      <CommandActionsProvider>{children}</CommandActionsProvider>
    </AppContext.Provider>
  );
}

export function useAppContext(): CompositionRoot {
  const root = useContext(AppContext);
  if (!root) {
    throw new Error("useAppContext debe usarse dentro de <AppProvider>");
  }
  return root;
}
