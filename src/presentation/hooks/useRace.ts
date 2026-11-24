/**
 * Ejecución de una carrera multi-run sobre el servidor de un workspace: crea
 * los worktrees y las sesiones, envía el mismo encargo, sigue el estado por el
 * stream SSE existente y limpia las perdedoras. El estado y las transiciones
 * están en `domain/race/races`; aquí solo hay I/O, persistencia y React.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatServer } from "../../domain/repositories/ChatGateway";
import { prefKeys } from "../../domain/repositories/Preferences";
import type { Preferences } from "../../domain/repositories/Preferences";
import { errorText, folderName } from "../../domain/shared";
import type { AgentOption, ModelOption } from "../../domain/chat/selection";
import { summarizeChanges } from "../../domain/workspace/changes";
import {
  applyRaceEvent,
  chooseWinner,
  createRace,
  discardRun,
  failRun,
  finishRun,
  markCleaned,
  parseRace,
  prepareRun,
  projectIdFor,
  raceIsLive,
  recoverRace,
  runSummaryFromMessages,
  runsNeedingCleanup,
  serializeRace,
  setRunDetails,
  startRun,
  worktreeRunName,
  type Race,
  type RaceModelChoice,
  type RaceRun,
} from "../../domain/race/races";
import type { Workspace } from "../../types";

/** Identificador del arranque de la app: distingue navegar de reabrir. */
const APP_BOOT_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `boot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function newRaceId(): string {
  return `race-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

type Catalog = {
  models: ModelOption[];
  agents: AgentOption[];
  isGit: boolean;
  baseBranch: string | null;
  projectID: string | null;
};

type UseRaceInput = {
  client: ChatServer;
  workspace: Workspace;
  worktreesRoot: string;
  repoPath: string | null;
  /** Sesión activa del chat, para resolver el proyecto si `project.list` no basta. */
  sessionId: string | null;
  preferences: Preferences;
};

export type StartRaceInput = {
  prompt: string;
  modelKeys: string[];
  agent: string | null;
  useWorktrees: boolean;
};

function modelChoice(model: ModelOption): RaceModelChoice {
  return {
    key: model.key,
    providerID: model.providerID,
    id: model.id,
    name: model.name,
  };
}

function toChanges(
  files: Array<{
    file: string;
    additions: number;
    deletions: number;
    status: "added" | "deleted" | "modified";
  }>,
) {
  const summary = summarizeChanges(files);
  return { files: summary.files, additions: summary.additions, deletions: summary.deletions };
}

