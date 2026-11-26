#!/usr/bin/env node
/**
 * Presupuesto del bundle inicial (issue #86).
 *
 * El "bundle inicial" es lo que el navegador descarga antes de ejecutar la app:
 * el chunk de entrada más todos los chunks JS que este importa de forma
 * estática. Los chunks de `lazy()` / `dynamicImports` no cuentan: se cargan al
 * abrir su vista.
 *
 * Lee `dist/.vite/manifest.json` en lugar de buscar nombres conocidos, así que
 * funciona con assets hasheados (`index-CVGjZ74K.js`, etc.).
 *
 * Uso:
 *   pnpm build
 *   pnpm check:bundle
 *   BUNDLE_BUDGET_KB=510 pnpm check:bundle   # presupuesto puntual
 *
 * Falla (exit 1) si el JS inicial supera el presupuesto. También imprime el
 * coste de cada chunk diferido para que las regresiones se vean en el log.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const MANIFEST = path.join(DIST, ".vite", "manifest.json");
const DEFAULT_BUDGET_KB = 500;

const budgetKb = Number(process.env.BUNDLE_BUDGET_KB ?? DEFAULT_BUDGET_KB);
if (!Number.isFinite(budgetKb) || budgetKb <= 0) {
  console.error(`BUNDLE_BUDGET_KB inválido: ${process.env.BUNDLE_BUDGET_KB}`);
  process.exit(1);
}

async function readManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(
        `No existe ${path.relative(ROOT, MANIFEST)}. Ejecuta \`pnpm build\` antes de comprobar el presupuesto.`,
      );
      process.exit(1);
    }
    throw error;
  }
}

async function sizeOf(file) {
  // Read once: stat + read would be a TOCTOU race (and CodeQL flags it).
  const contents = await readFile(path.join(DIST, file));
  return { bytes: contents.length, gzip: gzipSync(contents).length };
}

const kb = (bytes) => bytes / 1000;
const fmtKb = (bytes) => `${kb(bytes).toFixed(2)} kB`;

/** Entrada = chunk con `isEntry` (Vite lo marca en index.html). */
function findEntry(manifest) {
  const entries = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry);
  if (entries.length !== 1) {
    throw new Error(`Se esperaba 1 entrada en el manifest y hay ${entries.length}`);
  }
  return entries[0];
}

/** Cierre de imports estáticos de un chunk, sin entrar en dynamicImports. */
function staticClosure(manifest, key) {
  const seen = new Set();
  const result = [];
  const visit = (currentKey) => {
    if (seen.has(currentKey)) return;
    seen.add(currentKey);
    const chunk = manifest[currentKey];
    if (!chunk) return;
    result.push(currentKey);
    for (const imported of chunk.imports ?? []) visit(imported);
  };
  visit(key);
  return result;
}

function isEntryKey(manifest, key) {
  return Boolean(manifest[key]?.isEntry);
}

/** Coste de un chunk diferido: su fichero + imports estáticos no iniciales. */
function deferredClosure(manifest, key) {
  const seen = new Set();
  const result = [];
  const visit = (currentKey) => {
    if (seen.has(currentKey) || isEntryKey(manifest, currentKey)) return;
    seen.add(currentKey);
    const chunk = manifest[currentKey];
    if (!chunk) return;
    result.push(currentKey);
    for (const imported of chunk.imports ?? []) visit(imported);
  };
  visit(key);
  return result;
}

const manifest = await readManifest();
const [entryKey] = findEntry(manifest);
const initialKeys = staticClosure(manifest, entryKey);

const initial = { bytes: 0, gzip: 0, files: [] };
for (const key of initialKeys) {
  const chunk = manifest[key];
  if (!chunk.file.endsWith(".js")) continue;
  const sizes = await sizeOf(chunk.file);
  initial.bytes += sizes.bytes;
  initial.gzip += sizes.gzip;
  initial.files.push({ file: chunk.file, ...sizes });
}

const deferred = [];
for (const [key, chunk] of Object.entries(manifest)) {
  if (!chunk.isDynamicEntry) continue;
  const files = deferredClosure(manifest, key);
  let bytes = 0;
  let gzip = 0;
  for (const fileKey of files) {
    const file = manifest[fileKey].file;
    if (!file.endsWith(".js")) continue;
    const sizes = await sizeOf(file);
    bytes += sizes.bytes;
    gzip += sizes.gzip;
  }
  deferred.push({ name: chunk.name ?? key, file: chunk.file, bytes, gzip });
}

console.log("Bundle inicial (entrada + imports estáticos):");
for (const item of initial.files) {
  console.log(`  ${fmtKb(item.bytes).padStart(10)}  ${item.file}`);
}
console.log(
  `  ${fmtKb(initial.bytes).padStart(10)}  total (${fmtKb(initial.gzip)} gzip) de ${budgetKb} kB`,
);

if (deferred.length > 0) {
  console.log("\nChunks diferidos (coste al abrir su vista):");
  for (const item of deferred.sort((a, b) => b.bytes - a.bytes)) {
    console.log(
      `  ${fmtKb(item.bytes).padStart(10)}  ${fmtKb(item.gzip).padStart(9)} gzip  ${item.file}`,
    );
  }
}

const initialKb = kb(initial.bytes);
if (initialKb > budgetKb) {
  console.error(
    `\n✗ Bundle inicial ${initialKb.toFixed(2)} kB > presupuesto ${budgetKb} kB. ` +
      "Mueve código a un chunk lazy o justifica y sube BUNDLE_BUDGET_KB.",
  );
  process.exit(1);
}

console.log(
  `\n✓ Bundle inicial ${initialKb.toFixed(2)} kB (${fmtKb(initial.gzip)} gzip) ` +
    `dentro del presupuesto de ${budgetKb} kB.`,
);
