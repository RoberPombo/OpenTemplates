/**
 * Árbol de ficheros del workspace con carga perezosa: cada carpeta se pide a
 * `file.list` al abrirla y cada fichero a `file.read` al pulsarlo. No hay
 * dependencia de resaltado: el visor es texto plano a propósito.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { errorText } from "../../domain/shared";
import {
  fileDisplayName,
  sortFileEntries,
  type FileContent,
  type FileTreeEntry,
} from "../../domain/workspace/changes";
import type { ChatServer } from "../../domain/repositories/ChatGateway";
import type { Workspace } from "../../types";
type Props = {
  client: ChatServer;
  workspace: Workspace;
};
const ROOT = "";
function bytesLabel(bytes: number) {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
export function FilesPanel({ client, workspace }: Props) {
  const location = useMemo(() => ({ directory: workspace.projectPath }), [workspace.projectPath]);
  const [directories, setDirectories] = useState<Record<string, FileTreeEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingDir, setLoadingDir] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [content, setContent] = useState<FileContent | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setDirectories({});
    setExpanded(new Set());
    setOpenFile(null);
    setContent(null);
    setError(null);
    client.file
      .list({ location })
      .then((result) => {
        if (alive) setDirectories({ [ROOT]: sortFileEntries(result.data) });
      })
      .catch((err) => {
        if (alive) setError(errorText(err));
      });
    return () => {
      alive = false;
    };
  }, [client, location]);
  const loadDirectory = useCallback(
    async (path: string) => {
      setLoadingDir(path);
      setError(null);
      try {
        const result =
          path === ROOT
            ? await client.file.list({ location })
            : await client.file.list({ location, path });
        setDirectories((prev) => ({ ...prev, [path]: sortFileEntries(result.data) }));
      } catch (err) {
        setError(errorText(err));
      } finally {
        setLoadingDir(null);
      }
    },
    [client, location],
  );
  function toggleDirectory(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!directories[path]) void loadDirectory(path);
  }
  async function readFile(path: string) {
    setOpenFile(path);
    setContent(null);
    setReading(true);
    setError(null);
    try {
      const result = await client.file.read({ location, path });
      setContent(result.data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setReading(false);
    }
  }
  function renderEntries(parent: string, depth: number): ReactNode[] {
    const entries = directories[parent] ?? [];
    return entries.flatMap((entry) => {
      const name = fileDisplayName(entry.path);
      const isDirectory = entry.type === "directory";
      const isExpanded = expanded.has(entry.path);
      const row = (
        <button
          type="button"
          key={entry.path}
          className={`file-row ${openFile === entry.path ? "active" : ""}`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          title={entry.path}
          aria-label={
            isDirectory ? `${isExpanded ? "Contraer" : "Expandir"} ${name}` : `Abrir ${name}`
          }
          aria-expanded={isDirectory ? isExpanded : undefined}
          onClick={() => {
            if (isDirectory) toggleDirectory(entry.path);
            else void readFile(entry.path);
          }}
        >
          <span className="file-kind" aria-hidden="true">
            {isDirectory ? (isExpanded ? "▾" : "▸") : "·"}
          </span>
          <span className="file-name">{name}</span>
        </button>
      );
      if (!isDirectory) return [row];
      const children: ReactNode[] = isExpanded ? renderEntries(entry.path, depth + 1) : [];
      const spinner =
        loadingDir === entry.path ? (
          <div
            className="file-row file-loading"
            style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }}
            key={`${entry.path}:loading`}
          >
            Cargando…
          </div>
        ) : null;
      return spinner ? [row, spinner, ...children] : [row, ...children];
    });
  }
  return (
    <div className="files-panel">
      <div className="changes-toolbar">
        <span className="inspector-muted" title={workspace.projectPath}>
          {workspace.projectPath}
        </span>
        <button
          type="button"
          className="icon-button"
          title="Recargar árbol"
          aria-label="Recargar árbol"
          onClick={() => {
            setDirectories({});
            setExpanded(new Set());
            setOpenFile(null);
            setContent(null);
            void loadDirectory(ROOT);
          }}
        >
          ↻
        </button>
      </div>
      {error && <div className="inline-error small-text">{error}</div>}
      <div className="file-tree" role="tree" aria-label="Árbol de ficheros">
        {directories[ROOT] ? (
          renderEntries(ROOT, 0)
        ) : (
          <p className="inspector-empty">Cargando árbol…</p>
        )}
        {directories[ROOT]?.length === 0 && (
          <p className="inspector-empty">La carpeta del workspace está vacía.</p>
        )}
      </div>
      {openFile && (
        <section className="file-view" aria-label={`Contenido de ${openFile}`}>
          <header>
            <span className="change-name" title={openFile}>
              {fileDisplayName(openFile)}
            </span>
            {content && (
              <span className="inspector-muted">
                {content.kind === "binary" ? "binario" : "texto"} · {bytesLabel(content.bytes)}
              </span>
            )}
            <button
              type="button"
              className="icon-button"
              title="Cerrar fichero"
              aria-label="Cerrar fichero"
              onClick={() => {
                setOpenFile(null);
                setContent(null);
              }}
            >
              ×
            </button>
          </header>
          {reading && <p className="inspector-empty">Leyendo…</p>}
          {!reading && content?.kind === "binary" && (
            <p className="inspector-empty">
              Archivo binario ({bytesLabel(content.bytes)}); no se muestra su contenido.
            </p>
          )}
          {!reading && content?.kind === "text" && (
            <>
              {content.truncated && (
                <p className="callout info small-text">
                  Vista parcial: el fichero sigue después de {bytesLabel(content.bytes)}.
                </p>
              )}
              <pre className="file-content">{content.text}</pre>
            </>
          )}
        </section>
      )}
    </div>
  );
}
