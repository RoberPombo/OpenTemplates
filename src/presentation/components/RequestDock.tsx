/**
 * Dock sobre el composer con lo que el agente espera del usuario: permisos
 * (`permission.*`) y preguntas en formulario (`session.form`). Es un dock, no
 * un modal: deja el chat y el composer visibles mientras hay algo pendiente.
 *
 * Los payloads llegan ya estrechados por el adaptador; aquí solo hay estado
 * local del formulario y llamadas a los callbacks del hook.
 */
import { useState } from "react";
import { safeExternalUrl } from "../../domain/shared";
import {
  defaultFormAnswer,
  formFieldLabel,
  isFormAnswerComplete,
  visibleFormFields,
  type AgentForm,
  type FormAnswer,
  type FormField,
  type FormValue,
} from "../../domain/chat/forms";
import {
  permissionMessage,
  permissionResources,
  permissionTitle,
  type PermissionDecision,
  type PermissionRequest,
} from "../../domain/chat/permissions";
import { Button, Select, TextInput } from "./ui";

type Props = {
  permissions: PermissionRequest[];
  forms: AgentForm[];
  busy: string | null;
  error: string | null;
  onPermission: (request: PermissionRequest, decision: PermissionDecision) => void;
  onFormReply: (form: AgentForm, answer: FormAnswer) => void;
  onFormCancel: (form: AgentForm) => void;
};

export function RequestDock({
  permissions,
  forms,
  busy,
  error,
  onPermission,
  onFormReply,
  onFormCancel,
}: Props) {
  if (permissions.length === 0 && forms.length === 0 && !error) return null;

  return (
    <section className="request-dock" aria-label="Permisos y preguntas del agente">
      {error && <p className="request-error">{error}</p>}
      {permissions.map((request) => (
        <PermissionCard
          key={request.id}
          request={request}
          busy={busy}
          onPermission={onPermission}
        />
      ))}
      {forms.map((form) => (
        <FormCard
          key={form.id}
          form={form}
          busy={busy}
          onReply={onFormReply}
          onCancel={onFormCancel}
        />
      ))}
    </section>
  );
}

function PermissionCard({
  request,
  busy,
  onPermission,
}: {
  request: PermissionRequest;
  busy: string | null;
  onPermission: (request: PermissionRequest, decision: PermissionDecision) => void;
}) {
  const resources = permissionResources(request);
  const message = permissionMessage(request);
  const disabled = busy !== null;

  return (
    <article
      className="request-card permission"
      aria-label={`Permiso: ${permissionTitle(request)}`}
    >
      <header className="request-head">
        <span className="request-badge">Permiso</span>
        <strong>{permissionTitle(request)}</strong>
        <span className="request-action">{request.action}</span>
      </header>

      {resources.length > 0 && (
        <ul className="request-resources">
          {resources.map((resource) => (
            <li key={resource}>
              <code>{resource}</code>
            </li>
          ))}
        </ul>
      )}

      {message && <p className="request-message">{message}</p>}

      <div className="request-actions">
        <Button
          variant="primary"
          size="small"
          disabled={disabled}
          onClick={() => onPermission(request, "once")}
        >
          Permitir una vez
        </Button>
        <Button size="small" disabled={disabled} onClick={() => onPermission(request, "always")}>
          Permitir siempre
        </Button>
        <Button
          variant="danger"
          size="small"
          disabled={disabled}
          onClick={() => onPermission(request, "reject")}
        >
          Rechazar
        </Button>
      </div>
    </article>
  );
}

