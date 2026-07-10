import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 28 (R6, R7): guard anti-`embalaje`. Recorre el arbol del repo y falla
// si aparece la palabra `embalaje` (case-insensitive) fuera del whitelist
// confirmado por el humano (decisiones append-only / definicion de la feature).

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

const GUARD_FILE_ABS = path.join(__dirname, "no-embalaje.test.ts");

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "coverage",
  "build",
  "progress",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cts",
  ".mts",
  ".json",
  ".md",
  ".sql",
  ".prisma",
  ".toml",
  ".yml",
  ".yaml",
  ".css",
  ".txt",
  ".sh",
]);

// Rutas (relativas a REPO_ROOT, con separadores normalizados a "/") donde SI
// puede aparecer `embalaje` sin que el guard falle.
//
// Ademas de la whitelist confirmada por el humano (specs de esta feature y
// feature_list.json), se whitelistean explicitamente los DOS artefactos que
// R3/R4 exigen crear y que POR DEFINICION deben citar el valor literal
// 'embalaje' para documentar/verificar el rename (el UPDATE de la migracion y
// el test estatico que lo comprueba por regex). Sin esta excepcion el propio
// guard se auto-contradiria con R3/R4.
const WHITELIST_PREFIXES = [
  "specs/rename-embalaje-fulfillment/",
  "db/migrations/20260710140000_rename_order_status_embalaje_en_fulfillment/",
  // Feature 27: el spec cita 'embalaje' solo para documentar el rename historico
  // (embalaje -> en_fulfillment, feature 28) como contexto; no reintroduce el valor.
  "specs/27-fulfillment-tienda/",
];
const WHITELIST_FILES = new Set([
  "feature_list.json",
  "tests/integration/db/rename-order-status-migration.test.ts",
]);

function toRelPosix(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join("/");
}

function isWhitelisted(absPath: string): boolean {
  if (absPath === GUARD_FILE_ABS) return true;
  const rel = toRelPosix(absPath);
  if (WHITELIST_FILES.has(rel)) return true;
  return WHITELIST_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

interface Hallazgo {
  file: string;
  line: number;
  text: string;
}

function walk(dir: string, hallazgos: Hallazgo[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, hallazgos);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    if (isWhitelisted(abs)) continue;

    const content = fs.readFileSync(abs, "utf8");
    const lines = content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (/embalaje/i.test(line)) {
        hallazgos.push({ file: toRelPosix(abs), line: idx + 1, text: line.trim() });
      }
    });
  }
}

describe("guard anti-embalaje (R6, R7)", () => {
  it("no queda ninguna referencia a 'embalaje' fuera del whitelist", () => {
    const hallazgos: Hallazgo[] = [];
    walk(REPO_ROOT, hallazgos);

    if (hallazgos.length > 0) {
      const detalle = hallazgos
        .map((h) => `${h.file}:${h.line}: ${h.text}`)
        .join("\n");
      throw new Error(`Se encontraron referencias a 'embalaje' fuera del whitelist:\n${detalle}`);
    }

    expect(hallazgos).toHaveLength(0);
  });
});
