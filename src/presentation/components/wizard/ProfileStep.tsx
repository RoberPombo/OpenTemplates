/** Paso 2 del wizard: perfil, alta rápida y selección de MCPs/skills. */
import type { Library, ProfileManifest, SkillRef } from "../../../types";
import { CheckboxRow } from "./chrome";

type Props = {
  profiles: ProfileManifest[];
  library: Library;
  profileId: string | null;
  quickOpen: boolean;
  quickName: string;
  quickDescription: string;
  quickSlug: string;
  savingProfile: boolean;
  selectedMcps: Set<string>;
  selectedSkills: Map<string, SkillRef>;
  onToggleQuickOpen: () => void;
  onQuickNameChange: (value: string) => void;
  onQuickDescriptionChange: (value: string) => void;
  onCreateQuickProfile: () => void;
  onSelectProfile: (id: string | null) => void;
  onToggleMcp: (name: string) => void;
  onToggleSkill: (skill: Library["skills"][number]) => void;
};

export function ProfileStep({
  profiles,
  library,
  profileId,
  quickOpen,
  quickName,
  quickDescription,
  quickSlug,
  savingProfile,
  selectedMcps,
  selectedSkills,
  onToggleQuickOpen,
  onQuickNameChange,
  onQuickDescriptionChange,
  onCreateQuickProfile,
  onSelectProfile,
  onToggleMcp,
  onToggleSkill,
}: Props) {
  return (
    <section className="wizard-pane">
      <div className="section-head">
        <h3>Perfil</h3>
        <button className="ghost small" onClick={onToggleQuickOpen}>
          {quickOpen ? "Cancelar" : "Crear perfil"}
        </button>
      </div>
      <p className="muted small-text">
        El perfil elige agentes, skills, MCPs, comandos y plugins de la biblioteca global. Se
        congela al crear el workspace.
      </p>

      {quickOpen && (
        <div className="quick-profile">
          <label className="field" htmlFor="wizard-quick-name">
            <span>Nombre</span>
            <input
              id="wizard-quick-name"
              className="text-input"
              value={quickName}
              placeholder="Backend, revisión, observabilidad…"
              onChange={(event) => onQuickNameChange(event.target.value)}
            />
          </label>
          <label className="field" htmlFor="wizard-quick-description">
            <span>Descripción</span>
            <input
              id="wizard-quick-description"
              className="text-input"
              value={quickDescription}
              placeholder="API, tests y revisión"
              onChange={(event) => onQuickDescriptionChange(event.target.value)}
            />
          </label>
          <div className="row">
            <span className="muted small-text">id: {quickSlug || "—"}</span>
            <button className="primary" onClick={onCreateQuickProfile} disabled={savingProfile}>
              {savingProfile ? "Guardando…" : "Crear y elegir"}
            </button>
          </div>
          <p className="muted small-text">
            Se crea con los MCPs y skills que has marcado. Podrás ajustar agentes, comandos y
            plugins en Ajustes → Perfiles.
          </p>
        </div>
      )}

      <div className="option-list">
        <button
          type="button"
          className={`option ${profileId === null ? "on" : ""}`}
          aria-label="Sin perfil"
          onClick={() => onSelectProfile(null)}
        >
          <span className="option-main">
            <span className="option-title">Sin perfil</span>
            <span className="option-sub">
              Elige MCPs y skills ahora; el resto hereda de la config global.
            </span>
          </span>
        </button>
        {profiles.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`option ${profileId === item.id ? "on" : ""}`}
            aria-label={item.name}
            onClick={() => onSelectProfile(item.id)}
          >
            <span className="option-main">
              <span className="option-title">
                {item.name}
                <span className="tool-chip">v{item.version}</span>
              </span>
              <span className="option-sub">{item.description || "Sin descripción"}</span>
              <span className="option-sub">
                {item.agents.length} agentes · {item.skills.length} skills · {item.mcps.length} MCPs
                · {item.commands.length} comandos · {item.plugins.length} plugins
              </span>
            </span>
          </button>
        ))}
      </div>

      {profileId === null && (
        <div className="pick-lists">
          <section>
            <div className="section-head">
              <h3>MCPs</h3>
              <span className="muted">{selectedMcps.size} elegidos</span>
            </div>
            <div className="check-list compact">
              {library.mcps.map((mcp) => (
                <CheckboxRow
                  key={mcp.name}
                  checked={selectedMcps.has(mcp.name)}
                  title={mcp.name}
                  subtitle={
                    typeof mcp.config.url === "string"
                      ? mcp.config.url
                      : Array.isArray(mcp.config.command)
                        ? mcp.config.command.join(" ")
                        : ""
                  }
                  onChange={() => onToggleMcp(mcp.name)}
                />
              ))}
              {library.mcps.length === 0 && (
                <p className="muted">No hay MCPs en la config global.</p>
              )}
            </div>
          </section>
          <section>
            <div className="section-head">
              <h3>Skills</h3>
              <span className="muted">{selectedSkills.size} elegidas</span>
            </div>
            <div className="check-list compact">
              {library.skills.map((skill) => (
                <CheckboxRow
                  key={skill.id}
                  checked={selectedSkills.has(skill.id)}
                  title={skill.name}
                  subtitle={skill.description}
                  onChange={() => onToggleSkill(skill)}
                />
              ))}
              {library.skills.length === 0 && <p className="muted">No se encontraron skills.</p>}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
