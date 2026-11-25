/**
 * Estado de features en la UI: carga, selección, arranque y provisioning.
 * El dominio decide el flujo; el hook solo orquesta los casos de uso.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { errorText } from "../../domain/shared";
import type { Feature } from "../../domain/features/model";
import type { FeatureProvisionOutcome } from "../../domain/features/provision";

export function useFeatures() {
  const root = useAppContext();
  const [features, setFeatures] = useState<Feature[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    root.features
      .list()
      .then((items) => {
        if (alive) setFeatures(items);
      })
      .catch((err: unknown) => {
        if (alive) setError(errorText(err));
      });
    return () => {
      alive = false;
    };
  }, [root]);

  const selected = useMemo(
    () => features.find((feature) => feature.id === selectedId) ?? null,
    [features, selectedId],
  );

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
        const outcome = await root.provideProvisionFeature().execute(id);
        upsert(outcome.feature);
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
    [root, upsert],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      const feature = features.find((item) => item.id === id);
      const ok = root.confirm.confirm(
        `¿Quitar la feature «${feature?.name ?? id}» del listado? Los worktrees no se tocan todavía.`,
      );
      if (!ok) return;
      setError(null);
      await root.provideDeleteFeature().execute(id);
      setFeatures((prev) => prev.filter((item) => item.id !== id));
      if (selectedId === id) setSelectedId(null);
    },
    [root, features, selectedId],
  );

  return {
    features,
    selected,
    selectedId,
    select: setSelectedId,
    clearSelection: () => setSelectedId(null),
    start,
    provision,
    remove,
    busyId,
    notice,
    error,
    setNotice,
    setError,
  };
}
