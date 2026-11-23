/**
 * Historial de sesiones del workspace: buscar, abrir, renombrar, duplicar,
 * exportar, importar y eliminar. La lista llega ya ordenada del hook; aquí solo
 * se filtra (estado de UI local).
 */
import { useState } from "react";
import { filterSessions, type SessionSummary } from "../../domain/chat/sessions";
import { formatRelativeTime } from "../../domain/shared";
import { useAppContext } from "../context/AppContext";
import { Button, TextInput } from "./ui";

type Props = {
  sessions: SessionSummary[];
  activeId: string | null;
  busy: boolean;
  error: string | null;
  notice?: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onNew: () => void;
  onClose: () => void;
  /** Exporta con saneado salvo que el usuario pida lo contrario. */
  onExport: (id: string, sanitize: boolean) => Promise<void>;
  onImport: () => Promise<void>;
  onFork: (id: string) => Promise<void>;
};

export function SessionsPanel({
  sessions,
  activeId,
  busy,
  error,
  notice,
  onSelect,
  onRename,
  onDelete,
  onNew,
  onClose,
  onExport,
  onImport,
  onFork,
}: Props) {
  const { confirm } = useAppContext();
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [includeRaw, setIncludeRaw] = useState(false);

  const visible = filterSessions(sessions, query);

  function startRename(session: SessionSummary) {
    setRenamingId(session.id);
    setDraft(session.title);
  }

  function commitRename() {
    const id = renamingId;
    const title = draft.trim();
    setRenamingId(null);
    if (id && title) void onRename(id, title);
  }

  async function remove(session: SessionSummary) {
    if (!confirm.confirm(`¿Eliminar la sesión «${session.title}»? No se puede deshacer.`)) return;
    await onDelete(session.id);
  }

  return (
    <aside className="sessions-panel" aria-label="Sesiones del workspace">
      <header className="sessions-head">
        <span>Sesiones</span>
        <span className="muted small-text">{sessions.length}</span>
        <Button
          variant="icon"
          size="small"
          title="Importar sesión"
          aria-label="Importar sesión"
          disabled={busy}
          onClick={() => void onImport()}
        >
          ⤒
        </Button>
        <Button
          variant="icon"
          size="small"
          title="Ocultar sesiones"
          aria-label="Ocultar sesiones"
          onClick={onClose}
        >
          ×
        </Button>
      </header>
      <div className="sessions-tools">
        <TextInput
          type="search"
          value={query}
          placeholder="Buscar sesiones…"
          aria-label="Buscar sesiones"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button size="small" onClick={onNew} disabled={busy}>
          Nueva
        </Button>
      </div>
      <label className="sessions-raw">
        <input
          type="checkbox"
          checked={includeRaw}
          onChange={(event) => setIncludeRaw(event.target.checked)}
        />
        <span title="Incluye rutas y credenciales tal cual: no compartas el archivo sin revisarlo">
          Exportar sin sanear
        </span>
      </label>
      {error && <p className="inline-error sessions-error">{error}</p>}
      {notice && <p className="sessions-notice">{notice}</p>}
      <ul className="session-list">
        {visible.map((session) => (
          <li key={session.id} className={`session-row ${session.id === activeId ? "active" : ""}`}>
            {renamingId === session.id ? (
              <TextInput
                className="session-rename"
                autoFocus
                value={draft}
                aria-label="Título de la sesión"
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitRename();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setRenamingId(null);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="session-open"
                title={session.title}
                disabled={busy && session.id !== activeId}
                onClick={() => onSelect(session.id)}
                onDoubleClick={() => startRename(session)}
              >
                <span className="session-title">{session.title}</span>
                <span className="session-meta">
                  {formatRelativeTime(session.updated)}
                  {session.cost > 0 ? ` · $${session.cost.toFixed(3)}` : ""}
                </span>
              </button>
            )}
            <div className="session-actions">
              <Button
                variant="icon"
                size="small"
                title="Duplicar sesión"
                aria-label={`Duplicar ${session.title}`}
                disabled={busy}
                onClick={() => void onFork(session.id)}
              >
                ⧉
              </Button>
              <Button
                variant="icon"
                size="small"
                title="Exportar sesión"
                aria-label={`Exportar ${session.title}`}
                disabled={busy}
                onClick={() => void onExport(session.id, !includeRaw)}
              >
                ⤓
              </Button>
              <Button
                variant="icon"
                size="small"
                title="Renombrar"
                aria-label={`Renombrar ${session.title}`}
                onClick={() => startRename(session)}
              >
                ✎
              </Button>
              <Button
                variant="icon"
                size="small"
                className="danger-text"
                title="Eliminar"
                aria-label={`Eliminar ${session.title}`}
                onClick={() => void remove(session)}
              >
                ×
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {visible.length === 0 && (
        <p className="muted small-text sessions-empty">
          {sessions.length === 0 ? "Aún no hay sesiones." : "Sin resultados."}
        </p>
      )}
    </aside>
  );
}
