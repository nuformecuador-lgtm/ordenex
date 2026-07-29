import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { ORDEN_HISTORIAL_ORIGEN_TIPO_SEED } from "@/lib/types/orden-historial";

// Feature 154 (R28) — GUARD de censo de "DECLARADO Y SIN USO". Patron de
// `censo-order-status-rename.test.ts`, pero al reves: alla se censaban values RETIRADOS; aqui
// se censan values RECIEN DECLARADOS que TODAVIA NO deben usarse.
//
// La 154 declaro dos estados (`por_recolectar_en_tienda`, `incidente`) y dos familias de
// historial (`recoleccion_tienda`, `incidente`) que ningun modulo podia producir todavia.
// Mientras siguen sin productor solo pueden aparecer en:
//   - el catalogo (`lib/types/order-status.ts`),
//   - las familias (`lib/types/orden-historial.ts`),
//   - el mapa de transiciones (`lib/types/order-status-transiciones.ts`),
//   - la capa de presentacion del estatus (`EstatusBadge.tsx`),
//   - `db/` (migraciones), `tests/` y `specs/` — que NO se escanean.
//
// FEATURE 155 — DOS LITERALES SE GRADUAN Y SALEN DEL CENSO. El guard funciono como se diseño:
// mientras nadie los producia estuvieron confinados, y ahora salen POR SU FEATURE, no de
// contrabando.
//   - `por_recolectar_en_tienda`: es el estado en que NACE la rama (b) de la bifurcacion de
//     creacion. Lo produce `resolverDestinoCreacion` y lo consumen las tres vias, la politica
//     de eventos publicos y el contrato OpenAPI.
//   - `recoleccion_tienda`: es el flujo del manifiesto de esa rama (`MANIFIESTO_FLUJOS`), y
//     tambien la familia de historial de la arista #43, que producira la 157.
//
// `incidente` SIGUE censado: no tiene productor hasta la feature 158. Si alguien lo escribiera
// antes de tiempo, este guard se pone rojo.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
// Deliberadamente SIN `tests`, `db` ni `specs`: R28 los admite como sitios legitimos.
const SCAN_DIRS = ["app", "lib", "components", "hooks", "scripts", "e2e"];
const SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql", ".css", ".json"]);

// Frontera de palabra a proposito: `\bincidente\b` NO marca "coincidentes"/"coincidente", que
// aparecen en nombres de test y en textos de filtros de la UI.
const LITERALES_154: Array<{ label: string; re: RegExp }> = [
  { label: "incidente", re: /\bincidente\b/ },
];

/** Los que la 155 GRADUO: siguen siendo values/familias reales, pero ya tienen productor. */
const GRADUADOS_155 = ["por_recolectar_en_tienda", "recoleccion_tienda"] as const;

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

describe("154/R28 — los values y familias TODAVIA sin productor estan DECLARADOS y SIN USO", () => {
  it("ningun archivo de app/, lib/, components/, hooks/, scripts/ ni e2e/ fuera de la allowlist los nombra", () => {
    expect(ofensores()).toEqual([]);
  });

  it("los cuatro archivos de la allowlist SI los declaran (el guard no es vacuo)", () => {
    for (const relativo of ALLOWLIST) {
      const contenido = fs.readFileSync(path.join(REPO_ROOT, relativo), "utf8");
      const hits = LITERALES_154.filter((v) => v.re.test(contenido)).map((v) => v.label);
      expect(hits.length, `${relativo} no declara ningun literal censado`).toBeGreaterThan(0);
    }
  });

  it("el censo de `incidente` es por igualdad EXACTA (no marca “coincidentes”)", () => {
    const re = LITERALES_154.find((v) => v.label === "incidente")!.re;
    expect(re.test("las coincidentes y excluye distrito nulo")).toBe(false);
    expect(re.test("solo las coincidentes")).toBe(false);
    expect(re.test('estatus = "incidente"')).toBe(true);
    expect(re.test("origenTipo: incidente,")).toBe(true);
  });

  it("155: el censo queda reducido a `incidente`, el unico todavia sin productor", () => {
    expect(LITERALES_154.map((v) => v.label)).toEqual(["incidente"]);
    // Y sigue siendo un value/familia real: si una feature posterior lo renombrara, este
    // guard dejaria de censar lo que cree censar.
    expect(ORDER_STATUS_SEED).toContain("incidente");
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain("incidente");
  });

  it("155: los dos literales graduados siguen existiendo en el catalogo y en las familias", () => {
    // Salen del CENSO, no del sistema. Si alguien los borrara, el guard no lo veria (ya no los
    // busca), asi que se afirma aqui explicitamente.
    expect(ORDER_STATUS_SEED).toContain(GRADUADOS_155[0]);
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain(GRADUADOS_155[1]);
  });

  it("155: los dos graduados SI aparecen ya en modulos de negocio (tienen productor real)", () => {
    const conEstado = fs.readFileSync(
      path.join(REPO_ROOT, "lib", "services", "destino-creacion.ts"),
      "utf8",
    );
    expect(conEstado).toMatch(/\bpor_recolectar_en_tienda\b/);
    const conFlujo = fs.readFileSync(path.join(REPO_ROOT, "lib", "types", "manifiesto.ts"), "utf8");
    expect(conFlujo).toMatch(/\brecoleccion_tienda\b/);
  });
});
