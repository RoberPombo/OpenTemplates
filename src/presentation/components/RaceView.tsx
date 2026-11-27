/**
 * Comparación de una carrera: una tarjeta por corrida con estado, coste,
 * duración, cambios y resumen, y las acciones para abrirla, ver su diff,
 * quedarse con ella o descartarla.
 */
import { formatDuration } from "../../domain/shared";
import { formatCost, formatTokens } from "../../domain/chat/usage";
import {
  canChooseWinner,
  mergeableWinner,
  mergeStatusLabel,
  raceStatus,
  raceTotals,
  RACE_STATUS_LABELS,
  runDuration,
  runStatusLabel,
  type Race,
  type RaceRun,
  type RaceRunStatus,
} from "../../domain/race/races";
import { Button } from "./ui";

type Props = {
  race: Race;
  busy: boolean;
  merging: boolean;
  mergeError: string | null;
  onClose: () => void;
  onNewRace: () => void;
  onOpenSession: (run: RaceRun) => void;
  onOpenDiff: (run: RaceRun) => void;
  onKeepWinner: (run: RaceRun) => void;
  onRetryMerge: () => void;
  onDiscard: (run: RaceRun) => void;
};

const STATUS_TONE: Record<RaceRunStatus, string> = {
  preparing: "info",
  running: "info",
  waiting: "warning",
  succeeded: "success",
  failed: "error",
  discarded: "neutral",
  winner: "success",
};

function runHeadline(run: RaceRun): string {
  if (run.waitingFor === "permission") return "Esperando una aprobación; ábrela en el chat.";
  if (run.waitingFor === "form") return "Esperando una respuesta; ábrela en el chat.";
  if (run.error) return run.error;
  if (run.summary) return run.summary;
  if (run.status === "preparing") return "Preparando worktree y sesión…";
  if (run.status === "running") return "Ejecutando el encargo…";
  if (run.status === "succeeded" || run.status === "winner") return "Sin mensaje de resumen.";
  if (run.status === "discarded") return "Corrida descartada.";
  return "";
}

