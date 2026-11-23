// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  permissionMessage,
  permissionResources,
  permissionTitle,
  removePermissionRequest,
  upsertPermissionRequest,
  type PermissionRequest,
} from "../chat/permissions";

function request(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: "per_1",
    sessionID: "s1",
    action: "bash",
    resources: ["rm -rf dist"],
    ...overrides,
  };
}

describe("etiquetas del permiso", () => {
  test("traduce las acciones conocidas", () => {
    expect(permissionTitle(request())).toBe("Ejecutar un comando");
    expect(permissionTitle(request({ action: "read" }))).toBe("Leer un archivo");
    expect(permissionTitle(request({ action: "external_directory" }))).toBe(
      "Acceder a otra carpeta",
    );
  });

  test("cae al identificador si la acción es desconocida", () => {
    expect(permissionTitle(request({ action: "custom_tool" }))).toBe("Permiso para custom_tool");
  });

  test("limpia el motivo y los recursos vacíos", () => {
    expect(permissionMessage(request({ message: "  hace falta  " }))).toBe("hace falta");
    expect(permissionMessage(request({ message: "   " }))).toBeUndefined();
    expect(
      permissionResources(request({ resources: ["  git status ", "", "  ", "npm test"] })),
    ).toEqual(["git status", "npm test"]);
  });
});

describe("lista de permisos", () => {
  test("añade al final las peticiones nuevas", () => {
    const first = request();
    const second = request({ id: "per_2", action: "read" });
    expect(upsertPermissionRequest([first], second)).toEqual([first, second]);
  });

  test("reemplaza por id sin duplicar ni mutar la entrada", () => {
    const original = request();
    const updated = request({ message: "ahora con motivo" });
    const input = [original];
    const result = upsertPermissionRequest(input, updated);

    expect(result).toEqual([updated]);
    expect(input).toEqual([original]);
  });

  test("quitar devuelve la misma referencia si no estaba", () => {
    const input = [request()];
    expect(removePermissionRequest(input, "per_otro")).toBe(input);
    expect(removePermissionRequest(input, "per_1")).toEqual([]);
  });
});
