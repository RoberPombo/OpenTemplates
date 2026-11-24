/** Puerto del flujo git de un workspace: estado, stage, commit y push. */
import type { GitCommit, GitCommitResult, GitPushResult, GitStatus } from "../workspace/git";

export interface GitGateway {
  status(projectPath: string): Promise<GitStatus>;
  stage(projectPath: string, paths: string[]): Promise<GitStatus>;
  unstage(projectPath: string, paths: string[]): Promise<GitStatus>;
  /** Diff preparado (índice) para sugerir el mensaje de commit. */
  stagedDiff(projectPath: string): Promise<string>;
  commit(projectPath: string, message: string): Promise<GitCommitResult>;
  push(
    projectPath: string,
    input: { branch: string; setUpstream: boolean; remote?: string },
  ): Promise<GitPushResult>;
  /** Commits de la rama que no están en la base, para el borrador de la PR. */
  commits(projectPath: string, base: string, limit?: number): Promise<GitCommit[]>;
}
