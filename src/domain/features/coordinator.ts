/**
 * Encargo del coordinador y plantilla de descomposición. El coordinador es una
 * sesión que solo produce contenido; la app ejecuta. Aquí vive el contrato para
 * que la sesión no tenga que adivinarlo y para poder previsualizarlo en la UI.
 */
import type { Feature } from "./model";
import type { ServerInfo } from "../../types";
import { DECOMPOSITION_BLOCK } from "./decomposition";
import { resolveStepProfile } from "./steps";

export type FeatureArtifact = {
  name: string;
  content: string;
};

/** Contexto y servidor efímero del coordinador; no es un workspace. */
export type FeatureRunnerInfo = {
  featureId: string;
  profileId: string | null;
  directory: string;
  contextHash: string;
  server: ServerInfo;
  warnings: string[];
};

export type CoordinatorProfile = { id: string; name: string };

/** Identificador de la "sesión" sintética que pinta el chat del coordinador. */
export function coordinatorWorkspaceId(featureId: string): string {
  return `feature:${featureId}`;
}

export function coordinatorScope(): string {
  return "coordinator";
}

/**
 * Perfil del coordinador: el del paso si ya está fijado, luego el que se llama
 * coordinador, luego el perfil por defecto de la app y, si no hay nada, el
 * primero. La UI puede cambiarlo antes de lanzar; la sesión usa ese contexto.
 */
export function coordinatorProfileId(
  feature: Feature,
  profiles: CoordinatorProfile[],
  defaultProfileId?: string | null,
): string | null {
  const coordinate = feature.steps.find((step) => step.type === "coordinate");
  if (coordinate) return resolveStepProfile(coordinate, profiles, defaultProfileId);
  const exists = (id: string | null | undefined) =>
    Boolean(id && profiles.some((profile) => profile.id === id));
  const named = profiles.find((profile) =>
    /coordinador|coordinator/i.test(`${profile.id} ${profile.name}`),
  );
  if (named) return named.id;
  if (exists(defaultProfileId)) return defaultProfileId!;
  return profiles[0]?.id ?? null;
}

export const BRIEF_FILE = "BRIEF.md";
export const DECOMPOSITION_FILE = "DECOMPOSITION.md";
export const NOTES_FILE = "NOTES.md";

function targetLine(feature: Feature): string[] {
  const lines: string[] = [];
  if (feature.root) {
    lines.push(
      `- Metarepo ${feature.root.name}: ${feature.directory}/${feature.root.relativePath}` +
        ` · rama ${feature.root.branch} · base ${feature.root.baseBranch}`,
    );
  }
  for (const target of feature.targets) {
    lines.push(
      `- ${target.name}: ${feature.directory}/${target.relativePath}` +
        ` · scopes ${target.scopes.map((scope) => scope.path).join(", ")}` +
        ` · rama ${target.branch} · base ${target.baseBranch}`,
    );
  }
  return lines;
}

/** Encargo completo para la sesión del coordinador; `null` en flujos rápidos. */
export function coordinatorPrompt(feature: Feature): string | null {
  if (feature.flow === "fast") return null;

  const lines = [
    `Eres el coordinador de la feature «${feature.name}» (${feature.id}).`,
    "",
    "No editas código, no haces commit ni push y no creas sesiones.",
    "Solo decides contenido: alcance, orden y riesgos. La app ejecuta los pasos.",
    "",
    "## Objetivo",
    feature.brief.trim() || "(sin brief)",
  ];

  if (feature.issue) {
    lines.push(
      "",
      `Issue: #${feature.issue.number} — ${feature.issue.title}` +
        (feature.issue.url ? `\n${feature.issue.url}` : ""),
    );
  }

  lines.push("", "## Repos y scopes", ...targetLine(feature));
  lines.push(
    "",
    `## Entregable: ${DECOMPOSITION_FILE}`,
    `Escribe el artefacto en la carpeta de la feature: ${feature.directory}/${DECOMPOSITION_FILE}`,
    "Incluye estas secciones:",
    "- Targets y scopes confirmados, o petición de añadir uno.",
    "- Brief por scope: qué investigar y criterios de aceptación.",
    "- Orden y dependencias entre scopes.",
    "- Riesgos.",
    "- Estrategia de verificación por scope.",
    "",
    `Además, deja un bloque \`\`\`${DECOMPOSITION_BLOCK} con la propuesta que la app`,
    "puede validar y ejecutar. Es tu forma de pedir targets y de proponer los",
    "scopes de los pasos:",
    "```" + DECOMPOSITION_BLOCK,
    "{",
    '  "requestTargets": [{ "name": "...", "repoPath": "...", "baseBranch": "...", "scopes": ["."] }],',
    '  "proposeSteps": [{ "targetId": "target-...", "scopes": ["front"] }]',
    "}",
    "```",
    "",
    "`requestTargets` crea el worktree de un repo que faltaba; `proposeSteps` fija",
    "los scopes de cada target. La app expande recon, plan, implementación y",
    "verificación, y el usuario aprueba la descomposición en la UI.",
    "No inventes un grafo de pasos distinto ni llames a herramientas que no existan:",
    "la app ejecuta `feature.propose_steps` y `feature.request_target` al aprobar.",
  );
  return lines.join("\n");
}

/** Esqueleto para que el coordinador (o el usuario) lo rellene. */
export function decompositionTemplate(feature: Feature): string {
  const lines = [`# Descomposición — ${feature.name}`, "", "## Targets y scopes"];

  if (feature.root) {
    lines.push(`- Metarepo ${feature.root.name} (\`${feature.root.relativePath}\`)`);
  }
  for (const target of feature.targets) {
    lines.push(
      `- ${target.name} (\`${target.relativePath}\`): ` +
        target.scopes.map((scope) => scope.path).join(", "),
    );
  }

  lines.push("", "## Brief por scope");
  for (const target of feature.targets) {
    for (const scope of target.scopes) {
      const where = scope.path === "." ? target.name : `${target.name} · ${scope.path}`;
      lines.push(`### ${where}`, "- Qué investigar:", "- Criterios de aceptación:", "");
    }
  }

  lines.push("## Orden y dependencias", "", "## Riesgos", "", "## Verificación", "");

  lines.push(
    "## Propuesta para la app",
    "",
    "```" + DECOMPOSITION_BLOCK,
    "{",
    '  "requestTargets": [],',
    '  "proposeSteps": [',
  );
  for (const target of feature.targets) {
    lines.push(
      `    { "targetId": "${target.id}", "scopes": ${JSON.stringify(
        target.scopes.map((scope) => scope.path),
      )} },`,
    );
  }
  lines.push("  ]", "}", "```", "");
  return lines.join("\n");
}
