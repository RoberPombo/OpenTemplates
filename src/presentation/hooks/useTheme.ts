/** Estado reactivo del tema: aplica al DOM y persiste en preferencias. */
import { useCallback, useEffect, useState } from "react";
import { useAppContext } from "../context/AppContext";
import type { AccentId, ThemeId } from "../../domain/theme/themes";
import { applyTheme, readThemeSelection, saveTheme } from "../theme/themeRuntime";

export function useTheme() {
  const root = useAppContext();
  const [selection, setSelection] = useState(() => readThemeSelection(root.preferences));

  useEffect(() => {
    applyTheme(selection);
  }, [selection]);

  const chooseTheme = useCallback(
    (theme: ThemeId) => {
      setSelection((current) => {
        saveTheme(root.preferences, theme, current.accent);
        return { ...current, theme };
      });
    },
    [root],
  );

  const chooseAccent = useCallback(
    (accent: AccentId) => {
      setSelection((current) => {
        saveTheme(root.preferences, current.theme, accent);
        return { ...current, accent };
      });
    },
    [root],
  );

  return { selection, chooseTheme, chooseAccent };
}
