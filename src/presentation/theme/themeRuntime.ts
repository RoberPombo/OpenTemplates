/**
 * Aplicación del tema en el DOM. Se llama antes de montar React (para no
 * parpadear) y desde los ajustes al cambiar de tema o acento.
 */
import type { Preferences } from "../../domain/repositories/Preferences";
import { prefKeys } from "../../domain/repositories/Preferences";
import {
  resolveThemeSelection,
  themeStyle,
  type AccentId,
  type ThemeId,
  type ThemeSelection,
} from "../../domain/theme/themes";

export function readThemeSelection(preferences: Pick<Preferences, "get">): ThemeSelection {
  return resolveThemeSelection(preferences.get(prefKeys.theme), preferences.get(prefKeys.accent));
}

export function applyTheme(
  selection: ThemeSelection,
  element: HTMLElement = document.documentElement,
): void {
  for (const [name, value] of Object.entries(themeStyle(selection.theme, selection.accent))) {
    element.style.setProperty(name, value);
  }
  element.dataset.theme = selection.theme;
  element.style.colorScheme = selection.theme === "light" ? "light" : "dark";
}

export function saveTheme(preferences: Preferences, theme: ThemeId, accent: AccentId): void {
  preferences.set(prefKeys.theme, theme);
  preferences.set(prefKeys.accent, accent);
}
