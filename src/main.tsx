import ReactDOM from "react-dom/client";
import App from "./App";
import { migrateLegacyPreferences } from "./data/migrateLegacyPreferences";
import { AppProvider } from "./presentation/context/AppContext";

migrateLegacyPreferences();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <AppProvider>
    <App />
  </AppProvider>,
);
