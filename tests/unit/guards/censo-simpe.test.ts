import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 118 (R12) — GUARD de censo case-sensitive del literal historico "SIMPE".
// Recorre el arbol de fuentes de produccion y tests (app/, lib/, tests/, e2e/) y
// falla si ALGUN archivo conserva el typo "SIMPE" (mayusculas). Es la red que impide
// que el valor viejo del enum reaparezca en codigo o aserciones nuevas.
//
// El literal "SIMPE" SOLO puede sobrevivir en:
//   - la migracion historica (db/migrations/20260711150000_*) y el down.sql de esta
//     feature (db/migrations/*_metodo_pago_rename_simpe_to_sinpe/down.sql): ambos
//     estan bajo db/, que NO se escanea aqui (fuera del arbol app/lib/tests/e2e).
//   - los tests de migracion que AFIRMAN esos literales (allowlist de abajo), por
//     trazabilidad de R10 (migracion historica) y R2/R3 (rename UP/DOWN).
//   - este mismo archivo, que contiene el literal como patron de busqueda.
//
// NOTA: no depende de `total_simpe`/`totalSimpe`/clave DTO `simpe` (minusculas): esos
// identificadores internos (R9) no coinciden con el censo case-sensitive de "SIMPE".

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SCAN_DIRS = ["app", "lib", "tests", "e2e"];
const SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql", ".css", ".json"]);
const NEEDLE = ["SIM", "PE"].join(""); // evita auto-match trivial en la lectura

// Archivos que legitimamente conservan el literal historico (allowlist, por basename):
const ALLOWLIST = new Set([
  "censo-simpe.test.ts", // este guard (contiene el patron de busqueda)
  "gestion-orden-migration.test.ts", // R10: afirma el literal historico 'SIMPE'
  "metodo-pago-rename-simpe-sinpe-migration.test.ts", // R2/R3: afirma el RENAME VALUE
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...walk(full));
    } else if (SCAN_EXTS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

describe("R12 — invariante de censo: ningun 'SIMPE' fuera de la allowlist", () => {
  it("no hay coincidencias case-sensitive de 'SIMPE' en app/, lib/, tests/, e2e/", () => {
    const offenders: string[] = [];
    for (const rel of SCAN_DIRS) {
      const base = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(base)) continue;
      for (const file of walk(base)) {
        if (ALLOWLIST.has(path.basename(file))) continue;
        const content = fs.readFileSync(file, "utf8");
        if (content.includes(NEEDLE)) {
          offenders.push(path.relative(REPO_ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
