import { useEffect, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { AppearanceSettings } from "./AppearanceSettings";
import { ShortcutsSettings } from "./ShortcutsSettings";
import { ProfilesSection, ReposSection, SystemSection } from "./SettingsLibrarySections";
import { McpsSection } from "./settings/McpsSection";
import { SkillsSection } from "./settings/SkillsSection";
import {
  APPLY_SECTIONS,
  NAV_GROUPS,
  NavIcon,
  isWorkspaceSection,
  type SettingsSectionId,
} from "./settings/navigation";
import { useWorkspaceSettingsForm } from "../hooks/useWorkspaceSettingsForm";
import { prefKeys } from "../../domain/repositories/Preferences";
import { NOTIFICATIONS_ON, notificationsEnabled } from "../../domain/chat/notifications";
import type { Library, ProfileManifest, Repo, Workspace } from "../../types";
import type { ChatGateway as WorkspaceClient } from "../../domain/repositories/ChatGateway";

export type { SettingsSectionId } from "./settings/navigation";

type Props = {
  workspace?: Workspace | null;
  client?: WorkspaceClient | null;
  onWorkspaceUpdated?: (workspace: Workspace, warnings: string[]) => void;
  repos: Repo[];
  profiles: ProfileManifest[];
  library: Library;
  workspaces: Workspace[];
  worktreesRoot: string;
  defaultProfileId?: string | null;
  onReposChanged: (repos: Repo[]) => void;
  onProfilesChanged: (profiles: ProfileManifest[]) => void;
  onWorktreesRootChanged: (root: string) => void;
  onClose: () => void;
  initialSection?: SettingsSectionId;
};

function SectionHead({
  title,
  meta,
  description,
}: {
  title: string;
  meta?: string;
  description?: string;
}) {
  return (
    <div className="settings-section-head">
      <div className="section-head">
        <h3>{title}</h3>
        {meta && <span className="muted">{meta}</span>}
      </div>
      {description && <p className="muted small-text">{description}</p>}
    </div>
  );
}

export function SettingsDialog({
  workspace,
  client,
  onWorkspaceUpdated,
  repos,
  profiles,
  library,
  workspaces,
  worktreesRoot,
  defaultProfileId,
  onReposChanged,
  onProfilesChanged,
  onWorktreesRootChanged,
  onClose,
  initialSection = "appearance",
}: Props) {
  const root = useAppContext();
  const [section, setSection] = useState<SettingsSectionId>(initialSection);
  const [navQuery, setNavQuery] = useState("");
  const [notifications, setNotifications] = useState(() =>
    notificationsEnabled(root.preferences.get(prefKeys.notifications)),
  );
  const [notificationError, setNotificationError] = useState<string | null>(null);

  const {
    mcps,
    skills,
    statuses,
    selectedMcps,
    selectedSkills,
    model,
    budgetText,
    budgetError,
    applying,
    reapplying,
    error,
    warnings,
    applied,
    changeModel,
    changeBudget,
    toggleMcp,
    toggleSkill,
    clearFeedback,
    apply,
    reapply,
  } = useWorkspaceSettingsForm({ workspace, client, onWorkspaceUpdated });

  useEffect(() => {
    if (!workspace && isWorkspaceSection(section)) setSection("appearance");
  }, [workspace, section]);

  async function toggleNotifications() {
    setNotificationError(null);
    if (notifications) {
      root.preferences.set(prefKeys.notifications, "0");
      setNotifications(false);
      return;
    }
    const permission = await root.notifications.requestPermission();
    if (permission === "denied") {
      setNotificationError(
        "El sistema denegó el permiso de notificaciones. Actívalo en los ajustes del sistema y vuelve a intentarlo.",
      );
      return;
    }
    root.preferences.set(prefKeys.notifications, NOTIFICATIONS_ON);
    setNotifications(true);
  }

  const query = navQuery.trim().toLowerCase();
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => (!group.workspaceOnly || workspace) && item.label.toLowerCase().includes(query),
    ),
  })).filter((group) => group.items.length > 0);
  const canApply = Boolean(workspace) && APPLY_SECTIONS.has(section);
  const showStatus = Boolean(workspace) && isWorkspaceSection(section);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal settings" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>Ajustes</h2>
            <p className="muted small-text">
              {workspace
                ? `${workspace.name} · ${workspace.projectPath}`
                : "Preferencias de la aplicación"}
            </p>
          </div>
          <button className="ghost" onClick={onClose}>
            Cerrar
          </button>
        </header>

        <div className="settings-shell">
          <aside className="settings-nav" aria-label="Secciones de ajustes">
            <input
              className="text-input settings-nav-search"
              value={navQuery}
              placeholder="Buscar configuración"
              aria-label="Buscar configuración"
              onChange={(event) => setNavQuery(event.target.value)}
            />
            {groups.map((group) => (
              <div key={group.label} className="settings-nav-group">
                <span className="settings-nav-label">{group.label}</span>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`settings-nav-item ${section === item.id ? "active" : ""}`}
                    aria-current={section === item.id ? "page" : undefined}
                    onClick={() => {
                      setSection(item.id);
                      clearFeedback();
                    }}
                  >
                    <NavIcon name={item.icon} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </aside>

          <div className="settings-main">
            {!workspace && isWorkspaceSection(section) ? (
              <div className="settings-pane">
                <SectionHead
                  title="Sin workspace"
                  description="Selecciona un workspace en la barra lateral para configurar su modelo, skills, MCPs y presupuesto."
                />
              </div>
            ) : section === "appearance" ? (
              <div className="settings-pane">
                <AppearanceSettings />
              </div>
            ) : section === "shortcuts" ? (
              <div className="settings-pane">
                <ShortcutsSettings />
              </div>
            ) : section === "notifications" ? (
              <div className="settings-pane">
                <SectionHead
                  title="Notificaciones"
                  meta={notifications ? "activadas" : "desactivadas"}
                  description="Preferencia global. Solo avisa si la ventana no tiene el foco; pide permiso al sistema la primera vez."
                />
                <label className={`check ${notifications ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={notifications}
                    onChange={() => void toggleNotifications()}
                  />
                  <span className="check-main">
                    <span className="check-title">
                      Avisarme cuando el agente termine o espere algo
                    </span>
                    <span className="check-sub">
                      Se aplica a todos los workspaces de esta instalación.
                    </span>
                  </span>
                </label>
                {notificationError && <div className="inline-error">{notificationError}</div>}
              </div>
            ) : section === "model" ? (
              <div className="settings-pane">
                <SectionHead
                  title="Modelo"
                  meta="opcional"
                  description="Modelo por defecto de este workspace. Vacío = el de la configuración global."
                />
                <input
                  className="text-input"
                  value={model}
                  placeholder="provider/modelo (vacío = el de la config global)"
                  onChange={(event) => changeModel(event.target.value)}
                />
              </div>
            ) : section === "skills" ? (
              <SkillsSection skills={skills} selected={selectedSkills} onToggle={toggleSkill} />
            ) : section === "mcps" ? (
              <McpsSection
                mcps={mcps}
                selected={selectedMcps}
                statuses={statuses}
                onToggle={toggleMcp}
              />
            ) : section === "budget" ? (
              <div className="settings-pane">
                <SectionHead
                  title="Presupuesto"
                  meta="mensual · opcional"
                  description="El Inspector avisa cuando el coste del rango supera este importe. Se guarda al editarlo como preferencia de este workspace: vacío significa sin límite y no toca la configuración del servidor."
                />
                <input
                  className="text-input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  aria-label="Presupuesto mensual en dólares"
                  placeholder="p. ej. 20"
                  value={budgetText}
                  onChange={(event) => changeBudget(event.target.value)}
                />
                {budgetError && <div className="inline-error">{budgetError}</div>}
              </div>
            ) : section === "workspace-profile" ? (
              <div className="settings-pane">
                <SectionHead
                  title="Perfil"
                  meta={
                    workspace?.profileId
                      ? `${workspace.profileId} · v${workspace.profileVersion ?? "?"}`
                      : "sin perfil"
                  }
                  description="La selección está congelada por workspace. Reaplicar toma la versión actual del perfil; editar el perfil no cambia este workspace por sí solo."
                />
                {workspace?.profileId ? (
                  <button className="ghost" onClick={() => void reapply()} disabled={reapplying}>
                    {reapplying ? "Reaplicando…" : "Reaplicar perfil"}
                  </button>
                ) : (
                  <p className="muted small-text">
                    Este workspace no tiene perfil. Puedes crearlos y editarlos en Biblioteca →
                    Perfiles.
                  </p>
                )}
              </div>
            ) : section === "repos" ? (
              <ReposSection repos={repos} workspaces={workspaces} onReposChanged={onReposChanged} />
            ) : section === "profiles" ? (
              <ProfilesSection
                profiles={profiles}
                library={library}
                onProfilesChanged={onProfilesChanged}
              />
            ) : (
              <SystemSection
                worktreesRoot={worktreesRoot}
                defaultProfileId={defaultProfileId}
                onWorktreesRootChanged={onWorktreesRootChanged}
              />
            )}

            {showStatus && (warnings.length > 0 || error || applied) && (
              <div className="settings-status">
                {warnings.length > 0 && (
                  <div className="warning-box">
                    {warnings.map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </div>
                )}
                {error && <div className="inline-error">{error}</div>}
                {applied && !error && (
                  <div className="ok-box">Cambios aplicados a este workspace.</div>
                )}
              </div>
            )}
          </div>
        </div>

        {canApply && (
          <footer className="modal-foot">
            <span className="muted">
              {applied ? "Aplicado" : "Los cambios afectan solo a este workspace"}
            </span>
            <div className="row">
              <button className="ghost" onClick={onClose}>
                Cancelar
              </button>
              <button className="primary" onClick={() => void apply()} disabled={applying}>
                {applying ? "Aplicando…" : "Aplicar"}
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
