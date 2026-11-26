/** Piezas visuales compartidas del wizard: marco, campos, pasos y pie del modal. */
import type { ReactNode } from "react";
import { TextInput } from "../ui";

export const WIZARD_STEPS = ["Repo", "Profile", "Nombre", "Resumen"];

export function WizardShell({
  onClose,
  stepper,
  footer,
  error,
  children,
}: {
  onClose: () => void;
  stepper: ReactNode;
  footer: ReactNode;
  error: string | null;
  children: ReactNode;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal wizard"
        role="presentation"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <h2>Nuevo workspace</h2>
            <p className="muted small-text">
              Repo, perfil y modo de trabajo. La config queda aislada.
            </p>
          </div>
          <button className="ghost" onClick={onClose}>
            Cerrar
          </button>
        </header>
        {stepper}
        <div className="modal-body wizard-body">
          {children}
          {error && <div className="inline-error">{error}</div>}
        </div>
        {footer}
      </div>
    </div>
  );
}

export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <TextInput
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function CheckboxRow({
  checked,
  title,
  subtitle,
  onChange,
}: {
  checked: boolean;
  title: string;
  subtitle: string;
  onChange: () => void;
}) {
  return (
    <label className={`check ${checked ? "on" : ""}`}>
      <input type="checkbox" checked={checked} aria-label={title} onChange={onChange} />
      <span className="check-main">
        <span className="check-title">{title}</span>
        <span className="check-sub">{subtitle}</span>
      </span>
    </label>
  );
}

export function WizardStepper({
  steps,
  step,
  onSelect,
}: {
  steps: string[];
  step: number;
  onSelect: (index: number) => void;
}) {
  return (
    <ol className="wizard-steps">
      {steps.map((label, index) => (
        <li key={label}>
          <button
            className={index === step ? "active" : index < step ? "done" : ""}
            onClick={() => onSelect(index)}
            disabled={index > step}
            type="button"
          >
            <span>{index + 1}</span>
            {label}
          </button>
        </li>
      ))}
    </ol>
  );
}

export function WizardFooter({
  step,
  steps,
  name,
  submitting,
  canContinue,
  onBack,
  onNext,
  onCreate,
}: {
  step: number;
  steps: number;
  name: string;
  submitting: boolean;
  canContinue: boolean;
  onBack: () => void;
  onNext: () => void;
  onCreate: () => void;
}) {
  return (
    <footer className="modal-foot">
      <span className="muted">
        {step === steps - 1
          ? "Se materializa la config y, si procede, se crea el worktree"
          : `Paso ${step + 1} de ${steps}`}
      </span>
      <div className="row">
        {step > 0 && (
          <button className="ghost" onClick={onBack} disabled={submitting}>
            Atrás
          </button>
        )}
        {step < steps - 1 ? (
          <button className="primary" onClick={onNext} disabled={!canContinue}>
            Siguiente
          </button>
        ) : (
          <button className="primary" onClick={onCreate} disabled={submitting || !name.trim()}>
            {submitting ? "Creando…" : "Crear workspace"}
          </button>
        )}
      </div>
    </footer>
  );
}
