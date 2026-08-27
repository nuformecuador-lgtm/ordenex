import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Cobertura estatica (sin DB) del cambio de unicidad de `num_remision`: de UNIQUE GLOBAL a
// UNIQUE POR TIENDA. Patron tests/unit/db/orden-num-guia-deferred.test.ts.
//
// Por que un guardia y no solo la migracion: este es un cambio de IDENTIDAD, y su modo de
// fallo no es un error de compilacion sino un dato mal clasificado. Si alguien "restaurara"
// el UNIQUE global, la tienda B volveria a ver `duplicada` una remision que solo existe en la
// tienda A — y nada en el build se pondria rojo. Ademas se ancla lo que NO cambia: `num_guia`
// sigue siendo unico GLOBAL, porque ese numero lo genera Ordenex y lo lee la bodega sin saber
// de que tienda viene.
const MIGRATION_DIR = resolve(
  __dirname,
  "../../../db/migrations/20260825160000_orden_num_remision_unico_por_tienda",
);
const SCHEMA = readFileSync(resolve(__dirname, "../../../db/schema.prisma"), "utf8");

function sql(file: "migration.sql" | "down.sql"): string {
  return readFileSync(resolve(MIGRATION_DIR, file), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}

/** Cuerpo del `model Orden { ... }` de schema.prisma. */
function modeloOrden(): string {
  const m = SCHEMA.match(/^model\s+Orden\s*\{\n([\s\S]*?)\n\}/m);
  if (!m) throw new Error("No se encontro el model Orden en schema.prisma");
  return m[1];
}

describe("migration.sql — num_remision unico por tienda", () => {
  it("crea el UNIQUE compuesto con tienda_id PRIMERO (sirve de prefijo al scope por tienda)", () => {
    expect(sql("migration.sql")).toContain(
      'CREATE UNIQUE INDEX "orden_tienda_id_num_remision_key" ON "orden"("tienda_id", "num_remision");',
    );
  });

  it("suelta el UNIQUE global anterior", () => {
    expect(sql("migration.sql")).toContain('DROP INDEX "orden_num_remision_key";');
  });

  it("crea el nuevo ANTES de soltar el viejo: la columna nunca queda sin proteccion", () => {
    const s = sql("migration.sql");
    expect(s.indexOf("CREATE UNIQUE INDEX")).toBeLessThan(s.indexOf("DROP INDEX"));
  });

  it("no toca num_guia: sigue siendo UNIQUE GLOBAL", () => {
    expect(sql("migration.sql")).not.toMatch(/num_guia/i);
  });

  it("down.sql restaura el UNIQUE global y suelta el compuesto", () => {
    const s = sql("down.sql");
    expect(s).toContain('CREATE UNIQUE INDEX "orden_num_remision_key" ON "orden"("num_remision");');
    expect(s).toContain('DROP INDEX IF EXISTS "orden_tienda_id_num_remision_key";');
    // Un DELETE/UPDATE "resolutivo" destruiria la remision real de una tienda para satisfacer
    // una constraint que ya se decidio que estaba mal. El down declara el fallo, no lo tapa.
    expect(s).not.toMatch(/\b(DELETE|UPDATE)\b/i);
  });
});

describe("schema.prisma — el modelo declara lo que la migracion creo", () => {
  it("num_remision NO lleva @unique de columna", () => {
    expect(modeloOrden()).toMatch(/^\s*numRemision\s+String\s+@map\("num_remision"\)/m);
  });

  // FEATURE 294 (2026-08-27) — AQUI VIVIA «declara @@unique([tiendaId, numRemision]) con el
  // nombre exacto del indice». Ya no puede vivir: la ficha 294 convirtio ese indice en PARCIAL
  // (`WHERE deleted_at IS NULL`) y Prisma no expresa predicados, asi que la restriccion SALIO
  // del modelo y se declara a mano en
  // `db/migrations/20260827160000_orden_num_remision_unico_parcial`. Lo que aquel caso protegia
  // —que nadie devuelva la unicidad a GLOBAL— lo sigue protegiendo el caso de arriba (sin
  // `@unique` de columna) y, sobre el indice real, `tests/unit/db/orden-num-remision-parcial.test.ts`
  // mas su contraparte contra Postgres. NO se restaura el `@@unique`: hacerlo haria que
  // `prisma db push` escribiera otra vez el indice SIN predicado y que el cliente generado
  // ofreciera `findUnique` por un par que la base ya no garantiza unico (medido en la 294).

  it("num_guia conserva su @unique global", () => {
    expect(modeloOrden()).toMatch(/numGuia\s+Int\?\s+@unique\s+@map\("num_guia"\)/);
  });
});
