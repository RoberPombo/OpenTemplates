/**
 * Encargo del coordinador y plantilla de descomposición. El coordinador es una
 * sesión que solo produce contenido; la app ejecuta. Aquí vive el contrato para
 * que la sesión no tenga que adivinarlo y para poder previsualizarlo en la UI.
 */
import type { Feature } from "./model";

export type FeatureArtifact = {
  name: string;
  content: string;
};

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
    "Incluye estas secciones:",
    "- Targets y scopes confirmados, o petición de añadir uno con feature.request_target.",
    "- Brief por scope: qué investigar y criterios de aceptación.",
    "- Orden y dependencias entre scopes.",
    "- Riesgos.",
    "- Estrategia de verificación por scope.",
    "",
    "El flujo de pasos ya está generado: no inventes pasos nuevos.",
    "Cuando la descomposición esté lista, pide aprobación con feature.propose_steps.",
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
  return lines.join("\n");
}
