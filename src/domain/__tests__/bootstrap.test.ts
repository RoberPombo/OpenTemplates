import { describe, expect, test } from "vitest";
import type { BootstrapCandidate, BootstrapEntry } from "../../types";
import { bootstrapKey, decisionsToBootstrap, proposeBootstrap } from "../features/bootstrap";

const configured: BootstrapEntry = { path: ".env", mode: "copy", required: true };
const candidates: BootstrapCandidate[] = [
  { path: ".env", kind: "env" },
  { path: ".env.local", kind: "env" },
  { path: "docker-compose.override.yml", kind: "override" },
];

describe("proposeBootstrap", () => {
  test("conserva lo configurado y propone lo detectado sin duplicar", () => {
    const proposals = proposeBootstrap([configured], candidates);

    expect(proposals.map((item) => item.path)).toEqual([
      ".env",
      ".env.local",
      "docker-compose.override.yml",
    ]);
    expect(proposals[0]).toMatchObject({
      path: ".env",
      mode: "copy",
      required: true,
      source: "configured",
      kind: null,
    });
    expect(proposals[1]).toMatchObject({
      path: ".env.local",
      mode: "copy",
      required: false,
      source: "detected",
      kind: "env",
    });
    expect(proposals[2]).toMatchObject({
      path: "docker-compose.override.yml",
      source: "detected",
      kind: "override",
    });
  });

  test("acepta por defecto solo lo configurado", () => {
    const proposals = proposeBootstrap([configured], candidates);

    expect(decisionsToBootstrap("repo-1", proposals, {})).toEqual([configured]);
  });

  test("acepta lo marcado y permite descartar lo configurado", () => {
    const proposals = proposeBootstrap([configured], candidates);
    const decisions = {
      [bootstrapKey("repo-1", ".env")]: false,
      [bootstrapKey("repo-1", ".env.local")]: true,
    };

    expect(decisionsToBootstrap("repo-1", proposals, decisions)).toEqual([
      { path: ".env.local", mode: "copy", required: false },
    ]);
  });

  test("no inventa entradas si no hay nada", () => {
    expect(proposeBootstrap()).toEqual([]);
    expect(proposeBootstrap([], [])).toEqual([]);
    expect(decisionsToBootstrap("repo-1", [], {})).toEqual([]);
  });

  test("ignora rutas vacías y repetidas del backend", () => {
    const proposals = proposeBootstrap(
      [{ path: " .env ", mode: "copy" }],
      [
        { path: ".env", kind: "env" },
        { path: "  ", kind: "env" },
        { path: ".env.local", kind: "env" },
      ],
    );

    expect(proposals.map((item) => item.path)).toEqual([".env", ".env.local"]);
  });
});
