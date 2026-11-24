/**
 * Diálogo para definir o editar el objetivo de sesión: texto, límite de turnos
 * y límite de coste opcional. También concentra pausar, reanudar y quitar.
 */
import { useState } from "react";
import { DEFAULT_GOAL_TURNS, MAX_GOAL_TURNS, type Goal } from "../../domain/chat/goals";
import { Button, TextInput } from "./ui";
type GoalForm = { text: string; maxTurns: number; maxCost: number | null };
type Props = {
  goal: Goal | null;
  /** Modelo con capacidad de decisión; sin él el bucle no puede evaluar. */
  decisionModel: { providerID: string; id: string } | null;
  error: string | null;
  onSave: (input: GoalForm) => void | Promise<void>;
  onPause: () => void;
  onResume: () => void;
  onRemove: () => void;
  onClose: () => void;
};
export function GoalDialog({
  goal,
  decisionModel,
  error,
  onSave,
  onPause,
  onResume,
  onRemove,
  onClose,
}: Props) {
  const [text, setText] = useState(goal?.text ?? "");
  const [maxTurns, setMaxTurns] = useState(String(goal?.maxTurns ?? DEFAULT_GOAL_TURNS));
  const [maxCost, setMaxCost] = useState(
    goal?.maxCost !== null && goal?.maxCost !== undefined ? String(goal.maxCost) : "",
  );
  const [busy, setBusy] = useState(false);
  const turns = Number(maxTurns);
  const cost = maxCost.trim() === "" ? null : Number(maxCost);
  const valid =
    text.trim().length > 0 &&
    Number.isFinite(turns) &&
    turns >= 1 &&
    turns <= MAX_GOAL_TURNS &&
    (cost === null || (Number.isFinite(cost) && cost >= 0));
  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onSave({ text: text.trim(), maxTurns: turns, maxCost: cost });
      onClose();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <dialog open className="modal goal-dialog" aria-labelledby="goal-title">
        <header className="modal-head">
          <div>
            <h2 id="goal-title">{goal ? "Objetivo de la sesión" : "Nuevo objetivo"}</h2>
            <p className="muted small-text">
              El agente seguirá trabajando solo hasta cumplirlo, bloquearse o agotar el límite.
            </p>
          </div>
          <button type="button" className="ghost" aria-label="Cerrar" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body goal-body">
          <label className="field" htmlFor="goal-criterion">
            <span>Criterio de fin</span>
            <textarea
              id="goal-criterion"
              className="text-input goal-text"
              rows={3}
              autoFocus
              value={text}
              placeholder="Por ejemplo: deja los tests en verde y el lint limpio"
              aria-label="Criterio de fin"
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <div className="goal-fields">
            <label className="field" htmlFor="goal-turns">
              <span>Límite de turnos</span>
              <TextInput
                id="goal-turns"
                type="number"
                min={1}
                max={MAX_GOAL_TURNS}
                value={maxTurns}
                aria-label="Límite de turnos"
                onChange={(event) => setMaxTurns(event.target.value)}
              />
            </label>
            <label className="field" htmlFor="goal-cost">
              <span>Límite de coste (USD, opcional)</span>
              <TextInput
                id="goal-cost"
                type="number"
                min={0}
                step="0.01"
                value={maxCost}
                placeholder="sin límite"
                aria-label="Límite de coste"
                onChange={(event) => setMaxCost(event.target.value)}
              />
            </label>
          </div>
          {goal && (
            <p className="muted small-text goal-progress">
              {goal.turns} de {goal.maxTurns} turnos · ${goal.cost.toFixed(3)} ·{" "}
              {goal.tokens.input + goal.tokens.output} tokens de evaluación
            </p>
          )}
          {!decisionModel && (
            <div className="callout warning">
              Este workspace no tiene un modelo con capacidad de decisión; el objetivo no podrá
              evaluarse hasta que haya uno disponible.
            </div>
          )}
          {error && <p className="inline-error goal-error">{error}</p>}
        </div>
        <footer className="modal-foot">
          <span className="row">
            {goal && goal.status === "active" && (
              <Button onClick={onPause} disabled={busy}>
                Pausar
              </Button>
            )}
            {goal && goal.status !== "active" && goal.status !== "done" && (
              <Button onClick={onResume} disabled={busy}>
                Reanudar
              </Button>
            )}
            {goal && (
              <Button className="danger-text" onClick={onRemove} disabled={busy}>
                Quitar
              </Button>
            )}
          </span>
          <span className="row">
            <Button onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={() => void submit()} disabled={!valid || busy}>
              {goal ? "Guardar" : "Crear objetivo"}
            </Button>
          </span>
        </footer>
      </dialog>
    </div>
  );
}
