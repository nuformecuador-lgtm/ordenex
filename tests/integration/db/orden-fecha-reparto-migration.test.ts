import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 246 (T1.1, R19/R21/R44) — cobertura de la migracion `*_orden_fecha_reparto`.
//
// Molde de `orden-prioridad-migration.test.ts`: lee `migration.sql`, `down.sql` y
// `schema.prisma` por regex. NO requiere Postgres real. El ROUND-TRIP up -> down -> up contra
// la base local SI se ejecuto, y su salida (columna `date` nullable sin default, indice creado,
// 67 filas previas con `fecha_reparto` NULL, y la columna y el indice AUSENTES tras el down)
// queda pegada en `progress/impl_246.md`. Un test estatico no puede demostrar eso, y fingir que
// si seria una asercion contra su propia fuente.
//
// Cubre:
//   R19 — nullable, SIN default, SIN backfill: las filas previas quedan en `NULL`.
//   R21 — el `down.sql` revierte EXACTAMENTE lo que el `migration.sql` hace, con `IF EXISTS`.
//   R44 — el indice del denominador del ranking existe y es de UNA sola columna.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "db", "migrations");

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = migrationDirFor("_orden_fecha_reparto");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(path.join(REPO_ROOT, "db", "schema.prisma"), "utf8");

/** Deja solo las sentencias DDL: fuera los comentarios `--`, que son la mitad de estos archivos. */
function soloDdl(sql: string): string {
  return sql.replace(/^\s*--.*$/gm, "");
}

const upDdl = soloDdl(upSql);
const downDdl = soloDdl(downSql);

