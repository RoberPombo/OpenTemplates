/**
 * Puerto del preview: sondeo del servidor que se va a embeber y apertura de la
 * URL en el navegador del sistema.
 *
 * El sondeo vive en Rust (comando Tauri) porque desde el webview una petición a
 * otro origen queda sujeta a CORS y no permite leer estado ni cabeceras. Aquí
 * solo se declara la superficie que usa la presentación.
 */
import type { PreviewProbe } from "../preview/preview";

export interface PreviewGateway {
  /** Comprueba si la URL responde y si se puede embeber. No lanza por red. */
  probe(url: string): Promise<PreviewProbe>;
  /** Abre la URL en el navegador externo del sistema. */
  openExternal(url: string): Promise<void>;
}
