/**
 * Confirmación del borrado real de una feature: lista los worktrees y ramas del
 * plan de Rust, avisa de los cambios sin commitear y exige marcarlos para
 * continuar. La limpieza y sus protecciones las decide el backend.
 */
// oxlint-disable jsx-a11y/prefer-tag-over-role -- mismo patrón de modal que el resto de diálogos; Escape se gestiona en el contenedor.
import { useMemo, useState } from "react";
import { useDialogDismiss } from "../hooks/useDialogDismiss";
import {
  branchStatusLabel,
  canConfirmDeletion,
  dirtyWorktrees,
  type FeatureDeletePreview,
} from "../../domain/features/deletion";

type Props = {
  preview: FeatureDeletePreview;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (forceDirty: boolean) => void;
};

export function DeleteFeatureDialog({ preview, busy, error, onCancel, onConfirm }: Props) {
  const dismiss = useDialogDismiss(() => {
    if (!busy) onCancel();
  });
  const dirty = useMemo(() => dirtyWorktrees(preview), [preview]);
  const [forceDirty, setForceDirty] = useState(false);
  const canDelete = canConfirmDeletion(preview, forceDirty);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <dialog
        open
        className="modal delete-feature-dialog"
        aria-modal="true"
        aria-labelledby="delete-feature-title"
        onKeyDown={dismiss}
      >
        <header className="modal-head">
          <div>
            <h2 id="delete-feature-title">Eliminar «{preview.name}»</h2>
            <p className="muted small-text">
              Se quitarán sus worktrees y se borrarán las ramas locales que creó. Las ramas base,
              publicadas en origin o en uso por otro worktree se conservan.
            </p>
          </div>
          <button
            type="button"
            className="ghost"
            aria-label="Cerrar"
            onClick={onCancel}
            disabled={busy}
          >
            ×
          </button>
        </header>

        <div className="modal-body delete-feature-body">
          {preview.worktrees.length === 0 ? (
            <p className="muted">Esta feature no tiene worktrees ni ramas que limpiar.</p>
          ) : (
            <ul className="delete-feature-list">
              {preview.worktrees.map((entry, index) => (
                <li
                  className="delete-feature-entry"
                  key={`${entry.repoPath}:${entry.branch}:${entry.path}:${index}`}
                >
                  <div className="delete-feature-entry-head">
                    <strong>{entry.name}</strong>
                    <span className="muted small-text">
                      {entry.role === "root" ? "raíz" : "target"}
                    </span>
                  </div>
                  <code className="feature-path">{entry.path}</code>
                  <div className="delete-feature-branch">
                    <span>
                      rama <code>{entry.branch}</code>
                    </span>
                    <span className={entry.protectReason ? "muted small-text" : "danger-text"}>
                      {branchStatusLabel(entry)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="delete-feature-warning">
            También se borrará la carpeta de la feature, con su <code>BRIEF.md</code>, planes y
            locks del runner.
          </p>

          {dirty.length > 0 && (
            <div className="delete-feature-dirty" role="alert">
              <strong>Hay cambios sin commitear.</strong>
              <ul>
                {dirty.map((entry) => (
                  <li key={entry.path}>
                    <code>{entry.path}</code>
                  </li>
                ))}
              </ul>
              <label className="delete-feature-force">
                <input
                  type="checkbox"
                  checked={forceDirty}
                  disabled={busy}
                  onChange={(event) => setForceDirty(event.target.checked)}
                />
                Eliminar también los cambios sin commitear
              </label>
            </div>
          )}

          {preview.warnings.length > 0 && (
            <ul className="delete-feature-notes muted small-text">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
        </div>

        <footer className="modal-foot">
          <button type="button" className="ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => onConfirm(forceDirty)}
            disabled={busy || !canDelete}
          >
            {busy ? "Eliminando…" : "Eliminar feature"}
          </button>
        </footer>
      </dialog>
    </div>
  );
}
