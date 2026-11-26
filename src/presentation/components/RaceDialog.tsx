/**
 * Diálogo para lanzar una carrera: encargo, de 2 a 5 modelos del catálogo del
 * workspace, agente opcional y worktree por corrida. Muestra el coste estimado
 * cuando el catálogo trae precios.
 */
import { useMemo, useState } from "react";
import { useDialogDismiss } from "../hooks/useDialogDismiss";
import type { AgentOption, ModelOption } from "../../domain/chat/selection";
import type { SelectOptionGroup } from "./ui/Select";
import { estimateRaceCost, MAX_RACE_RUNS, MIN_RACE_RUNS } from "../../domain/race/races";
import { formatCost } from "../../domain/chat/usage";
import { ModelInfoCard } from "./ModelInfoCard";
import { Button, Select } from "./ui";
import { AsyncMultiSearchableSelect } from "./ui";

export type RaceLaunchDraft = {
  prompt: string;
  modelKeys: string[];
  agent: string | null;
  useWorktrees: boolean;
};

type Props = {
  models: ModelOption[];
  agents: AgentOption[];
  isGit: boolean;
  worktreesAvailable: boolean;
  catalogError: string | null;
  error: string | null;
  onLaunch: (draft: RaceLaunchDraft) => string | null;
  onClose: () => void;
};

