/**
 * Preguntas del agente mediante formularios (`session.form`): modelo del dock
 * y funciones puras de valores por defecto, visibilidad y validación. Sin React
 * ni HTTP; los payloads llegan estrechados desde `data/opencodePayloads`.
 */

export type FormValue = string | number | boolean | string[];

/** Respuesta de un formulario: una entrada por `key` de campo. */
export type FormAnswer = Record<string, FormValue>;

export type FormWhen = {
  key: string;
  op: "eq" | "neq";
  value: string | number | boolean;
};

export type FormOption = {
  value: string;
  label: string;
  description?: string;
};

type FormFieldBase = {
  key: string;
  title?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  when?: FormWhen[];
};

export type FormField =
  | (FormFieldBase & {
      type: "string";
      format?: "email" | "uri" | "date" | "date-time";
      minLength?: number;
      maxLength?: number;
      pattern?: string;
      placeholder?: string;
      options?: FormOption[];
      default?: string;
      custom?: boolean;
    })
  | (FormFieldBase & {
      type: "number" | "integer";
      minimum?: number;
      maximum?: number;
      default?: number;
    })
  | (FormFieldBase & {
      type: "boolean";
      default?: boolean;
    })
  | (FormFieldBase & {
      type: "multiselect";
      options: FormOption[];
      minItems?: number;
      maxItems?: number;
      default?: string[];
      custom?: boolean;
    })
  | (FormFieldBase & {
      type: "external";
      url: string;
    });

/** Formulario pendiente ya estrechado en la frontera. */
export type AgentForm = {
  id: string;
  sessionID: string;
  title: string;
  metadata?: Record<string, unknown>;
  fields: FormField[];
};

/** Título legible del campo; cae a su clave si no trae `title`. */
export function formFieldLabel(field: FormField): string {
  const title = field.title?.trim();
  return title || field.key;
}

function conditionHolds(condition: FormWhen, answer: FormAnswer): boolean {
  const value = answer[condition.key];
  const equal = Array.isArray(value)
    ? value.includes(String(condition.value))
    : value === condition.value;
  return condition.op === "eq" ? equal : !equal;
}

/** Un campo se pinta si no está oculto y sus condiciones se cumplen. */
export function isFormFieldVisible(field: FormField, answer: FormAnswer): boolean {
  if (field.hidden) return false;
  return (field.when ?? []).every((condition) => conditionHolds(condition, answer));
}

export function visibleFormFields(form: AgentForm, answer: FormAnswer): FormField[] {
  return form.fields.filter((field) => isFormFieldVisible(field, answer));
}

/** Valores iniciales declarados por el servidor (solo campos visibles). */
export function defaultFormAnswer(form: AgentForm): FormAnswer {
  const answer: FormAnswer = {};
  for (const field of form.fields) {
    if (field.hidden || field.type === "external") continue;
    if (field.default === undefined) continue;
    answer[field.key] = Array.isArray(field.default) ? [...field.default] : field.default;
  }
  return answer;
}

function hasValue(field: FormField, value: FormValue | undefined): boolean {
  if (value === undefined) return false;
  switch (field.type) {
    case "string":
      return typeof value === "string" && value.trim().length > 0;
    case "number":
    case "integer":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "multiselect": {
      if (!Array.isArray(value)) return false;
      const minimum = field.minItems ?? (field.required ? 1 : 0);
      return value.length >= minimum;
    }
    case "external":
      return true;
  }
}

/** ¿Están cubiertos todos los campos obligatorios visibles? */
export function isFormAnswerComplete(form: AgentForm, answer: FormAnswer): boolean {
  return visibleFormFields(form, answer).every(
    (field) => !field.required || hasValue(field, answer[field.key]),
  );
}

/** Añade o reemplaza un formulario por su id. */
export function upsertAgentForm(forms: AgentForm[], form: AgentForm): AgentForm[] {
  const index = forms.findIndex((item) => item.id === form.id);
  if (index === -1) return [...forms, form];
  const next = forms.slice();
  next[index] = form;
  return next;
}

/** Quita un formulario resuelto (respondido o cancelado). */
export function removeAgentForm(forms: AgentForm[], formID: string): AgentForm[] {
  if (!forms.some((item) => item.id === formID)) return forms;
  return forms.filter((item) => item.id !== formID);
}
