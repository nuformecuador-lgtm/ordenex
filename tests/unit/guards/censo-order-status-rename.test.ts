import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 135 (R13) — GUARD de censo case-sensitive de los 6 values ANTIGUOS de
// order_status renombrados por esta feature. Recorre el arbol de fuentes y tests
// (app/, lib/, components/, hooks/, scripts/, tests/, e2e/) y falla si ALGUN archivo
// conserva un value viejo. Es la red que impide que la nomenclatura antigua reaparezca
// en constantes, sets, uniones-literal, datos de test o comentarios.
//
// Los literales antiguos SOLO pueden sobrevivir en:
//   - db/migrations/** (historicas) y el down.sql de esta feature: NO se escanean aqui
//     (db/ no esta en SCAN_DIRS).
//   - los tests de migracion que AFIRMAN esos literales HISTORICOS o la traza UP/DOWN
//     del rename (allowlist de abajo), por R10 (historicas) y R2/R3 (rename).
//   - este mismo archivo, que contiene los patrones de busqueda.
//
// CUIDADO case-sensitive: `en_bodega` se censa por igualdad EXACTA (word boundary),
// sin marcar `en_bodega_satelite`, `en_ruta_bodega_satelite` ni el nuevo
// `en_bodega_central` (R11).

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SCAN_DIRS = ["app", "lib", "components", "hooks", "scripts", "tests", "e2e"];
const SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql", ".css", ".json"]);

// 6 values antiguos (regex case-sensitive, word boundary). El word boundary evita
// falsos positivos: `\ben_bodega\b` no matchea `en_bodega_satelite`/`en_bodega_central`.
const OLD_VALUES: Array<{ label: string; re: RegExp }> = [
  { label: "en_reparto", re: /\ben_reparto\b/ },
  { label: "en_espera_aceptacion", re: /\ben_espera_aceptacion\b/ },
  { label: "en_ruta_bodega_principal", re: /\ben_ruta_bodega_principal\b/ },
  { label: "en_bodega", re: /\ben_bodega\b/ },
  { label: "devuelta_origen", re: /\bdevuelta_origen\b/ },
  { label: "recibido_origen", re: /\brecibido_origen\b/ },
];

// Archivos que legitimamente conservan literales antiguos (allowlist, por basename):
const ALLOWLIST = new Set([
  "censo-order-status-rename.test.ts", // este guard (contiene los patrones)
  "order-status-enum-migration.test.ts", // R10: afirma los 8 literales HISTORICOS del enum
  "gestion-orden-migration.test.ts", // R10: afirma el ADD VALUE historico 'en_reparto'
  "cierre-detail-migration.test.ts", // R10: referencia el nombre de carpeta historica *_recibido_origen
  "zonas-migration.test.ts", // R10: referencia el nombre de carpeta historica *_recibido_origen
  "orden-num-guia-deferred.test.ts", // R10: afirma el ADD VALUE/INSERT historico 'en_espera_aceptacion'
  "order-status-rename-nomenclatura-migration.test.ts", // R2/R3: traza UP/DOWN del rename
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

describe("R13 — invariante de censo: ningun value antiguo de order_status fuera de la allowlist", () => {
  it("no hay coincidencias case-sensitive de los 6 values antiguos en app/, lib/, components/, hooks/, scripts/, tests/, e2e/", () => {
    const offenders: string[] = [];
    for (const rel of SCAN_DIRS) {
      const base = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(base)) continue;
      for (const file of walk(base)) {
        if (ALLOWLIST.has(path.basename(file))) continue;
        const content = fs.readFileSync(file, "utf8");
        const hits = OLD_VALUES.filter((v) => v.re.test(content)).map((v) => v.label);
        if (hits.length > 0) {
          offenders.push(`${path.relative(REPO_ROOT, file)} -> ${hits.join(", ")}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("el censo de en_bodega es por igualdad EXACTA (no marca los vecinos satelite ni el nuevo central)", () => {
    const enBodega = OLD_VALUES.find((v) => v.label === "en_bodega")!.re;
    expect(enBodega.test("en_bodega_satelite")).toBe(false);
    expect(enBodega.test("en_ruta_bodega_satelite")).toBe(false);
    expect(enBodega.test("en_bodega_central")).toBe(false);
    expect(enBodega.test('estatus = "en_bodega"')).toBe(true);
  });
});
