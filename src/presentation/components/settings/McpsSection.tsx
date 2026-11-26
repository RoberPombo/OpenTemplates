import { useState } from "react";
import { mcpStateLabel, type McpState } from "../../../domain/chat/mcp";
import type { McpInfo } from "../../../types";

/** Resumen legible de la config de un MCP: URL o comando. */
function mcpSummary(config: Record<string, unknown>) {
  if (typeof config.url === "string") return config.url;
  if (Array.isArray(config.command)) return config.command.join(" ");
  return "";
}

export function McpsSection({
  mcps,
  selected,
  statuses,
  onToggle,
}: {
  mcps: McpInfo[];
  selected: Set<string>;
  statuses: Record<string, string>;
  onToggle: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const filtered = mcps.filter((mcp) =>
    `${mcp.name} ${mcpSummary(mcp.config)} ${mcp.source}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const current = filtered.find((mcp) => mcp.name === selectedName) ?? filtered[0] ?? null;
  const active = current ? selected.has(current.name) : false;

  return (
    <div className="settings-split">
      <aside className="settings-list">
        <div className="settings-list-head">
          <div className="section-head">
            <h3>MCPs</h3>
            <span className="muted">{selected.size} activos</span>
          </div>
          <input
            className="text-input"
            value={query}
            placeholder="Buscar MCP"
            aria-label="Buscar MCP"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="settings-list-scroll">
          {mcps.length === 0 && (
            <p className="muted small-text settings-list-empty">
              No hay MCPs en la configuración global de opencode.
            </p>
          )}
          {filtered.map((mcp) => {
            const checked = selected.has(mcp.name);
            return (
              <label
                key={mcp.name}
                className={`settings-list-item ${current?.name === mcp.name ? "selected" : ""} ${checked ? "on" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  aria-label={mcp.name}
                  onChange={() => {
                    setSelectedName(mcp.name);
                    onToggle(mcp.name);
                  }}
                />
                <span className="settings-list-main">
                  <span className="settings-list-title">{mcp.name}</span>
                  <span className="settings-list-sub">{mcpSummary(mcp.config)}</span>
                </span>
              </label>
            );
          })}
        </div>
      </aside>
      <div className="settings-detail">
        {current ? (
          <>
            <div className="settings-detail-head">
              <div>
                <h3>{current.name}</h3>
                <p className="muted small-text">{current.source}</p>
              </div>
              <div className="row">
                {statuses[current.name] && (
                  <span className={`mcp-status ${statuses[current.name]}`}>
                    {mcpStateLabel(statuses[current.name] as McpState)}
                  </span>
                )}
                <span className={`tool-chip ${active ? "on" : ""}`}>
                  {active ? "activo" : "inactivo"}
                </span>
              </div>
            </div>
            <p className="settings-detail-text">
              {mcpSummary(current.config) || "Sin URL ni comando configurado."}
            </p>
            <div className="settings-meta-grid">
              <span>Origen</span>
              <strong>{current.source}</strong>
              <span>Configuración</span>
              <code>{JSON.stringify(current.config, null, 2)}</code>
            </div>
            <button className={active ? "ghost" : "primary"} onClick={() => onToggle(current.name)}>
              {active ? "Desactivar en este workspace" : "Activar en este workspace"}
            </button>
            <p className="muted small-text">
              Los cambios se guardan al pulsar Aplicar en este workspace.
            </p>
          </>
        ) : (
          <p className="muted">Selecciona un MCP para ver su detalle.</p>
        )}
      </div>
    </div>
  );
}
