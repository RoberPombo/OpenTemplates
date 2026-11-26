/** Resultado de materializar una feature en worktrees (adaptador Rust). */
import type { Feature } from "./model";

export type ProvisionedWorktree = {
  role: "root" | "target";
  repoPath: string;
  path: string;
  branch: string;
  base: string;
};

export type FeatureProvisionOutcome = {
  feature: Feature;
  worktrees: ProvisionedWorktree[];
  warnings: string[];
  /** Fallos de bootstrap obligatorio. */
  errors: string[];
  /** Entradas de bootstrap aplicadas. */
  applied: string[];
  /** `true` si algún bootstrap obligatorio falló; la feature queda bloqueada. */
  blocked: boolean;
};
