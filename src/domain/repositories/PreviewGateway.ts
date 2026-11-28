/**
 * Puerto del preview: sondeo del servidor que se va a embeber, apertura de la
 * URL en el navegador del sistema y proxy propio del selector de elemento.
 *
 * El sondeo y el proxy viven en Rust (comandos Tauri) porque desde el webview
 * una petición a otro origen queda sujeta a CORS y la misma orígen impide
 * leer el DOM; aquí solo se declara la superficie que usa la presentación.
 */
import type { PreviewProbe } from "../preview/preview";
import type { PreviewProxySession } from "../preview/element";

export interface PreviewGateway {
  /** Comprueba si la URL responde y si se puede embeber. No lanza por red. */
  probe(url: string): Promise<PreviewProbe>;
  /** Abre la URL en el navegador externo del sistema. */
  openExternal(url: string): Promise<void>;
  /**
   * Arranca el proxy propio loopback para el selector de elemento sobre una
   * URL de preview ya validada. `appOrigin` = origen de la app para
   * `postMessage`. No relaja CSP ni capabilities; contenido remoto sin IPC.
   */
  startElementPicker(url: string, appOrigin: string): Promise<PreviewProxySession>;
  /** Para el proxy, cierra el listener y limpia. Idempotente. */
  stopElementPicker(token: string): Promise<void>;
}
