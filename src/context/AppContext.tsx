/** Inyección del CompositionRoot en el árbol React. */
import { createContext, useContext, useState, type ReactNode } from "react";
import { CompositionRoot } from "../CompositionRoot";

const AppContext = createContext<CompositionRoot | null>(null);

export function AppProvider({ children, root }: { children: ReactNode; root?: CompositionRoot }) {
  const [value] = useState(() => root ?? CompositionRoot.getInstance());
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): CompositionRoot {
  const root = useContext(AppContext);
  if (!root) {
    throw new Error("useAppContext debe usarse dentro de <AppProvider>");
  }
  return root;
}
