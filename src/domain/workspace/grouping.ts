/** Agrupación de workspaces por repositorio para la barra lateral. */
import type { Repo, Workspace } from "../../types";

export type WorkspaceGroup = {
  key: string;
  title: string;
  subtitle?: string;
  items: Workspace[];
};

export function groupWorkspacesByRepo(workspaces: Workspace[], repos: Repo[]): WorkspaceGroup[] {
  const byRepo = new Map<string, Workspace[]>();
  for (const workspace of workspaces) {
    const key = workspace.repoId ?? "";
    const list = byRepo.get(key) ?? [];
    list.push(workspace);
    byRepo.set(key, list);
  }
  const result: WorkspaceGroup[] = [];
  for (const repo of repos) {
    const items = byRepo.get(repo.id);
    if (!items || items.length === 0) continue;
    result.push({ key: repo.id, title: repo.name, subtitle: repo.path, items });
    byRepo.delete(repo.id);
  }
  const leftovers: Workspace[] = [];
  for (const items of byRepo.values()) leftovers.push(...items);
  if (leftovers.length > 0) {
    result.push({ key: "", title: "Sin repo", items: leftovers });
  }
  return result;
}
