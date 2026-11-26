#!/usr/bin/env node
/**
 * Guardarraíl de la regla de dependencia entre capas (issue #76).
 *
 * Recorre `src/` y falla si:
 *   - `src/domain/**` importa React, Tauri, el SDK de OpenCode, `src/data` o
 *     `src/presentation`, o usa `localStorage`.
 *   - `src/presentation/**` y `src/App.tsx` importan Tauri, el SDK de OpenCode
 *     o `src/data`, o usan `localStorage`/`window.confirm` directamente.
 *
 * Los tests (`__tests__/`, `tests/`, `*.test.*` y `*.spec.*`) quedan fuera:
 * pueden montar adaptadores y dobles sin respetar la dirección de dependencias.
 *
 * No es un linter general: solo comprueba esta regla. No usa dependencias
 * externas para poder ejecutarse antes de `pnpm install` si hiciera falta.
 *
 * Excepciones conocidas:
 *   Hoy no hay ninguna. La lista `EXCEPTIONS` existe para documentar aquí, de
 *   forma explícita y revisable, cualquier futura excepción (por ejemplo, un
 *   adaptador que aún no se haya movido a `data/`). Cada entrada debe indicar
 *   el fichero, la regla y el motivo; si se puede, también el import exacto.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

/**
 * Excepciones explícitas a la regla de capas.
 *
 * Forma de cada entrada:
 *   {
 *     file: "presentation/components/Ejemplo.tsx", // ruta relativa a src/
 *     rule: "tauri",                                // id de la regla
 *     specifier: "@tauri-apps/api/core",            // opcional, import exacto
 *     reason: "Motivo concreto y qué habría que hacer para eliminarla.",
 *   }
 */
const EXCEPTIONS = [];

/** Extrae los especificadores de import/export/require de un fuente ya sin comentarios. */
function extractImports(source) {
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  const imports = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      imports.push({ specifier: match[1], index: match.index ?? 0 });
    }
  }
  return imports;
}

function lineNumber(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

/**
 * Elimina comentarios conservando longitudes y saltos de línea, para que las
 * líneas del informe sigan siendo correctas y un comentario que mencione
 * `localStorage` no provoque un falso positivo.
 */
function stripComments(source) {
  let result = "";
  let state = "code";
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (char === "/" && next === "/") {
        result += "  ";
        state = "line";
        i += 1;
      } else if (char === "/" && next === "*") {
        result += "  ";
        state = "block";
        i += 1;
      } else {
        result += char;
        if (char === "'") state = "single";
        else if (char === '"') state = "double";
        else if (char === "`") state = "template";
      }
    } else if (state === "line") {
      if (char === "\n") {
        result += char;
        state = "code";
      } else {
        result += " ";
      }
    } else if (state === "block") {
      if (char === "*" && next === "/") {
        result += "  ";
        state = "code";
        i += 1;
      } else {
        result += char === "\n" ? char : " ";
      }
    } else {
      result += char;
      if (char === "\\") {
        result += next ?? "";
        i += 1;
      } else if (
        (state === "single" && char === "'") ||
        (state === "double" && char === '"') ||
        (state === "template" && char === "`")
      ) {
        state = "code";
      }
    }
  }
  return result;
}

function relativeToSource(file) {
  return path.relative(SRC, file).split(path.sep).join("/");
}

function isTestFile(relative) {
  const segments = relative.split("/");
  if (segments.includes("__tests__") || segments.includes("tests")) return true;
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relative);
}

function layerOf(relative) {
  if (relative === "App.tsx") return "app";
  if (relative.startsWith("domain/")) return "domain";
  if (relative.startsWith("presentation/")) return "presentation";
  return null;
}

/** Resuelve un import relativo a una ruta normalizada dentro de `src/`. */
function resolveRelative(fromRelative, specifier) {
  const clean = specifier.split("?")[0];
  if (!clean.startsWith(".")) return null;
  const base = path.resolve(path.dirname(path.join(SRC, fromRelative)), clean);
  return path.relative(SRC, base).split(path.sep).join("/");
}

function inLayer(resolved, layer) {
  return resolved === layer || resolved.startsWith(`${layer}/`);
}

function isPackage(specifier, name) {
  return specifier === name || specifier.startsWith(`${name}/`);
}

