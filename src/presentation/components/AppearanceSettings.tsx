/**
 * Apariencia: elección de tema y acento. Se aplica al instante y se persiste
 * en preferencias; la previsualización usa los tokens del dominio, no colores
 * incrustados en el componente.
 */
// oxlint-disable jsx-a11y/prefer-tag-over-role -- Las tarjetas de tema son botones con `role="radio"` para conservar el foco y el estilo propio.
import { ACCENTS, ACCENT_IDS, THEMES, THEME_IDS, themeTokens } from "../../domain/theme/themes";
import { useTheme } from "../hooks/useTheme";

export function AppearanceSettings() {
  const { selection, chooseTheme, chooseAccent } = useTheme();

  return (
    <section>
      <div className="section-head">
        <h3>Apariencia</h3>
        <span className="muted">
          {THEMES[selection.theme].label} · acento {ACCENTS[selection.accent].label.toLowerCase()}
        </span>
      </div>
      <p className="muted small-text">
        El tema se aplica al momento y se recuerda en esta instalación. Los dos temas comparten los
        mismos tokens semánticos, así que ningún texto ni borde se queda sin color.
      </p>

      <div className="theme-options" role="radiogroup" aria-label="Tema">
        {THEME_IDS.map((id) => {
          const preview = themeTokens(id, selection.accent);
          const checked = selection.theme === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={checked}
              className={`theme-option ${checked ? "selected" : ""}`}
              onClick={() => chooseTheme(id)}
            >
              <span
                className="theme-preview"
                aria-hidden="true"
                style={{ background: preview.bg, borderColor: preview.line }}
              >
                <span className="theme-preview-panel" style={{ background: preview.surface }}>
                  <span
                    className="theme-preview-line"
                    style={{ background: preview.text, opacity: 0.85 }}
                  />
                  <span
                    className="theme-preview-line short"
                    style={{ background: preview.muted }}
                  />
                  <span className="theme-preview-accent" style={{ background: preview.accent }} />
                </span>
              </span>
              <span className="theme-option-label">{THEMES[id].label}</span>
            </button>
          );
        })}
      </div>

      <div className="accent-options" role="radiogroup" aria-label="Acento">
        {ACCENT_IDS.map((id) => {
          const tokens = themeTokens(selection.theme, id);
          const checked = selection.accent === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`Acento ${ACCENTS[id].label}`}
              title={`Acento ${ACCENTS[id].label}`}
              className={`accent-option ${checked ? "selected" : ""}`}
              onClick={() => chooseAccent(id)}
            >
              <span
                className="accent-swatch"
                aria-hidden="true"
                style={{ background: tokens.accent, borderColor: tokens.accentBorder }}
              />
              <span>{ACCENTS[id].label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
