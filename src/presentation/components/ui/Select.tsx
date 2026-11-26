import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { Select as BaseSelect } from "@base-ui/react/select";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, MouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  description?: string;
  searchText?: string;
  /** Contenido que se muestra en una tarjeta flotante al pasar por la opción. */
  tooltip?: ReactNode;
};

export type SelectOptionGroup = {
  label: string;
  options: readonly SelectOption[];
};

export type SelectEntry = SelectOption | SelectOptionGroup;

export type SelectProps = {
  "aria-label": string;
  value: string;
  options: readonly SelectEntry[];
  placeholder: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  variant?: "chip" | "field";
  className?: string;
};

function isGroup(entry: SelectEntry): entry is SelectOptionGroup {
  return "options" in entry;
}

type OptionPreview = { content: ReactNode; rect: DOMRect };

type OptionPreviewHandlers = {
  onPreview: (
    event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>,
    content?: ReactNode,
  ) => void;
  onHide: () => void;
};

function useOptionPreview() {
  const [preview, setPreview] = useState<OptionPreview | null>(null);
  const onPreview = useCallback(
    (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>, content?: ReactNode) => {
      if (!content) return;
      setPreview({ content, rect: event.currentTarget.getBoundingClientRect() });
    },
    [],
  );
  const onHide = useCallback(() => setPreview(null), []);
  return { preview, onPreview, onHide };
}

function OptionTooltip({ preview }: { preview: OptionPreview | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({
    position: "fixed",
    left: 0,
    top: 0,
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!preview || !element) return;
    const { rect } = preview;
    const margin = 10;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    let left = rect.right + margin;
    if (left + width > window.innerWidth - 8) left = rect.left - width - margin;
    if (left < 8) left = Math.max(8, window.innerWidth - width - 8);
    let top = rect.top;
    if (top + height > window.innerHeight - 8) top = window.innerHeight - height - 8;
    if (top < 8) top = 8;
    setStyle({ position: "fixed", left, top, visibility: "visible" });
  }, [preview]);

  if (!preview) return null;
  return createPortal(
    <div ref={ref} className="model-tooltip" style={style} role="tooltip">
      {preview.content}
    </div>,
    document.body,
  );
}

function SelectItem({
  value,
  label,
  disabled,
  tooltip,
  onPreview,
  onHide,
}: SelectOption & OptionPreviewHandlers) {
  return (
    <BaseSelect.Item
      className="select-item"
      value={value}
      disabled={disabled}
      onMouseEnter={(event) => onPreview(event, tooltip)}
      onMouseLeave={onHide}
      onFocus={(event) => onPreview(event, tooltip)}
      onBlur={onHide}
    >
      <BaseSelect.ItemText className="select-item-text">{label}</BaseSelect.ItemText>
      <BaseSelect.ItemIndicator className="select-item-indicator" aria-hidden="true">
        <CheckIcon />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path
        d="m3.5 8 3 3 6-6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path
        d="m4 6 4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const Select = memo(function Select({
  "aria-label": ariaLabel,
  value,
  options,
  placeholder,
  onValueChange,
  disabled = false,
  variant = "field",
  className,
}: SelectProps) {
  const items = useMemo(
    () =>
      options.flatMap((entry) => {
        const groupOptions = isGroup(entry) ? entry.options : [entry];
        return groupOptions.map(({ value: itemValue, label }) => ({
          value: itemValue,
          label,
        }));
      }),
    [options],
  );
  const triggerClasses = [
    "select-trigger",
    variant === "field" ? "select-trigger-field text-input" : "select-trigger-chip",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const { preview, onPreview, onHide } = useOptionPreview();

  return (
    <>
      <BaseSelect.Root<string>
        items={items}
        value={value || null}
        onValueChange={(nextValue) => {
          onHide();
          onValueChange(nextValue ?? "");
        }}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onHide();
        }}
        disabled={disabled}
      >
        <BaseSelect.Trigger className={triggerClasses} aria-label={ariaLabel}>
          <BaseSelect.Value className="select-value" placeholder={placeholder} />
          <BaseSelect.Icon className="select-trigger-icon">
            <ChevronDownIcon />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>

        <BaseSelect.Portal>
          <BaseSelect.Positioner className="select-positioner" sideOffset={5}>
            <BaseSelect.Popup
              className={`select-popup ${variant === "field" ? "select-popup-field" : ""}`}
            >
              <BaseSelect.List className="select-list">
                {options.map((entry) =>
                  isGroup(entry) ? (
                    <BaseSelect.Group className="select-group" key={entry.label}>
                      <BaseSelect.GroupLabel className="select-group-label">
                        {entry.label}
                      </BaseSelect.GroupLabel>
                      {entry.options.map((option) => (
                        <SelectItem
                          key={option.value}
                          {...option}
                          onPreview={onPreview}
                          onHide={onHide}
                        />
                      ))}
                    </BaseSelect.Group>
                  ) : (
                    <SelectItem
                      key={entry.value}
                      {...entry}
                      onPreview={onPreview}
                      onHide={onHide}
                    />
                  ),
                )}
              </BaseSelect.List>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
      <OptionTooltip preview={preview} />
    </>
  );
});