function describeImport(rule, specifier, layer) {
  switch (rule) {
    case "react":
      return `domain/ prohíbe importar React: "${specifier}"`;
    case "tauri":
      return `${layer}/ prohíbe importar Tauri directamente: "${specifier}"`;
    case "opencode":
      return `${layer}/ prohíbe importar el SDK de OpenCode directamente: "${specifier}"`;
    case "data":
      return `${layer}/ prohíbe importar la capa data: "${specifier}"`;
    case "presentation":
      return "domain/ prohíbe importar la capa presentation";
    default:
      return `Regla ${rule} incumplida: "${specifier}"`;
  }
}

function describeUsage(rule, layer) {
  switch (rule) {
    case "localStorage":
      return `${layer}/ prohíbe usar localStorage directamente; pasa por el puerto Preferences`;
    case "windowConfirm":
      return `${layer}/ prohíbe usar window.confirm directamente; pasa por el puerto ConfirmDialog`;
    default:
      return `Regla ${rule} incumplida`;
  }
}

function isExcepted(violation) {
  return EXCEPTIONS.some(
    (exception) =>
      exception.file === violation.file &&
      exception.rule === violation.rule &&
      (exception.specifier === undefined || exception.specifier === violation.specifier),
  );
}

function collectImports(relative, source, layer) {
  const violations = [];
  const seen = new Set();
  for (const { specifier, index } of extractImports(source)) {
    const key = `${index}:${specifier}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const resolved = resolveRelative(relative, specifier);
    const line = lineNumber(source, index);
    const add = (rule) => {
      violations.push({
        file: relative,
        line,
        layer,
        rule,
        specifier,
        message: describeImport(rule, specifier, layer),
      });
    };

    if (layer === "domain") {
      if (isPackage(specifier, "react")) add("react");
      if (isPackage(specifier, "@tauri-apps")) add("tauri");
      if (isPackage(specifier, "@opencode")) add("opencode");
      if (resolved && inLayer(resolved, "data")) add("data");
      if (resolved && inLayer(resolved, "presentation")) add("presentation");
    } else {
      if (isPackage(specifier, "@tauri-apps")) add("tauri");
      if (isPackage(specifier, "@opencode")) add("opencode");
      if (resolved && inLayer(resolved, "data")) add("data");
    }
  }
  return violations;
}

function collectUsages(relative, source, layer) {
  const violations = [];
  const checks =
    layer === "domain"
      ? [{ rule: "localStorage", pattern: /\blocalStorage\b/g }]
      : [
          { rule: "localStorage", pattern: /\blocalStorage\b/g },
          { rule: "windowConfirm", pattern: /\bwindow\s*\.\s*confirm\b/g },
        ];

  for (const { rule, pattern } of checks) {
    for (const match of source.matchAll(pattern)) {
      violations.push({
        file: relative,
        line: lineNumber(source, match.index ?? 0),
        layer,
        rule,
        specifier: undefined,
        message: describeUsage(rule, layer),
      });
    }
  }
  return violations;
}

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name === "tests") {
        continue;
      }
      files.push(...(await listSourceFiles(absolute)));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(absolute);
    }
  }
  return files;
}

async function main() {
  const files = await listSourceFiles(SRC);
  const violations = [];
  const counts = { domain: 0, presentation: 0, app: 0 };

  for (const file of files) {
    const relative = relativeToSource(file);
    const layer = layerOf(relative);
    if (!layer || isTestFile(relative)) continue;
    counts[layer] += 1;

    const source = stripComments(await readFile(file, "utf8"));
    violations.push(
      ...collectImports(relative, source, layer),
      ...collectUsages(relative, source, layer),
    );
  }

  const effective = violations.filter((violation) => !isExcepted(violation));
  if (effective.length > 0) {
    console.error(`\n✗ Regla de capas: ${effective.length} violación(es) encontradas.\n`);
    for (const violation of effective) {
      console.error(`  ${violation.file}:${violation.line}  ${violation.message}`);
    }
    console.error(
      "\nMueve la dependencia a un adaptador de data/ o pásala por un puerto de domain/.",
    );
    console.error("Si es una excepción legítima, documéntala en scripts/check-layers.mjs.\n");
    process.exitCode = 1;
    return;
  }

  const checked = counts.domain + counts.presentation + counts.app;
  console.log(
    `✓ Regla de capas: ${checked} ficheros revisados ` +
      `(domain ${counts.domain}, presentation ${counts.presentation}, App ${counts.app}).`,
  );
}

try {
  await main();
} catch (error) {
  console.error(`✗ check-layers no pudo completarse: ${error.message}`);
  process.exitCode = 1;
}
