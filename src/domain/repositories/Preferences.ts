/** Puerto de preferencias persistidas en el cliente (clave/valor). */
export interface Preferences {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** Claves centralizadas (antes repartidas como strings ad-hoc en los componentes). */
export const prefKeys = {
  selectedWorkspace: "opentemplates:selected",
  panelOpen: "opentemplates:panel",
  sessionsOpen: "opentemplates:sessions",
  terminalOpen: "opentemplates:terminal",
  notifications: "opentemplates:notifications",
  panelTab: (workspaceId: string) => `opentemplates:panel-tab:${workspaceId}`,
  budget: (workspaceId: string) => `opentemplates:budget:${workspaceId}`,
  budgetAlert: (workspaceId: string, threshold: number) =>
    `opentemplates:budget-alert:${workspaceId}:${threshold}`,
  session: (workspaceId: string) => `opentemplates:session:${workspaceId}`,
  goal: (workspaceId: string, sessionId: string) =>
    `opentemplates:goal:${workspaceId}:${sessionId}`,
  model: (workspaceId: string) => `opentemplates:model:${workspaceId}`,
  agent: (workspaceId: string) => `opentemplates:agent:${workspaceId}`,
  variant: (workspaceId: string) => `opentemplates:variant:${workspaceId}`,
};
