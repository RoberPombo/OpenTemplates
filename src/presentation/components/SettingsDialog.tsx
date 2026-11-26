import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAppContext } from "../context/AppContext";
import { AppearanceSettings } from "./AppearanceSettings";
import { ShortcutsSettings } from "./ShortcutsSettings";
import { ProfilesSection, ReposSection, SystemSection } from "./SettingsLibrarySections";
import { errorText } from "../../domain/shared";
import { prefKeys } from "../../domain/repositories/Preferences";
import { NOTIFICATIONS_ON, notificationsEnabled } from "../../domain/chat/notifications";
import { parseBudgetUsd } from "../../domain/chat/usage";
import { mcpStateLabel, type McpState } from "../../domain/chat/mcp";
import type {
  Library,
  McpInfo,
  ProfileManifest,
  Repo,
  SkillInfo,
  SkillRef,
  Workspace,
} from "../../types";
import type { ChatGateway as WorkspaceClient } from "../../domain/repositories/ChatGateway";

export type SettingsSectionId =
  | "appearance"
  | "shortcuts"
  | "notifications"
  | "model"
  | "skills"
  | "mcps"
  | "budget"
  | "workspace-profile"
  | "repos"
  | "profiles"
  | "system";

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

type IconName =
  | "appearance"
  | "shortcuts"
  | "notifications"
  | "model"
  | "skills"
  | "mcps"
  | "budget"
  | "profile"
  | "repos"
  | "profiles"
  | "system";

const ICONS: Record<IconName, ReactNode> = {
  appearance: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  shortcuts: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6" />
    </>
  ),
  notifications: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </>
  ),
  model: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </>
  ),
  skills: (
    <>
      <path d="M12 3 9.6 8.6 4 11l5.6 2.4L12 19l2.4-5.6L20 11l-5.6-2.4L12 3Z" />
      <path d="M19 3v3M20.5 4.5h-3" />
    </>
  ),
  mcps: (
    <>
      <path d="M9 7V3M15 7V3" />
      <rect x="5" y="7" width="14" height="8" rx="2" />
      <path d="M12 15v6" />
    </>
  ),
  budget: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
      <path d="M16 12h.01" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
    </>
  ),
  repos: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </>
  ),
  profiles: (
    <>
      <path d="M12 2 3 7l9 5 9-5-9-5Z" />
      <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
    </>
  ),
  system: (
    <>
      <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="14" cy="18" r="2" />
    </>
  ),
};

type NavItem = { id: SettingsSectionId; label: string; icon: IconName };
type NavGroup = { label: string; items: NavItem[]; workspaceOnly?: boolean };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Aplicación",
    items: [
      { id: "appearance", label: "Apariencia", icon: "appearance" },
      { id: "shortcuts", label: "Atajos", icon: "shortcuts" },
      { id: "notifications", label: "Notificaciones", icon: "notifications" },
    ],
  },
  {
    label: "Workspace",
    workspaceOnly: true,
    items: [
      { id: "model", label: "Modelo", icon: "model" },
      { id: "skills", label: "Skills", icon: "skills" },
      { id: "mcps", label: "MCPs", icon: "mcps" },
      { id: "budget", label: "Presupuesto", icon: "budget" },
      { id: "workspace-profile", label: "Perfil", icon: "profile" },
    ],
  },
  {
    label: "Biblioteca",
    items: [
      { id: "repos", label: "Repositorios", icon: "repos" },
      { id: "profiles", label: "Perfiles", icon: "profiles" },
    ],
  },
  {
    label: "Sistema",
    items: [{ id: "system", label: "Rutas y worktrees", icon: "system" }],
  },
];

const WORKSPACE_SECTIONS = new Set<SettingsSectionId>([
  "model",
  "skills",
  "mcps",
  "budget",
  "workspace-profile",
]);

const APPLY_SECTIONS = new Set<SettingsSectionId>(["model", "skills", "mcps"]);

function isWorkspaceSection(section: SettingsSectionId) {
  return WORKSPACE_SECTIONS.has(section);
}

