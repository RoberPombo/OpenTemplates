/**
 * Panel del coordinador: muestra el encargo que recibirá la sesión y deja
 * editar la descomposición. Sin React en el dominio: las plantillas vienen de
 * `domain/features/coordinator`.
 */
import { useEffect, useState } from "react";
import type { Feature } from "../../domain/features/model";
import {
  BRIEF_FILE,
  DECOMPOSITION_FILE,
  coordinatorPrompt,
  decompositionTemplate,
  type FeatureArtifact,
} from "../../domain/features/coordinator";

type Props = {
  feature: Feature;
  artifacts: FeatureArtifact[];
  onSave: (name: string, content: string) => Promise<unknown>;
};

export function CoordinatorPanel({ feature, artifacts, onSave }: Props) {
  const prompt = coordinatorPrompt(feature);
  const brief = artifacts.find((item) => item.name === BRIEF_FILE);
  const saved = artifacts.find((item) => item.name === DECOMPOSITION_FILE);
  const [draft, setDraft] = useState(saved?.content ?? decompositionTemplate(feature));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(saved?.content ?? decompositionTemplate(feature));
    setNotice(null);
    setError(null);
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

  return (
    <section className="feature-panel coordinator-panel">
      <div className="section-head">
        <h3>Coordinador</h3>
        <span className="muted small-text">alcance y plan por scope</span>
      </div>

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
        <button className="primary" disabled={saving} onClick={() => void save()}>
          {saving ? "Guardando…" : "Guardar descomposición"}
        </button>
        {notice && <span className="muted small-text">{notice}</span>}
        {error && <span className="danger-text small-text">{error}</span>}
      </div>
    </section>
  );
}
