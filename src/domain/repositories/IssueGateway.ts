/** Puerto de issues de GitHub con `gh`. Solo lectura: nunca escribe issues. */
import type { GitHubIssue } from "../features/issue";
import type { GhStatus } from "../workspace/pullRequest";

export type IssueSearchOptions = {
  /** Texto libre; vacío u omitido lista los más recientes. */
  search?: string;
  /** Por defecto 30; el backend lo acota a 1..50. */
  limit?: number;
};

export interface IssueGateway {
  /** ¿Está `gh` instalado y autenticado? Devuelve un mensaje claro si no. */
  status(): Promise<GhStatus>;
  /** Issues abiertos del repo, ya saneados y ordenados por gh. */
  list(projectPath: string, options?: IssueSearchOptions): Promise<GitHubIssue[]>;
}