function NavIcon({ name }: { name: IconName }) {
  return (
    <svg
      className="settings-nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

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

function mcpSummary(config: Record<string, unknown>) {
  if (typeof config.url === "string") return config.url;
  if (Array.isArray(config.command)) return config.command.join(" ");
  return "";
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
  const [mcps, setMcps] = useState<McpInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [reapplying, setReapplying] = useState(false);
  const [selectedMcps, setSelectedMcps] = useState<Set<string>>(
    () => new Set(workspace?.mcpNames ?? []),
  );
  const [selectedSkills, setSelectedSkills] = useState<Map<string, SkillRef>>(
    () => new Map((workspace?.skills ?? []).map((skill) => [skill.id, skill])),
  );
  const [model, setModel] = useState(workspace?.model ?? "");
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);
  const [notifications, setNotifications] = useState(() =>
    notificationsEnabled(root.preferences.get(prefKeys.notifications)),
  );
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [budgetText, setBudgetText] = useState(() =>
    workspace ? (root.preferences.get(prefKeys.budget(workspace.id)) ?? "") : "",
  );
  const [budgetError, setBudgetError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    root.library
      .mcps()
      .then((items) => {
        if (alive) setMcps(items);
      })
      .catch(() => undefined);
    if (workspace) {
      root.library
        .skills(workspace.projectPath)
        .then((items) => {
          if (alive) setSkills(items);
        })
        .catch(() => undefined);
    } else {
      setSkills([]);
    }
    return () => {
      alive = false;
    };
  }, [root, workspace?.projectPath]);

  useEffect(() => {
    setSelectedMcps(new Set(workspace?.mcpNames ?? []));
    setSelectedSkills(new Map((workspace?.skills ?? []).map((skill) => [skill.id, skill])));
    setModel(workspace?.model ?? "");
    setBudgetText(workspace ? (root.preferences.get(prefKeys.budget(workspace.id)) ?? "") : "");
    setBudgetError(null);
    setError(null);
    setWarnings([]);
    setApplied(false);
  }, [root.preferences, workspace?.id]);

  useEffect(() => {
    if (!workspace && isWorkspaceSection(section)) setSection("appearance");
  }, [workspace, section]);

  const skillList = useMemo(() => {
    const map = new Map<string, SkillInfo>();
    for (const skill of skills) map.set(skill.id, skill);
    return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  }, [skills]);

  async function refreshStatuses() {
    if (!client || !workspace) return;
    try {
      const result = await client.mcp.list({
        location: { directory: workspace.projectPath },
      });
      const next: Record<string, string> = {};
      for (const item of result.data) next[item.name] = item.state;
      setStatuses(next);
    } catch {
      // El servidor puede estar arrancando; se reintenta al aplicar.
    }
  }

  useEffect(() => {
    void refreshStatuses();
  }, [workspace?.id, workspace?.projectPath, client]);

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

  function changeBudget(value: string) {
    if (!workspace) return;
    setBudgetText(value);
    const raw = value.trim();
    if (!raw) {
      root.preferences.remove(prefKeys.budget(workspace.id));
      setBudgetError(null);
      return;
    }
    const budget = parseBudgetUsd(raw);
    if (budget === null) {
      setBudgetError("Introduce un importe mayor que 0 o deja el campo vacío.");
      return;
    }
    root.preferences.set(prefKeys.budget(workspace.id), String(budget));
    setBudgetError(null);
  }

  function toggleMcp(name: string) {
    setSelectedMcps((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    setApplied(false);
  }

  function toggleSkill(skill: SkillInfo) {
    setSelectedSkills((prev) => {
      const next = new Map(prev);
      if (next.has(skill.id)) next.delete(skill.id);
      else next.set(skill.id, { id: skill.id, path: skill.path });
      return next;
    });
    setApplied(false);
  }

  async function apply() {
    if (!workspace) return;
    setApplying(true);
    setError(null);
    setWarnings([]);
    try {
      const { outcome, mcpErrors } = await root
        .provideApplyWorkspaceSettings(client ?? null)
        .execute({
          workspace,
          mcpNames: [...selectedMcps],
          skills: [...selectedSkills.values()],
          model,
          mcps,
        });
      setWarnings(outcome.warnings);
      onWorkspaceUpdated?.(outcome.workspace, outcome.warnings);
      if (mcpErrors.length > 0) setError(mcpErrors[mcpErrors.length - 1]);
      await refreshStatuses();
      setApplied(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setApplying(false);
    }
  }

  async function reapply() {
    if (!workspace) return;
    setReapplying(true);
    setError(null);
    setWarnings([]);
    try {
      const outcome = await root.workspaces.reapplyProfile(workspace.id);
      setSelectedMcps(new Set(outcome.workspace.mcpNames));
      setSelectedSkills(new Map(outcome.workspace.skills.map((skill) => [skill.id, skill])));
      setModel(outcome.workspace.model ?? "");
      setWarnings(outcome.warnings);
      onWorkspaceUpdated?.(outcome.workspace, outcome.warnings);
      setApplied(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setReapplying(false);
    }
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
                      setError(null);
                      setWarnings([]);
                      setApplied(false);
                      setBudgetError(null);
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
                  onChange={(event) => {
                    setModel(event.target.value);
                    setApplied(false);
                  }}
                />
              </div>
            ) : section === "skills" ? (
              <SkillsSection skills={skillList} selected={selectedSkills} onToggle={toggleSkill} />
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

function SkillsSection({
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

function McpsSection({
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
