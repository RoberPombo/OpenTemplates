import { lazy, Suspense } from "react";
import type { MultiSelectProps, SelectEntry, SelectOptionGroup, SelectProps } from "./Select";

const SelectImplementation = lazy(() =>
  import("./Select").then((module) => ({ default: module.Select })),
);
const SearchableSelectImplementation = lazy(() =>
  import("./Select").then((module) => ({ default: module.SearchableSelect })),
);
const MultiSearchableSelectImplementation = lazy(() =>
  import("./Select").then((module) => ({ default: module.MultiSearchableSelect })),
);

function isGroup(entry: SelectEntry): entry is SelectOptionGroup {
  return "options" in entry;
}

function selectedLabel(value: string, options: readonly SelectEntry[], placeholder: string) {
  if (!value) return placeholder;
  for (const entry of options) {
    const match = isGroup(entry)
      ? entry.options.find((option) => option.value === value)
      : entry.value === value
        ? entry
        : undefined;
    if (match) return match.label;
  }
  return placeholder;
}

function SelectFallback({
  "aria-label": ariaLabel,
  value,
  options,
  placeholder,
  variant = "field",
  className,
}: SelectProps) {
  const triggerClasses = [
    "select-trigger",
    variant === "field" ? "select-trigger-field text-input" : "select-trigger-chip",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded="false"
      aria-busy="true"
      className={triggerClasses}
      disabled
    >
      <span className="select-value">{selectedLabel(value, options, placeholder)}</span>
      <span className="select-trigger-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
          <path
            d="m4 6 4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  );
}

export function AsyncSelect(props: SelectProps) {
  return (
    <Suspense fallback={<SelectFallback {...props} />}>
      <SelectImplementation {...props} />
    </Suspense>
  );
}

export function AsyncSearchableSelect(props: SelectProps) {
  return (
    <Suspense fallback={<SelectFallback {...props} />}>
      <SearchableSelectImplementation {...props} />
    </Suspense>
  );
}

function MultiSelectFallback({
  "aria-label": ariaLabel,
  value,
  placeholder,
  variant = "field",
  className,
}: MultiSelectProps) {
  const controlClasses = [
    "select-search-control",
    variant === "field" ? "select-search-control-field" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={controlClasses} aria-label={ariaLabel} aria-busy="true">
      <span className="select-search-input select-search-input-field select-search-placeholder">
        {placeholder}
      </span>
      {value.length > 0 && (
        <span className="select-search-count" aria-hidden="true">
          {value.length}
        </span>
      )}
    </div>
  );
}

export function AsyncMultiSearchableSelect(props: MultiSelectProps) {
  return (
    <Suspense fallback={<MultiSelectFallback {...props} />}>
      <MultiSearchableSelectImplementation {...props} />
    </Suspense>
  );
}
