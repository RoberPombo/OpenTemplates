/**
 * Propuesta de bootstrap para el alta de una feature: mezcla lo que el repo ya
 * tiene configurado a mano con los candidatos que detecta el backend. Solo
 * decide qué rutas se aceptan; no lee contenido ni toca disco.
 */
import type { BootstrapCandidate, BootstrapEntry } from "../../types";

export type BootstrapProposal = {
  path: string;
  mode: BootstrapEntry["mode"];
  required: boolean;
  source: "configured" | "detected";
  kind: BootstrapCandidate["kind"] | null;
};

/** Lo configurado manda; lo detectado se añade sin duplicar y sin marcar. */
export function proposeBootstrap(
  existing: BootstrapEntry[] = [],
  candidates: BootstrapCandidate[] = [],
): BootstrapProposal[] {
  const proposals: BootstrapProposal[] = [];
  const seen = new Set<string>();

  for (const entry of existing) {
    const path = entry.path.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    proposals.push({
      path,
      mode: entry.mode,
      required: Boolean(entry.required),
      source: "configured",
      kind: null,
    });
  }

  for (const candidate of candidates) {
    const path = candidate.path.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    proposals.push({
      path,
      mode: "copy",
      required: false,
      source: "detected",
      kind: candidate.kind,
    });
  }

  return proposals;
}

/** Clave estable para las decisiones de una casilla, separada por repo. */
export function bootstrapKey(repoId: string, path: string): string {
  return `${repoId}\u0000${path}`;
}

export function isProposalAccepted(
  proposal: BootstrapProposal,
  repoId: string,
  decisions: Record<string, boolean>,
): boolean {
  return decisions[bootstrapKey(repoId, proposal.path)] ?? proposal.source === "configured";
}

export function acceptedBootstrap(
  proposals: BootstrapProposal[],
  accepted: Iterable<string>,
): BootstrapEntry[] {
  const paths = new Set(accepted);
  return proposals
    .filter((proposal) => paths.has(proposal.path))
    .map(({ path, mode, required }) => ({ path, mode, required }));
}

/** Entradas finales de un repo: lo marcado por el usuario o, por defecto, lo configurado. */
export function decisionsToBootstrap(
  repoId: string,
  proposals: BootstrapProposal[],
  decisions: Record<string, boolean>,
): BootstrapEntry[] {
  const accepted = proposals
    .filter((proposal) => isProposalAccepted(proposal, repoId, decisions))
    .map((proposal) => proposal.path);
  return acceptedBootstrap(proposals, accepted);
}
