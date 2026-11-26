/**
 * Estado de features en la UI: carga, selección, arranque y provisioning.
 * El dominio decide el flujo; el hook solo orquesta los casos de uso.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { errorText } from "../../domain/shared";
import type { Feature } from "../../domain/features/model";
import type { FeatureArtifact, FeatureRunnerInfo } from "../../domain/features/coordinator";
import type { FeatureProvisionOutcome } from "../../domain/features/provision";

export function useFeatures() {
  const root = useAppContext();
  const [features, setFeatures] = useState<Feature[]>([]);
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
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const items = await root.features.list();
        if (alive) setFeatures(items);
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
    setFeatures((prev) => {
      const index = prev.findIndex((item) => item.id === feature.id);
      if (index < 0) return [...prev, feature];
      const next = [...prev];
      next[index] = feature;
      return next;
    });
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
      const feature = features.find((item) => item.id === id);
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
    [root, features, upsert],
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
      const feature = features.find((item) => item.id === id);
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
    [root, features, upsert, reloadArtifacts],
  );

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

  const remove = useCallback(
    async (id: string): Promise<void> => {
      const feature = features.find((item) => item.id === id);
      const ok = root.confirm.confirm(
        `¿Quitar la feature «${feature?.name ?? id}» del listado? Los worktrees no se tocan todavía.`,
      );
      if (!ok) return;
      setError(null);
      await root.features.remove(id);
      setFeatures((prev) => prev.filter((item) => item.id !== id));
      if (selectedId === id) setSelectedId(null);
    },
    [root, features, selectedId],
  );

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
    saveArtifact,
    remove,
    busyId,
    notice,
    error,
    setNotice,
    setError,
  };
}
