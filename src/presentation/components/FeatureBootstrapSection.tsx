/** Lista de candidatos de bootstrap del alta, agrupada por repo. */
import {
  bootstrapKey,
  proposeBootstrap,
  type BootstrapProposal,
} from "../../domain/features/bootstrap";
import type { BootstrapCandidateKind, Repo } from "../../types";
import type { BootstrapDetectionState } from "../hooks/useBootstrapCandidates";

type Props = {
  repos: Repo[];
  detections: BootstrapDetectionState;
  decisions: Record<string, boolean>;
  onToggle: (repoId: string, path: string, checked: boolean) => void;
};

const KIND_LABELS: Record<BootstrapCandidateKind, string> = {
  env: "Variables de entorno",
  local: "Configuración local",
  npm: "Configuración de npm",
  tool: "Versión de herramientas",
  override: "Override",
};

function candidateLabel(proposal: BootstrapProposal): string {
  if (proposal.source === "configured") return "Configurado en el repo";
  return proposal.kind ? KIND_LABELS[proposal.kind] : "Detectado";
}

export function FeatureBootstrapSection({ repos, detections, decisions, onToggle }: Props) {
  if (repos.length === 0) return null;

  return (
    <section className="feature-pick feature-bootstrap">
      <div className="section-head">
        <h3>Bootstrap</h3>
        <span className="muted small-text">Se copian al worktree de la feature</span>
      </div>
      <p className="muted small-text">
        Ficheros ignorados que parecen configuración local. Solo se muestran rutas y su tipo: nunca
        se lee el contenido.
      </p>

      {repos.map((repo) => {
        const detection = detections[repo.id];
        const proposals = proposeBootstrap(repo.bootstrap ?? [], detection?.candidates ?? []);

        return (
          <div key={repo.id} className="bootstrap-repo">
            <div className="section-head">
              <h4>{repo.name}</h4>
              <span className="muted small-text">{repo.path}</span>
            </div>

            {detection?.loading && (
              <output className="muted small-text">Buscando ficheros ignorados…</output>
            )}
            {detection?.error && (
              <p className="inline-error" role="alert">
                No se pudieron detectar candidatos: {detection.error}
              </p>
            )}
            {!detection?.loading && !detection?.error && proposals.length === 0 && (
              <p className="muted small-text">Sin ficheros candidatos.</p>
            )}

            {proposals.length > 0 && (
              <div className="check-list compact">
                {proposals.map((proposal) => {
                  const key = bootstrapKey(repo.id, proposal.path);
                  const checked = decisions[key] ?? proposal.source === "configured";
                  return (
                    <label key={key} className={`check ${checked ? "on" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        aria-label={`${proposal.path} en ${repo.name}`}
                        onChange={(event) => onToggle(repo.id, proposal.path, event.target.checked)}
                      />
                      <span className="check-main">
                        <span className="check-title">{proposal.path}</span>
                        <span className="check-sub">{candidateLabel(proposal)}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {detection?.truncated && (
              <p className="muted small-text">
                Hay más candidatos de los que se muestran; revisa el repo a mano si falta alguno.
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
