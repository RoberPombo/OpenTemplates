import { describe, expect, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeatureIssuePicker } from "../FeatureIssuePicker";
import type { GitHubIssue } from "../../../domain/features/issue";
import type { IssueGateway } from "../../../domain/repositories/IssueGateway";
import { makeIssueGateway } from "../../../tests/fakes";
import type { Repo } from "../../../types";

const repo: Repo = {
  id: "repo-web",
  name: "Web",
  path: "/repos/web",
  provider: "github",
  mainBranch: "main",
  createdAt: 0,
  updatedAt: 0,
};

const apiRepo: Repo = { ...repo, id: "repo-api", name: "API", path: "/repos/api" };

const issue: GitHubIssue = {
  number: 12,
  title: "Cobro roto",
  labels: ["bug", "pagos"],
  author: "ana",
  url: "https://github.com/acme/app/issues/12",
  body: "El pago falla con tarjeta.",
  bodyTruncated: false,
};

function renderPicker(
  overrides: {
    repos?: Repo[];
    gateway?: IssueGateway;
    value?: { repoId: string; issue: GitHubIssue } | null;
    onChange?: (selection: { repoId: string; issue: GitHubIssue } | null) => void;
  } = {},
) {
  const onChange = overrides.onChange ?? vi.fn();
  render(
    <FeatureIssuePicker
      repos={overrides.repos ?? [repo]}
      gateway={overrides.gateway}
      value={overrides.value ?? null}
      onChange={onChange}
      searchDelayMs={0}
    />,
  );
  return { onChange };
}

describe("FeatureIssuePicker", () => {
  test("muestra el motivo si gh no está instalado y deja crear sin issue", async () => {
    const fake = makeIssueGateway({
      ghStatus: {
        installed: false,
        authenticated: false,
        version: null,
        message: "GitHub CLI (gh) no está instalado.",
        docsUrl: "https://cli.github.com/",
      },
    });
    renderPicker({ gateway: fake.gateway });

    expect(await screen.findByText("GitHub CLI (gh) no está instalado.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Abrir la documentación de GitHub CLI" }),
    ).toHaveAttribute("href", "https://cli.github.com/");
    expect(screen.getByRole("radio", { name: "Sin issue" })).toBeChecked();
    expect(fake.list).not.toHaveBeenCalled();
  });

  test("carga issues y devuelve el elegido", async () => {
    const fake = makeIssueGateway({ issues: [issue] });
    const { onChange } = renderPicker({ gateway: fake.gateway });

    expect(await screen.findByText("#12 Cobro roto")).toBeInTheDocument();
    expect(screen.getByText(/bug · pagos · ana/)).toBeInTheDocument();
    expect(fake.list).toHaveBeenCalledWith("/repos/web", { search: undefined, limit: 30 });

    await userEvent.click(screen.getByRole("radio", { name: "#12 Cobro roto" }));
    expect(onChange).toHaveBeenCalledWith({ repoId: "repo-web", issue });
  });

  test("«Sin issue» limpia la selección", async () => {
    const fake = makeIssueGateway({ issues: [issue] });
    const { onChange } = renderPicker({
      gateway: fake.gateway,
      value: { repoId: "repo-web", issue },
    });

    expect(await screen.findByRole("radio", { name: "#12 Cobro roto" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Sin issue" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  test("busca de forma incremental con el texto y el límite", async () => {
    const user = userEvent.setup();
    const fake = makeIssueGateway({ issues: [issue] });
    renderPicker({ gateway: fake.gateway });

    await screen.findByText("#12 Cobro roto");
    await user.type(screen.getByLabelText("Buscar issues"), "pagos");

    await waitFor(() =>
      expect(fake.list).toHaveBeenLastCalledWith("/repos/web", { search: "pagos", limit: 30 }),
    );
  });

  test("un fallo de la consulta se muestra y no bloquea el alta", async () => {
    const fake = makeIssueGateway({ listError: new Error("HTTP 403") });
    renderPicker({ gateway: fake.gateway });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudieron cargar los issues: HTTP 403",
    );
    expect(screen.getByRole("radio", { name: "Sin issue" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeVisible();
  });

  test("muestra el estado de carga mientras responde gh", async () => {
    let resolve: (issues: GitHubIssue[]) => void = () => {};
    const pending = new Promise<GitHubIssue[]>((done) => {
      resolve = done;
    });
    const gateway: IssueGateway = {
      status: vi.fn(async () => ({
        installed: true,
        authenticated: true,
        version: "gh version 2.60.0",
        message: null,
        docsUrl: "https://cli.github.com/manual/gh_auth_login",
      })),
      list: vi.fn(async () => pending),
    };
    renderPicker({ gateway });

    expect(await screen.findByText("Buscando issues abiertos…")).toBeInTheDocument();
    await act(async () => {
      resolve([issue]);
      await pending;
    });
    expect(await screen.findByText("#12 Cobro roto")).toBeInTheDocument();
  });

  test("cambia de repo y vuelve a consultar su ruta", async () => {
    const user = userEvent.setup();
    const fake = makeIssueGateway({ issues: [issue] });
    const value = { repoId: "repo-web", issue };
    const { onChange } = renderPicker({
      repos: [repo, apiRepo],
      gateway: fake.gateway,
      value,
    });

    await screen.findByText("#12 Cobro roto");
    await user.selectOptions(screen.getByLabelText("Repositorio de los issues"), "repo-api");

    expect(onChange).toHaveBeenCalledWith(null);
    await waitFor(() =>
      expect(fake.list).toHaveBeenLastCalledWith("/repos/api", { search: undefined, limit: 30 }),
    );
  });
});
