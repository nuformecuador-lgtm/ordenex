import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { OrdenHistorialOrigenTipo as PrismaOrdenHistorialOrigenTipo } from "@prisma/client";
import {
  ORDEN_HISTORIAL_ORIGEN_TIPO_SEED,
  ORIGEN_TIPOS_CON_GESTION,
} from "@/lib/types/orden-historial";

// Feature 154 (T4.2) — cobertura ESTATICA de la migracion
// `*_orden_historial_origen_recoleccion_tienda_incidente` (copia estructural de
// `orden-historial-origen-recepcion-bodega-central-migration`): lee migration.sql/down.sql por
// regex. NO requiere Postgres real; el round-trip deploy -> rollback -> deploy contra una base
// real queda como DEUDA declarada, documentada en `progress/impl_154.md`.
//
// Cubre R7-R12:
//   R7/R8   alta de `recoleccion_tienda` e `incidente` como familias de origen
//   R9      correspondencia EXACTA codigo <-> DB en AMBAS direcciones (rompe el build)
//   R10     el DOWN recrea el tipo con las 22 familias previas y migra la columna
//   R11     el DOWN ABORTA ruidosamente si alguna fila usa los origenes nuevos
//   R12     ninguna de las dos entra en la familia que enlaza una gestion

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = migrationDirFor("_orden_historial_origen_recoleccion_tienda_incidente");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

const NUEVOS = ["recoleccion_tienda", "incidente"] as const;

/**
 * SQL EJECUTABLE, sin las lineas de comentario `--`. Las aserciones NEGATIVAS ("no hace X") van
 * contra esto: la cabecera documental cita `DROP VALUE`, `order_status` o `UPDATE` justo para
 * explicar por que NO se usan, y buscarlos sobre el texto crudo daria falsos positivos.
 */
function sinComentarios(sql: string): string {
  return sql
    .split(/\r?\n/)
    .filter((linea) => !/^\s*--/.test(linea))
    .join("\n");
}

const upEjecutable = sinComentarios(upSql);
const downEjecutable = sinComentarios(downSql);

describe("Feature 154 · SEED del enum — las dos familias del flujo v2 (R7/R8/R9)", () => {
  it("R7: reconoce `recoleccion_tienda` como familia de origen de una transicion", () => {
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain("recoleccion_tienda");
  });

  it("R8: reconoce `incidente` como familia de origen de una transicion", () => {
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain("incidente");
  });

  it("R9: la correspondencia codigo <-> DB es EXACTA en ambas direcciones (29 = 29)", () => {
    // codigo -> DB lo fuerza el `satisfies readonly PrismaOrdenHistorialOrigenTipo[]`;
    // DB -> codigo lo fuerza el `_EnsureExhaustive` del modulo. Las dos rompen el BUILD.
    // Aqui se verifica el resultado en runtime contra el enum generado del schema.
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED].sort()).toEqual(
      Object.values(PrismaOrdenHistorialOrigenTipo).sort(),
    );
  // 27: la 149 apendio `deshacer_asignacion`, la 157 `asignacion_recoleccion` y la 239
    // `anclaje_devolucion` (2026-08-19), las tres DESPUES de estos dos valores.
    expect(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED).toHaveLength(29); // 2026-08-19 (235): +2 familias de la ayuda
  });

  it("R12: NINGUNA de las dos entra en ORIGEN_TIPOS_CON_GESTION (no alteran los intentos)", () => {
    for (const nuevo of NUEVOS) expect([...ORIGEN_TIPOS_CON_GESTION]).not.toContain(nuevo);
    expect([...ORIGEN_TIPOS_CON_GESTION]).toEqual(["gestion", "deshacer_gestion"]);
  });
});

