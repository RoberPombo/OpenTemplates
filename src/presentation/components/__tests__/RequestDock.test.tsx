import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentForm } from "../../../domain/chat/forms";
import type { PermissionRequest } from "../../../domain/chat/permissions";
import { RequestDock } from "../RequestDock";

const permission: PermissionRequest = {
  id: "per_1",
  sessionID: "s1",
  action: "bash",
  resources: ["rm -rf dist"],
  message: "Necesito limpiar la carpeta de build",
};

const form: AgentForm = {
  id: "frm_1",
  sessionID: "s1",
  title: "¿Qué entorno preparo?",
  fields: [
    {
      key: "entorno",
      type: "string",
      title: "Entorno",
      placeholder: "dev o prod",
      required: true,
    },
    {
      key: "incluir",
      type: "multiselect",
      title: "Incluir",
      options: [
        { value: "tests", label: "Tests" },
        { value: "docs", label: "Documentación" },
      ],
    },
    { key: "acepto", type: "boolean", title: "Acepto los cambios" },
  ],
};

function renderDock(overrides: Partial<Parameters<typeof RequestDock>[0]> = {}) {
  const props: Parameters<typeof RequestDock>[0] = {
    permissions: [],
    forms: [],
    busy: null,
    error: null,
    onPermission: vi.fn(),
    onFormReply: vi.fn(),
    onFormCancel: vi.fn(),
    ...overrides,
  };
  render(<RequestDock {...props} />);
  return props;
}

describe("RequestDock — permisos", () => {
  test("muestra la acción, los recursos y el motivo", () => {
    renderDock({ permissions: [permission] });

    expect(screen.getByText("Ejecutar un comando")).toBeInTheDocument();
    expect(screen.getByText("rm -rf dist")).toBeInTheDocument();
    expect(screen.getByText("Necesito limpiar la carpeta de build")).toBeInTheDocument();
    expect(screen.getByText("bash")).toBeInTheDocument();
  });

  test("cada botón responde con su decisión", async () => {
    const user = userEvent.setup();
    const props = renderDock({ permissions: [permission] });

    await user.click(screen.getByRole("button", { name: "Permitir una vez" }));
    expect(props.onPermission).toHaveBeenCalledWith(permission, "once");

    await user.click(screen.getByRole("button", { name: "Permitir siempre" }));
    expect(props.onPermission).toHaveBeenCalledWith(permission, "always");

    await user.click(screen.getByRole("button", { name: "Rechazar" }));
    expect(props.onPermission).toHaveBeenCalledWith(permission, "reject");
  });

  test("deshabilita los botones mientras hay una respuesta en curso", () => {
    renderDock({ permissions: [permission], busy: "per_1" });
    expect(screen.getByRole("button", { name: "Permitir una vez" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Permitir siempre" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeDisabled();
  });
});

describe("RequestDock — preguntas", () => {
  test("no deja responder hasta cubrir los campos obligatorios", async () => {
    const user = userEvent.setup();
    const props = renderDock({ forms: [form] });
    const submit = screen.getByRole("button", { name: "Responder" });

    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/Entorno/), "dev");
    expect(submit).toBeEnabled();

    await user.click(screen.getByRole("checkbox", { name: "Tests" }));
    await user.click(screen.getByLabelText(/Acepto los cambios/));
    await user.click(submit);

    expect(props.onFormReply).toHaveBeenCalledWith(form, {
      entorno: "dev",
      incluir: ["tests"],
      acepto: true,
    });
  });

  test("Cancelar avisa al hook", async () => {
    const user = userEvent.setup();
    const props = renderDock({ forms: [form] });
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(props.onFormCancel).toHaveBeenCalledWith(form);
  });

  test("muestra el error del servidor sobre el dock", () => {
    renderDock({ forms: [form], error: "No se pudo responder" });
    expect(screen.getByText("No se pudo responder")).toBeInTheDocument();
  });
});
