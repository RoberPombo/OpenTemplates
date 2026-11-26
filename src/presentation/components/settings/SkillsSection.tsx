import { useState } from "react";
import type { SkillInfo, SkillRef } from "../../../types";

export function SkillsSection({
  skills,
  selected,
  onToggle,
}: {
  skills: SkillInfo[];
  selected: Map<string, SkillRef>;
  onToggle: (skill: SkillInfo) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filtered = skills.filter((skill) =>
    `${skill.id} ${skill.name} ${skill.description} ${skill.source}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const current = filtered.find((skill) => skill.id === selectedId) ?? filtered[0] ?? null;
  const active = current ? selected.has(current.id) : false;

  return (
    <div className="settings-split">
      <aside className="settings-list">
        <div className="settings-list-head">
          <div className="section-head">
            <h3>Skills</h3>
            <span className="muted">{selected.size} activas</span>
          </div>
          <input
            className="text-input"
            value={query}
            placeholder="Buscar skill"
            aria-label="Buscar skill"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="settings-list-scroll">
          {filtered.length === 0 && (
            <p className="muted small-text settings-list-empty">No se encontraron skills.</p>
          )}
          {filtered.map((skill) => {
            const checked = selected.has(skill.id);
            return (
              <label
                key={skill.id}
                className={`settings-list-item ${current?.id === skill.id ? "selected" : ""} ${checked ? "on" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  aria-label={skill.name}
                  onChange={() => {
                    setSelectedId(skill.id);
                    onToggle(skill);
                  }}
                />
                <span className="settings-list-main">
                  <span className="settings-list-title">{skill.name}</span>
                  <span className="settings-list-sub">{skill.source}</span>
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
                <p className="muted small-text">{current.id}</p>
              </div>
              <span className={`tool-chip ${active ? "on" : ""}`}>
                {active ? "activa" : "inactiva"}
              </span>
            </div>
            <p className="settings-detail-text">
              {current.description || "Esta skill no trae descripción."}
            </p>
            <div className="settings-meta-grid">
              <span>Origen</span>
              <strong>{current.source}</strong>
              <span>Ruta</span>
              <code>{current.path}</code>
            </div>
            <button className={active ? "ghost" : "primary"} onClick={() => onToggle(current)}>
              {active ? "Desactivar en este workspace" : "Activar en este workspace"}
            </button>
            <p className="muted small-text">
              Los cambios se guardan al pulsar Aplicar en este workspace.
            </p>
          </>
        ) : (
          <p className="muted">Selecciona una skill para ver su detalle.</p>
        )}
      </div>
    </div>
  );
}
