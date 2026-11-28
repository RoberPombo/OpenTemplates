/** Issue abierto de GitHub y su paso al `IssueRef` de la feature. */
import type { IssueRef } from "../../types";

export type GitHubIssue = {
  number: number;
  title: string;
  labels: string[];
  author: string;
  url: string;
  /** Cuerpo ya saneado y recortado por Rust. */
  body: string;
  bodyTruncated: boolean;
};

/** Guarda solo lo que necesita la feature; etiquetas y autor son de la lista. */
export function toIssueRef(issue: GitHubIssue): IssueRef {
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url || null,
    body: issue.body.trim() ? issue.body : null,
  };
}

/** Resumen de una línea para la lista del selector, sin volcar el cuerpo. */
export function shortIssueText(value: string, limit = 160): string {
  const text = value.trim().replace(/\s+/g, " ");
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

export function sameIssue(a: GitHubIssue | null, b: GitHubIssue | null): boolean {
  if (!a || !b) return a === b;
  return a.number === b.number && a.url === b.url;
}
