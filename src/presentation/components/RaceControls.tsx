/**
 * Punto de entrada de las carreras en la cabecera del workspace: botón, diálogo
 * de lanzamiento y vista de comparación. El estado de ejecución lo lleva
 * `useRace`; aquí solo quedan las confirmaciones y la navegación al chat.
 */
import { useEffect, useState } from "react";
import type { ChatServer } from "../../domain/repositories/ChatGateway";
import type { Workspace } from "../../types";
import { discardConfirmText, winnerConfirmText, type RaceRun } from "../../domain/race/races";
import { useAppContext } from "../context/AppContext";
import { useCommandAction } from "../context/CommandActions";
import { useRace } from "../hooks/useRace";
import { RaceDialog } from "./RaceDialog";
import { RaceView } from "./RaceView";
import { Button } from "./ui";

type Props = {
  client: ChatServer;
  workspace: Workspace;
  worktreesRoot: string;
  repoPath: string | null;
  sessionId: string | null;
  onOpenSession: (sessionId: string) => void;
  onOpenDiff: (sessionId: string) => void;
  onLiveChange: (live: boolean) => void;
};

export function RaceControls({
  client,
  workspace,
  worktreesRoot,
  repoPath,
  sessionId,
  onOpenSession,
  onOpenDiff,
  onLiveChange,
}: Props) {
  const root = useAppContext();
  const {
    race,
    models,
    agents,
    isGit,
    projectID,
    catalogError,
    launchError,
    merging,
    mergeError,
    hasLiveRace,
    startRace,
    keepWinner,
    retryMerge,
    discard,
    clearRace,
  } = useRace({
    client,
    git: root.git,
    workspace,
    worktreesRoot,
    repoPath,
    sessionId,
    preferences: root.preferences,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    onLiveChange(hasLiveRace);
  }, [hasLiveRace, onLiveChange]);

  // Al desmontar (workspace parado o cambiado) no queda carrera observable.
  useEffect(() => () => onLiveChange(false), [onLiveChange]);

  const worktreesAvailable = isGit && projectID !== null && worktreesRoot.trim().length > 0;
  useCommandAction("race.launch", open);

  function open() {
    if (race) setViewOpen(true);
    else setDialogOpen(true);
  }

  async function newRace() {
    if (hasLiveRace) return;
    setBusy(true);
    try {
      await clearRace();
    } finally {
      setBusy(false);
    }
    setViewOpen(false);
    setDialogOpen(true);
  }

  function openSession(run: RaceRun) {
    if (!run.sessionId) return;
    onOpenSession(run.sessionId);
    setViewOpen(false);
  }

  function openDiff(run: RaceRun) {
    if (!run.sessionId) return;
    onOpenDiff(run.sessionId);
    setViewOpen(false);
  }

  async function keep(run: RaceRun) {
    if (!race) return;
    if (!root.confirm.confirm(winnerConfirmText(race, run))) return;
    setBusy(true);
    try {
      await keepWinner(run.id);
    } finally {
      setBusy(false);
    }
  }

  async function discardRun(run: RaceRun) {
    if (!root.confirm.confirm(discardConfirmText(run))) return;
    setBusy(true);
    try {
      await discard(run.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        className={race ? "active" : ""}
        title={
          race
            ? hasLiveRace
              ? "Carrera en curso"
              : "Ver la comparación de la última carrera"
            : "Lanzar el mismo encargo a varios modelos"
        }
        onClick={open}
      >
        Carrera
        {race && <span className="race-count">{race.runs.length}</span>}
      </Button>

      {dialogOpen && (
        <RaceDialog
          models={models}
          agents={agents}
          isGit={isGit}
          worktreesAvailable={worktreesAvailable}
          catalogError={catalogError}
          error={launchError}
          onLaunch={(draft) => {
            const error = startRace(draft);
            if (!error) setViewOpen(true);
            return error;
          }}
          onClose={() => setDialogOpen(false)}
        />
      )}

      {viewOpen && race && (
        <RaceView
          race={race}
          busy={busy || merging}
          merging={merging}
          mergeError={mergeError}
          onClose={() => setViewOpen(false)}
          onNewRace={newRace}
          onOpenSession={openSession}
          onOpenDiff={openDiff}
          onKeepWinner={(run) => void keep(run)}
          onRetryMerge={() => void retryMerge()}
          onDiscard={(run) => void discardRun(run)}
        />
      )}
    </>
  );
}
