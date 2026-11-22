import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AsyncSearchableSelect, Select } from "../ui";

describe("Select", () => {
  it("shows grouped options and reports the selected value", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <Select
        aria-label="Modelo"
        value="provider/model-a"
        placeholder="Seleccionar modelo"
        onValueChange={onValueChange}
        options={[
          {
            label: "Provider",
            options: [
              { value: "provider/model-a", label: "Model A" },
              { value: "provider/model-b", label: "Model B" },
            ],
          },
        ]}
      />,
    );

    const trigger = await screen.findByRole("combobox", { name: "Modelo" });
    expect(trigger).toHaveTextContent("Model A");

    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "Model B" }));

    expect(onValueChange).toHaveBeenCalledWith("provider/model-b");
  });

  it("shows the placeholder when there is no selected value", async () => {
    render(
      <Select
        aria-label="Modelo"
        value=""
        placeholder="Sin modelo por defecto"
        onValueChange={() => {}}
        options={[]}
      />,
    );

    expect(await screen.findByRole("combobox", { name: "Modelo" })).toHaveTextContent(
      "Sin modelo por defecto",
    );
  });

  it("filters model names and provider ids", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <AsyncSearchableSelect
        aria-label="Modelo"
        value="openai/gpt"
        placeholder="Buscar modelo…"
        onValueChange={onValueChange}
        options={[
          {
            label: "OpenAI",
            options: [
              {
                value: "openai/gpt",
                label: "GPT",
                description: "openai · gpt",
                searchText: "openai gpt",
              },
            ],
          },
          {
            label: "Anthropic",
            options: [
              {
                value: "anthropic/claude",
                label: "Claude",
                description: "anthropic · claude",
                searchText: "anthropic claude",
              },
            ],
          },
        ]}
      />,
    );

    const input = await screen.findByRole("combobox", { name: "Modelo" });
    expect(input).toHaveValue("GPT");

    await user.click(input);
    expect(input).toHaveValue("");

    await user.type(input, "anthropic");

    expect(await screen.findByRole("option", { name: /Claude/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /GPT/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: /Claude/ }));
    expect(onValueChange).toHaveBeenCalledWith("anthropic/claude");
  });

  it("muestra la ficha de la opción al pasar el ratón", async () => {
    const user = userEvent.setup();

    render(
      <AsyncSearchableSelect
        aria-label="Modelo"
        value=""
        placeholder="Buscar modelo…"
        onValueChange={() => {}}
        options={[
          {
            value: "anthropic/claude",
            label: "Claude",
            tooltip: <div>Ficha del modelo</div>,
          },
        ]}
      />,
    );

    const input = await screen.findByRole("combobox", { name: "Modelo" });
    await user.click(input);
    await user.hover(await screen.findByRole("option", { name: "Claude" }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Ficha del modelo");

    await user.unhover(screen.getByRole("option", { name: "Claude" }));
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });
});