describe("Feature 154 · UP — ADD VALUE aditivo de las dos familias (R7/R8)", () => {
  it("R7/R8: añade las dos con IF NOT EXISTS (idempotente si se reintenta)", () => {
    for (const nuevo of NUEVOS) {
      expect(upSql).toMatch(
        new RegExp(`ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS '${nuevo}';`),
      );
    }
    const addValues = [...upSql.matchAll(/ADD VALUE IF NOT EXISTS '([^']+)'/g)].map((m) => m[1]);
    expect(addValues).toEqual([...NUEVOS]);
  });

  it("no USA los values nuevos en la misma transaccion (evita el 55P04 de Postgres)", () => {
    // Ninguna sentencia distinta del ADD VALUE: nada de INSERT/UPDATE que cite los values.
    expect(upEjecutable).not.toMatch(/INSERT INTO/i);
    expect(upEjecutable).not.toMatch(/\bUPDATE\b/i);
    expect(upSql).toMatch(/55P04/); // la razon queda documentada en la cabecera
  });

  it("es ADITIVA: no altera ninguna tabla ni borra nada (sin RLS nueva)", () => {
    expect(upEjecutable).not.toMatch(/DROP COLUMN/i);
    expect(upEjecutable).not.toMatch(/ALTER COLUMN/i);
    expect(upEjecutable).not.toMatch(/DELETE FROM/i);
    expect(upEjecutable).not.toMatch(/CREATE TABLE/i);
    expect(upEjecutable).not.toMatch(/CREATE POLICY/i);
    expect(upEjecutable).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(upEjecutable).not.toMatch(/order_status/i); // no toca el catalogo de estatus (va en la A)
  });
});

