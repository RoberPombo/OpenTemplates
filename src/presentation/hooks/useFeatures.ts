/**
 * Estado de features en la UI: carga, selección, arranque y provisioning.
 * El dominio decide el flujo; el hook solo orquesta los casos de uso.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { errorText } from "../../domain/shared";
import type { Feature } from "../../domain/features/model";
import type { FeatureArtifact, FeatureRunnerInfo } from "../../domain/features/coordinator";
import type { FeatureProvisionOutcome } from "../../domain/features/provision";
import {
  deletionError,
  deletionNotice,
  type FeatureDeletePreview,
} from "../../domain/features/deletion";

export function useFeatures(defaultProfileId: string | null = null) {
  const root = useAppContext();
  const [features, setFeatures] = useState<Feature[]>([]);
  // Ref con la última lista confirmada por el backend: dos acciones de pasos
  // seguidas no deben guardar una versión vieja de la feature.
  const featuresRef = useRef<Feature[]>([]);
  const [artifactsState, setArtifactsState] = useState<{
    id: string;
    items: FeatureArtifact[];
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [coordinatorState, setCoordinatorState] = useState<{
    id: string;
    info: FeatureRunnerInfo | null;
  } | null>(null);
  const [coordinatorBusy, setCoordinatorBusy] = useState(false);
  const [stepBusyId, setStepBusyId] = useState<string | null>(null);
  const [stepSessionState, setStepSessionState] = useState<{
    featureId: string;
    stepId: string;
    runner: FeatureRunnerInfo;
    open: boolean;
  } | null>(null);
  const stepLaunches = useRef(new Set<string>());
  const [deletion, setDeletion] = useState<{
    id: string;
    preview: FeatureDeletePreview;
    busy: boolean;
    error: string | null;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const items = await root.features.list();
        if (alive) {
          featuresRef.current = items;
          setFeatures(items);
        }
      } catch (err) {
        if (alive) setError(errorText(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [root]);

  const selected = useMemo(
    () => features.find((feature) => feature.id === selectedId) ?? null,
    [features, selectedId],
  );
  // Los datos del coordinador y de los artefactos pertenecen a la feature
  // seleccionada: si cambia la selección se ignoran en render, sin un reset
  // intermedio desde un efecto.
  const coordinator =
    coordinatorState && coordinatorState.id === selectedId ? coordinatorState.info : null;
  const artifacts = artifactsState && artifactsState.id === selectedId ? artifactsState.items : [];
  const stepSession =
    stepSessionState && stepSessionState.featureId === selectedId ? stepSessionState : null;

  useEffect(() => {
    if (!selectedId) return;
    const id = selectedId;
    let alive = true;
    root.features
      .runnerStatus(id)
      .then((info) => {
        if (alive) setCoordinatorState({ id, info });
        return undefined;
      })
      .catch(() => {
        if (alive) setCoordinatorState({ id, info: null });
      });
    return () => {
      alive = false;
    };
  }, [selectedId, root]);

  useEffect(() => {
    if (!selectedId) return;
    const id = selectedId;
    let alive = true;
    root.features
      .artifacts(id)
      .then((items) => {
        if (alive) setArtifactsState({ id, items });
        return undefined;
      })
      .catch(() => {
        if (alive) setArtifactsState({ id, items: [] });
      });
    return () => {
      alive = false;
    };
  }, [selectedId, root]);

  const reloadArtifacts = useCallback(
    async (id: string) => {
      try {
        setArtifactsState({ id, items: await root.features.artifacts(id) });
      } catch {
        setArtifactsState({ id, items: [] });
      }
    },
    [root],
  );

  const reloadSelectedArtifacts = useCallback(async () => {
    if (selectedId) await reloadArtifacts(selectedId);
  }, [selectedId, reloadArtifacts]);

  const upsert = useCallback((feature: Feature) => {
    const prev = featuresRef.current;
    const index = prev.findIndex((item) => item.id === feature.id);
    const next =
      index < 0
        ? [...prev, feature]
        : prev.map((item) => (item.id === feature.id ? feature : item));
    featuresRef.current = next;
    setFeatures(next);
  }, []);

  const start = useCallback(
    async (draft: Feature): Promise<Feature> => {
      setError(null);
      const saved = await root.provideStartFeature().execute(draft);
      upsert(saved);
      setSelectedId(saved.id);
      return saved;
    },
    [root, upsert],
  );

  const provision = useCallback(
    async (id: string): Promise<FeatureProvisionOutcome> => {
      setBusyId(id);
      setError(null);
      setNotice(null);
      try {
        const outcome = await root.features.provision(id);
        upsert(outcome.feature);
        await reloadArtifacts(id);
        if (outcome.blocked) {
          setError(outcome.errors.join(" "));
        } else {
          const avisos =
            outcome.warnings.length > 0 ? ` · ${outcome.warnings.length} aviso(s)` : "";
          setNotice(`Worktrees listos${avisos}.`);
        }
        return outcome;
      } catch (err: unknown) {
        setError(errorText(err));
        throw err;
      } finally {
        setBusyId(null);
      }
    },
    [root, upsert, reloadArtifacts],
  );

  const launchCoordinator = useCallback(
    async (id: string, profileId: string | null) => {
      const feature = featuresRef.current.find((item) => item.id === id);
      if (!feature) throw new Error("La feature no existe.");
      setCoordinatorBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await root.provideLaunchCoordinator().execute(feature, profileId);
        upsert(result.feature);
        setCoordinatorState({ id, info: result.runner });
        setNotice(
          result.runner.warnings.length > 0
            ? `Coordinador listo · ${result.runner.warnings.length} aviso(s).`
            : "Coordinador listo.",
        );
        return result;
      } catch (err: unknown) {
        setError(errorText(err));
        throw err;
      } finally {
        setCoordinatorBusy(false);
      }
    },
    [root, upsert],
  );

  const stopCoordinator = useCallback(
    async (id: string) => {
      setCoordinatorBusy(true);
      setError(null);
      try {
        await root.features.stopRunner(id);
        setCoordinatorState({ id, info: null });
        setNotice("Coordinador parado. La sesión queda guardada.");
      } catch (err: unknown) {
        setError(errorText(err));
      } finally {
        setCoordinatorBusy(false);
      }
    },
    [root],
  );

  const approveDecomposition = useCallback(
    async (id: string, content: string) => {
      const feature = featuresRef.current.find((item) => item.id === id);
      if (!feature) throw new Error("La feature no existe.");
      setError(null);
      setNotice(null);
      try {
        const result = await root.provideApproveDecomposition().execute(feature, content);
        upsert(result.feature);
        await reloadArtifacts(id);
        setNotice(
          result.addedTargets > 0
            ? `Descomposición aprobada · ${result.addedTargets} target(s) nuevos.`
            : "Descomposición aprobada y pasos refrescados.",
        );
        return result;
      } catch (err: unknown) {
        setError(errorText(err));
        throw err;
      }
    },
    [root, upsert, reloadArtifacts],
  );

  const launchStep = useCallback(
    async (id: string, stepId: string, profileId: string | null = null) => {
      const feature = featuresRef.current.find((item) => item.id === id);
      if (!feature) throw new Error("La feature no existe.");
      const inFlight = `${id}:${stepId}`;
      if (stepLaunches.current.has(inFlight)) return null;
      stepLaunches.current.add(inFlight);
      setStepBusyId(stepId);
      setError(null);
      setNotice(null);
      try {
        const existed = Boolean(feature.steps.find((step) => step.id === stepId)?.sessionId);
        const result = await root
          .provideLaunchStep()
          .execute(feature, stepId, profileId, defaultProfileId);
        upsert(result.feature);
        setStepSessionState({
          featureId: id,
          stepId,
          runner: result.runner,
          open: true,
        });
        setNotice(
          existed
            ? result.runner.warnings.length > 0
              ? `Sesión abierta · ${result.runner.warnings[0]}`
              : "Sesión del paso abierta."
            : "Paso lanzado.",
        );
        return result;
      } catch (err: unknown) {
        setError(errorText(err));
        throw err;
      } finally {
        stepLaunches.current.delete(inFlight);
        setStepBusyId(null);
      }
    },
    [root, upsert, defaultProfileId],
  );

  const finishStep = useCallback(
    async (id: string, stepId: string) => {
      const feature = featuresRef.current.find((item) => item.id === id);
      if (!feature) throw new Error("La feature no existe.");
      setStepBusyId(stepId);
      setError(null);
      setNotice(null);
      try {
        const saved = await root.provideAdvanceStep().execute(feature, stepId, "finish");
        upsert(saved);
        setNotice("Paso en revisión.");
        return saved;
      } catch (err: unknown) {
        setError(errorText(err));
        throw err;
      } finally {
        setStepBusyId(null);
      }
    },
    [root, upsert],
  );

  const approveStep = useCallback(
    async (id: string, stepId: string) => {
      const feature = featuresRef.current.find((item) => item.id === id);
      if (!feature) throw new Error("La feature no existe.");
      setStepBusyId(stepId);
      setError(null);
      setNotice(null);
      try {
        const saved = await root.provideAdvanceStep().execute(feature, stepId, "approve");
        upsert(saved);
        setNotice("Paso aprobado.");
        return saved;
      } catch (err: unknown) {
        setError(errorText(err));
        throw err;
      } finally {
        setStepBusyId(null);
      }
    },
    [root, upsert],
  );

  const closeStepChat = useCallback(() => {
    setStepSessionState((current) => (current ? { ...current, open: false } : current));
  }, []);

  const saveArtifact = useCallback(
    async (name: string, content: string): Promise<FeatureArtifact> => {
      if (!selectedId) throw new Error("No hay una feature seleccionada.");
      const saved = await root.features.writeArtifact(selectedId, name, content);
      setArtifactsState((prev) => {
        const items = prev?.id === selectedId ? prev.items : [];
        const index = items.findIndex((item) => item.name === saved.name);
        const next =
          index < 0 ? [...items, saved] : items.map((item, i) => (i === index ? saved : item));
        return { id: selectedId, items: next };
      });
      return saved;
    },
    [root, selectedId],
  );

  /** Pide el plan de borrado y abre el diálogo de confirmación. */
  const requestDelete = useCallback(
    async (id: string) => {
      setError(null);
      setNotice(null);
      try {
        const preview = await root.provideDeleteFeature().preview(id);
        setDeletion({ id, preview, busy: false, error: null });
      } catch (err: unknown) {
        setError(errorText(err));
      }
    },
    [root],
  );

  const confirmDelete = useCallback(
    async (forceDirty: boolean) => {
      if (!deletion) return null;
      const id = deletion.id;
      setDeletion((current) =>
        current && current.id === id ? { ...current, busy: true, error: null } : current,
      );
      try {
        const outcome = await root.provideDeleteFeature().execute(id, forceDirty);
        if (outcome.featureDeleted) {
          const next = featuresRef.current.filter((item) => item.id !== id);
          featuresRef.current = next;
          setFeatures(next);
          if (selectedId === id) setSelectedId(null);
          setDeletion(null);
          setNotice(deletionNotice(outcome));
          return outcome;
        }
        // Fallo parcial: se conserva la feature y se refresca lo que queda.
        let preview = deletion.preview;
        try {
          preview = await root.provideDeleteFeature().preview(id);
        } catch {
          // La preview vieja sigue sirviendo para reintentar.
        }
        setDeletion({ id, preview, busy: false, error: deletionError(outcome) });
        return outcome;
      } catch (err: unknown) {
        setDeletion((current) =>
          current && current.id === id
            ? { ...current, busy: false, error: errorText(err) }
            : current,
        );
        return null;
      }
    },
    [deletion, root, selectedId],
  );

  const cancelDelete = useCallback(() => {
    setDeletion((current) => (current && !current.busy ? null : current));
  }, []);

  return {
    features,
    selected,
    selectedId,
    artifacts,
    select: setSelectedId,
    clearSelection: () => setSelectedId(null),
    reloadArtifacts: reloadSelectedArtifacts,
    start,
    provision,
    launchCoordinator,
    stopCoordinator,
    approveDecomposition,
    coordinator,
    coordinatorBusy,
    stepBusyId,
    stepSession,
    launchStep,
    finishStep,
    approveStep,
    closeStepChat,
    saveArtifact,
    deletion,
    requestDelete,
    confirmDelete,
    cancelDelete,
    busyId,
    notice,
    error,
    setNotice,
    setError,
  };
}
