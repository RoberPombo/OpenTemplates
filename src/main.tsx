import ReactDOM from "react-dom/client";
import App from "./App";
import { migrateLegacyPreferences } from "./data/migrateLegacyPreferences";
import { LocalStoragePreferences } from "./data/LocalStoragePreferences";
import { AppProvider } from "./presentation/context/AppContext";
import { applyTheme, readThemeSelection } from "./presentation/theme/themeRuntime";

// El tema se resuelve y aplica antes de montar React para no pintar con los
// tokens del tema anterior. `index.html` deja `data-theme` listo aún antes.
migrateLegacyPreferences();
applyTheme(readThemeSelection(new LocalStoragePreferences()));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <AppProvider>
    <App />
  </AppProvider>,
);