function FormCard({
  form,
  busy,
  onReply,
  onCancel,
}: {
  form: AgentForm;
  busy: string | null;
  onReply: (form: AgentForm, answer: FormAnswer) => void;
  onCancel: (form: AgentForm) => void;
}) {
  const [answer, setAnswer] = useState<FormAnswer>(() => defaultFormAnswer(form));
  const visible = visibleFormFields(form, answer);
  const complete = isFormAnswerComplete(form, answer);
  const disabled = busy !== null;

  function setValue(key: string, value: FormValue | undefined) {
    setAnswer((prev) => {
      if (value === undefined) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
  }

  function submit() {
    const payload: FormAnswer = {};
    for (const field of visible) {
      const value = answer[field.key];
      if (value !== undefined && field.type !== "external") payload[field.key] = value;
    }
    onReply(form, payload);
  }

  return (
    <article className="request-card question" aria-label={`Pregunta: ${form.title}`}>
      <header className="request-head">
        <span className="request-badge question">Pregunta</span>
        <strong>{form.title}</strong>
      </header>

      <div className="request-fields">
        {visible.map((field) => (
          <FormFieldControl
            key={field.key}
            formId={form.id}
            field={field}
            value={answer[field.key]}
            onChange={(value) => setValue(field.key, value)}
          />
        ))}
      </div>

      <div className="request-actions">
        <Button variant="primary" size="small" disabled={disabled || !complete} onClick={submit}>
          Responder
        </Button>
        <Button variant="danger" size="small" disabled={disabled} onClick={() => onCancel(form)}>
          Cancelar
        </Button>
      </div>
    </article>
  );
}

function FormFieldControl({
  formId,
  field,
  value,
  onChange,
}: {
  formId: string;
  field: FormField;
  value: FormValue | undefined;
  onChange: (value: FormValue | undefined) => void;
}) {
  const label = formFieldLabel(field);
  const id = `${formId}-${field.key}`;
  const required = field.required ? <span className="request-required">*</span> : null;

  if (field.type === "boolean") {
    return (
      <label className="request-field request-check" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          {label}
          {required}
        </span>
      </label>
    );
  }

  return (
    <div className="request-field">
      <label className="request-label" htmlFor={id}>
        {label}
        {required}
      </label>
      {field.description && <p className="request-hint">{field.description}</p>}
      {field.type === "string" &&
        (field.options && field.options.length > 0 ? (
          <Select
            aria-label={label}
            value={typeof value === "string" ? value : ""}
            placeholder="Selecciona una opción…"
            options={field.options.map((option) => ({
              value: option.value,
              label: option.label,
              description: option.description,
            }))}
            onValueChange={(next) => onChange(next)}
          />
        ) : (
          <TextInput
            id={id}
            type={inputType(field)}
            value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder}
            minLength={field.minLength}
            maxLength={field.maxLength}
            onChange={(event) => onChange(event.target.value)}
          />
        ))}
      {(field.type === "number" || field.type === "integer") && (
        <TextInput
          id={id}
          type="number"
          value={typeof value === "number" ? String(value) : ""}
          min={field.minimum}
          max={field.maximum}
          step={field.type === "integer" ? 1 : "any"}
          onChange={(event) =>
            onChange(event.target.value === "" ? undefined : Number(event.target.value))
          }
        />
      )}
      {field.type === "multiselect" && (
        <div className="request-options">
          {field.options.map((option) => {
            const selected = Array.isArray(value) ? value : [];
            return (
              <label key={option.value} className="request-option">
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, option.value]
                        : selected.filter((item) => item !== option.value),
                    )
                  }
                />
                <span>
                  {option.label}
                  {option.description && <em>{option.description}</em>}
                </span>
              </label>
            );
          })}
        </div>
      )}
      {field.type === "external" && <ExternalLink url={field.url} />}
    </div>
  );
}
/** Enlace externo del agente: solo http(s)/mailto; si no, texto sin href. */
function ExternalLink({ url }: { url: string }) {
  const href = safeExternalUrl(url);
  if (!href) return <span className="request-link">Enlace no válido</span>;
  return (
    <a className="request-link" href={href} target="_blank" rel="noreferrer">
      Abrir enlace
    </a>
  );
}

function inputType(field: Extract<FormField, { type: "string" }>) {
  switch (field.format) {
    case "email":
      return "email";
    case "uri":
      return "url";
    case "date":
      return "date";
    case "date-time":
      return "datetime-local";
    default:
      return "text";
  }
}
