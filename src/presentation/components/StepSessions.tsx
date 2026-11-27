/**
 * Lista de pasos con su sesión: perfil resuelto, agente, lanzar o reabrir,
 * terminar y aprobar. La coordinación conserva su panel; aquí solo se informa.
 */
import { useState } from "react";
import type { Feature } from "../../domain/features/model";
import type { FeatureRunnerInfo } from "../../domain/features/coordinator";
import { resolveStepAgent, resolveStepProfile, canLaunchStep } from "../../domain/features/steps";
import { readySteps, stepLabel } from "../../domain/features/flow";
import type { ProfileManifest } from "../../types";
import { StepChat } from "./StepChat";

type Props = {
  feature: Feature;
  profiles: ProfileManifest[];
  defaultProfileId?: string | null;
  runner: FeatureRunnerInfo | null;
  openStepId: string | null;
  busyStepId: string | null;
  onLaunch: (stepId: string, profileId: string | null) => Promise<unknown>;
  onFinish: (stepId: string) => Promise<unknown>;
  onApprove: (stepId: string) => Promise<unknown>;
  onCloseChat: () => void;
};

const STEP_STATUS: Record<string, string> = {
  pending: "Pendiente",
  running: "En marcha",
  "awaiting-review": "Revisión",
  done: "Hecho",
  failed: "Fallido",
  skipped: "Omitido",
};

export function StepSessions({
  feature,
  profiles,
  defaultProfileId,
  runner,
  openStepId,
  busyStepId,
  onLaunch,
  onFinish,
  onApprove,
  onCloseChat,
}: Props) {
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const ready = new Set(readySteps(feature).map((step) => step.id));
  const openStep = feature.steps.find((step) => step.id === openStepId) ?? null;

  function profileFor(stepId: string): string | null {
    const step = feature.steps.find((item) => item.id === stepId);
    if (!step) return null;
    return resolveStepProfile(step, profiles, defaultProfileId, overrides[stepId] ?? null);
  }

  function manifestFor(stepId: string): ProfileManifest | null {
    const profileId = profileFor(stepId);
    return profiles.find((profile) => profile.id === profileId) ?? null;
  }

  return (
    <>
      <ol className="feature-steps">
        {feature.steps.map((step) => {
          const label = stepLabel(feature, step);
          const profileId = profileFor(step.id);
          const profile = manifestFor(step.id);
          const agentId = resolveStepAgent(step, profile);
          const launch = canLaunchStep(feature, step.id);
          const isReady = ready.has(step.id);
          const isCoordinate = step.type === "coordinate";
          const busy = busyStepId !== null;
          const myBusy = busyStepId === step.id;
          return (
            <li key={step.id} className={`feature-step ${step.status} ${isReady ? "ready" : ""}`}>
              <span className={`step-dot ${step.status}`} />
              <span className="step-label">{label}</span>
              {isReady && <span className="step-ready">siguiente</span>}
              <span className={`step-status ${step.status}`}>
                {STEP_STATUS[step.status] ?? step.status}
              </span>

              <span className="step-session-meta">
                {profile ? (
                  <span className="step-profile" title={profile.model ?? undefined}>
                    {profile.name}
                    {agentId ? ` · ${agentId}` : ""}
                  </span>
                ) : (
                  <span className="muted small-text">sin perfil</span>
                )}
                {step.sessionId && (
                  <span className="step-session-id" title={step.sessionId}>
                    {step.sessionId.slice(0, 8)}
                  </span>
                )}
              </span>

              <span className="step-actions">
                {isCoordinate ? (
                  <span className="muted small-text">en el panel del coordinador</span>
                ) : step.status === "pending" && step.sessionId ? (
                  <button
                    className="ghost small"
                    disabled={busy}
                    onClick={() => void onLaunch(step.id, profileId)}
                  >
                    {myBusy ? "Abriendo…" : "Reabrir sesión"}
                  </button>
                ) : step.status === "pending" && isReady && !step.sessionId ? (
                  <>
                    <select
                      className="text-input step-profile-select"
                      aria-label={`Perfil de ${label}`}
                      value={profileId ?? ""}
                      disabled={busy || profiles.length === 0 || Boolean(step.sessionId)}
                      onChange={(event) =>
                        setOverrides((current) => ({
                          ...current,
                          [step.id]: event.target.value || null,
                        }))
                      }
                    >
                      {profiles.length === 0 && <option value="">Sin perfiles</option>}
                      {profiles.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                          {item.model ? ` · ${item.model}` : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      className="primary small"
                      disabled={busy || profiles.length === 0}
                      onClick={() => void onLaunch(step.id, profileId)}
                    >
                      {myBusy ? "Abriendo…" : "Lanzar sesión"}
                    </button>
                  </>
                ) : step.status === "pending" && !step.sessionId ? (
                  <span className="muted small-text">
                    {launch && "error" in launch ? "esperando dependencias" : "no listo"}
                  </span>
                ) : step.status === "running" ? (
                  <>
                    {step.sessionId && (
                      <button
                        className="ghost small"
                        disabled={busy}
                        onClick={() => void onLaunch(step.id, profileId)}
                      >
                        {myBusy ? "Abriendo…" : openStepId === step.id ? "Ver chat" : "Abrir chat"}
                      </button>
                    )}
                    <button
                      className="ghost small"
                      disabled={busy || !step.sessionId}
                      onClick={() => void onFinish(step.id)}
                    >
                      Terminar paso
                    </button>
                  </>
                ) : step.status === "awaiting-review" ? (
                  <>
                    {step.sessionId && (
                      <button
                        className="ghost small"
                        disabled={busy}
                        onClick={() => void onLaunch(step.id, profileId)}
                      >
                        {myBusy ? "Abriendo…" : "Ver chat"}
                      </button>
                    )}
                    <button
                      className="primary small"
                      disabled={busy}
                      onClick={() => void onApprove(step.id)}
                    >
                      Aprobar y continuar
                    </button>
                  </>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>

      {openStep && runner && openStep.sessionId && (
        <div className="step-chat-wrap">
          <div className="section-head">
            <h4>{stepLabel(feature, openStep)}</h4>
            <button className="ghost small" onClick={onCloseChat}>
              Cerrar chat
            </button>
          </div>
          <StepChat
            feature={feature}
            step={openStep}
            runner={runner}
            sessionId={openStep.sessionId}
          />
        </div>
      )}
    </>
  );
}