describe("Feature 154 · DOWN — recrea el tipo con las 22 familias previas (R10/R11)", () => {
  it("R10: recrea el enum SIN las dos nuevas, con las 22 previas derivadas del SEED", () => {
    expect(downSql).toMatch(
      /ALTER TYPE "orden_historial_origen_tipo" RENAME TO "orden_historial_origen_tipo_old";/,
    );
    const match = downSql.match(/CREATE TYPE "orden_historial_origen_tipo" AS ENUM \(([\s\S]*?)\);/);
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(valores).toHaveLength(22);
    for (const nuevo of NUEVOS) expect(valores).not.toContain(nuevo);
    // Las 22 previas = el SEED actual menos las AÑADIDAS EN O DESPUES de la 154. La 149 aterrizo
    // `deshacer_asignacion` DESPUES (migracion `20260729140000_...`), asi que se descuenta tambien:
    // este down recrea el enum a su estado PRE-154, que es fijo e historico (patron 67/99/100/106/138).
    const AÑADIDOS_EN_O_DESPUES_DEL_154 = new Set<string>([
      "asignacion_recoleccion", // feature 157 (ampliacion)
      ...NUEVOS,
      "deshacer_asignacion",
          // Feature 239 (2026-08-19): el `down.sql` de ESTA migracion NO se toca (es una foto
      // historica); lo que se ajusta es el conjunto que se le descuenta al SEED vigente.
      "anclaje_devolucion",
      // Feature 235 (2026-08-19): idem — el `down.sql` de ESTA migracion sigue SIN TOCARSE. Las dos
      // familias de la ayuda se descuentan del SEED vigente, no se anaden a la foto historica.
      "solicitud_ayuda_tienda",
      "rescate_ayuda_tienda",
]);
    expect(new Set(valores)).toEqual(
      new Set(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.filter((v) => !AÑADIDOS_EN_O_DESPUES_DEL_154.has(v))),
    );
  });

  it("R10: migra `origen_tipo` con USING y suelta el tipo viejo", () => {
    expect(downSql).toMatch(
      /ALTER TABLE "orden_historial_estado"\s+ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"\s+USING \("origen_tipo"::text::"orden_historial_origen_tipo"\);/,
    );
    expect(downSql).toMatch(/DROP TYPE "orden_historial_origen_tipo_old";/);
  });

  it("R11: documenta la precondicion (0 filas con los origenes nuevos) y que el rollback ABORTA", () => {
    expect(downSql).toMatch(/Precondicion/i);
    for (const nuevo of NUEVOS) expect(downSql).toContain(nuevo);
    expect(downSql).toMatch(/RUIDOSAMENTE/i);
    expect(downSql).toMatch(/ABORTA/i);
    // NO hay borrado ni reescritura de las filas ofensoras: el rollback falla, no las destruye.
    expect(downEjecutable).not.toMatch(/DELETE FROM "orden_historial_estado"/i);
    expect(downEjecutable).not.toMatch(/UPDATE "orden_historial_estado"/i);
  });

  it("no existe DROP VALUE nativo: el down documenta la irreversibilidad parcial", () => {
    expect(downEjecutable).not.toMatch(/ALTER TYPE[^;]*DROP VALUE/i);
    expect(downSql).toMatch(/IRREVERSIBILIDAD PARCIAL/i);
  });

  it("el down tampoco toca policies RLS", () => {
    expect(downEjecutable).not.toMatch(/CREATE POLICY/i);
    expect(downEjecutable).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});

describe("Feature 154 · schema.prisma refleja la migracion (sin drift, R9)", () => {
  it("el enum Prisma OrdenHistorialOrigenTipo tiene las dos familias nuevas", () => {
    const bloque = schemaPrisma.match(/enum OrdenHistorialOrigenTipo \{([\s\S]*?)\n\}/);
    expect(bloque).not.toBeNull();
    for (const nuevo of NUEVOS) {
      expect((bloque as RegExpMatchArray)[1]).toMatch(new RegExp(`\\b${nuevo}\\b`));
    }
  });
});

describe("Feature 154 · estructura de la carpeta de migracion B", () => {
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
    // Y va DESPUES de la migracion A del catalogo (orden de carpetas exigido por el spec).
    expect(dirName > path.basename(migrationDirFor("_order_status_v2_por_recolectar_incidente"))).toBe(
      true,
    );
  });

  // Este caso exigia que `zonas-migration.test.ts` llevara esta carpeta en su denylist. Era
  // parte de un patron que se AUTO-REFORZABA: cada migracion nueva sumaba una entrada a esa
  // lista y un test exigiendola. La denylist se retiro el 2026-07-30 (habia llegado a quince
  // entradas y rompio cinco veces el 2026-07-29), asi que la exigencia desaparece.
  //
  // Se afirma el invariante NUEVO, mas fuerte: que el assert de `zonas` siga PINNEADO a un
  // baseline historico y por tanto NO necesite mantenimiento al apendir migraciones.
  it("`zonas-migration.test.ts` NO depende del arbol vivo: su baseline sigue pinneado", () => {
    const zonasTest = fs.readFileSync(
      path.join(ROOT, "tests", "integration", "db", "zonas-migration.test.ts"),
      "utf8",
    );
    expect(zonasTest).toMatch(/const MAX_AL_ESCRIBIRLA = "\d{14}"/);
    expect(zonasTest).not.toMatch(/const previas = dirs\.filter\(/);
  });

  it("los 8 down.sql PREVIOS que recrean el enum NO se tocan (son fotos historicas)", () => {
    // `design.md` §2.3 + T1.6: cada uno recrea el enum tal como estaba ANTES de SU migracion, y
    // el rollback es SECUENCIAL (`scripts/db-rollback.ts` toma siempre la ULTIMA carpeta), asi
    // que cuando se ejecuta el down de una vieja los values posteriores ya se quitaron.
    // Cambiarlos los volveria incorrectos. Este test verifica que ninguno cita los values de la
    // 154 y que sus recuentos siguen siendo los historicos.
    const PREVIAS: Array<[string, number]> = [
      ["_gestion_orden_anulacion", 11],
      ["_orden_historial_origen_tipo_carga_api", 12],
      ["_orden_historial_origen_tipo_sla_devuelta", 13],
      ["_orden_historial_origen_tipo_resolver_novedad", 15],
      ["_cancelacion_api_por_key", 17],
      ["_orden_historial_origen_sin_gestionar", 18],
      ["_orden_historial_origen_recepcion_bodega_central", 20],
      ["_orden_historial_origen_devolucion_rechazada", 21],
    ];
    for (const [sufijo, esperados] of PREVIAS) {
      const sql = fs.readFileSync(path.join(migrationDirFor(sufijo), "down.sql"), "utf8");
      const match = sql.match(/CREATE TYPE "orden_historial_origen_tipo" AS ENUM \(([\s\S]*?)\);/);
      expect(match, `${sufijo} deberia recrear el enum`).not.toBeNull();
      const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
      expect(valores, `${sufijo}`).toHaveLength(esperados);
      for (const nuevo of NUEVOS) expect(valores, `${sufijo}`).not.toContain(nuevo);
    }
  });
});
