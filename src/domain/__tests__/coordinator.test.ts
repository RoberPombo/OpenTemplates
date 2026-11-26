import { describe, expect, test } from "vitest";
import type { CreateFeatureInput, Feature } from "../features/model";
import { createFeatureDraft } from "../features/model";
import { coordinatorPrompt, decompositionTemplate } from "../features/coordinator";

function draft(overrides: Partial<CreateFeatureInput> = {}): Feature {
  const result = createFeatureDraft({
    id: "feat-1",
    name: "Checkout con Stripe",
    kind: "feature",
    brief: "Cobrar con Stripe en el checkout",
    directory: "/data/features/feat-1",
    root: { repoId: "main", name: "Main", repoPath: "/repos/main" },
    targets: [{ repoId: "front", name: "Front", repoPath: "/repos/front", scopes: ["front"] }],
    now: 1,
    ...overrides,
  });
  if ("error" in result) throw new Error(result.error);
  return result.feature;
}

describe("coordinatorPrompt", () => {
  test("en flujo rápido no hay coordinador", () => {
    expect(coordinatorPrompt(draft({ kind: "hotfix" }))).toBeNull();
  });

  test("incluye objetivo, repos, scopes y contrato", () => {
    const prompt = coordinatorPrompt(
      draft({ issue: { number: 12, title: "Cobro roto", url: "https://example.com/12" } }),
    );

    expect(prompt).toContain("«Checkout con Stripe»");
    expect(prompt).toContain("Cobrar con Stripe en el checkout");
    expect(prompt).toContain("Issue: #12 — Cobro roto");
    expect(prompt).toContain("Metarepo Main");
    expect(prompt).toContain("scopes front");
    expect(prompt).toContain("front");
    expect(prompt).toContain("DECOMPOSITION.md");
    expect(prompt).toContain("feature.propose_steps");
    expect(prompt).toContain("no creas sesiones");
  });
});

describe("decompositionTemplate", () => {
  test("lista cada scope y las secciones que hay que rellenar", () => {
    const template = decompositionTemplate(draft());

    expect(template).toContain("# Descomposición — Checkout con Stripe");
    expect(template).toContain("### Front · front");
    expect(template).toContain("## Orden y dependencias");
    expect(template).toContain("## Verificación");
    expect(template).toContain("- Criterios de aceptación:");
  });
});