describe("Feature 246 · UP — columna orden.fecha_reparto aditiva (R19)", () => {
  it("agrega `fecha_reparto` DATE a `orden`", () => {
    expect(upDdl).toMatch(/ALTER TABLE "orden" ADD COLUMN "fecha_reparto" DATE;/);
  });

  it("R19: NULLABLE y SIN DEFAULT — las filas previas quedan en NULL y se barren como hoy", () => {
    // `NOT NULL` obligaria a un default o a un backfill; un `DEFAULT` inventaria un dia que
    // nadie eligio. La ausencia de las dos palabras ES el requisito.
    expect(upDdl).not.toMatch(/"fecha_reparto"\s+DATE[^;]*NOT NULL/i);
    expect(upDdl).not.toMatch(/"fecha_reparto"\s+DATE[^;]*DEFAULT/i);
  });

  it("R19: sin backfill — ninguna fila existente se toca", () => {
    expect(upDdl).not.toMatch(/UPDATE\s+"?orden"?/i);
  });

  it("R44: AMPLIA el compuesto que ya existia a TRES columnas, en vez de crear uno suelto", () => {
    // ⚠️ ESTA ASERCION SE INVIRTIO EL 2026-08-20, Y LA INVERSION ES EL REQUISITO.
    //
    // Antes exigia `CREATE INDEX "orden_fecha_reparto_idx" ON "orden" ("fecha_reparto")`. El
    // `EXPLAIN` de produccion (M8) mostro que el denominador se sirve HOY con un `Index Only
    // Scan` sobre `(mensajero_asignado_id, asignado_at)` —el mejor plan posible, sin tocar el
    // heap— y que un indice suelto por `fecha_reparto` NO lo preserva: hace atractivo un
    // `BitmapOr` que degrada a `Bitmap Heap Scan`, es decir, EMPEORA el plan. Con la fecha como
    // TERCERA columna clave del compuesto, el plan vuelve a ser `Index Only Scan`. Medido.
    expect(upDdl).toMatch(
      /CREATE INDEX "orden_mensajero_asignado_at_fecha_reparto_idx"\s+ON "orden" \("mensajero_asignado_id", "asignado_at", "fecha_reparto"\);/,
    );
    // Y el suelto NO se crea: es el remedio equivocado, no una alternativa aceptable.
    expect(upDdl).not.toMatch(/CREATE INDEX "orden_fecha_reparto_idx"/);
  });

  it("R44: el numero de indices de `orden` NO sube — se SUSTITUYE el de dos columnas", () => {
    // `orden` es la tabla mas caliente del sistema y cada indice se paga en cada escritura. Que
    // esta migracion sustituya en vez de sumar es lo que hace que el coste sean 4 bytes de ancho
    // de entrada y no un indice entero mas.
    expect(upDdl).toMatch(/DROP INDEX IF EXISTS "orden_mensajero_asignado_id_asignado_at_idx";/);
    const creados = [...upDdl.matchAll(/CREATE INDEX "([a-z_]+)"/g)].map((m) => m[1]);
    const borrados = [...upDdl.matchAll(/DROP INDEX IF EXISTS "([a-z_]+)"/g)].map((m) => m[1]);
    expect(creados).toHaveLength(1);
    expect(borrados).toHaveLength(1);
  });

  it("R44: el PREFIJO se conserva — quien usaba `(mensajero, asignado_at)` sigue servido", () => {
    // `TableroDiaRepository.cteIdsDelDia` y el denominador de la 76 se apoyan en ese prefijo. Un
    // indice `(a, b, c)` sirve a `(a, b)`; uno `(c, a, b)` NO. El ORDEN de las columnas es el
    // requisito, no un detalle de estilo.
    const cols =
      /CREATE INDEX "orden_mensajero_asignado_at_fecha_reparto_idx"\s+ON "orden" \(([^)]+)\)/.exec(
        upDdl,
      );
    expect(cols).not.toBeNull();
    expect((cols as RegExpExecArray)[1].split(",").map((c) => c.trim())).toEqual([
      '"mensajero_asignado_id"',
      '"asignado_at"',
      '"fecha_reparto"',
    ]);
  });

  it("es ADITIVA EN DATOS: no crea tablas ni enums, no toca RLS, no borra ni altera columnas", () => {
    expect(upDdl).not.toMatch(/CREATE TABLE/i);
    expect(upDdl).not.toMatch(/CREATE TYPE|ALTER TYPE/i);
    expect(upDdl).not.toMatch(/CREATE POLICY/i);
    expect(upDdl).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(upDdl).not.toMatch(/DROP COLUMN/i);
    expect(upDdl).not.toMatch(/DROP TABLE/i);
    expect(upDdl).not.toMatch(/ALTER COLUMN/i);
    // El unico `DROP` admisible es el del indice que esta migracion sustituye.
    const drops = [...upDdl.matchAll(/\bDROP\s+(\w+)/gi)].map((m) => m[1].toUpperCase());
    expect(drops).toEqual(["INDEX"]);
  });

  it("sin CHECK: «solo hoy o mañana» es regla del borde, no de la base (design §2.1)", () => {
    // Un CHECK tendria que comparar contra `now()`, que es una SEGUNDA definicion del dia.
    expect(upDdl).not.toMatch(/CHECK\s*\(/i);
    expect(upDdl).not.toMatch(/now\(\)/i);
  });

  it("sin aritmetica de zona horaria en el SQL (R17)", () => {
    expect(upDdl).not.toMatch(/AT TIME ZONE/i);
    expect(upDdl).not.toMatch(/America\/Costa_Rica/i);
    expect(upDdl).not.toMatch(/INTERVAL\s+'6 hours'/i);
  });
});