export type MultiSelectProps = Omit<SelectProps, "value" | "onValueChange"> & {
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  emptyText?: string;
};

function flattenOptions(options: readonly SelectEntry[]): SelectOption[] {
  return options.flatMap((entry) => {
    if (!isGroup(entry)) return [entry];
    return entry.options.map((option) => ({
      ...option,
      searchText: `${entry.label} ${option.searchText ?? ""}`.trim(),
    }));
  });
}

export const MultiSearchableSelect = memo(function MultiSearchableSelect({
  "aria-label": ariaLabel,
  value,
  options,
  placeholder,
  onValueChange,
  disabled = false,
  variant = "field",
  className,
  emptyText = "No hay modelos que coincidan",
}: MultiSelectProps) {
  const items = useMemo(() => flattenOptions(options), [options]);
  const selectedItems = useMemo(
    () =>
      value.map(
        (itemValue) =>
          items.find((item) => item.value === itemValue) ?? {
            value: itemValue,
            label: itemValue,
            searchText: itemValue,
          },
      ),
    [items, value],
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filter = BaseCombobox.useFilter({ locale: "es", sensitivity: "base" });
  const filterItem = useCallback(
    (item: SelectOption, searchQuery: string) =>
      filter.contains(
        `${item.label} ${item.description ?? ""} ${item.searchText ?? ""}`,
        searchQuery,
      ),
    [filter],
  );
  const inputClasses = [
    "select-search-input",
    variant === "field" ? "select-search-input-field" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const { preview, onPreview, onHide } = useOptionPreview();

  return (
    <>
      <BaseCombobox.Root<SelectOption, true>
        multiple
        items={items}
        value={selectedItems}
        inputValue={open ? query : ""}
        onInputValueChange={(nextValue) => {
          setQuery(nextValue);
          onHide();
        }}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) setQuery("");
          else onHide();
        }}
        onValueChange={(nextItems) => {
          onHide();
          onValueChange(nextItems.map((item) => item.value));
        }}
        itemToStringLabel={(item) => item.label}
        itemToStringValue={(item) => item.value}
        isItemEqualToValue={(item, selected) => item.value === selected.value}
        filter={filterItem}
        autoHighlight
        disabled={disabled}
      >
        <BaseCombobox.InputGroup
          className={`select-search-control ${variant === "field" ? "select-search-control-field" : ""}`}
        >
          <BaseCombobox.Input
            className={inputClasses}
            aria-label={ariaLabel}
            placeholder={placeholder}
          />
          {value.length > 0 && (
            <span className="select-search-count" aria-hidden="true">
              {value.length}
            </span>
          )}
          <BaseCombobox.Trigger className="select-search-trigger" aria-label="Mostrar opciones">
            <BaseCombobox.Icon>
              <ChevronDownIcon />
            </BaseCombobox.Icon>
          </BaseCombobox.Trigger>
        </BaseCombobox.InputGroup>

        <BaseCombobox.Portal>
          <BaseCombobox.Positioner className="select-positioner" sideOffset={5}>
            <BaseCombobox.Popup className="select-popup select-popup-search">
              <BaseCombobox.Empty className="select-empty">{emptyText}</BaseCombobox.Empty>
              <BaseCombobox.List className="select-list">
                {(item: SelectOption) => (
                  <BaseCombobox.Item
                    key={item.value}
                    className="select-item select-search-item"
                    value={item}
                    disabled={item.disabled}
                    onMouseEnter={(event) => onPreview(event, item.tooltip)}
                    onMouseLeave={onHide}
                    onFocus={(event) => onPreview(event, item.tooltip)}
                    onBlur={onHide}
                  >
                    <span className="select-search-item-copy">
                      <span className="select-item-text">{item.label}</span>
                      {item.description && (
                        <span className="select-search-item-description">{item.description}</span>
                      )}
                    </span>
                    <BaseCombobox.ItemIndicator
                      className="select-item-indicator"
                      aria-hidden="true"
                    >
                      <CheckIcon />
                    </BaseCombobox.ItemIndicator>
                  </BaseCombobox.Item>
                )}
              </BaseCombobox.List>
            </BaseCombobox.Popup>
          </BaseCombobox.Positioner>
        </BaseCombobox.Portal>
      </BaseCombobox.Root>
      <OptionTooltip preview={preview} />
    </>
  );
});

