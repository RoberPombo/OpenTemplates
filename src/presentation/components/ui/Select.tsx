import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { Select as BaseSelect } from "@base-ui/react/select";
import { memo, useCallback, useMemo, useState } from "react";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  description?: string;
  searchText?: string;
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

function SelectItem({ value, label, disabled }: SelectOption) {
  return (
    <BaseSelect.Item className="select-item" value={value} disabled={disabled}>
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

  return (
    <BaseSelect.Root<string>
      items={items}
      value={value || null}
      onValueChange={(nextValue) => onValueChange(nextValue ?? "")}
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
                      <SelectItem key={option.value} {...option} />
                    ))}
                  </BaseSelect.Group>
                ) : (
                  <SelectItem key={entry.value} {...entry} />
                ),
              )}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
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

  return (
    <BaseCombobox.Root<SelectOption, true>
      multiple
      items={items}
      value={selectedItems}
      inputValue={open ? query : ""}
      onInputValueChange={setQuery}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setQuery("");
      }}
      onValueChange={(nextItems) => onValueChange(nextItems.map((item) => item.value))}
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
                >
                  <span className="select-search-item-copy">
                    <span className="select-item-text">{item.label}</span>
                    {item.description && (
                      <span className="select-search-item-description">{item.description}</span>
                    )}
                  </span>
                  <BaseCombobox.ItemIndicator className="select-item-indicator" aria-hidden="true">
                    <CheckIcon />
                  </BaseCombobox.ItemIndicator>
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
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
    (item: SelectOption, query: string) =>
      filter.contains(`${item.label} ${item.description ?? ""} ${item.searchText ?? ""}`, query),
    [filter],
  );
  const inputClasses = [
    "select-search-input",
    variant === "field" ? "select-search-input-field" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <BaseCombobox.Root<SelectOption>
      items={items}
      value={selectedItem}
      inputValue={open ? query : (selectedItem?.label ?? "")}
      onInputValueChange={setQuery}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setQuery("");
      }}
      onValueChange={(item) => onValueChange(item?.value ?? "")}
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
                >
                  <span className="select-search-item-copy">
                    <span className="select-item-text">{item.label}</span>
                    {item.description && (
                      <span className="select-search-item-description">{item.description}</span>
                    )}
                  </span>
                  <BaseCombobox.ItemIndicator className="select-item-indicator" aria-hidden="true">
                    <CheckIcon />
                  </BaseCombobox.ItemIndicator>
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
});
