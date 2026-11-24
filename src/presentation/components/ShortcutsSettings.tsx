/**
 * Página de atajos: listado del set mínimo. La personalización queda pendiente
 * (documentada en el handoff) para no abrir un editor de keybinds a medias.
 */
import { KEYBINDINGS, formatShortcut } from "../../domain/palette/keybindings";

export function ShortcutsSettings() {
  const platform = typeof navigator === "undefined" ? "linux" : navigator.platform || "linux";
  return (
    <section>
      <div className="section-head">
        <h3>Atajos de teclado</h3>
        <span className="muted">funcionan también en el composer</span>
      </div>
      <p className="muted small-text">
        Los atajos con modificador no interfieren con la escritura. Enter y Shift+Enter siguen
        enviando o saltando de línea en el composer.
      </p>
      <ul className="shortcut-list">
        {KEYBINDINGS.map((binding) => (
          <li key={binding.id}>
            <span>{binding.label}</span>
            <kbd>{formatShortcut(binding.shortcut, platform)}</kbd>
          </li>
        ))}
      </ul>
      <p className="muted small-text">
        La personalización de atajos todavía no está disponible: hoy se usa este set fijo para
        evitar conflictos con el editor del composer.
      </p>
    </section>
  );
}
