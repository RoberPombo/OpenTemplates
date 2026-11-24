// oxlint-disable jsx-a11y/prefer-tag-over-role -- El menú implementa el patrón combobox/listbox con aria-activedescendant; no hay un elemento nativo equivalente.
import type { ChatMenuGroup, ChatMenuItem } from "../../domain/chat/commands";

export const SLASH_MENU_ID = "composer-slash-menu";

/** Id estable de una opción para `aria-activedescendant`. */
export function slashOptionId(key: string): string {
  return `composer-slash-option-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

type Props = {
  groups: ChatMenuGroup[];
  activeKey: string | null;
  query: string;
  onHover: (key: string) => void;
  onChoose: (item: ChatMenuItem) => void;
};

/**
 * Lista de comandos y skills del composer. El foco sigue en el textarea; la
 * opción activa se marca con `aria-selected` y `aria-activedescendant`.
 */
export function SlashMenu({ groups, activeKey, query, onHover, onChoose }: Props) {
  const total = groups.reduce((count, group) => count + group.items.length, 0);

  return (
    <div id={SLASH_MENU_ID} className="slash-menu" role="listbox" aria-label="Comandos y skills">
      {total === 0 && (
        <div className="slash-menu-empty" role="presentation">
          Sin resultados{query ? ` para «${query}»` : ""}
        </div>
      )}
      {groups.map((group) => (
        <div className="slash-menu-group" role="group" aria-label={group.label} key={group.kind}>
          <div className="slash-menu-heading" aria-hidden="true">
            {group.label}
          </div>
          {group.items.map((item) => {
            const active = item.key === activeKey;
            return (
              <div
                key={item.key}
                id={slashOptionId(item.key)}
                role="option"
                tabIndex={-1}
                aria-selected={active}
                className={active ? "slash-menu-option active" : "slash-menu-option"}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChoose(item);
                }}
                onMouseEnter={() => onHover(item.key)}
              >
                <span className="slash-menu-prefix" aria-hidden="true">
                  {item.kind === "command" ? "/" : "✦"}
                </span>
                <span className="slash-menu-label">{item.name}</span>
                <span className="slash-menu-kind">
                  {item.kind === "command" ? "comando" : "skill"}
                </span>
                {item.description && (
                  <span className="slash-menu-description">{item.description}</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
