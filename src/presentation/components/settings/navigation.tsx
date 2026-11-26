/** Datos y piezas estáticas de la navegación del diálogo de ajustes. */
import type { ReactNode } from "react";

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

export const NAV_GROUPS: NavGroup[] = [
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

export const APPLY_SECTIONS = new Set<SettingsSectionId>(["model", "skills", "mcps"]);

export function isWorkspaceSection(section: SettingsSectionId) {
  return WORKSPACE_SECTIONS.has(section);
}

export function NavIcon({ name }: { name: IconName }) {
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
