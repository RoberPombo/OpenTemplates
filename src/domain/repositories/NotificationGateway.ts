/** Puerto de notificaciones nativas del sistema operativo. */

/** Resultado de pedir permiso; `unsupported` cubre web/dev sin Tauri. */
export type NotificationPermission = "granted" | "denied" | "default" | "unsupported";

export type NotificationInput = {
  title: string;
  body: string;
  /** Workspace que provoca el aviso; permite agrupar o filtrar en el adaptador. */
  workspaceId: string;
};

export interface NotificationGateway {
  /**
   * Pide permiso al sistema. Se llama al activar la preferencia, nunca al
   * arrancar la app.
   */
  requestPermission(): Promise<NotificationPermission>;
  /**
   * Muestra una notificación. Sin permiso o fuera de Tauri es un no-op: el
   * chat sigue funcionando igual en el navegador.
   */
  notify(input: NotificationInput): Promise<void>;
}
