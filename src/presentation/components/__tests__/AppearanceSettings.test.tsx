import { beforeEach, describe, expect, test } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppearanceSettings } from "../AppearanceSettings";
import { AppProvider } from "../../context/AppContext";
import { CompositionRoot } from "../../../CompositionRoot";
import { prefKeys } from "../../../domain/repositories/Preferences";
import { themeTokens } from "../../../domain/theme/themes";

function renderSettings() {
  render(
    <AppProvider root={new CompositionRoot()}>
      <AppearanceSettings />
    </AppProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  delete document.documentElement.dataset.theme;
});

describe("AppearanceSettings", () => {
  test("cambia al tema claro, aplica tokens y persiste la preferencia", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("radio", { name: "Claro" }));

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    expect(localStorage.getItem(prefKeys.theme)).toBe("light");
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe(
      themeTokens("light", "verde").bg,
    );
    expect(screen.getByRole("radio", { name: "Claro" })).toHaveAttribute("aria-checked", "true");
  });

  test("el acento se puede cambiar de forma independiente y se recuerda", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("radio", { name: "Acento Azul" }));

    expect(localStorage.getItem(prefKeys.accent)).toBe("azul");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe(
      themeTokens("dark", "azul").accent,
    );
    expect(screen.getByRole("radio", { name: "Acento Azul" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("arranca con la preferencia guardada", async () => {
    localStorage.setItem(prefKeys.theme, "light");
    localStorage.setItem(prefKeys.accent, "violeta");
    renderSettings();

    expect(screen.getByRole("radio", { name: "Claro" })).toHaveAttribute("aria-checked", "true");
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--accent")).toBe(
        themeTokens("light", "violeta").accent,
      ),
    );
  });
});
