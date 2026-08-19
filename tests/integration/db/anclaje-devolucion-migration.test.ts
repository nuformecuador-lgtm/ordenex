import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import {
  ORDEN_HISTORIAL_ORIGEN_TIPO_SEED,
  ORIGEN_TIPOS_CON_GESTION,
  ORIGEN_TIPOS_VISITA_REAL,
} from "@/lib/types/orden-historial";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 239 (T1.2, R32) — cobertura ESTATICA de las DOS migraciones de esta feature, por
// lectura de `migration.sql` / `down.sql`. Mismo patron que
// `orden-historial-origen-recepcion-bodega-central-migration.test.ts`: NO requiere Postgres real
// (no hay DB en el entorno de test de este repo; `tests/integration/db` son emuladores y
// lecturas de fichero).
//
// Lo que se afirma aqui, y por que cada cosa:
//   - las dos son IDEMPOTENTES (aplicar dos veces no duplica): `ADD VALUE IF NOT EXISTS` y
//     `INSERT ... WHERE NOT EXISTS`;
//   - las dos tienen DOWN, y el del enum RECREA el tipo con la lista vigente (Postgres no tiene
//     `DROP VALUE`), dejando la base legible por el codigo anterior (R32);
//   - NINGUNA mueve ordenes entre estados desde SQL (R31): eso solo pasa por `appendCambioEstado`;
//   - `anclaje_devolucion` NO entra en `ORIGEN_TIPOS_VISITA_REAL` — meterla ahi subiria el conteo
//     de intentos, adelantaria el escalado del cron SLA y cobraria antes de tiempo (R16) — ni en
//     `ORIGEN_TIPOS_CON_GESTION`.

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

const enumDir = migrationDirFor("_orden_historial_origen_anclaje_devolucion");
const enumUp = fs.readFileSync(path.join(enumDir, "migration.sql"), "utf8");
const enumDown = fs.readFileSync(path.join(enumDir, "down.sql"), "utf8");

const catalogoDir = migrationDirFor("_order_status_devolucion_por_confirmar");
const catalogoUp = fs.readFileSync(path.join(catalogoDir, "migration.sql"), "utf8");
const catalogoDown = fs.readFileSync(path.join(catalogoDir, "down.sql"), "utf8");

const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

const FAMILIA = "anclaje_devolucion";
const PRE_ESTADO = "devolucion_por_confirmar";

/* -------------------------------------------------------------------------- */
/* 1. El enum `orden_historial_origen_tipo`                                     */
/* -------------------------------------------------------------------------- */

