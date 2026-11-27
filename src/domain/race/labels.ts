/**
 * Etiquetas y textos de confirmación de la carrera. Solo formatea estado ya
 * resuelto; no lo modifica ni depende de React.
 */
import type { Race, RaceMerge, RaceRun, RaceRunStatus, RaceStatus } from "./state";

const RUN_STATUS_LABELS: Record<RaceRunStatus, string> = {
  preparing: "preparando",
  running: "ejecutando",
  waiting: "esperando respuesta",
  succeeded: "terminada",
  failed: "fallida",
  discarded: "descartada",
  winner: "ganadora",
};

export function runStatusLabel(run: RaceRun): string {
  return RUN_STATUS_LABELS[run.status];
}

export const RACE_STATUS_LABELS: Record<RaceStatus, string> = {
  running: "en curso",
  finished: "terminada",
  settled: "ganadora elegida",
};

/** Mensaje de confirmación antes de quedarse con una corrida. */
export function winnerConfirmText(race: Race, run: RaceRun): string {
  const losers = race.runs.filter((item) => item.id !== run.id);
  const worktrees = losers.filter((item) => item.worktree !== null).length;
  const sessions = losers.filter((item) => item.sessionId !== null).length;
  const parts = [
    `¿Quedarte con ${run.model.name} y descartar las otras ${losers.length} corridas?`,
  ];
  if (run.worktree) {
    parts.push(
      "Sus cambios se aplicarán al workspace y quedarán preparados para que los revises y commitees; no se creará ningún commit.",
    );
  }
  if (sessions > 0) parts.push(`Se cerrarán ${sessions} sesión(es) de las perdedoras.`);
  if (worktrees > 0) {
    parts.push(
      `Se eliminarán ${worktrees} worktree(s) de las perdedoras conservando su rama base; sus cambios sin commitear se perderán.`,
    );
  }
  return `${parts.join(" ")} El worktree y la sesión de la ganadora se conservan.`;
}

const MERGE_STATUS_LABELS: Record<RaceMerge["status"], string> = {
  merged: "Ganadora fusionada en el workspace",
  empty: "La ganadora no tenía cambios que fusionar",
  conflict: "La fusión chocó con cambios del workspace",
  failed: "La fusión falló",
};

export function mergeStatusLabel(merge: RaceMerge): string {
  return MERGE_STATUS_LABELS[merge.status];
}

export function discardConfirmText(run: RaceRun): string {
  const where = run.worktree
    ? ` Se eliminará su worktree (la rama base no se toca) y se perderán los cambios sin commitear.`
    : " Se cerrará su sesión.";
  return `¿Descartar la corrida de ${run.model.name}?${where}`;
}
