/** Puerto de pull requests con GitHub CLI (`gh`). */
import type { GhStatus, PullRequestCheck, PullRequestInfo } from "../workspace/pullRequest";

export interface PullRequestGateway {
  /** ¿Está `gh` instalado y autenticado? Devuelve un mensaje claro si no. */
  status(): Promise<GhStatus>;
  /** PR de la rama actual, o `null` si todavía no existe. */
  view(projectPath: string): Promise<PullRequestInfo | null>;
  /** Todos los checks de la PR actual; el dominio filtra los fallidos. */
  checks(projectPath: string): Promise<PullRequestCheck[]>;
  create(
    projectPath: string,
    input: { base: string; head: string; title: string; body: string },
  ): Promise<{ url: string }>;
}
