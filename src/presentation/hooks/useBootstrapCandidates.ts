/**
 * Candidatos de bootstrap por repo para el alta de una feature. Cada repo
 * consulta sus candidatos por separado: un fallo o una respuesta tardía no
 * bloquea ni contamina a los demás.
 */
import { useEffect, useRef, useState } from "react";
import { errorText } from "../../domain/shared";
import type { BootstrapCandidate, BootstrapDetection, Repo } from "../../types";

export type RepoBootstrapState = {
  loading: boolean;
  candidates: BootstrapCandidate[];
  truncated: boolean;
  error: string | null;
};

export type BootstrapDetectionState = Record<string, RepoBootstrapState>;

const EMPTY: RepoBootstrapState = {
  loading: false,
  candidates: [],
  truncated: false,
  error: null,
};

export function useBootstrapCandidates(
  repos: Repo[],
  detect?: (repoId: string) => Promise<BootstrapDetection>,
): BootstrapDetectionState {
  const [states, setStates] = useState<BootstrapDetectionState>({});
  const detectRef = useRef(detect);
  const reposRef = useRef(repos);
  const key = repos.map((repo) => repo.id).join("|");

  useEffect(() => {
    detectRef.current = detect;
  }, [detect]);
  useEffect(() => {
    reposRef.current = repos;
  }, [repos]);

  useEffect(() => {
    const detector = detectRef.current;
    const ids = key ? key.split("|") : [];
    const list = reposRef.current.filter((repo) => ids.includes(repo.id));
    if (!detector || list.length === 0) {
      setStates({});
      return;
    }

    let alive = true;
    // oxlint-disable-next-line react/set-state-in-effect -- carga asíncrona de candidatos
    setStates(Object.fromEntries(list.map((repo) => [repo.id, { ...EMPTY, loading: true }])));

    for (const repo of list) {
      void detector(repo.id)
        .then((result) => {
          if (!alive) return;
          setStates((previous) => ({
            ...previous,
            [repo.id]: {
              loading: false,
              candidates: result.candidates,
              truncated: result.truncated,
              error: null,
            },
          }));
          return undefined;
        })
        .catch((error: unknown) => {
          if (!alive) return;
          setStates((previous) => ({
            ...previous,
            [repo.id]: { ...EMPTY, error: errorText(error) },
          }));
        });
    }

    return () => {
      alive = false;
    };
  }, [key]);

  return states;
}
