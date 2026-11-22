import type { UpdateInfo } from "../../domain/repositories/UpdateGateway";
import { Button } from "./ui";

interface Props {
  update: UpdateInfo;
  installing: boolean;
  installed: boolean;
  error: string | null;
  onInstall: () => void;
  onRestart: () => void;
  onDismiss: () => void;
}

/** Aviso de versión nueva, una vez por arranque. */
export function UpdateDialog({
  update,
  installing,
  installed,
  error,
  onInstall,
  onRestart,
  onDismiss,
}: Props) {
  return (
    <div className="modal-backdrop">
      <dialog className="modal update" open aria-labelledby="update-title">
        <header className="modal-head">
          <div>
            <h2 id="update-title">Nueva versión disponible</h2>
            <p className="muted small-text">OpenTemplates {update.version}</p>
          </div>
        </header>

        <div className="modal-body">
          {installed ? (
            <p>Actualización instalada. Reinicia la aplicación para usarla.</p>
          ) : (
            <>
              <p>
                Tienes la <strong>{update.currentVersion}</strong> y hay una nueva versión{" "}
                <strong>{update.version}</strong>.
              </p>
              {update.notes && <p className="muted small-text">{update.notes}</p>}
              {error && <p className="danger-text small-text">{error}</p>}
            </>
          )}
        </div>

        <footer className="modal-foot">
          <span className="muted small-text">
            {installing ? "Descargando…" : installed ? "Listo para reiniciar" : "Puedes aplazarlo"}
          </span>
          <span className="row">
            {installed ? (
              <Button variant="primary" onClick={onRestart}>
                Reiniciar ahora
              </Button>
            ) : (
              <Button variant="primary" onClick={onInstall} disabled={installing}>
                {installing ? "Actualizando…" : "Actualizar ahora"}
              </Button>
            )}
            <Button variant="ghost" onClick={onDismiss} disabled={installing}>
              Más tarde
            </Button>
          </span>
        </footer>
      </dialog>
    </div>
  );
}
