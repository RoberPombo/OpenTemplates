/** Puerto de repositorios git dados de alta en la app. */
import type { Repo } from "../../types";

export interface RepoGateway {
  list(): Promise<Repo[]>;
  add(path: string): Promise<Repo>;
  refresh(id: string): Promise<Repo>;
  remove(id: string): Promise<void>;
}