export function RaceDialog({
  models,
  agents,
  isGit,
  worktreesAvailable,
  catalogError,
  error,
  onLaunch,
  onClose,
}: Props) {
  const dismiss = useDialogDismiss(onClose);
  const [prompt, setPrompt] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [agent, setAgent] = useState("");
  // El catálogo puede resolverse después de abrir el diálogo. Mientras el
  // usuario no toque la casilla, el valor deriva de la disponibilidad; en cuanto
  // la toca, su elección manda (sin un efecto que la sobrescriba).
  const [useWorktreesOverride, setUseWorktreesOverride] = useState<boolean | null>(null);
  const useWorktrees = useWorktreesOverride ?? worktreesAvailable;
  const [formError, setFormError] = useState<string | null>(null);

  const selected = useMemo(
    () =>
      selectedKeys
        .map((key) => models.find((model) => model.key === key))
        .filter((model): model is ModelOption => Boolean(model)),
    [models, selectedKeys],
  );

  const modelGroups = useMemo<SelectOptionGroup[]>(() => {
    const groups = new Map<string, ModelOption[]>();
    for (const model of models) {
      const list = groups.get(model.providerID) ?? [];
      list.push(model);
      groups.set(model.providerID, list);
    }
    return [...groups.entries()].map(([provider, list]) => ({
      label: provider,
      options: list.map((model) => ({
        value: model.key,
        label: model.name,
        description: `${model.providerID} · ${model.id}`,
        searchText: `${model.providerID} ${model.id}`,
        tooltip: model.details ? <ModelInfoCard details={model.details} /> : undefined,
      })),
    }));
  }, [models]);

  const estimate = useMemo(
    () =>
      estimateRaceCost(
        selected.map((model) => model.details),
        prompt,
      ),
    [selected, prompt],
  );
  const tooFew = selectedKeys.length < MIN_RACE_RUNS;
  const valid = prompt.trim().length > 0 && !tooFew;
  const agentOptions = [
    { value: "", label: "El del workspace" },
    ...agents.map((item) => ({ value: item.id, label: item.name })),
  ];

  function selectModels(values: string[]) {
    if (values.length > MAX_RACE_RUNS) {
      setSelectedKeys(values.slice(0, MAX_RACE_RUNS));
      setFormError(`Como mucho ${MAX_RACE_RUNS} modelos por carrera.`);
      return;
    }
    setFormError(null);
    setSelectedKeys(values);
  }

  function launch() {
    if (!valid) return;
    const failure = onLaunch({
      prompt: prompt.trim(),
      modelKeys: selectedKeys,
      agent: agent || null,
      useWorktrees: useWorktrees && worktreesAvailable,
    });
    if (failure) {
      setFormError(failure);
      return;
    }
    onClose();
  }

  const worktreeHint = !isGit
    ? "El proyecto no es un repositorio git: las corridas compartirán la carpeta del workspace."
    : !worktreesAvailable
      ? "No se pudo resolver el proyecto de opencode o falta la raíz de worktrees: se compartirá la carpeta."
      : "Cada corrida se ejecuta en su propio árbol de trabajo, ramificado desde la rama actual.";

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <dialog
        open
        className="modal race-dialog"
        aria-modal="true"
        aria-labelledby="race-dialog-title"
        onKeyDown={dismiss}
      >
        <header className="modal-head">
          <div>
            <h2 id="race-dialog-title">Nueva carrera</h2>
            <p className="muted small-text">
              El mismo encargo a varios modelos a la vez. Después compara y quédate con uno.
            </p>
          </div>
          <button type="button" className="ghost" aria-label="Cerrar" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="modal-body race-body">
          <label className="field" htmlFor="race-prompt">
            <span>Encargo</span>
            <textarea
              id="race-prompt"
              className="text-input race-prompt"
              rows={4}
              autoFocus
              value={prompt}
              placeholder="Por ejemplo: añade validación al formulario de alta y tests para los casos límite"
              aria-label="Encargo"
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>

          <div className="field">
            <span>
              Modelos ({MIN_RACE_RUNS}–{MAX_RACE_RUNS})
            </span>
            <AsyncMultiSearchableSelect
              aria-label="Modelos de la carrera"
              value={selectedKeys}
              options={modelGroups}
              placeholder={
                models.length === 0 ? "Cargando modelos…" : "Buscar modelos para la carrera…"
              }
              disabled={models.length === 0}
              onValueChange={selectModels}
            />
            <span className="field-hint">
              {selectedKeys.length === 0
                ? `Elige al menos ${MIN_RACE_RUNS} modelos.`
                : `${selectedKeys.length} de ${MAX_RACE_RUNS} seleccionados.`}
            </span>
          </div>

          <div className="field">
            <span>Agente</span>
            <Select
              aria-label="Agente de la carrera"
              value={agent}
              options={agentOptions}
              placeholder="El del workspace"
              onValueChange={setAgent}
            />
          </div>

          <label className="check race-worktrees">
            <input
              type="checkbox"
              checked={useWorktrees && worktreesAvailable}
              disabled={!worktreesAvailable}
              aria-label="Un worktree por corrida"
              onChange={(event) => setUseWorktreesOverride(event.target.checked)}
            />
            <span className="check-main">
              <span className="check-title">Un worktree por corrida</span>
              <span className="check-sub">{worktreeHint}</span>
            </span>
          </label>

          {selected.length > 0 && (
            <div className="race-estimate" aria-live="polite">
              <span className="race-estimate-label">Coste estimado</span>
              {estimate.total !== null ? (
                <strong>{formatCost(estimate.total)}</strong>
              ) : (
                <strong className="muted">sin precios en el catálogo</strong>
              )}
              <span className="muted small-text">
                {estimate.total !== null
                  ? "estimación por prompt y 1.200 tokens de salida por corrida; el coste real puede variar"
                  : "alguno de los modelos elegidos no publica precio"}
              </span>
              {estimate.total !== null && (
                <span className="race-estimate-runs">
                  {estimate.perRun
                    .map(
                      (value, index) =>
                        `${selected[index]?.name ?? "modelo"}: ${formatCost(value ?? 0)}`,
                    )
                    .join(" · ")}
                </span>
              )}
            </div>
          )}

          {catalogError && <p className="inline-error">Catálogo: {catalogError}</p>}
          {(formError || error) && (
            <p className="inline-error" role="alert">
              {formError ?? error}
            </p>
          )}
        </div>

        <footer className="modal-foot">
          <span className="muted small-text">
            {tooFew && prompt.trim()
              ? `Faltan modelos: ${MIN_RACE_RUNS - selectedKeys.length}.`
              : "Las corridas se lanzan en paralelo; un fallo no detiene a las demás."}
          </span>
          <span className="row">
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" onClick={launch} disabled={!valid}>
              Lanzar carrera
            </Button>
          </span>
        </footer>
      </dialog>
    </div>
  );
}
