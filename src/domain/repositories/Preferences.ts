/** Puerto de preferencias persistidas en el cliente (clave/valor). */
export interface Preferences {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** Claves centralizadas (antes repartidas como strings ad-hoc en los componentes). */
export const prefKeys = {
  selectedWorkspace: "openconf:selected",
  panelOpen: "openconf:panel",
  session: (workspaceId: string) => `openconf:session:${workspaceId}`,
  model: (workspaceId: string) => `openconf:model:${workspaceId}`,
  agent: (workspaceId: string) => `openconf:agent:${workspaceId}`,
  variant: (workspaceId: string) => `openconf:variant:${workspaceId}`,
};
