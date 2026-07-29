import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { ORDEN_HISTORIAL_ORIGEN_TIPO_SEED } from "@/lib/types/orden-historial";

// Feature 154 (R28) — GUARD de censo de "DECLARADO Y SIN USO". Patron de
// `censo-order-status-rename.test.ts`, pero al reves: alla se censaban values RETIRADOS; aqui
// se censan values RECIEN DECLARADOS que TODAVIA NO deben usarse.
//
// La 154 declara dos estados (`por_recolectar_en_tienda`, `incidente`) y dos familias de
// historial (`recoleccion_tienda`, `incidente`) que NINGUN service, action, repository, hook,
// componente ni script puede producir hasta las features 155-158. Mientras tanto solo pueden
// aparecer en:
//   - el catalogo (`lib/types/order-status.ts`),
//   - las familias (`lib/types/orden-historial.ts`),
//   - el mapa de transiciones (`lib/types/order-status-transiciones.ts`),
//   - la capa de presentacion del estatus (`EstatusBadge.tsx`),
//   - `db/` (migraciones), `tests/` y `specs/` — que NO se escanean.
//
// Si un service empieza a escribir uno de estos literales antes de tiempo, este guard se pone
// rojo y obliga a que el cambio llegue con SU feature (155/156/157/158), no de contrabando.
// Cuando esa feature llegue, se añade su archivo a la allowlist o se retira el literal de
// LITERALES_154 con la justificacion correspondiente.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
// Deliberadamente SIN `tests`, `db` ni `specs`: R28 los admite como sitios legitimos.
const SCAN_DIRS = ["app", "lib", "components", "hooks", "scripts", "e2e"];
const SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql", ".css", ".json"]);

// Frontera de palabra a proposito: `\bincidente\b` NO marca "coincidentes"/"coincidente", que
// aparecen en nombres de test y en textos de filtros de la UI.
const LITERALES_154: Array<{ label: string; re: RegExp }> = [
  { label: "por_recolectar_en_tienda", re: /\bpor_recolectar_en_tienda\b/ },
  { label: "incidente", re: /\bincidente\b/ },
  { label: "recoleccion_tienda", re: /\brecoleccion_tienda\b/ },
];

// Archivos que SI pueden nombrarlos (por ruta relativa POSIX, no por basename: `incidente` es
// una palabra comun y un basename suelto seria una allowlist demasiado ancha).
const ALLOWLIST = new Set([
  "lib/types/order-status.ts", // catalogo
  "lib/types/orden-historial.ts", // familias de origen
  "lib/types/order-status-transiciones.ts", // mapa de transiciones
  "app/(app)/ordenes/_components/EstatusBadge.tsx", // presentacion del estatus
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

function ofensores(): string[] {
  const out: string[] = [];
  for (const rel of SCAN_DIRS) {
    const base = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(base)) continue;
    for (const file of walk(base)) {
      const relativo = path.relative(REPO_ROOT, file).split(path.sep).join("/");
      if (ALLOWLIST.has(relativo)) continue;
      const contenido = fs.readFileSync(file, "utf8");
      const hits = LITERALES_154.filter((v) => v.re.test(contenido)).map((v) => v.label);
      if (hits.length > 0) out.push(`${relativo} -> ${hits.join(", ")}`);
    }
  }
  return out;
}

describe("154/R28 — los values y familias de la 154 estan DECLARADOS y SIN USO", () => {
  it("ningun archivo de app/, lib/, components/, hooks/, scripts/ ni e2e/ fuera de la allowlist los nombra", () => {
    expect(ofensores()).toEqual([]);
  });

  it("los cuatro archivos de la allowlist SI los declaran (el guard no es vacuo)", () => {
    for (const relativo of ALLOWLIST) {
      const contenido = fs.readFileSync(path.join(REPO_ROOT, relativo), "utf8");
      const hits = LITERALES_154.filter((v) => v.re.test(contenido)).map((v) => v.label);
      expect(hits.length, `${relativo} no declara ningun literal de la 154`).toBeGreaterThan(0);
    }
  });

  it("el censo de `incidente` es por igualdad EXACTA (no marca “coincidentes”)", () => {
    const re = LITERALES_154.find((v) => v.label === "incidente")!.re;
    expect(re.test("las coincidentes y excluye distrito nulo")).toBe(false);
    expect(re.test("solo las coincidentes")).toBe(false);
    expect(re.test('estatus = "incidente"')).toBe(true);
    expect(re.test("origenTipo: incidente,")).toBe(true);
  });

  it("el censo de `recoleccion_tienda` no marca la familia preexistente `recoleccion`", () => {
    const re = LITERALES_154.find((v) => v.label === "recoleccion_tienda")!.re;
    expect(re.test('via: "recoleccion"')).toBe(false);
    expect(re.test('via: "recoleccion_tienda"')).toBe(true);
  });

  it("los literales censados son EXACTAMENTE los que la 154 da de alta", () => {
    expect(LITERALES_154.map((v) => v.label)).toEqual([
      "por_recolectar_en_tienda",
      "incidente",
      "recoleccion_tienda",
    ]);
    // Y siguen siendo values reales del catalogo / del enum de familias: si una feature
    // posterior los renombrara, este guard dejaria de censar lo que cree censar.
    expect(ORDER_STATUS_SEED).toContain("por_recolectar_en_tienda");
    expect(ORDER_STATUS_SEED).toContain("incidente");
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain("recoleccion_tienda");
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain("incidente");
  });
});