export const SearchableSelect = memo(function SearchableSelect({
  "aria-label": ariaLabel,
  value,
  options,
  placeholder,
  onValueChange,
  disabled = false,
  variant = "chip",
  className,
}: SelectProps) {
  const items = useMemo(
    () =>
      options.flatMap((entry) => {
        if (!isGroup(entry)) return [entry];
        return entry.options.map((option) => ({
          ...option,
          searchText: `${entry.label} ${option.searchText ?? ""}`.trim(),
        }));
      }),
    [options],
  );
  const selectedItem = items.find((item) => item.value === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filter = BaseCombobox.useFilter({ locale: "es", sensitivity: "base" });
  const filterItem = useCallback(
    (item: SelectOption, text: string) =>
      filter.contains(`${item.label} ${item.description ?? ""} ${item.searchText ?? ""}`, text),
    [filter],
  );
  const inputClasses = [
    "select-search-input",
    variant === "field" ? "select-search-input-field" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const { preview, onPreview, onHide } = useOptionPreview();

  return (
    <>
      <BaseCombobox.Root<SelectOption>
        items={items}
        value={selectedItem}
        inputValue={open ? query : (selectedItem?.label ?? "")}
        onInputValueChange={(nextValue) => {
          setQuery(nextValue);
          onHide();
        }}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) setQuery("");
          else onHide();
        }}
        onValueChange={(item) => {
          onHide();
          onValueChange(item?.value ?? "");
        }}
        itemToStringLabel={(item) => item.label}
        itemToStringValue={(item) => item.value}
        filter={filterItem}
        autoHighlight
        disabled={disabled}
      >
        <BaseCombobox.InputGroup
          className={`select-search-control ${variant === "field" ? "select-search-control-field" : ""}`}
        >
          <BaseCombobox.Input
            className={inputClasses}
            aria-label={ariaLabel}
            placeholder={placeholder}
          />
          <BaseCombobox.Trigger className="select-search-trigger" aria-label="Mostrar opciones">
            <BaseCombobox.Icon>
              <ChevronDownIcon />
            </BaseCombobox.Icon>
          </BaseCombobox.Trigger>
        </BaseCombobox.InputGroup>

        <BaseCombobox.Portal>
          <BaseCombobox.Positioner className="select-positioner" sideOffset={5}>
            <BaseCombobox.Popup className="select-popup select-popup-search">
              <BaseCombobox.Empty className="select-empty">
                No hay modelos que coincidan
              </BaseCombobox.Empty>
              <BaseCombobox.List className="select-list">
                {(item: SelectOption) => (
                  <BaseCombobox.Item
                    key={item.value}
                    className="select-item select-search-item"
                    value={item}
                    disabled={item.disabled}
                    onMouseEnter={(event) => onPreview(event, item.tooltip)}
                    onMouseLeave={onHide}
                    onFocus={(event) => onPreview(event, item.tooltip)}
                    onBlur={onHide}
                  >
                    <span className="select-search-item-copy">
                      <span className="select-item-text">{item.label}</span>
                      {item.description && (
                        <span className="select-search-item-description">{item.description}</span>
                      )}
                    </span>
                    <BaseCombobox.ItemIndicator
                      className="select-item-indicator"
                      aria-hidden="true"
                    >
                      <CheckIcon />
                    </BaseCombobox.ItemIndicator>
                  </BaseCombobox.Item>
                )}
              </BaseCombobox.List>
            </BaseCombobox.Popup>
          </BaseCombobox.Positioner>
        </BaseCombobox.Portal>
      </BaseCombobox.Root>
      <OptionTooltip preview={preview} />
    </>
  );
});
