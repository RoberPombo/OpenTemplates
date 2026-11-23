/**
 * Dock inferior de terminal del workspace: una pestaña por PTY, alta y cierre,
 * reconexión con ticket nuevo y aviso de terminal terminada. Cerrar el dock no
 * borra los PTYs; solo el cierre de pestaña o parar el workspace lo hacen.
 */
import type { TerminalGateway } from "../../domain/repositories/TerminalGateway";
import type { TerminalTab } from "../../domain/terminal/terminals";
import { useTerminal } from "../hooks/useTerminal";
import { Button } from "./ui";
import { TerminalPane } from "./TerminalPane";

type Props = {
  gateway: TerminalGateway;
  directory: string;
  onClose: () => void;
};

const stateLabel: Record<TerminalTab["state"], string> = {
  creating: "creando",
  connecting: "conectando",
  connected: "conectada",
  dropped: "caída",
  exited: "terminada",
};

export function TerminalDock({ gateway, directory, onClose }: Props) {
  const terminal = useTerminal({ gateway, directory });
  const active = terminal.tabs.find((tab) => tab.id === terminal.activeId) ?? null;

  return (
    <section className="terminal-dock" aria-label="Terminal del workspace">
      <header className="terminal-head">
        <div className="terminal-tabs" role="tablist" aria-label="Terminales del workspace">
          {terminal.tabs.map((tab) => {
            const selected = tab.id === terminal.activeId;
            return (
              <div key={tab.id} className={`terminal-tab ${selected ? "active" : ""} ${tab.state}`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  title={`${tab.title} · ${stateLabel[tab.state]}`}
                  onClick={() => terminal.selectTab(tab.id)}
                >
                  <span className={`terminal-dot ${tab.state}`} aria-hidden="true" />
                  <span className="terminal-tab-title">{tab.title}</span>
                </button>
                <button
                  type="button"
                  className="terminal-tab-close"
                  aria-label={`Cerrar ${tab.title}`}
                  title={`Cerrar ${tab.title} y terminar su proceso`}
                  onClick={() => void terminal.closeTab(tab.id)}
                >
                  ×
                </button>
              </div>
            );
          })}
          {terminal.creating && <output className="terminal-creating">Creando…</output>}
        </div>
        <div className="row terminal-actions">
          <Button
            onClick={() => void terminal.newTerminal()}
            disabled={terminal.creating}
            title="Abrir una terminal en la carpeta del proyecto"
          >
            Nueva
          </Button>
          <Button
            variant="icon"
            aria-label="Cerrar terminal"
            title="Cerrar el dock (la terminal sigue viva)"
            onClick={onClose}
          >
            ×
          </Button>
        </div>
      </header>

      {terminal.error && (
        <div className="inline-error terminal-error" role="alert">
          {terminal.error}
        </div>
      )}

      <div className="terminal-body">
        {terminal.loading && <p className="terminal-empty-text">Cargando terminales…</p>}

        {!terminal.loading && terminal.tabs.length === 0 && (
          <div className="terminal-empty">
            <p className="terminal-empty-text">
              No hay terminales en este workspace. Se abre una en la carpeta del proyecto, con el
              entorno aislado del workspace.
            </p>
            <Button variant="primary" onClick={() => void terminal.newTerminal()}>
              Nueva terminal
            </Button>
          </div>
        )}

        {active && (
          <TerminalPane
            key={active.id}
            tabId={active.id}
            getBuffer={terminal.getBuffer}
            subscribe={terminal.subscribe}
            onInput={terminal.send}
            onResize={terminal.resize}
          />
        )}

        {active?.state === "dropped" && (
          <output className="terminal-banner">
            <span>
              Conexión perdida{active.error ? `: ${active.error}` : ""}. La terminal sigue viva.
            </span>
            <Button onClick={() => terminal.reconnect(active.id)}>Reintentar</Button>
          </output>
        )}

        {active?.state === "exited" && (
          <output className="terminal-banner exited">
            <span>
              La terminal terminó
              {typeof active.exitCode === "number" ? ` con código ${active.exitCode}` : ""}.
            </span>
            <Button onClick={() => void terminal.closeTab(active.id)}>Cerrar pestaña</Button>
          </output>
        )}
      </div>
    </section>
  );
}
