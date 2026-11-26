/**
 * Paleta de comandos: búsqueda incremental, navegación con teclado y listbox
 * accesible. Toda la lógica de filtrado vive en `domain/palette`; aquí solo se
 * pinta el catálogo que recibe ya resuelto.
 */
// oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- Listbox con aria-activedescendant: el foco vive en el input y las opciones se manejan con el teclado.
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  filterPaletteCommands,
  firstEnabledIndex,
  lastEnabledIndex,
  movePaletteSelection,
  type PaletteCommand,
} from "../../domain/palette/catalog";
import { formatShortcut } from "../../domain/palette/keybindings";

type Props = {
  commands: readonly PaletteCommand[];
  onRun: (id: string) => void;
  onClose: () => void;
};

const LIST_ID = "command-palette-list";
const HELP_ID = "command-palette-help";

function optionId(id: string): string {
  return `palette-option-${id.replace(/[^a-z0-9]+/gi, "-")}`;
}

function platformName(): string {
  return typeof navigator === "undefined" ? "linux" : navigator.platform || "linux";
}

export function CommandPalette({ commands, onRun, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActive] = useState(() => Math.max(0, firstEnabledIndex(commands)));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef(new Map<string, HTMLDivElement>());

  const results = useMemo(() => filterPaletteCommands(commands, query), [commands, query]);
  // El índice activo se ajusta en render: si el filtro deja fuera la opción
  // actual se usa la primera habilitada, sin un efecto que vuelva a pintar.
  const active = results[activeIndex]?.enabled ? activeIndex : firstEnabledIndex(results);
  const activeCommand = results[active];
  const platform = platformName();

  useEffect(() => {
    const previous = document.activeElement;
    inputRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    if (!activeCommand) return;
    optionRefs.current.get(activeCommand.id)?.scrollIntoView({ block: "nearest" });
  }, [activeCommand]);

  function execute(command: PaletteCommand | undefined) {
    if (!command?.enabled) return;
    onRun(command.id);
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(movePaletteSelection(results, active, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(movePaletteSelection(results, active, -1));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActive(firstEnabledIndex(results));
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActive(lastEnabledIndex(results));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      execute(activeCommand);
    }
  }

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        aria-describedby={HELP_ID}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-search">
          <span className="palette-search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            ref={inputRef}
            className="palette-input"
            role="combobox"
            aria-label="Buscar una acción"
            aria-expanded="true"
            aria-controls={LIST_ID}
            aria-autocomplete="list"
            aria-activedescendant={activeCommand ? optionId(activeCommand.id) : undefined}
            placeholder="Busca una acción: objetivo, terminal, diff…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="palette-hint">Esc</kbd>
        </div>

        <div className="palette-list" id={LIST_ID} role="listbox" aria-label="Acciones">
          {results.length === 0 && (
            <p className="palette-empty">No hay acciones que coincidan con «{query}».</p>
          )}
          {results.map((command, index) => {
            const showGroup = index === 0 || results[index - 1]?.group !== command.group;
            return (
              <Fragment key={command.id}>
                {showGroup && (
                  <div className="palette-group" role="presentation">
                    {command.group}
                  </div>
                )}
                <div
                  id={optionId(command.id)}
                  ref={(element) => {
                    if (element) optionRefs.current.set(command.id, element);
                    else optionRefs.current.delete(command.id);
                  }}
                  role="option"
                  aria-selected={index === active}
                  aria-disabled={!command.enabled}
                  className={[
                    "palette-option",
                    index === active ? "active" : "",
                    command.enabled ? "" : "disabled",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseMove={() => setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => execute(command)}
                >
                  <span className="palette-option-main">
                    <span className="palette-option-label">{command.label}</span>
                    {command.description && (
                      <span className="palette-option-description">
                        {command.enabled
                          ? command.description
                          : (command.reason ?? command.description)}
                      </span>
                    )}
                  </span>
                  {command.shortcut && (
                    <kbd className="palette-shortcut">
                      {formatShortcut(command.shortcut, platform)}
                    </kbd>
                  )}
                </div>
              </Fragment>
            );
          })}
        </div>

        <footer className="palette-footer" id={HELP_ID}>
          <span>↑↓ navegar</span>
          <span>Enter ejecutar</span>
          <span>Esc cerrar</span>
        </footer>
      </div>
    </div>
  );
}
