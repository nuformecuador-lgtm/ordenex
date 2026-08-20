import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  ORDEN_HISTORIAL_ORIGEN_TIPO_SEED,
  ORIGEN_TIPOS_CON_GESTION,
} from "@/lib/types/orden-historial";

// Feature 138 (T1, R17) — cobertura ESTATICA de la migracion
// `*_orden_historial_origen_recepcion_bodega_central` (patron
// orden-historial-origen-tipo-cancelacion-api / resolver-novedad): lee migration.sql/down.sql por
// regex. NO requiere Postgres real; el round-trip up->down->up contra Postgres queda como DEUDA
// post-merge (no hay DB en el entorno; mismo criterio que la 137), documentado en
// `progress/impl_138-recepcion-bodega-central.md`. Cubre R17 (el `origen_tipo` propio, aditivo y
// reversible).

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = migrationDirFor("_orden_historial_origen_recepcion_bodega_central");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

const NUEVO = "recepcion_bodega_central";

describe("Feature 138 · SEED del enum — recepcion_bodega_central (R17)", () => {
  it("siembra recepcion_bodega_central idempotente (esta en ORDEN_HISTORIAL_ORIGEN_TIPO_SEED)", () => {
    expect(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED).toContain(NUEVO);
    // El SEED itera con `satisfies` frente al enum Prisma: si el valor no estuviera en el enum
    // el build romperia. Su presencia aqui = catalogo sembrado por el seed idempotente.
  });

  it("NO entra en ORIGEN_TIPOS_CON_GESTION (no cuenta como intento; destino != devuelta)", () => {
    // El derivador cuenta filas con destino `devuelta`; la recepcion central va a
    // `en_bodega_central`, asi que no debe estar en la familia que enlaza intentos.
    expect([...ORIGEN_TIPOS_CON_GESTION]).not.toContain(NUEVO);
    expect([...ORIGEN_TIPOS_CON_GESTION]).toEqual(["gestion", "deshacer_gestion"]);
  });
});

describe("Feature 138 · UP — ADD VALUE aditivo del origen_tipo (R17)", () => {
  it("añade `recepcion_bodega_central` (fuera de tx via IF NOT EXISTS)", () => {
    expect(upSql).toMatch(
      new RegExp(`ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS '${NUEVO}';`),
    );
  });

  it("es ADITIVA: no altera ninguna tabla ni borra nada (sin RLS nueva)", () => {
    expect(upSql).not.toMatch(/DROP COLUMN/i);
    expect(upSql).not.toMatch(/ALTER COLUMN/i);
    expect(upSql).not.toMatch(/DELETE FROM/i);
    expect(upSql).not.toMatch(/CREATE TABLE/i);
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(upSql).not.toMatch(/order_status/i); // no toca el enum/catalogo de estatus
  });
});

describe("Feature 138 · DOWN — reversible (OBLIGATORIO, docs/architecture.md)", () => {
  it("recrea el enum SIN recepcion_bodega_central, con los 20 previos", () => {
    // Postgres no soporta DROP VALUE: el tipo se recrea y la columna se migra con USING.
    expect(downSql).toMatch(
      /ALTER TYPE "orden_historial_origen_tipo" RENAME TO "orden_historial_origen_tipo_old";/,
    );
    const match = downSql.match(/CREATE TYPE "orden_historial_origen_tipo" AS ENUM \(([\s\S]*?)\);/);
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(valores).toHaveLength(20);
    expect(valores).not.toContain(NUEVO);
    // Los 20 previos = el SEED actual menos los valores AÑADIDOS EN O DESPUES de la feature 138:
    // `recepcion_bodega_central` (138), `devolucion_rechazada` (139), los dos de la 154
    // (`recoleccion_tienda`/`incidente`) y `deshacer_asignacion` (149), apendidos despues. El
    // down.sql del 138 recrea el enum a su estado PRE-138 (fijo, historico); sin descontar los
    // posteriores el SEED crecido divergiria (patron del down del 67/99/100/106).
    const AÑADIDOS_EN_O_DESPUES_DEL_138 = new Set([
      "asignacion_recoleccion", // feature 157 (ampliacion)
      NUEVO,
      "devolucion_rechazada",
      "recoleccion_tienda", // feature 154
      "incidente", // feature 154
      "deshacer_asignacion", // feature 149
          // Feature 239 (2026-08-19): el `down.sql` de ESTA migracion NO se toca (es una foto
      // historica); lo que se ajusta es el conjunto que se le descuenta al SEED vigente.
      "anclaje_devolucion",
      // Feature 235 (2026-08-19): idem — el `down.sql` de ESTA migracion sigue SIN TOCARSE. Las dos
      // familias de la ayuda se descuentan del SEED vigente, no se anaden a la foto historica.
      "solicitud_ayuda_tienda",
      "rescate_ayuda_tienda",
      // Feature 237 (2026-08-20): idem — el `down.sql` de ESTA migracion sigue SIN TOCARSE (foto
      // historica). `gestion_tienda_ayuda` se descuenta del SEED vigente, no se anade a la foto.
      "gestion_tienda_ayuda",
]);
    expect(new Set(valores)).toEqual(
      new Set(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.filter((v) => !AÑADIDOS_EN_O_DESPUES_DEL_138.has(v))),
    );
  });

  it("migra `origen_tipo` con USING y suelta el tipo viejo", () => {
    expect(downSql).toMatch(
      /ALTER TABLE "orden_historial_estado"\s+ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"\s+USING \("origen_tipo"::text::"orden_historial_origen_tipo"\);/,
    );
    expect(downSql).toMatch(/DROP TYPE "orden_historial_origen_tipo_old";/);
  });

  it("documenta la precondicion: 0 filas con el origen_tipo nuevo (el USING falla si las hay)", () => {
    expect(downSql).toMatch(/Precondicion/i);
    expect(downSql).toContain(NUEVO);
  });

  it("el down tampoco toca policies RLS", () => {
    expect(downSql).not.toMatch(/CREATE POLICY/i);
    expect(downSql).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});

describe("Feature 138 · schema.prisma refleja la migracion (sin drift)", () => {
  it("el enum Prisma OrdenHistorialOrigenTipo tiene recepcion_bodega_central", () => {
    const bloque = schemaPrisma.match(/enum OrdenHistorialOrigenTipo \{([\s\S]*?)\n\}/);
    expect(bloque).not.toBeNull();
    expect((bloque as RegExpMatchArray)[1]).toMatch(new RegExp(`\\b${NUEVO}\\b`));
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a la carpeta previa", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const previa = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => n < dirName)
      .sort()
      .pop();
    expect(previa).toBeDefined();
    expect(dirName > (previa as string)).toBe(true);
  });
});
