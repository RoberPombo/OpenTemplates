// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  defaultFormAnswer,
  formFieldLabel,
  isFormAnswerComplete,
  removeAgentForm,
  upsertAgentForm,
  visibleFormFields,
  type AgentForm,
} from "../chat/forms";

function form(overrides: Partial<AgentForm> = {}): AgentForm {
  return {
    id: "frm_1",
    sessionID: "s1",
    title: "¿Qué hago?",
    fields: [
      { key: "entorno", type: "string", title: "Entorno", required: true },
      { key: "notas", type: "string", title: "Notas" },
    ],
    ...overrides,
  };
}

describe("valores por defecto", () => {
  test("copia los defaults declarados, incluidas listas y booleanos", () => {
    const include = ["a"];
    const result = defaultFormAnswer({
      id: "frm_2",
      sessionID: "s1",
      title: "Opciones",
      fields: [
        { key: "modo", type: "string", default: "dev" },
        { key: "tests", type: "boolean", default: false },
        { key: "incluir", type: "multiselect", options: [], default: include },
      ],
    });

    expect(result).toEqual({ modo: "dev", tests: false, incluir: ["a"] });
    expect(result.incluir).not.toBe(include);
  });

  test("ignora campos ocultos y externos", () => {
    expect(
      defaultFormAnswer(
        form({
          fields: [
            { key: "oculto", type: "string", hidden: true, default: "x" },
            { key: "url", type: "external", url: "https://example.com" },
          ],
        }),
      ),
    ).toEqual({});
  });
});

describe("visibilidad y etiquetas", () => {
  test("respeta hidden y las condiciones when", () => {
    const target = form({
      fields: [
        { key: "entorno", type: "string", default: "dev" },
        { key: "prod", type: "string", when: [{ key: "entorno", op: "eq", value: "prod" }] },
        { key: "oculto", type: "string", hidden: true },
      ],
    });

    expect(visibleFormFields(target, { entorno: "dev" }).map((field) => field.key)).toEqual([
      "entorno",
    ]);
    expect(visibleFormFields(target, { entorno: "prod" }).map((field) => field.key)).toEqual([
      "entorno",
      "prod",
    ]);
  });

  test("usa title y cae a key", () => {
    expect(formFieldLabel({ key: "notas", type: "string", title: "  Notas " })).toBe("Notas");
    expect(formFieldLabel({ key: "notas", type: "string" })).toBe("notas");
  });
});

describe("validación", () => {
  test("exige los campos obligatorios visibles", () => {
    expect(isFormAnswerComplete(form(), {})).toBe(false);
    expect(isFormAnswerComplete(form(), { entorno: "  " })).toBe(false);
    expect(isFormAnswerComplete(form(), { entorno: "dev" })).toBe(true);
  });

  test("valida números y multiselección", () => {
    const target = form({
      fields: [
        { key: "puerto", type: "integer", required: true },
        { key: "incluir", type: "multiselect", options: [], required: true, minItems: 2 },
        { key: "acepto", type: "boolean", required: true },
      ],
    });
    expect(isFormAnswerComplete(target, { puerto: 3000, incluir: ["a"], acepto: true })).toBe(
      false,
    );
    expect(isFormAnswerComplete(target, { puerto: 3000, incluir: ["a", "b"], acepto: true })).toBe(
      true,
    );
    expect(
      isFormAnswerComplete(target, { puerto: Number.NaN, incluir: ["a", "b"], acepto: true }),
    ).toBe(false);
  });

  test("un campo condicionado oculto no bloquea la respuesta", () => {
    const target = form({
      fields: [
        { key: "entorno", type: "string", default: "dev", required: true },
        {
          key: "prod",
          type: "string",
          required: true,
          when: [{ key: "entorno", op: "eq", value: "prod" }],
        },
      ],
    });
    expect(isFormAnswerComplete(target, { entorno: "dev" })).toBe(true);
  });
});

describe("lista de formularios", () => {
  test("añade, reemplaza y quita por id", () => {
    const first = form();
    const second = form({ id: "frm_2" });
    expect(upsertAgentForm([first], second)).toEqual([first, second]);

    const updated = form({ title: "Actualizado" });
    expect(upsertAgentForm([first], updated)).toEqual([updated]);

    const input = [first];
    expect(removeAgentForm(input, "frm_otro")).toBe(input);
    expect(removeAgentForm(input, "frm_1")).toEqual([]);
  });
});
