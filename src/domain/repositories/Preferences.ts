/** Puerto de preferencias persistidas en el cliente (clave/valor). */
export interface Preferences {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** Claves centralizadas (antes repartidas como strings ad-hoc en los componentes). */
export const prefKeys = {
  selectedWorkspace: "opentemplates:selected",
  recentWorkspaces: "opentemplates:recent-workspaces",
  theme: "opentemplates:theme",
  accent: "opentemplates:accent",
  panelOpen: "opentemplates:panel",
  terminalOpen: "opentemplates:terminal",
  notifications: "opentemplates:notifications",
  panelTab: (workspaceId: string) => `opentemplates:panel-tab:${workspaceId}`,
  budget: (workspaceId: string) => `opentemplates:budget:${workspaceId}`,
  budgetAlert: (workspaceId: string, threshold: number) =>
    `opentemplates:budget-alert:${workspaceId}:${threshold}`,
  session: (workspaceId: string, scope?: string) =>
    scope
      ? `opentemplates:session:${workspaceId}:${scope}`
      : `opentemplates:session:${workspaceId}`,
  goal: (workspaceId: string, sessionId: string) =>
    `opentemplates:goal:${workspaceId}:${sessionId}`,
  race: (workspaceId: string) => `opentemplates:race:${workspaceId}`,
  previewOpen: "opentemplates:preview",
  previewUrl: (workspaceId: string) => `opentemplates:preview-url:${workspaceId}`,
  previewDevice: (workspaceId: string) => `opentemplates:preview-device:${workspaceId}`,
  model: (workspaceId: string, scope?: string) =>
    scope ? `opentemplates:model:${workspaceId}:${scope}` : `opentemplates:model:${workspaceId}`,
  agent: (workspaceId: string, scope?: string) =>
    scope ? `opentemplates:agent:${workspaceId}:${scope}` : `opentemplates:agent:${workspaceId}`,
  variant: (workspaceId: string, scope?: string) =>
    scope
      ? `opentemplates:variant:${workspaceId}:${scope}`
      : `opentemplates:variant:${workspaceId}`,
};
