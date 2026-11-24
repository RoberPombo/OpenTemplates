import { describe, expect, test } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PullRequestCard } from "../PullRequestCard";
import type { ChatServer } from "../../../domain/repositories/ChatGateway";
import { makeFakeClient, makeGitGateway, makePullRequestGateway } from "../../../tests/fakes";
import type {
  GhStatus,
  PullRequestCheck,
  PullRequestInfo,
} from "../../../domain/workspace/pullRequest";

const pullRequest: PullRequestInfo = {
  number: 12,
  title: "Flujo git y pull request",
  state: "OPEN",
  url: "https://github.com/acme/app/pull/12",
  isDraft: false,
  baseBranch: "develop",
  headBranch: "feat/git-y-pr",
  reviewDecision: "CHANGES_REQUESTED",
  reviews: [
    {
      author: "ana",
      state: "CHANGES_REQUESTED",
      body: "falta un test para el hook que falla",
      submittedAt: "2026-01-01T00:00:00Z",
    },
  ],
  comments: [
    {
      author: "luis",
      body: "revisa el borde del parseo de renombrados",
      createdAt: "2026-01-02T00:00:00Z",
      url: "https://github.com/acme/app/pull/12#c1",
    },
  ],
};

const checks: PullRequestCheck[] = [
  {
    name: "tests",
    state: "FAILURE",
    bucket: "failed",
    url: "https://ci.example/1",
    workflow: "CI",
  },
  {
    name: "lint",
    state: "SUCCESS",
    bucket: "passed",
    url: "https://ci.example/2",
    workflow: "CI",
  },
];

function setup(
  options: {
    ghStatus?: GhStatus;
    pr?: PullRequestInfo | null;
    checks?: PullRequestCheck[];
    sessionId?: string | null;
    commits?: Array<{ hash: string; subject: string; body: string }>;
  } = {},
) {
  const { client } = makeFakeClient();
  const git = makeGitGateway({ commits: options.commits });
  const pullRequests = makePullRequestGateway({
    ghStatus: options.ghStatus,
    pr: options.pr === undefined ? pullRequest : options.pr,
    checks: options.checks ?? checks,
  });
  render(
    <PullRequestCard
      pullRequests={pullRequests.gateway}
      git={git.gateway}
      client={client as unknown as ChatServer}
      projectPath="/tmp/demo"
      branch="feat/git-y-pr"
      defaultBase="main"
      sessionId={options.sessionId === undefined ? "s1" : options.sessionId}
      refreshKey={0}
    />,
  );
  return { client, git, pullRequests };
}

describe("PullRequestCard", () => {
  test("muestra estado, checks y envía el prompt recortado al agente", async () => {
    const user = userEvent.setup();
    const { client } = setup();
    expect(await screen.findByText("#12")).toBeInTheDocument();
    expect(screen.getByText("abierta")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir en GitHub" })).toHaveAttribute(
      "href",
      pullRequest.url,
    );
    expect(await screen.findByText("tests")).toBeInTheDocument();
    expect(screen.getByText(/1 en verde · 1 fallidos/)).toBeInTheDocument();
    expect(screen.getByText(/falta un test para el hook/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enviar al agente" }));
    await waitFor(() => expect(client.session.prompt).toHaveBeenCalledTimes(1));
    const prompt = client.session.prompt.mock.calls[0]?.[0] as { sessionID: string; text: string };
    expect(prompt.sessionID).toBe("s1");
    expect(prompt.text).toContain("tests");
    expect(prompt.text).toContain("falta un test para el hook");
    expect(prompt.text).toContain("revisa el borde del parseo");
    expect(prompt.text).toContain("pull request #12");
    expect(prompt.text.length).toBeLessThanOrEqual(4_000);
  });

  test("si gh no está instalado lo dice y enlaza a la documentación", async () => {
    const { pullRequests } = setup({
      ghStatus: {
        installed: false,
        authenticated: false,
        version: null,
        message: "GitHub CLI (gh) no está instalado.",
        docsUrl: "https://cli.github.com/",
      },
    });
    expect(await screen.findByText(/no está instalado/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /documentación/i })).toHaveAttribute(
      "href",
      "https://cli.github.com/",
    );
    expect(pullRequests.view).not.toHaveBeenCalled();
  });

  test("crea la PR con el borrador editable generado desde los commits", async () => {
    const user = userEvent.setup();
    const { pullRequests } = setup({
      pr: null,
      commits: [
        { hash: "a1", subject: "feat: primer cambio", body: "" },
        { hash: "a2", subject: "fix: segundo cambio", body: "" },
      ],
    });
    await user.click(await screen.findByRole("button", { name: "Crear pull request" }));
    const title = await screen.findByLabelText("Título");
    await waitFor(() => expect(title).toHaveValue("feat: primer cambio"));
    expect((screen.getByLabelText("Cuerpo") as HTMLTextAreaElement).value).toContain(
      "fix: segundo cambio",
    );

    await user.click(screen.getByRole("button", { name: "Crear pull request" }));
    await waitFor(() =>
      expect(pullRequests.create).toHaveBeenCalledWith("/tmp/demo", {
        base: "main",
        head: "feat/git-y-pr",
        title: "feat: primer cambio",
        body: expect.stringContaining("fix: segundo cambio"),
      }),
    );
    expect(await screen.findByText(/Pull request creada/)).toBeInTheDocument();
  });

  test("sin sesión activa no se puede enviar al agente", async () => {
    setup({ sessionId: null });
    const send = await screen.findByRole("button", { name: "Enviar al agente" });
    expect(send).toBeDisabled();
  });
});
