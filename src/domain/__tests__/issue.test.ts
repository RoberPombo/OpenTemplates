import { describe, expect, test } from "vitest";
import { sameIssue, shortIssueText, toIssueRef, type GitHubIssue } from "../features/issue";

const issue: GitHubIssue = {
  number: 12,
  title: "Cobro roto",
  labels: ["bug", "pagos"],
  author: "ana",
  url: "https://github.com/acme/app/issues/12",
  body: "El pago falla.\n\nDetalle",
  bodyTruncated: false,
};

describe("issue de feature", () => {
  test("pasa solo número, título, URL y cuerpo al IssueRef", () => {
    expect(toIssueRef(issue)).toEqual({
      number: 12,
      title: "Cobro roto",
      url: "https://github.com/acme/app/issues/12",
      body: "El pago falla.\n\nDetalle",
    });
  });

  test("un cuerpo vacío queda como null y una URL vacía también", () => {
    const ref = toIssueRef({ ...issue, url: "", body: "   " });
    expect(ref.url).toBeNull();
    expect(ref.body).toBeNull();
  });

  test("resume el cuerpo en una línea sin volcarlo entero", () => {
    const body = `linea uno\n\nlinea dos ${"x".repeat(200)}`;
    const text = shortIssueText(body, 40);
    expect(text).toContain("linea uno linea dos");
    expect(text.length).toBeLessThanOrEqual(40);
    expect(text.endsWith("…")).toBe(true);
  });

  test("compara issues por número y URL", () => {
    expect(sameIssue(issue, { ...issue, title: "otro" })).toBe(true);
    expect(sameIssue(issue, { ...issue, number: 13 })).toBe(false);
    expect(sameIssue(null, null)).toBe(true);
    expect(sameIssue(issue, null)).toBe(false);
  });
});
