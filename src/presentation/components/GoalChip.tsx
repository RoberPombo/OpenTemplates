/**
 * Chip del objetivo de sesión: estado, progreso de turnos y coste. Abre el
 * diálogo para editarlo, pausarlo, reanudarlo o quitarlo.
 */
import type { Goal } from "../../domain/chat/goals";
const STATUS_LABEL: Record<Goal["status"], string> = {
  active: "activo",
  paused: "pausado",
  done: "cumplido",
  blocked: "bloqueado",
  exhausted: "agotado",
};
function TargetIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
type Props = {
  goal: Goal;
  onOpen: () => void;
};
export function GoalChip({ goal, onOpen }: Props) {
  const cost = goal.cost > 0 ? ` · $${goal.cost.toFixed(3)}` : "";
  const progress = `Turno ${goal.turns}/${goal.maxTurns}${cost}`;
  return (
    <button
      type="button"
      className={`goal-chip ${goal.status}`}
      title={`Objetivo: ${goal.text}\n${progress} · ${STATUS_LABEL[goal.status]}`}
      aria-label={`Objetivo ${STATUS_LABEL[goal.status]}: ${goal.text}. ${progress}`}
      onClick={onOpen}
    >
      <TargetIcon />
      <span className="goal-chip-key">Objetivo</span>
      <span className="goal-chip-text">{goal.text}</span>
      <span className="goal-chip-progress">{progress}</span>
      <span className={`goal-chip-status ${goal.status}`}>{STATUS_LABEL[goal.status]}</span>
    </button>
  );
}
