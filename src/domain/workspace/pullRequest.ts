/**
 * Modelo puro del pull request: estado de `gh`, checks, revisiones y borrador
 * del cuerpo a partir de los commits de la rama. La presentación solo pinta y
 * llama; el prompt que se envía al agente se construye y recorta aquí.
 */

export type GhStatus = {
  installed: boolean;
  authenticated: boolean;
  version: string | null;
  /** Mensaje claro cuando falta `gh` o la sesión de GitHub. */
  message: string | null;
  docsUrl: string;
};

export type PullRequestCheck = {
  name: string;
  state: string;
  /** `passed`, `failed`, `pending` o `skipped`. */
  bucket: string;
  url: string | null;
  workflow: string | null;
};

export type PullRequestReview = {
  author: string;
  state: string;
  body: string;
  submittedAt: string | null;
};

export type PullRequestComment = {
  author: string;
  body: string;
  createdAt: string | null;
  url: string | null;
};

export type PullRequestInfo = {
  number: number;
  title: string;
  state: string;
  url: string;
  isDraft: boolean;
  baseBranch: string;
  headBranch: string;
  reviewDecision: string | null;
  reviews: PullRequestReview[];
  comments: PullRequestComment[];
};

export type PullRequestBody = { title: string; body: string };

const COMMIT_LIMIT = 30;
const BODY_LIMIT = 400;
const PROMPT_LIMIT = 4_000;

export function failedChecks(checks: readonly PullRequestCheck[]): PullRequestCheck[] {
  return checks.filter((check) => check.bucket === "failed");
}

export function pendingChecks(checks: readonly PullRequestCheck[]): PullRequestCheck[] {
  return checks.filter((check) => check.bucket === "pending");
}

export function passedChecks(checks: readonly PullRequestCheck[]): PullRequestCheck[] {
  return checks.filter((check) => check.bucket === "passed");
}

export function checksSummary(checks: readonly PullRequestCheck[]): {
  passed: number;
  failed: number;
  pending: number;
  total: number;
} {
  return {
    passed: passedChecks(checks).length,
    failed: failedChecks(checks).length,
    pending: pendingChecks(checks).length,
    total: checks.length,
  };
}

export function prStateLabel(state: string): string {
  switch (state.toUpperCase()) {
    case "OPEN":
      return "abierta";
    case "CLOSED":
      return "cerrada";
    case "MERGED":
      return "fusionada";
    default:
      return state.toLowerCase() || "desconocida";
  }
}

function truncate(value: string, limit: number): string {
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function firstLine(value: string): string {
  return (
    value
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? ""
  );
}

/**
 * Borrador de PR desde los commits de la rama: el primer asunto es el título
 * y el resto se listan en el cuerpo. El usuario lo edita antes de crear nada.
 */
export function draftPullRequest(input: {
  branch: string;
  base: string;
  commits: readonly { subject: string; body?: string }[];
}): PullRequestBody {
  const commits = input.commits.slice(0, COMMIT_LIMIT);
  const subjects = commits.map((commit) => firstLine(commit.subject)).filter(Boolean);
  const title = truncate(subjects[0] ?? `Cambios en ${input.branch}`, 72);
  const bullets =
    subjects.length > 0
      ? subjects.map((subject) => `- ${subject}`).join("\n")
      : `- Cambios de la rama \`${input.branch}\``;
  const notes = commits.some((commit) => commit.body?.trim())
    ? "\n\n## Notas\n\n" +
      truncate(
        commits
          .map((commit) => commit.body?.trim())
          .filter(Boolean)
          .join(" "),
        800,
      )
    : "";
  const body = [
    "## Qué",
    "",
    bullets,
    notes,
    "",
    `_Borrador generado desde ${commits.length} commit(s) de \`${input.branch}\` contra \`${input.base}\`._`,
  ].join("\n");
  return { title, body };
}

/**
 * Prompt para el agente con los checks fallidos y los comentarios de revisión.
 * Recorta cada texto y el total: nunca se vuelca un log de CI entero.
 */
export function buildReviewPrompt(input: {
  pullRequest: PullRequestInfo | null;
  checks?: readonly PullRequestCheck[];
  /** Si se pasa, se usa tal cual y no se filtra por `failedChecks`. */
  failed?: readonly PullRequestCheck[];
  limit?: number;
}): string {
  const limit = input.limit ?? PROMPT_LIMIT;
  const failed = input.failed ?? failedChecks(input.checks ?? []);
  const reviews = (input.pullRequest?.reviews ?? [])
    .filter((review) => review.body.trim())
    .map((review) => `- ${review.author} (${review.state}): ${truncate(review.body, BODY_LIMIT)}`);
  const comments = (input.pullRequest?.comments ?? [])
    .filter((comment) => comment.body.trim())
    .map((comment) => `- ${comment.author}: ${truncate(comment.body, BODY_LIMIT)}`);
  const failedLines = failed.map((check) => {
    const workflow = check.workflow ? `${check.workflow} / ` : "";
    const url = check.url ? ` (${check.url})` : "";
    return `- ${workflow}${check.name}: ${check.state}${url}`;
  });

  const header = input.pullRequest
    ? `Revisa y corrige los problemas de la pull request #${input.pullRequest.number} «${input.pullRequest.title}» (${input.pullRequest.url}).`
    : "Revisa y corrige los problemas de la pull request de esta rama.";

  const blocks = [header];
  if (failedLines.length > 0) {
    blocks.push("", "Checks fallidos:", ...failedLines);
  }
  if (reviews.length > 0) {
    blocks.push("", "Comentarios de revisión:", ...reviews);
  }
  if (comments.length > 0) {
    blocks.push("", "Comentarios de la PR:", ...comments);
  }
  if (failedLines.length === 0 && reviews.length === 0 && comments.length === 0) {
    return "";
  }
  blocks.push(
    "",
    "Haz los cambios necesarios, ejecuta las comprobaciones que puedas y resume qué has tocado.",
  );

  const prompt = blocks.join("\n");
  if (prompt.length <= limit) return prompt;
  return `${prompt.slice(0, Math.max(0, limit - 20)).trimEnd()}\n\n… (recortado)`;
}