export function RaceView({
  race,
  busy,
  merging,
  mergeError,
  onClose,
  onNewRace,
  onOpenSession,
  onOpenDiff,
  onKeepWinner,
  onRetryMerge,
  onDiscard,
}: Props) {
  const totals = raceTotals(race);
  const status = raceStatus(race);
  const merge = race.merge;
  const mergeable = mergeableWinner(race);
  const mergeLabel =
    merge &&
    `${mergeStatusLabel(merge)}${
      merge.status === "merged"
        ? `: ${merge.files} fichero(s) +${merge.additions} −${merge.deletions}, preparados sin commit`
        : ""
    }${merge.conflicts.length > 0 ? ` · ${merge.conflicts.join(", ")}` : ""}`;
  const canStartAnother = !race.runs.some(
    (run) => run.status === "preparing" || run.status === "running" || run.status === "waiting",
  );

  return (
    <div className="modal-backdrop">
      <dialog open className="modal race-modal" aria-labelledby="race-title">
        <header className="modal-head race-head">
          <div className="race-head-copy">
            <div className="row">
              <h2 id="race-title">Carrera de modelos</h2>
              <span className={`race-status ${status}`}>{RACE_STATUS_LABELS[status]}</span>
            </div>
            <p className="race-prompt-summary" title={race.prompt}>
              {race.prompt}
            </p>
            <p className="muted small-text">
              {`${totals.finished}/${totals.total} terminadas · ${formatCost(totals.cost)} · ${formatTokens(
                totals.tokens.input + totals.tokens.output,
              )} tokens · ${totals.files} ficheros `}
              <span className="race-add">+{totals.additions}</span>{" "}
              <span className="race-del">−{totals.deletions}</span>
            </p>
            {mergeLabel && (
              <p
                className={`race-merge ${merge?.status ?? ""}`}
                role={
                  merge?.status === "conflict" || merge?.status === "failed" ? "alert" : undefined
                }
              >
                {mergeLabel}
              </p>
            )}
            {!merge && race.winnerRunId && !race.useWorktrees && (
              <p className="muted small-text">
                Las corridas compartieron la carpeta del workspace; no hay una fusión separada.
              </p>
            )}
            {merging && <p className="muted small-text">Aplicando los cambios al workspace…</p>}
            {mergeError && <p className="inline-error small-text">{mergeError}</p>}
          </div>
          <div className="row">
            <Button onClick={onNewRace} disabled={!canStartAnother || busy}>
              Nueva carrera
            </Button>
            <button type="button" className="ghost" aria-label="Cerrar" onClick={onClose}>
              ×
            </button>
          </div>
        </header>

        <div className="modal-body race-compare">
          {race.runs.map((run) => (
            <article
              key={run.id}
              className={`race-card ${run.status} ${race.winnerRunId === run.id ? "winner" : ""}`}
              aria-label={`Corrida de ${run.model.name}`}
            >
              <header className="race-card-head">
                <div>
                  <h3>{run.model.name}</h3>
                  <span className="muted small-text">
                    {run.model.providerID} · {run.model.id}
                  </span>
                </div>
                <span className={`race-run-status ${STATUS_TONE[run.status]}`}>
                  {runStatusLabel(run)}
                </span>
              </header>

              <dl className="race-metrics">
                <div>
                  <dt>Coste</dt>
                  <dd>{formatCost(run.cost)}</dd>
                </div>
                <div>
                  <dt>Duración</dt>
                  <dd>{formatDuration(runDuration(run)) || "—"}</dd>
                </div>
                <div>
                  <dt>Tokens</dt>
                  <dd>{formatTokens(run.tokens.input + run.tokens.output)}</dd>
                </div>
                <div>
                  <dt>Cambios</dt>
                  <dd>
                    {run.changes
                      ? `${run.changes.files} ficheros +${run.changes.additions} −${run.changes.deletions}`
                      : "—"}
                  </dd>
                </div>
              </dl>

              <p className={`race-run-summary ${run.error ? "error" : ""}`}>{runHeadline(run)}</p>

              <p className="muted small-text race-run-where" title={run.directory}>
                {run.worktree ? "worktree" : "carpeta del workspace"} · {run.directory}
                {run.branch ? ` · rama base ${run.branch}` : ""}
              </p>
              {run.cleanupError && (
                <p className="inline-error small-text">Limpieza: {run.cleanupError}</p>
              )}

              <footer className="race-card-actions">
                <Button
                  className="small"
                  disabled={!run.sessionId}
                  onClick={() => onOpenSession(run)}
                >
                  Abrir sesión
                </Button>
                <Button className="small" disabled={!run.sessionId} onClick={() => onOpenDiff(run)}>
                  Ver diff
                </Button>
                {canChooseWinner(run) && (
                  <Button
                    className="small primary"
                    disabled={busy}
                    onClick={() => onKeepWinner(run)}
                  >
                    Quedarse con esta
                  </Button>
                )}
                {mergeable?.id === run.id && (
                  <Button className="small" disabled={busy} onClick={onRetryMerge}>
                    {merge ? "Reintentar fusión" : "Fusionar en el workspace"}
                  </Button>
                )}
                {run.status !== "winner" && run.status !== "discarded" && (
                  <Button
                    className="small danger-text"
                    disabled={busy}
                    onClick={() => onDiscard(run)}
                  >
                    Descartar
                  </Button>
                )}
              </footer>
            </article>
          ))}
        </div>

        <footer className="modal-foot">
          <span className="muted small-text">
            Las sesiones de las corridas se abren en el chat; el panel de cambios muestra su diff.
          </span>
          <Button onClick={onClose}>Cerrar</Button>
        </footer>
      </dialog>
    </div>
  );
}