export function useRace({
  client,
  workspace,
  worktreesRoot,
  repoPath,
  sessionId,
  preferences,
}: UseRaceInput) {
  const storageKey = prefKeys.race(workspace.id);
  const [race, setRace] = useState<Race | null>(() => {
    const stored = parseRace(preferences.get(storageKey));
    return stored ? recoverRace(stored, APP_BOOT_ID, Date.now()) : null;
  });
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const raceRef = useRef<Race | null>(race);

  const commit = useCallback((next: Race | null) => {
    raceRef.current = next;
    setRace(next);
  }, []);

  const update = useCallback((change: (current: Race) => Race) => {
    const current = raceRef.current;
    if (!current) return;
    const next = change(current);
    if (next === current) return;
    raceRef.current = next;
    setRace(next);
  }, []);

  useEffect(() => {
    if (race) preferences.set(storageKey, serializeRace(race));
    else preferences.remove(storageKey);
  }, [race, storageKey, preferences]);

  // Catálogo de modelos/agentes del workspace y datos del proyecto.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [modelResponse, agentResponse, vcsResponse, projectResponse] = await Promise.allSettled(
        [
          client.model.list({ location: { directory: workspace.projectPath } }),
          client.agent.list({ location: { directory: workspace.projectPath } }),
          client.vcs.get({ location: { directory: workspace.projectPath } }),
          client.project.list(),
        ],
      );
      if (!alive) return;
      const allowed = new Set(workspace.models ?? []);
      const models =
        modelResponse.status === "fulfilled"
          ? modelResponse.value.data
              .filter((model) => model.enabled !== false && (!model.type || model.type === "chat"))
              .map((model) => ({
                key: `${model.providerID}/${model.id}`,
                providerID: model.providerID,
                id: model.id,
                name: model.name,
                variants: model.variants.map((variant) => variant.id),
                details: model.details,
              }))
              .filter((model) => allowed.size === 0 || allowed.has(model.key))
              .sort((a, b) => a.name.localeCompare(b.name))
          : [];
      const agents =
        agentResponse.status === "fulfilled"
          ? agentResponse.value.data
              .filter((agent) => !agent.hidden && agent.mode !== "subagent")
              .map((agent) => ({ id: agent.id, name: agent.name }))
              .sort((a, b) => a.name.localeCompare(b.name))
          : [];
      const isGit =
        vcsResponse.status === "fulfilled" &&
        typeof vcsResponse.value.data.branch.current === "string";
      const baseBranch =
        vcsResponse.status === "fulfilled"
          ? (vcsResponse.value.data.branch.current ?? workspace.branch ?? null)
          : (workspace.branch ?? null);
      const projects = projectResponse.status === "fulfilled" ? projectResponse.value.data : [];
      let projectID = projectIdFor(projects, {
        projectPath: workspace.projectPath,
        repoPath,
      });
      if (!projectID && sessionId) {
        projectID =
          (await client.session.get({ sessionID: sessionId }).catch(() => null))?.projectID ?? null;
      }
      if (!alive) return;
      setCatalog({ models, agents, isGit, baseBranch, projectID });
      setCatalogError(modelResponse.status === "rejected" ? errorText(modelResponse.reason) : null);
    })();
    return () => {
      alive = false;
    };
  }, [client, workspace.projectPath, workspace.branch, workspace.models, repoPath, sessionId]);

  const loadRunDetails = useCallback(
    async (run: RaceRun) => {
      if (!run.sessionId) return;
      const id = run.sessionId;
      const [info, diff, messages] = await Promise.allSettled([
        client.session.get({ sessionID: id }),
        client.session.diff({ sessionID: id }),
        client.message.list({ sessionID: id, limit: 10, order: "desc" }),
      ]);
      const session = info.status === "fulfilled" ? info.value : null;
      const changes =
        diff.status === "fulfilled"
          ? toChanges(
              diff.value.data.map((file) => ({
                file: file.file,
                additions: file.additions,
                deletions: file.deletions,
                status: file.status,
              })),
            )
          : undefined;
      const summary =
        messages.status === "fulfilled" ? runSummaryFromMessages(messages.value.data) : undefined;
      update((current) =>
        setRunDetails(current, run.id, {
          cost: session?.cost,
          tokens: session?.tokens,
          changes,
          summary,
        }),
      );
    },
    [client, update],
  );

  // Stream SSE: un evento terminal o de espera actualiza su corrida.
  const hasRace = race !== null;
  useEffect(() => {
    if (!hasRace) return;
    const abort = new AbortController();
    let alive = true;
    (async () => {
      try {
        for await (const event of client.event.subscribe({ signal: abort.signal })) {
          if (!alive) break;
          const current = raceRef.current;
          if (!current) continue;
          const data = (event.data ?? {}) as Record<string, unknown>;
          const eventSession = typeof data.sessionID === "string" ? data.sessionID : null;
          const run = eventSession
            ? current.runs.find((item) => item.sessionId === eventSession)
            : null;
          const next = applyRaceEvent(current, event, Date.now());
          if (next !== current) update(() => next);
          if (!run) continue;
          if (
            event.type === "session.idle" ||
            event.type === "session.execution.succeeded" ||
            event.type === "session.execution.failed" ||
            event.type === "session.execution.interrupted"
          ) {
            void loadRunDetails(run);
          }
        }
      } catch (err) {
        if (alive && !abort.signal.aborted) {
          setCatalogError(errorText(err));
        }
      }
    })();
    return () => {
      alive = false;
      abort.abort();
    };
  }, [client, hasRace, loadRunDetails, update]);

  // Al volver al workspace, reconcilia las corridas que siguieron sin nosotros.
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (reconciledRef.current) return;
    const current = raceRef.current;
    if (!current || !catalog) return;
    reconciledRef.current = true;
    void (async () => {
      for (const run of current.runs) {
        if (!run.sessionId) continue;
        if (run.status !== "running" && run.status !== "waiting" && run.status !== "preparing") {
          continue;
        }
        const info = await client.session.get({ sessionID: run.sessionId }).catch(() => null);
        if (!info) continue;
        if (info.outcome === "failed") {
          update((value) => failRun(value, run.id, "La ejecución falló", Date.now()));
          continue;
        }
        if (info.outcome === "interrupted") {
          update((value) => failRun(value, run.id, "La ejecución se interrumpió", Date.now()));
          continue;
        }
        if (info.outcome === "succeeded" || info.idle) {
          update((value) => finishRun(value, run.id, {}, Date.now()));
        }
        void loadRunDetails(run);
      }
    })();
  }, [catalog, client, loadRunDetails, update]);

  const launchRun = useCallback(
    async (
      created: Race,
      run: RaceRun,
      index: number,
      baseBranch: string | null,
      projectID: string | null,
      parent: string | null,
      agent: string | null,
    ) => {
      const runIsActive = () => {
        const current = raceRef.current?.runs.find((item) => item.id === run.id);
        return (
          current?.status === "preparing" ||
          current?.status === "running" ||
          current?.status === "waiting"
        );
      };
      const releaseOrphan = async (sessionID: string | null, directory: string | null) => {
        if (sessionID) {
          await client.session.remove({ sessionID }).catch(() => undefined);
        }
        if (directory && projectID) {
          await client.worktree
            .remove({ projectID, directory, force: true })
            .catch(() => undefined);
        }
      };
      let directory = workspace.projectPath;
      let worktree: string | null = null;
      let sessionID: string | null = null;
      try {
        if (created.useWorktrees && projectID && parent) {
          const result = await client.worktree.create({
            projectID,
            ...(baseBranch ? { branch: baseBranch } : {}),
            directory: parent,
            name: worktreeRunName(created.id, index),
          });
          directory = result.directory;
          worktree = result.directory;
          // La corrida pudo descartarse mientras se creaba el worktree.
          if (!runIsActive()) {
            await releaseOrphan(null, worktree);
            return;
          }
        }
        update((current) => prepareRun(current, run.id, { directory, worktree }));
        if (!runIsActive()) {
          await releaseOrphan(null, worktree);
          return;
        }
        const session = await client.session.create({
          location: { directory },
          title: `Carrera · ${run.model.name}`,
          agent,
          model: { id: run.model.id, providerID: run.model.providerID },
        });
        sessionID = session.id;
        if (!runIsActive()) {
          await releaseOrphan(sessionID, worktree);
          return;
        }
        update((current) => startRun(current, run.id, session.id, Date.now()));
        if (!runIsActive()) {
          await releaseOrphan(sessionID, worktree);
          return;
        }
        await client.session.prompt({ sessionID: session.id, text: created.prompt });
      } catch (err) {
        if (runIsActive()) {
          update((current) => failRun(current, run.id, errorText(err), Date.now()));
        } else {
          await releaseOrphan(sessionID, worktree);
        }
      }
    },
    [client, update, workspace.projectPath],
  );

  const startRace = useCallback(
    (input: StartRaceInput): string | null => {
      if (!catalog) return "El catálogo de modelos todavía no está listo.";
      if (input.modelKeys.length < 2) return "Elige al menos 2 modelos.";
      if (input.modelKeys.length > 5) return "Como mucho 5 modelos por carrera.";
      const models = input.modelKeys
        .map((key) => catalog.models.find((model) => model.key === key))
        .filter((model): model is ModelOption => Boolean(model));
      if (models.length !== input.modelKeys.length) return "Algún modelo ya no está disponible.";
      const useWorktrees = input.useWorktrees && catalog.isGit && catalog.projectID !== null;
      const parent =
        useWorktrees && worktreesRoot.trim()
          ? `${worktreesRoot.replace(/\/$/, "")}/${folderName(repoPath ?? workspace.projectPath)}`
          : null;
      const result = createRace({
        id: newRaceId(),
        workspaceId: workspace.id,
        prompt: input.prompt,
        agent: input.agent,
        useWorktrees: useWorktrees && parent !== null,
        bootId: APP_BOOT_ID,
        models: models.map(modelChoice),
        baseDirectory: workspace.projectPath,
        baseBranch: catalog.baseBranch ?? workspace.branch ?? null,
      });
      if ("error" in result) return result.error;
      const created = result.race;
      commit(created);
      setLaunchError(null);
      void Promise.all(
        created.runs.map((run, index) =>
          launchRun(
            created,
            run,
            index,
            catalog.baseBranch,
            catalog.projectID,
            parent,
            input.agent,
          ),
        ),
      );
      return null;
    },
    [
      catalog,
      commit,
      launchRun,
      worktreesRoot,
      repoPath,
      workspace.id,
      workspace.projectPath,
      workspace.branch,
    ],
  );

  const cleanupRun = useCallback(
    async (run: RaceRun, projectID: string | null, interrupt: boolean) => {
      const errors: string[] = [];
      if (interrupt && (run.status === "running" || run.status === "waiting") && run.sessionId) {
        await client.session.interrupt({ sessionID: run.sessionId }).catch((err: unknown) => {
          errors.push(`interrumpir: ${errorText(err)}`);
        });
      }
      if (run.sessionId) {
        await client.session.remove({ sessionID: run.sessionId }).catch((err: unknown) => {
          errors.push(`cerrar sesión: ${errorText(err)}`);
        });
      }
      if (run.worktree && projectID) {
        await client.worktree
          .remove({ projectID, directory: run.worktree, force: true })
          .catch((err: unknown) => {
            errors.push(`worktree: ${errorText(err)}`);
          });
      }
      update((current) =>
        markCleaned(current, run.id, errors.length > 0 ? errors.join(" · ") : null, Date.now()),
      );
    },
    [client, update],
  );

  const keepWinner = useCallback(
    async (runId: string) => {
      const current = raceRef.current;
      if (!current) return;
      const next = chooseWinner(current, runId, Date.now());
      if (next === current) return;
      update(() => next);
      const losers = runsNeedingCleanup(next);
      await Promise.all(losers.map((run) => cleanupRun(run, catalog?.projectID ?? null, true)));
    },
    [catalog?.projectID, cleanupRun, update],
  );

  const discard = useCallback(
    async (runId: string) => {
      const current = raceRef.current;
      if (!current) return;
      const next = discardRun(current, runId, Date.now());
      if (next === current) return;
      update(() => next);
      const run = next.runs.find((item) => item.id === runId);
      if (run) await cleanupRun(run, catalog?.projectID ?? null, true);
    },
    [catalog?.projectID, cleanupRun, update],
  );

  const clearRace = useCallback(async () => {
    const current = raceRef.current;
    if (!current) return;
    if (raceIsLive(current)) return;
    // Una carrera terminada puede dejar sesiones/worktrees sin limpiar (p. ej.
    // corridas fallidas o recuperadas tras cerrar la app): se liberan antes de
    // olvidarla, salvo la ganadora.
    await Promise.all(
      runsNeedingCleanup(current).map((run) => cleanupRun(run, catalog?.projectID ?? null, false)),
    );
    commit(null);
    setLaunchError(null);
  }, [catalog?.projectID, cleanupRun, commit]);

  return {
    race,
    models: catalog?.models ?? [],
    agents: catalog?.agents ?? [],
    isGit: catalog?.isGit ?? false,
    baseBranch: catalog?.baseBranch ?? null,
    projectID: catalog?.projectID ?? null,
    catalogError,
    launchError,
    hasLiveRace: race ? raceIsLive(race) : false,
    startRace,
    keepWinner,
    discard,
    clearRace,
    refreshDetails: loadRunDetails,
  };
}