describe("Feature 239 · enum — `anclaje_devolucion` (R7/P8)", () => {
  it("el UP anade el valor con `IF NOT EXISTS` (aplicarlo dos veces no duplica)", () => {
    expect(enumUp).toMatch(
      new RegExp(`ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS '${FAMILIA}';`),
    );
  });

  it("el UP es ADITIVO: ni tablas, ni columnas, ni RLS, ni movimientos de orden (R31)", () => {
    expect(enumUp).not.toMatch(/CREATE TABLE/i);
    expect(enumUp).not.toMatch(/ALTER COLUMN/i);
    expect(enumUp).not.toMatch(/DROP COLUMN/i);
    expect(enumUp).not.toMatch(/CREATE POLICY/i);
    expect(enumUp).not.toMatch(/ROW LEVEL SECURITY/i);
    // R31: ninguna orden cambia de estado desde SQL de migracion.
    expect(enumUp).not.toMatch(/UPDATE\s+"orden"/i);
    expect(enumUp).not.toMatch(/estatus_id/i);
  });

  it("no USA el valor nuevo en la misma transaccion que lo anade (Postgres 55P04)", () => {
    // El unico `anclaje_devolucion` que puede aparecer en el UP es el de los comentarios; nunca
    // en un INSERT/UPDATE que lo castee al enum.
    expect(enumUp).not.toMatch(new RegExp(`'${FAMILIA}'::orden_historial_origen_tipo`));
    expect(enumUp).not.toMatch(/INSERT INTO "orden_historial_estado"/i);
  });

  it("R32 — el DOWN recrea el tipo con los 26 valores previos, SIN el nuevo", () => {
    expect(enumDown).toMatch(
      /ALTER TYPE "orden_historial_origen_tipo" RENAME TO "orden_historial_origen_tipo_old";/,
    );
    const match = enumDown.match(
      /CREATE TYPE "orden_historial_origen_tipo" AS ENUM \(([\s\S]*?)\);/,
    );
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(valores).toHaveLength(26);
    expect(valores).not.toContain(FAMILIA);
    // La lista del down es EXACTAMENTE el SEED de hoy menos el valor que esta migracion anade
    // Y menos los que se anadieron DESPUES: el `down.sql` es una FOTO HISTORICA y no se toca, asi
    // que lo que se ajusta al crecer el enum es el conjunto que se le descuenta al SEED vigente.
    //
    // Feature 235 (2026-08-19): entran `solicitud_ayuda_tienda` y `rescate_ayuda_tienda`.
    const POSTERIORES = new Set<string>([
      FAMILIA,
      "solicitud_ayuda_tienda",
      "rescate_ayuda_tienda",
    ]);
    expect(new Set(valores)).toEqual(
      new Set(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.filter((v) => !POSTERIORES.has(v))),
    );
  });

  it("R32 — el DOWN migra la columna con USING y suelta el tipo viejo", () => {
    expect(enumDown).toMatch(
      /ALTER TABLE "orden_historial_estado"\s+ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"\s+USING \("origen_tipo"::text::"orden_historial_origen_tipo"\);/,
    );
    expect(enumDown).toMatch(/DROP TYPE "orden_historial_origen_tipo_old";/);
  });

  it("el DOWN documenta la precondicion (0 filas con la familia nueva) y el rollback encadenado", () => {
    expect(enumDown).toMatch(/Precondicion/i);
    expect(enumDown).toContain(FAMILIA);
    expect(enumDown).toMatch(/ROLLBACK ENCADENADO/i);
  });

  it("el DOWN NO tiene que rehacer indices a mano: no hay ninguno PARCIAL sobre `origen_tipo`", () => {
    // `ALTER COLUMN ... TYPE` reconstruye por si solo los indices que dependen de la columna,
    // pero solo si puede reparsear su expresion. Un indice PARCIAL cuyo `WHERE` comparase
    // `origen_tipo` con un literal del tipo viejo seria el caso problematico. Se censa el arbol
    // de migraciones para demostrar que no existe: los indices sobre `orden_historial_estado`
    // son btree plenos.
    const indices = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .flatMap((e) => {
        const file = path.join(MIGRATIONS_DIR, e.name, "migration.sql");
        if (!fs.existsSync(file)) return [];
        return fs
          .readFileSync(file, "utf8")
          .split(/;\s*\n/)
          .filter((stmt) => /CREATE\s+(UNIQUE\s+)?INDEX/i.test(stmt))
          .filter((stmt) => /"orden_historial_estado"/.test(stmt));
      });
    expect(indices.length).toBeGreaterThan(0); // el censo mira algo de verdad
    for (const stmt of indices) {
      expect(stmt).not.toMatch(/\bWHERE\b/i); // ninguno es parcial
    }
  });

  it("el DOWN tampoco toca policies RLS", () => {
    expect(enumDown).not.toMatch(/CREATE POLICY/i);
    expect(enumDown).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. El value del catalogo `order_status`                                      */
/* -------------------------------------------------------------------------- */

describe("Feature 239 · catalogo — `devolucion_por_confirmar` (R1)", () => {
  it("el UP inserta con `WHERE NOT EXISTS` (aplicarlo dos veces no duplica)", () => {
    expect(catalogoUp).toMatch(/INSERT INTO "order_status" \("id", "value"\)/);
    expect(catalogoUp).toMatch(
      new RegExp(
        `WHERE NOT EXISTS \\(SELECT 1 FROM "order_status" WHERE "value" = '${PRE_ESTADO}'\\);`,
      ),
    );
  });

  it("R31 — el UP NO mueve ninguna orden de estado desde SQL (sin backfill)", () => {
    expect(catalogoUp).not.toMatch(/UPDATE\s+"orden"/i);
    expect(catalogoUp).not.toMatch(/SET\s+"?estatus_id"?/i);
    expect(catalogoUp).not.toMatch(/INSERT INTO "orden_historial_estado"/i);
  });

  it("el UP es ADITIVO: ni tablas, ni columnas, ni RLS", () => {
    expect(catalogoUp).not.toMatch(/CREATE TABLE/i);
    expect(catalogoUp).not.toMatch(/DROP COLUMN/i);
    expect(catalogoUp).not.toMatch(/ALTER COLUMN/i);
    expect(catalogoUp).not.toMatch(/CREATE POLICY/i);
    expect(catalogoUp).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("R32 — el DOWN borra la fila SOLO si nadie la referencia (orden ni historial)", () => {
    expect(catalogoDown).toMatch(/DELETE FROM "order_status" os/);
    expect(catalogoDown).toMatch(
      /NOT EXISTS \(SELECT 1 FROM "orden" o WHERE o\."estatus_id" = os\."id"\)/,
    );
    expect(catalogoDown).toMatch(/NOT EXISTS \(SELECT 1 FROM "orden_historial_estado" h/);
    expect(catalogoDown).toMatch(/h\."estatus_destino_id" = os\."id" OR h\."estatus_origen_id" = os\."id"/);
  });

  it("R31/R32 — el DOWN tampoco mueve ordenes: deja la base legible, no reescrita", () => {
    // A diferencia del down de la 157, este NO reasigna las ordenes que quedaran en el
    // pre-estado: la fila del catalogo sobrevive huerfana y el codigo anterior las lee como un
    // estatus desconocido (chip neutro), en vez de romper.
    expect(catalogoDown).not.toMatch(/UPDATE\s+"orden"/i);
    expect(catalogoDown).not.toMatch(/INSERT INTO "orden_historial_estado"/i);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Sin drift entre el codigo y las migraciones                               */
/* -------------------------------------------------------------------------- */

describe("Feature 239 · el codigo y la base dicen lo mismo (sin drift)", () => {
  it("el enum Prisma tiene `anclaje_devolucion` y el SEED de TS tambien", () => {
    expect(schemaPrisma).toMatch(/enum OrdenHistorialOrigenTipo[\s\S]*?anclaje_devolucion/);
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain(FAMILIA);
  });

  it("`ORDER_STATUS_SEED` incluye el pre-estado, y como APENDICE (no reordena)", () => {
    expect(ORDER_STATUS_SEED as readonly string[]).toContain(PRE_ESTADO);
    // 2026-08-19 (feature 235): el pre-estado deja de ser el ULTIMO porque `ayuda_tienda` se
    // apendio DESPUES. Lo que este caso afirma sigue siendo lo mismo —que la 239 no reordeno a
    // nadie— y se dice de la forma que sobrevive a la siguiente feature aditiva: su posicion es la
    // penultima, e inmediatamente despues del value que ya estaba antes de ella.
    const i = (ORDER_STATUS_SEED as readonly string[]).indexOf(PRE_ESTADO);
    expect(i).toBe(ORDER_STATUS_SEED.length - 2);
    expect(ORDER_STATUS_SEED[i - 1]).toBe("recolectando"); // el ultimo antes de la 239 (157)
  });

  // R16 — EL CASO QUE PROTEGE EL DINERO. Si la familia del anclaje entrara en la lista de visita
  // real, cada aprobacion de cierre sumaria un intento de entrega de mas: el cron SLA (99)
  // alcanzaria antes el umbral, escalaria antes a `rechazada` y dispararia el `cobroRechazado`
  // (56) — dinero real cobrado a la tienda antes de tiempo, en silencio.
  it("R16: `anclaje_devolucion` NO esta en `ORIGEN_TIPOS_VISITA_REAL`", () => {
    expect([...ORIGEN_TIPOS_VISITA_REAL]).not.toContain(FAMILIA);
    expect([...ORIGEN_TIPOS_VISITA_REAL]).toEqual(["gestion"]);
  });

  it("`anclaje_devolucion` NO esta en `ORIGEN_TIPOS_CON_GESTION`", () => {
    // Esa lista solo desambigua la NULIDAD del enlace `gestion_orden_id` en filas que nacen SIN
    // gestion. El anclaje SI enlaza la gestion ancla, igual que `escalado_devuelta_sla`, que
    // tampoco esta.
    expect([...ORIGEN_TIPOS_CON_GESTION]).not.toContain(FAMILIA);
    expect([...ORIGEN_TIPOS_CON_GESTION]).toEqual(["gestion", "deshacer_gestion"]);
  });
});
