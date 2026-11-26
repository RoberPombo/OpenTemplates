/**
 * Panel del coordinador: lanza la sesión sobre la raíz de la feature, muestra
 * su chat y actúa como gate de la descomposición. La validación de la propuesta
 * es de dominio; aquí solo se recoge la acción del usuario.
 */
import { useEffect, useState } from "react";
import type { Feature } from "../../domain/features/model";
import type { ProfileManifest } from "../../types";
import {
  BRIEF_FILE,
  DECOMPOSITION_FILE,
  coordinatorProfileId,
  coordinatorPrompt,
  decompositionTemplate,
  type FeatureArtifact,
  type FeatureRunnerInfo,
} from "../../domain/features/coordinator";
import { CoordinatorChat } from "./CoordinatorChat";

type Props = {
  feature: Feature;
  artifacts: FeatureArtifact[];
  profiles: ProfileManifest[];
  defaultProfileId?: string | null;
  runner: FeatureRunnerInfo | null;
  coordinatorBusy: boolean;
  onSave: (name: string, content: string) => Promise<unknown>;
  onReloadArtifacts: () => Promise<unknown>;
  onLaunch: (profileId: string | null) => Promise<unknown>;
  onStop: () => Promise<unknown>;
  onApprove: (content: string) => Promise<unknown>;
};

export function CoordinatorPanel({
  feature,
  artifacts,
  profiles,
  defaultProfileId,
  runner,
  coordinatorBusy,
  onSave,
  onReloadArtifacts,
  onLaunch,
  onStop,
  onApprove,
}: Props) {
  const prompt = coordinatorPrompt(feature);
  const brief = artifacts.find((item) => item.name === BRIEF_FILE);
  const saved = artifacts.find((item) => item.name === DECOMPOSITION_FILE);
  const coordinate = feature.steps.find((step) => step.type === "coordinate");
  const sessionId = coordinate?.sessionId ?? null;
  const [draft, setDraft] = useState(saved?.content ?? decompositionTemplate(feature));
  const defaultProfileForFeature = coordinatorProfileId(feature, profiles, defaultProfileId);
  const [profileOverride, setProfileOverride] = useState<{
    featureId: string;
    id: string | null;
  } | null>(null);
  // La elección del usuario vale solo para la feature actual; al cambiar de
  // feature se vuelve al perfil por defecto sin un efecto de reset.
  const profileId =
    profileOverride && profileOverride.featureId === feature.id
      ? profileOverride.id
      : defaultProfileForFeature;
  const [chatOpen, setChatOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // La descomposición guardada o la feature cambian la fuente del borrador:
    // hay que descartar lo escrito y los avisos de la versión anterior. No es
    // derivable porque el textarea conserva ediciones del usuario; `feature` se
    // identifica por su id (el objeto cambia en cada refresco).
    // oxlint-disable-next-line react/set-state-in-effect, react/exhaustive-effect-dependencies -- reset del borrador al cambiar de feature/artefacto
    setDraft(saved?.content ?? decompositionTemplate(feature));
    setNotice(null);
    setError(null);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- reset por feature/artefacto
  }, [feature.id, saved?.content]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave(DECOMPOSITION_FILE, draft);
      setNotice("Descomposición guardada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function launch() {
    setError(null);
    setNotice(null);
    try {
      await onLaunch(profileId);
      setChatOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function approve() {
    setApproving(true);
    setError(null);
    setNotice(null);
    try {
      await onApprove(draft);
      setNotice("Descomposición aprobada y pasos actualizados.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApproving(false);
    }
  }

  if (!prompt) {
    return (
      <section className="feature-panel">
        <div className="section-head">
          <h3>Coordinador</h3>
        </div>
        <p className="muted">
          Flujo rápido: no hay coordinador ni plan. El encargo va directo a la sesión que ejecuta.
        </p>
      </section>
    );
  }

  const ready = feature.status !== "draft";
  const running = Boolean(runner);

  return (
    <section className="feature-panel coordinator-panel">
      <div className="section-head">
        <h3>Coordinador</h3>
        <span className={`feature-badge ${running ? "status-running" : "muted"}`}>
          {running ? "servidor vivo" : sessionId ? "sesión guardada" : "sin sesión"}
        </span>
      </div>

      <div className="coordinator-controls">
        <label className="field coordinator-profile">
          <span>Perfil</span>
          <select
            className="text-input"
            value={profileId ?? ""}
            disabled={Boolean(sessionId) || profiles.length === 0}
            title={
              sessionId
                ? "La sesión conserva el perfil con el que se creó."
                : "Elige un perfil barato para coordinación."
            }
            onChange={(event) =>
              setProfileOverride({ featureId: feature.id, id: event.target.value || null })
            }
          >
            {profiles.length === 0 && <option value="">Sin perfiles</option>}
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
                {profile.model ? ` · ${profile.model}` : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="row coordinator-actions">
          <button
            className="primary"
            disabled={coordinatorBusy || !ready || profiles.length === 0}
            onClick={() => void launch()}
          >
            {coordinatorBusy ? "Abriendo…" : sessionId ? "Abrir coordinador" : "Lanzar coordinador"}
          </button>
          {running && (
            <button className="ghost" disabled={coordinatorBusy} onClick={() => void onStop()}>
              Parar
            </button>
          )}
          {sessionId && running && (
            <button className="ghost" onClick={() => setChatOpen((open) => !open)}>
              {chatOpen ? "Ocultar chat" : "Ver chat"}
            </button>
          )}
          <button className="ghost small" onClick={() => void onReloadArtifacts()}>
            Recargar artefactos
          </button>
        </div>
        {!ready && <span className="muted small-text">Prepara los worktrees antes de lanzar.</span>}
        {ready && profiles.length === 0 && (
          <span className="muted small-text">
            Crea un perfil de coordinador en Ajustes → Perfiles.
          </span>
        )}
        {sessionId && (
          <span className="muted small-text coordinator-session">Sesión {sessionId}</span>
        )}
      </div>

      {chatOpen && runner && sessionId && (
        <CoordinatorChat feature={feature} runner={runner} sessionId={sessionId} />
      )}

      <details className="coordinator-details">
        <summary>Encargo de la sesión</summary>
        <pre className="coordinator-prompt">{prompt}</pre>
        <button
          className="ghost small"
          onClick={() => {
            void navigator.clipboard?.writeText(prompt);
            setNotice("Encargo copiado.");
          }}
        >
          Copiar encargo
        </button>
      </details>

      {brief && (
        <details className="coordinator-details">
          <summary>{BRIEF_FILE}</summary>
          <pre className="coordinator-prompt">{brief.content}</pre>
        </details>
      )}

      <label className="field coordinator-editor">
        <span>Descomposición</span>
        <textarea
          className="text-input"
          rows={14}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setNotice(null);
          }}
        />
      </label>

      <div className="row coordinator-actions">
        <button className="primary" disabled={saving || approving} onClick={() => void save()}>
          {saving ? "Guardando…" : "Guardar descomposición"}
        </button>
        <button className="ghost" disabled={saving || approving} onClick={() => void approve()}>
          {approving ? "Aprobando…" : "Aprobar descomposición"}
        </button>
        {notice && <span className="muted small-text">{notice}</span>}
        {error && <span className="danger-text small-text">{error}</span>}
      </div>
    </section>
  );
}