describe("Feature 246 · DOWN — reversible (OBLIGATORIO, docs/architecture.md) (R21)", () => {
  it("deshace EXACTAMENTE lo que el UP hizo: repone el indice de DOS y suelta lo demas", () => {
    expect(downDdl).toMatch(
      /CREATE INDEX IF NOT EXISTS "orden_mensajero_asignado_id_asignado_at_idx"\s+ON "orden" \("mensajero_asignado_id", "asignado_at"\);/,
    );
    expect(downDdl).toMatch(
      /DROP INDEX IF EXISTS "orden_mensajero_asignado_at_fecha_reparto_idx";/,
    );
    expect(downDdl).toMatch(/ALTER TABLE "orden" DROP COLUMN IF EXISTS "fecha_reparto";/);
    expect(downDdl).not.toMatch(/DROP COLUMN IF EXISTS "(?!fecha_reparto)/);
  });

  it("R21: REPONE el indice de dos columnas — no se limita a soltar la columna", () => {
    // Es la parte del `down` que un descuido se salta. El `up` SUSTITUYO el compuesto de la 76;
    // un `down` que solo soltara la columna dejaria la base SIN ese indice, y con el se iria el
    // `Index Only Scan` del que dependen el denominador del ranking y `TableroDiaRepository`.
    // Eso no seria «devolver la base al estado anterior»: seria dejarla PEOR.
    expect(downDdl).toMatch(
      /CREATE INDEX IF NOT EXISTS "orden_mensajero_asignado_id_asignado_at_idx"/,
    );
    // Y se repone ANTES de soltar nada, para que nunca haya una ventana sin indice que sirva.
    expect(downDdl.indexOf("CREATE INDEX")).toBeLessThan(downDdl.indexOf("DROP INDEX"));
  });

  it("es idempotente: las TRES sentencias llevan su guarda de existencia", () => {
    const sentencias = downDdl.split(";").filter((s) => s.trim().length > 0);
    expect(sentencias).toHaveLength(3);
    for (const s of sentencias) expect(s).toMatch(/IF (NOT )?EXISTS/i);
  });

  it("el down no toca RLS ni ninguna otra tabla", () => {
    expect(downDdl).not.toMatch(/CREATE POLICY/i);
    expect(downDdl).not.toMatch(/ROW LEVEL SECURITY/i);
    for (const [, tabla] of downDdl.matchAll(/ALTER\s+TABLE\s+"([a-z_]+)"/gi)) {
      expect(tabla).toBe("orden");
    }
  });

  it("declara POR ESCRITO las dos consecuencias operativas de revertir (design §2.3)", () => {
    // No es decoracion: esta reversion NO es inocua. Quien haga rollback tiene que saber que
    // (1) el corte volvera a barrer lo reservado y a crear `vencido`, y (2) el denominador del
    // ranking vuelve a `asignado_at`. Si el texto desaparece, este caso lo canta.
    expect(downSql).toMatch(/corte/i);
    expect(downSql).toMatch(/vencido/i);
    expect(downSql).toMatch(/ranking/i);
    expect(downSql).toMatch(/asignado_at/);
  });
});

describe("Feature 246 · schema.prisma refleja la migracion (sin drift)", () => {
  const bloque = /model Orden \{([\s\S]*?)\n\}/.exec(schemaPrisma)?.[1] ?? "";

  it("el model Orden encuentra su bloque (si no, el resto de este describe mentiria en verde)", () => {
    expect(bloque).not.toBe("");
  });

  it("declara `fechaReparto DateTime? @map(\"fecha_reparto\") @db.Date`", () => {
    expect(bloque).toMatch(
      /fechaReparto\s+DateTime\?\s+@map\("fecha_reparto"\)\s+@db\.Date/,
    );
  });

  it("`@db.Date` y NO un timestamp: es una fecha calendario, no un instante", () => {
    expect(bloque).not.toMatch(/fechaReparto\s+DateTime\?\s+@map\("fecha_reparto"\)\s*$/m);
  });

  it("declara el indice AMPLIADO con el nombre EXACTO del SQL (sin RENAME fantasma)", () => {
    expect(bloque).toMatch(
      /@@index\(\[mensajeroAsignadoId,\s*asignadoAt,\s*fechaReparto\],\s*map:\s*"orden_mensajero_asignado_at_fecha_reparto_idx"\)/,
    );
  });

  it("ya NO declara el compuesto de dos columnas ni un indice suelto por fecha", () => {
    // Si los dos convivieran, `orden` pagaria dos indices solapados en cada escritura — y el
    // `schema.prisma` estaria describiendo una base que no existe.
    expect(bloque).not.toMatch(/@@index\(\[mensajeroAsignadoId,\s*asignadoAt\]\)/);
    expect(bloque).not.toMatch(/@@index\(\[fechaReparto\]/);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a la que la precede", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    // Invariante ORDEN-ROBUSTO: sorts DESPUES de la carpeta inmediatamente anterior, no que
    // sea la ULTIMA del repo (estable ante añadidos de otras fichas en vuelo).
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
