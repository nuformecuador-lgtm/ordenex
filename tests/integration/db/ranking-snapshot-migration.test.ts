import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  crearPrismaDeTestEnEsquema,
  enTransaccionRevertida,
} from "./_postgres-real";
import { RankingSnapshotRepository } from "@/lib/repositories/RankingSnapshotRepository";
import { esP2002, textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";
import type { CrearSnapshotResult } from "@/lib/interfaces/repositories/IRankingSnapshotRepository";

// Feature 196 (T1.4) — cobertura de la migracion `*_ranking_snapshot`. Cubre R1, R8, R12,
// R13, R14, R17, R18, R37 y R38.
//
// ESTE ARCHIVO TIENE TRES BLOQUES, Y LA DIFERENCIA IMPORTA:
//
//  A. ESTATICO (patron `analytics-daily-migration` / `gestion-orden-ubicacion-migration`):
//     lee `migration.sql`, `down.sql` y `db/schema.prisma` y los contrasta por regex. No
//     necesita Postgres, corre siempre, y verifica la FORMA del DDL: que los CHECK esten
//     escritos, que las FK lleven RESTRICT/CASCADE, que la migracion sea ADITIVA (R18) y que
//     el DOWN suelte el detalle antes que la cabecera (R37).
//
//  B. COMPORTAMIENTO CONTRA POSTGRES DE VERDAD. Una regex no puede demostrar que el CHECK
//     RECHACE un premio sin podio, que el unico PARCIAL admita muchos NULL pero no dos
//     posiciones iguales, ni que el RESTRICT haga FALLAR el borrado del usuario. Eso son
//     hechos del motor. El bloque B los mide, y lo hace SIN APLICAR la migracion a ninguna
//     base: dentro de una transaccion que SIEMPRE se revierte, crea un ESQUEMA temporal,
//     ejecuta ahi el `migration.sql` REAL (no una parafrasis), ejercita las restricciones y
//     revierte. `_prisma_migrations` no se toca y en `public` no queda absolutamente nada.
//
//  C. EL REPOSITORIO DE VERDAD CONTRA POSTGRES DE VERDAD (R12/R14). El bloque B mide el DDL
//     con SQL crudo; el unitario mide el repositorio con un P2002 FABRICADO A MANO. Entre
//     los dos queda un eslabon que nadie habia medido: que el error que Postgres emite DE
//     VERDAD, atravesando el driver adapter, tenga la forma que `esColisionDeFecha` espera.
//     Si el nombre real de la constraint no casara, la reejecucion del cron daria un 500 en
//     vez de `omitido`. El bloque C hace DOS corridas de `crearSnapshot` por su API PUBLICA
//     sobre la misma fecha y comprueba que la segunda es un no-op reportado. Para eso NO
//     puede usar el `search_path` del bloque B (Prisma cualifica la tabla en el SQL que
//     genera): usa un segundo cliente apuntado al esquema temporal por el adapter
//     (`crearPrismaDeTestEnEsquema`). El esquema se crea y se suelta en los hooks; la
//     migracion NO se aplica a `public` y `_prisma_migrations` no se toca.
//
// POR QUE EL BLOQUE B NO PUEDE QUEDAR VERDE POR VACIO: no consulta datos preexistentes.
// Crea sus propios usuarios, su propia cabecera y sus propias filas, y cada asercion es
// sobre el MENSAJE de error de una sentencia que debia fallar. Si la tabla no se creara, o
// si un CHECK faltara, la sentencia pasaria y el test se pondria rojo por "no fallo lo que
// tenia que fallar". Lo unico que lo salta es la ausencia de `DATABASE_URL`, y entonces
// vitest lo marca como SKIPPED (nunca como passed).

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const SUFIJO = "_ranking_snapshot";

const carpeta = fs
  .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()
  .find((n) => n.endsWith(SUFIJO));
if (!carpeta) throw new Error(`No se encontro la carpeta de migracion ${SUFIJO}`);
const migrationDir = path.join(MIGRATIONS_DIR, carpeta);

const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

/**
 * El SQL EJECUTABLE, sin lineas de comentario: la prosa de estos archivos nombra a proposito
 * las palabras que las aserciones NEGATIVAS buscan (`DROP`, `UPDATE`, `CREATE POLICY`,
 * `entregadas <= asignadas`), y sin limpiar primero el test se leeria a si mismo y fallaria
 * por su propia documentacion.
 */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0 && !l.trimStart().startsWith("--"))
    .join("\n");
}

const upDdl = sinComentarios(upSql);
const downDdl = sinComentarios(downSql);

/** Sentencias sueltas del DDL. Ver el test que fija la invariante que hace valido el split. */
function sentenciasDe(ddl: string): string[] {
  return ddl
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const CUERPO_DIA = /CREATE TABLE "ranking_snapshot_dia" \(([\s\S]*?)\n\);/.exec(upSql)![1];
const CUERPO_FILA = /CREATE TABLE "ranking_snapshot_fila" \(([\s\S]*?)\n\);/.exec(upSql)![1];

const MODELO_DIA = /model RankingSnapshotDia \{[\s\S]*?\n\}/.exec(schemaPrisma)![0];
const MODELO_FILA = /model RankingSnapshotFila \{[\s\S]*?\n\}/.exec(schemaPrisma)![0];

// ===========================================================================================
// BLOQUE A — ESTATICO
// ===========================================================================================

describe("196 / R1 — la cabecera congela fecha, instante, umbral y conteo", () => {
  it("la carpeta de la migracion es la del design y trae los DOS archivos", () => {
    expect(path.basename(migrationDir)).toBe("20260811120000_ranking_snapshot");
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });

  it("`fecha` es DATE (fecha calendario CR), nunca un instante, y es UNIQUE", () => {
    expect(CUERPO_DIA).toMatch(/"fecha" DATE NOT NULL/);
    expect(CUERPO_DIA).not.toMatch(/"fecha" TIMESTAMP/);
    expect(upDdl).toMatch(
      /CREATE UNIQUE INDEX "ranking_snapshot_dia_fecha_key" ON "ranking_snapshot_dia"\("fecha"\)/,
    );
    expect(MODELO_DIA).toMatch(/fecha\s+DateTime\s+@unique @db\.Date/);
  });

  it("guarda el instante de generacion, el umbral aplicado y el conteo de filas", () => {
    expect(CUERPO_DIA).toMatch(/"generado_at" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(CUERPO_DIA).toMatch(/"min_asignadas_podio" INTEGER NOT NULL/);
    expect(CUERPO_DIA).toMatch(/"filas" INTEGER NOT NULL/);
    expect(MODELO_DIA).toMatch(/generadoAt\s+DateTime\s+@default\(now\(\)\) @map\("generado_at"\)/);
    expect(MODELO_DIA).toMatch(/minAsignadasPodio\s+Int\s+@map\("min_asignadas_podio"\)/);
  });

  it("la cabecera NO lleva updated_at: es inmutable por diseno (R12)", () => {
    expect(CUERPO_DIA).not.toMatch(/updated_at/);
    expect(MODELO_DIA).not.toMatch(/@updatedAt/);
  });

  it("el umbral es >= 1 y el conteo >= 0, por CHECK", () => {
    expect(upDdl).toMatch(
      /ADD CONSTRAINT "ranking_snapshot_dia_min_asignadas_podio_check"\s*\n?\s*CHECK \("min_asignadas_podio" >= 1\)/,
    );
    expect(upDdl).toMatch(
      /ADD CONSTRAINT "ranking_snapshot_dia_filas_check"\s*\n?\s*CHECK \("filas" >= 0\)/,
    );
  });
});

describe("196 / R6 — el detalle congela las siete columnas de negocio", () => {
  it("puesto, posicion, mensajero, nombre congelado, conteos y premio", () => {
    expect(CUERPO_FILA).toMatch(/"puesto" INTEGER NOT NULL/);
    expect(CUERPO_FILA).toMatch(/"posicion" INTEGER,/); // NULLABLE: sin podio (R9)
    expect(CUERPO_FILA).toMatch(/"mensajero_id" TEXT NOT NULL/);
    expect(CUERPO_FILA).toMatch(/"mensajero_nombre" TEXT NOT NULL/);
    expect(CUERPO_FILA).toMatch(/"entregadas" INTEGER NOT NULL/);
    expect(CUERPO_FILA).toMatch(/"asignadas" INTEGER NOT NULL/);
    expect(CUERPO_FILA).toMatch(/"premio_monto" DECIMAL\(12,2\),/);
    expect(CUERPO_FILA).toMatch(/"premio_descripcion" TEXT,?/);
  });

  it("R10: NO existe columna de porcentaje — el pct se deriva de los dos enteros", () => {
    expect(CUERPO_FILA).not.toMatch(/pct|porcentaje|ratio|tasa/i);
  });

  it("el premio es del MISMO tipo exacto que premio_ranking.monto", () => {
    expect(MODELO_FILA).toMatch(/premioMonto\s+Decimal\?\s+@map\("premio_monto"\) @db\.Decimal\(12, 2\)/);
  });

  it("NO hay CHECK `entregadas <= asignadas`, y es deliberado", () => {
    // Las dos magnitudes salen de fuentes distintas (`gestion_orden.created_at` vs
    // `orden.asignado_at`): una orden asignada ayer y entregada hoy hace entregadas >
    // asignadas legitimamente. Un CHECK aqui tumbaria el cron un dia cualquiera.
    expect(upDdl).not.toMatch(/"entregadas"\s*<=\s*"asignadas"/);
  });
});

describe("196 / R8 — sin podio, sin premio: lo impide la BASE", () => {
  it("el CHECK de premio-sin-posicion existe y cubre monto Y descripcion", () => {
    expect(upDdl).toMatch(
      /ADD CONSTRAINT "ranking_snapshot_fila_premio_sin_posicion_check"\s*\n?\s*CHECK \("posicion" IS NOT NULL OR \("premio_monto" IS NULL AND "premio_descripcion" IS NULL\)\)/,
    );
  });

  it("R9: la posicion de podio solo puede ser 1, 2 o 3 (o ausente)", () => {
    expect(upDdl).toMatch(
      /ADD CONSTRAINT "ranking_snapshot_fila_posicion_check"\s*\n?\s*CHECK \("posicion" IS NULL OR "posicion" IN \(1, 2, 3\)\)/,
    );
  });

  it("el puesto arranca en 1 y los conteos no son negativos", () => {
    expect(upDdl).toMatch(
      /ADD CONSTRAINT "ranking_snapshot_fila_puesto_check"\s*\n?\s*CHECK \("puesto" >= 1\)/,
    );
    expect(upDdl).toMatch(
      /ADD CONSTRAINT "ranking_snapshot_fila_conteos_no_negativos"\s*\n?\s*CHECK \("entregadas" >= 0 AND "asignadas" >= 0\)/,
    );
  });
});

describe("196 / R13 — los CUATRO unicos, incluido el PARCIAL", () => {
  it("declara exactamente los cuatro indices unicos del design y ninguno mas", () => {
    const indices = Array.from(upDdl.matchAll(/CREATE (?:UNIQUE )?INDEX "([a-z_0-9]+)"/g)).map(
      (m) => m[1],
    );
    expect(indices.sort()).toEqual([
      "ranking_snapshot_dia_fecha_key",
      "ranking_snapshot_fila_snapshot_id_mensajero_id_key",
      "ranking_snapshot_fila_snapshot_id_posicion_uq",
      "ranking_snapshot_fila_snapshot_id_puesto_key",
    ]);
  });

  it("un mensajero no se repite en un snapshot, y un puesto tampoco", () => {
    expect(upDdl).toMatch(
      /CREATE UNIQUE INDEX "ranking_snapshot_fila_snapshot_id_mensajero_id_key" ON "ranking_snapshot_fila"\("snapshot_id", "mensajero_id"\)/,
    );
    expect(upDdl).toMatch(
      /CREATE UNIQUE INDEX "ranking_snapshot_fila_snapshot_id_puesto_key" ON "ranking_snapshot_fila"\("snapshot_id", "puesto"\)/,
    );
    expect(MODELO_FILA).toMatch(/@@unique\(\[snapshotId, mensajeroId\]\)/);
    expect(MODELO_FILA).toMatch(/@@unique\(\[snapshotId, puesto\]\)/);
  });

  it("el de posicion es PARCIAL (`WHERE posicion IS NOT NULL`) y vive SOLO en el .sql", () => {
    // Prisma no sabe expresar un indice parcial. Declararlo en el datamodel como un
    // @@unique TOTAL seria peor que no declararlo: cambiaria el indice real. Que este
    // huerfano es la decision, y el `.sql` la explica; el test la fija para que nadie
    // "arregle" el huerfano metiendo un @@unique distinto al indice de la base.
    expect(upDdl).toMatch(
      /CREATE UNIQUE INDEX "ranking_snapshot_fila_snapshot_id_posicion_uq"\s*\n?\s*ON "ranking_snapshot_fila" \("snapshot_id", "posicion"\)\s*\n?\s*WHERE "posicion" IS NOT NULL/,
    );
    expect(MODELO_FILA).not.toMatch(/@@unique\(\[snapshotId, posicion\]/);
    expect(upSql).toContain("HUERFANO del datamodel");
  });
});

describe("196 / R17 — el historico no se queda huerfano", () => {
  it("la FK a usuario es ON DELETE RESTRICT, como las cuatro de analytics_daily", () => {
    expect(upDdl).toMatch(
      /ADD CONSTRAINT "ranking_snapshot_fila_mensajero_id_fkey" FOREIGN KEY \("mensajero_id"\) REFERENCES "usuario"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/,
    );
    expect(MODELO_FILA).toMatch(/mensajero Usuario\s+@relation\([\s\S]*?onDelete: Restrict/);
    expect(upDdl).not.toMatch(/REFERENCES "usuario"\("id"\) ON DELETE (CASCADE|SET NULL)/);
  });

  it("la FK a la cabecera es ON DELETE CASCADE: una fila sin cabecera no significa nada", () => {
    expect(upDdl).toMatch(
      /ADD CONSTRAINT "ranking_snapshot_fila_snapshot_id_fkey" FOREIGN KEY \("snapshot_id"\) REFERENCES "ranking_snapshot_dia"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE/,
    );
    expect(MODELO_FILA).toMatch(/snapshot\s+RankingSnapshotDia\s+@relation\([\s\S]*?onDelete: Cascade/);
  });

  it("son exactamente DOS FK", () => {
    expect(upDdl.match(/FOREIGN KEY/g)).toHaveLength(2);
  });
});

describe("196 / R18 + R37 — la migracion es ADITIVA: no toca NADA preexistente", () => {
  it("solo crea y altera las dos tablas nuevas", () => {
    const creadas = Array.from(upDdl.matchAll(/CREATE TABLE "([a-z_0-9]+)"/g)).map((m) => m[1]);
    expect(creadas.sort()).toEqual(["ranking_snapshot_dia", "ranking_snapshot_fila"]);
    const alteradas = new Set(
      Array.from(upDdl.matchAll(/ALTER TABLE "([a-z_0-9]+)"/g)).map((m) => m[1]),
    );
    expect([...alteradas].sort()).toEqual(["ranking_snapshot_dia", "ranking_snapshot_fila"]);
  });

  it("los COMMENT ON solo hablan de las dos tablas nuevas", () => {
    const comentadas = new Set(
      Array.from(upDdl.matchAll(/COMMENT ON (?:TABLE|COLUMN) "([a-z_0-9]+)"/g)).map((m) => m[1]),
    );
    expect([...comentadas].sort()).toEqual(["ranking_snapshot_dia", "ranking_snapshot_fila"]);
    // La semantica viaja en la base (patron analytics_daily): las dos tablas y las columnas
    // que un lector del esquema no podria interpretar mirando solo el tipo.
    expect(upDdl.match(/COMMENT ON TABLE/g)).toHaveLength(2);
    expect((upDdl.match(/COMMENT ON COLUMN/g) ?? []).length).toBeGreaterThanOrEqual(8);
  });

  it("no destruye, no renombra y no crea enums", () => {
    expect(upDdl).not.toMatch(/DROP TABLE/i);
    expect(upDdl).not.toMatch(/DROP COLUMN/i);
    expect(upDdl).not.toMatch(/DROP INDEX/i);
    expect(upDdl).not.toMatch(/DROP CONSTRAINT/i);
    expect(upDdl).not.toMatch(/DROP TYPE/i);
    expect(upDdl).not.toMatch(/ALTER COLUMN/i);
    expect(upDdl).not.toMatch(/ALTER TYPE/i);
    expect(upDdl).not.toMatch(/CREATE TYPE/i);
    expect(upDdl).not.toMatch(/RENAME/i);
  });

  it("no mueve un solo dato: ni backfill, ni semilla, ni borrado", () => {
    // La comprobacion es por SENTENCIA y no por palabra suelta: `ON UPDATE CASCADE` y
    // `ON DELETE RESTRICT` son clausulas legitimas de las dos FK, y una negativa ingenua
    // sobre el texto se rompería con ellas sin que exista ningun DML.
    for (const sentencia of sentenciasDe(upDdl)) {
      expect(sentencia, sentencia).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|SELECT)\b/i);
    }
  });

  it("R37: el DOWN suelta el DETALLE antes que la CABECERA, y nada mas", () => {
    expect(sentenciasDe(downDdl)).toEqual([
      'DROP TABLE IF EXISTS "ranking_snapshot_fila"',
      'DROP TABLE IF EXISTS "ranking_snapshot_dia"',
    ]);
  });

  it("R37: el DOWN no lleva DROP TYPE (no se creo ningun enum) ni toca nada ajeno", () => {
    expect(downDdl).not.toMatch(/DROP TYPE/i);
    expect(downDdl).not.toMatch(/ALTER TABLE/i);
    expect(downDdl).not.toMatch(/CASCADE/i);
    expect(downDdl).not.toMatch(/usuario/);
  });
});

describe("196 / R38 — RLS habilitada en las dos tablas nuevas", () => {
  it("las dos llevan ENABLE ROW LEVEL SECURITY", () => {
    expect(upDdl).toMatch(/ALTER TABLE "ranking_snapshot_dia" ENABLE ROW LEVEL SECURITY;/);
    expect(upDdl).toMatch(/ALTER TABLE "ranking_snapshot_fila" ENABLE ROW LEVEL SECURITY;/);
  });

  it("cero policies: solo el service role accede (patron ruta_optimizada / analytics_daily)", () => {
    expect(upDdl).not.toMatch(/CREATE POLICY/i);
    expect(upDdl).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
  });
});

describe("196 — el datamodel y el SQL no se separan", () => {
  it("los dos modelos mapean a las dos tablas en snake_case", () => {
    expect(MODELO_DIA).toMatch(/@@map\("ranking_snapshot_dia"\)/);
    expect(MODELO_FILA).toMatch(/@@map\("ranking_snapshot_fila"\)/);
    for (const cuerpo of [CUERPO_DIA, CUERPO_FILA]) {
      const columnas = Array.from(cuerpo.matchAll(/^\s{4}"([a-z_0-9]+)"/gm)).map((m) => m[1]);
      expect(columnas.length).toBeGreaterThan(0);
      for (const c of columnas) expect(c).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("Usuario declara el lado inverso de la relacion (sin el, el schema no valida)", () => {
    expect(schemaPrisma).toMatch(
      /rankingSnapshotFilas\s+RankingSnapshotFila\[\]\s+@relation\("RankingSnapshotFilaMensajero"\)/,
    );
  });

  it("ninguna cadena del SQL contiene `;` — lo que hace valido partir el DDL por `;`", () => {
    // El bloque B ejecuta el `migration.sql` REAL partiendolo por `;`. Si algun dia un
    // COMMENT llevara un `;` dentro de la cadena, ese split partiria una sentencia por la
    // mitad y el bloque B fallaria por un motivo que no es el suyo. La invariante se fija
    // aqui, donde el mensaje de error dice exactamente que pasa.
    const literales = upSql.match(/'[^']*'/g) ?? [];
    expect(literales.length).toBeGreaterThan(0);
    for (const literal of literales) {
      expect(literal, `este literal del .sql contiene un ';': ${literal}`).not.toContain(";");
    }
  });
});

// ===========================================================================================
// BLOQUE B — COMPORTAMIENTO CONTRA POSTGRES DE VERDAD
// ===========================================================================================

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** Columna tal como Postgres la creo de verdad. */
interface ColumnaReal {
  column_name: string;
  data_type: string;
  is_nullable: string;
  numeric_precision: number | null;
  numeric_scale: number | null;
}

interface Medicion {
  columnasDia: ColumnaReal[];
  columnasFila: ColumnaReal[];
  rls: { relname: string; relrowsecurity: boolean }[];
  errores: Record<string, string>;
  filasTrasBorrarCabecera: number;
  tablasTrasElDown: string[];
}

describeSiHayBase("196 / bloque B — las restricciones RECHAZAN de verdad (Postgres real)", () => {
  let prisma: PrismaClient;
  let medicion: Medicion;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    medicion = await enTransaccionRevertida(prisma, async (tx) => medir(tx));
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /**
   * Corre el `migration.sql` REAL en un esquema temporal y ejercita todo. Todo lo que pasa
   * aqui vive dentro de la transaccion que `enTransaccionRevertida` deshace: ni el esquema
   * temporal, ni los usuarios, ni las filas sobreviven al test.
   */
  async function medir(tx: Tx): Promise<Medicion> {
    const esquema = `t196_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
    // `public` sigue en el search_path porque la FK del detalle apunta a la tabla `usuario`
    // REAL. Sin ella, este bloque probaria un RESTRICT de mentira contra una tabla de juguete.
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${esquema}", public`);

    for (const sentencia of sentenciasDe(upDdl)) {
      await tx.$executeRawUnsafe(sentencia);
    }

    const columnasDia = await columnasDe(tx, esquema, "ranking_snapshot_dia");
    const columnasFila = await columnasDe(tx, esquema, "ranking_snapshot_fila");
    const rls = await tx.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
      `SELECT c.relname, c.relrowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind = 'r'
        ORDER BY c.relname`,
      esquema,
    );

    // --- datos PROPIOS del test (nada preexistente) -----------------------------------
    const [a, b, c] = [await crearUsuario(tx), await crearUsuario(tx), await crearUsuario(tx)];
    const snapshotId = randomUUID();
    await tx.$executeRawUnsafe(
      `INSERT INTO "ranking_snapshot_dia" ("id", "fecha", "min_asignadas_podio", "filas")
       VALUES ($1, DATE '2026-08-10', 5, 2)`,
      snapshotId,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO "ranking_snapshot_fila"
         ("id","snapshot_id","puesto","posicion","mensajero_id","mensajero_nombre","entregadas","asignadas","premio_monto","premio_descripcion")
       VALUES ($1, $2, 1, 1, $3, 'Nombre Congelado A', 9, 10, 25000.00, 'Primer lugar')`,
      randomUUID(),
      snapshotId,
      a.id,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO "ranking_snapshot_fila"
         ("id","snapshot_id","puesto","posicion","mensajero_id","mensajero_nombre","entregadas","asignadas")
       VALUES ($1, $2, 2, NULL, $3, 'Nombre Congelado B', 1, 4)`,
      randomUUID(),
      snapshotId,
      b.id,
    );

    const fila = (
      puesto: number | string,
      posicion: string,
      mensajeroId: string,
      extra = "",
    ): string =>
      `INSERT INTO "ranking_snapshot_fila"
         ("id","snapshot_id","puesto","posicion","mensajero_id","mensajero_nombre","entregadas","asignadas"${extra ? ',"premio_monto"' : ""})
       VALUES ('${randomUUID()}', '${snapshotId}', ${puesto}, ${posicion}, '${mensajeroId}', 'X', 0, 1${extra})`;

    const errores: Record<string, string> = {
      dia_fecha_duplicada: await resultadoDe(
        tx,
        `INSERT INTO "ranking_snapshot_dia" ("id","fecha","min_asignadas_podio","filas")
         VALUES ('${randomUUID()}', DATE '2026-08-10', 5, 0)`,
      ),
      fila_mensajero_duplicado: await resultadoDe(tx, fila(9, "NULL", a.id)),
      fila_puesto_duplicado: await resultadoDe(tx, fila(1, "NULL", c.id)),
      fila_posicion_duplicada: await resultadoDe(tx, fila(9, "1", c.id)),
      // El unico PARCIAL NO debe estorbar: muchos NULL conviven en el mismo snapshot.
      fila_dos_sin_podio: await resultadoDe(tx, fila(9, "NULL", c.id)),
      fila_premio_sin_posicion: await resultadoDe(tx, fila(9, "NULL", c.id, ", 25000.00")),
      fila_posicion_fuera_de_podio: await resultadoDe(tx, fila(9, "4", c.id)),
      fila_puesto_cero: await resultadoDe(tx, fila(0, "NULL", c.id)),
      dia_umbral_cero: await resultadoDe(
        tx,
        `INSERT INTO "ranking_snapshot_dia" ("id","fecha","min_asignadas_podio","filas")
         VALUES ('${randomUUID()}', DATE '2026-08-11', 0, 0)`,
      ),
      dia_filas_negativas: await resultadoDe(
        tx,
        `INSERT INTO "ranking_snapshot_dia" ("id","fecha","min_asignadas_podio","filas")
         VALUES ('${randomUUID()}', DATE '2026-08-12', 5, -1)`,
      ),
      borrar_usuario_con_historia: await resultadoDe(
        tx,
        `DELETE FROM public."usuario" WHERE "id" = '${a.id}'`,
      ),
    };

    // CASCADE: al borrar la cabecera, sus filas se van con ella.
    await tx.$executeRawUnsafe(`DELETE FROM "ranking_snapshot_dia" WHERE "id" = $1`, snapshotId);
    const [{ n }] = await tx.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::int AS n FROM "ranking_snapshot_fila"`,
    );

    // R37 — el DOWN real deja el esquema como estaba.
    for (const sentencia of sentenciasDe(downDdl)) await tx.$executeRawUnsafe(sentencia);
    const tablasTrasElDown = (
      await tx.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
        esquema,
      )
    ).map((r) => r.table_name);

    return {
      columnasDia,
      columnasFila,
      rls,
      errores,
      filasTrasBorrarCabecera: Number(n),
      tablasTrasElDown,
    };
  }

  async function columnasDe(tx: Tx, esquema: string, tabla: string): Promise<ColumnaReal[]> {
    return tx.$queryRawUnsafe<ColumnaReal[]>(
      `SELECT column_name, data_type, is_nullable, numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`,
      esquema,
      tabla,
    );
  }

  /**
   * Ejecuta `sql` dentro de un SAVEPOINT y devuelve el MENSAJE de error, o `""` si la
   * sentencia paso. El savepoint es obligatorio: en Postgres un error aborta la transaccion
   * entera, y sin el, la primera violacion esperada dejaria muerto todo el resto del test.
   * En los dos casos se vuelve al savepoint, asi que el estado queda EXACTAMENTE igual y las
   * mediciones siguientes no dependen del orden.
   */
  async function resultadoDe(tx: Tx, sql: string): Promise<string> {
    await tx.$executeRawUnsafe("SAVEPOINT s196");
    try {
      await tx.$executeRawUnsafe(sql);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT s196");
      return "";
    } catch (error) {
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT s196");
      return error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Un usuario NUEVO, creado por el test. Toma rol y tipo de identificacion de los catalogos
   * (los siembran las migraciones de catalogo); si no hubiera ninguno, FALLA con el motivo
   * escrito en vez de saltarse: un test que se abstiene porque la base esta vacia es
   * exactamente el verde-en-falso que este archivo existe para evitar.
   */
  async function crearUsuario(tx: Tx): Promise<{ id: string }> {
    const [rol] = await tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM public."rol" LIMIT 1`,
    );
    const [tipo] = await tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM public."tipo_identificacion" LIMIT 1`,
    );
    if (!rol || !tipo) {
      throw new Error(
        "La base de pruebas no tiene catalogos `rol`/`tipo_identificacion` sembrados: sin " +
          "ellos no se puede crear el usuario propio del test. Corre `pnpm db:seed` antes. " +
          "Este test NO se salta en ese caso a proposito (si lo hiciera, quedaria verde sin " +
          "haber comprobado el RESTRICT de R17).",
      );
    }
    const id = randomUUID();
    const sufijo = id.slice(0, 8);
    await tx.$executeRawUnsafe(
      `INSERT INTO public."usuario"
         ("id","nombre","email","telefono","password_hash","cedula","tipo_identificacion_id","rol_id","updated_at")
       VALUES ($1, $2, $3, '00000000', 'x', $4, $5, $6, now())`,
      id,
      `Mensajero ${sufijo}`,
      `t196-${sufijo}@example.test`,
      `t196${sufijo}`,
      tipo.id,
      rol.id,
    );
    return { id };
  }

  it("R1: la cabecera existe con fecha DATE, generado_at, umbral y conteo", () => {
    const porNombre = Object.fromEntries(medicion.columnasDia.map((c) => [c.column_name, c]));
    expect(Object.keys(porNombre).sort()).toEqual([
      "fecha",
      "filas",
      "generado_at",
      "id",
      "min_asignadas_podio",
    ]);
    expect(porNombre.fecha.data_type).toBe("date");
    expect(porNombre.generado_at.data_type).toBe("timestamp without time zone");
    expect(porNombre.min_asignadas_podio.data_type).toBe("integer");
    expect(porNombre.filas.data_type).toBe("integer");
    for (const c of medicion.columnasDia) expect(c.is_nullable).toBe("NO");
  });

  it("R6: el detalle existe con sus diez columnas y los tipos del design", () => {
    const porNombre = Object.fromEntries(medicion.columnasFila.map((c) => [c.column_name, c]));
    expect(Object.keys(porNombre).sort()).toEqual([
      "asignadas",
      "entregadas",
      "id",
      "mensajero_id",
      "mensajero_nombre",
      "posicion",
      "premio_descripcion",
      "premio_monto",
      "puesto",
      "snapshot_id",
    ]);
    expect(porNombre.puesto.data_type).toBe("integer");
    expect(porNombre.puesto.is_nullable).toBe("NO");
    expect(porNombre.posicion.is_nullable).toBe("YES"); // R9: listado sin podio
    expect(porNombre.mensajero_nombre.data_type).toBe("text");
    expect(porNombre.mensajero_nombre.is_nullable).toBe("NO"); // R16
    expect(porNombre.premio_monto.data_type).toBe("numeric");
    expect(porNombre.premio_monto.numeric_precision).toBe(12);
    expect(porNombre.premio_monto.numeric_scale).toBe(2);
    expect(porNombre.premio_monto.is_nullable).toBe("YES");
    expect(porNombre.premio_descripcion.is_nullable).toBe("YES");
  });

  it("R13: la MISMA fecha no puede tener dos cabeceras", () => {
    expect(medicion.errores.dia_fecha_duplicada).toMatch(/ranking_snapshot_dia_fecha_key/);
  });

  it("R13: el mismo mensajero no puede aparecer dos veces en un snapshot", () => {
    expect(medicion.errores.fila_mensajero_duplicado).toMatch(
      /ranking_snapshot_fila_snapshot_id_mensajero_id_key/,
    );
  });

  it("R13: dos filas no pueden ocupar el mismo puesto", () => {
    expect(medicion.errores.fila_puesto_duplicado).toMatch(
      /ranking_snapshot_fila_snapshot_id_puesto_key/,
    );
  });

  it("R13: dos filas no pueden ocupar la misma posicion de PODIO", () => {
    expect(medicion.errores.fila_posicion_duplicada).toMatch(
      /ranking_snapshot_fila_snapshot_id_posicion_uq/,
    );
  });

  it("R13: pero el unico parcial SI admite muchas filas sin podio (posicion NULL)", () => {
    // Sin el `WHERE posicion IS NOT NULL` esto tambien seria un unico total y —dependiendo
    // del tratamiento de NULL— podria bloquear a todo el que no hace podio. Es la mitad de
    // la restriccion que un test de solo-duplicados nunca comprueba.
    expect(medicion.errores.fila_dos_sin_podio).toBe("");
  });

  it("R8: una fila SIN posicion de podio no puede llevar premio congelado", () => {
    expect(medicion.errores.fila_premio_sin_posicion).toMatch(
      /ranking_snapshot_fila_premio_sin_posicion_check/,
    );
  });

  it("R9: la posicion 4 no existe", () => {
    expect(medicion.errores.fila_posicion_fuera_de_podio).toMatch(
      /ranking_snapshot_fila_posicion_check/,
    );
  });

  it("R1/R6: el puesto 0, el umbral 0 y un conteo negativo son imposibles", () => {
    expect(medicion.errores.fila_puesto_cero).toMatch(/ranking_snapshot_fila_puesto_check/);
    expect(medicion.errores.dia_umbral_cero).toMatch(
      /ranking_snapshot_dia_min_asignadas_podio_check/,
    );
    expect(medicion.errores.dia_filas_negativas).toMatch(/ranking_snapshot_dia_filas_check/);
  });

  it("R17: borrar un usuario CON filas congeladas FALLA (RESTRICT)", () => {
    expect(medicion.errores.borrar_usuario_con_historia).toMatch(
      /ranking_snapshot_fila_mensajero_id_fkey/,
    );
  });

  it("borrar la cabecera se lleva sus filas (CASCADE)", () => {
    expect(medicion.filasTrasBorrarCabecera).toBe(0);
  });

  it("R38: relrowsecurity es true en las DOS tablas", () => {
    expect(medicion.rls).toEqual([
      { relname: "ranking_snapshot_dia", relrowsecurity: true },
      { relname: "ranking_snapshot_fila", relrowsecurity: true },
    ]);
  });

  it("R37: el down.sql real deja el esquema sin rastro de las dos tablas", () => {
    expect(medicion.tablasTrasElDown).toEqual([]);
  });
});

// ===========================================================================================
// BLOQUE C — `crearSnapshot` DE VERDAD: dos corridas sobre la misma fecha (R12/R14)
// ===========================================================================================

/** Un error tal como llego, sin interpretarlo: la evidencia cruda de la medicion. */
interface ErrorMedido {
  clase: string;
  code: string | null;
  /** Lo que `textoConstraintP2002` extrae del error REAL (lo que `esColisionDeFecha` lee). */
  texto: string | null;
  esP2002: boolean;
}

/** Cabecera leida con SQL crudo: a proposito NO por el repositorio que se esta midiendo. */
interface CabeceraReal {
  id: string;
  generado_at: Date;
  min_asignadas_podio: number;
  filas: number;
}

interface FilaReal {
  puesto: number;
  posicion: number | null;
  mensajero_id: string;
  mensajero_nombre: string;
  entregadas: number;
  asignadas: number;
}

interface MedicionRepo {
  /** El P2002 REAL que emite Postgres al repetir la fecha, capturado por la API de modelo. */
  colisionDeFecha: ErrorMedido;
  corrida1: CrearSnapshotResult;
  corrida2: CrearSnapshotResult;
  cabeceraAntes: CabeceraReal;
  cabeceraDespues: CabeceraReal;
  filasDespues: FilaReal[];
  /** P2002 de OTRA constraint (puesto duplicado): NO debe confundirse con la reejecucion. */
  colisionDePuesto: ErrorMedido;
  cabecerasDeLaFechaQueFallo: number;
}

describeSiHayBase("196 / bloque C — reejecutar el cron sobre una fecha ya congelada (R12/R14)", () => {
  // El nombre se fija ANTES de cualquier await para que el `afterAll` pueda soltarlo aunque
  // el `beforeAll` muera a mitad.
  const esquema = `t196_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const FECHA = new Date("2026-08-10T00:00:00.000Z"); // medianoche UTC = fecha calendario CR
  const FECHA_QUE_FALLA = new Date("2026-08-09T00:00:00.000Z");

  let admin: PrismaClient | undefined; // DDL y lecturas crudas (esquema `public` por defecto)
  let cliente: PrismaClient | undefined; // sus consultas de MODELO van al esquema temporal
  let medicion: MedicionRepo;

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    // Limpieza defensiva: si una corrida anterior murio de la peor manera posible (el proceso
    // matado entre el CREATE y el DROP), su esquema seguiria ahi. Se barren TODOS los `t196_%`
    // ajenos a esta corrida antes de empezar.
    const huerfanos = await admin.$queryRawUnsafe<{ nspname: string }[]>(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE 't196\\_%' AND nspname <> $1`,
      esquema,
    );
    for (const h of huerfanos) {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${h.nspname}" CASCADE`);
    }

    await admin.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
    // El DDL va dentro de UNA transaccion propia porque el `SET LOCAL search_path` solo vale
    // para la conexion que lo ejecuta: con el pool, cada `$executeRawUnsafe` suelto podria
    // caer en otra conexion y crear las tablas en `public`. `public` sigue en el search_path
    // para que la FK del detalle apunte a la tabla `usuario` REAL (la FK se resuelve al crear
    // la constraint, asi que el vinculo queda fijado ahi para siempre).
    //
    // Esta transaccion SI se compromete: el esquema temporal tiene que sobrevivir para que el
    // segundo cliente lo vea desde OTRA conexion. Por eso el `afterAll` lo suelta.
    await admin.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${esquema}", public`);
        for (const sentencia of sentenciasDe(upDdl)) await tx.$executeRawUnsafe(sentencia);
      },
      { timeout: 60_000, maxWait: 15_000 },
    );

    cliente = crearPrismaDeTestEnEsquema(esquema);
    medicion = await medir(admin, cliente);
  }, 180_000);

  afterAll(async () => {
    // Corre pase o falle el test: el esquema temporal NO sobrevive a este archivo.
    try {
      await cliente?.$disconnect();
    } finally {
      try {
        await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
      } finally {
        await admin?.$disconnect();
      }
    }
  }, 60_000);

  /**
   * Los dos mensajeros de las filas, LEIDOS de los que ya existen: este bloque no escribe ni
   * una fila en `public`. Si la base no tuviera usuarios, FALLA con el motivo escrito en vez
   * de saltarse: un test que se abstiene porque la base esta vacia es el verde-en-falso que
   * este archivo existe para evitar.
   */
  async function dosMensajeros(cli: PrismaClient): Promise<[string, string]> {
    const filas = await cli.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM public."usuario" ORDER BY id LIMIT 2`,
    );
    if (filas.length < 2) {
      throw new Error(
        "La base de pruebas no tiene dos usuarios en `public.usuario`: sin ellos la FK " +
          "`ranking_snapshot_fila_mensajero_id_fkey` no deja escribir las filas del snapshot. " +
          "Corre `pnpm db:seed`. Este bloque NO crea usuarios a proposito (no escribe NADA en " +
          "`public`) y NO se salta en este caso (si lo hiciera, R12 quedaria verde sin haberse " +
          "comprobado contra Postgres).",
      );
    }
    return [filas[0].id, filas[1].id];
  }

  function comoErrorMedido(error: unknown): ErrorMedido {
    return {
      clase: error instanceof Error ? error.constructor.name : typeof error,
      code:
        typeof (error as { code?: unknown })?.code === "string"
          ? (error as { code: string }).code
          : null,
      texto: textoConstraintP2002(error),
      esP2002: esP2002(error),
    };
  }

  async function capturar(fn: () => Promise<unknown>): Promise<ErrorMedido> {
    try {
      await fn();
    } catch (error) {
      return comoErrorMedido(error);
    }
    throw new Error("la operacion NO fallo, y tenia que fallar");
  }

  async function medir(adm: PrismaClient, cli: PrismaClient): Promise<MedicionRepo> {
    const [m1, m2] = await dosMensajeros(adm);
    const repo = new RankingSnapshotRepository(cli);

    // --- corrida 1: la fecha se congela con DOS filas -------------------------------------
    const corrida1 = await repo.crearSnapshot({
      fecha: FECHA,
      minAsignadasPodio: 5,
      filas: [
        {
          puesto: 1,
          posicion: 1,
          mensajeroId: m1,
          mensajeroNombre: "Nombre Congelado A",
          entregadas: 9,
          asignadas: 10,
          premioMonto: "25000.00",
          premioDescripcion: "Primer lugar",
        },
        {
          puesto: 2,
          posicion: null,
          mensajeroId: m2,
          mensajeroNombre: "Nombre Congelado B",
          entregadas: 1,
          asignadas: 4,
          premioMonto: null,
          premioDescripcion: null,
        },
      ],
    });
    const cabeceraAntes = await leerCabecera(adm, FECHA);

    // --- el ERROR REAL, en crudo ----------------------------------------------------------
    // Este `create` es el que hace el repositorio por dentro. Se captura aparte para poder
    // AFIRMAR la forma del error que Postgres emite de verdad, que es justo lo que el test
    // unitario tiene que fabricar a mano. No escribe nada: falla.
    const colisionDeFecha = await capturar(() =>
      cli.rankingSnapshotDia.create({ data: { fecha: FECHA, minAsignadasPodio: 5, filas: 0 } }),
    );

    // --- corrida 2: MISMA fecha, contenido DISTINTO ---------------------------------------
    // `filas` trae UNA sola fila y otro umbral: si el repositorio reescribiera algo, o si
    // reportara lo que se habria escrito en vez de lo congelado, el resultado seria `1`.
    const corrida2 = await repo.crearSnapshot({
      fecha: FECHA,
      minAsignadasPodio: 99,
      filas: [
        {
          puesto: 1,
          posicion: 1,
          mensajeroId: m2,
          mensajeroNombre: "Nombre NUEVO que no debe entrar",
          entregadas: 100,
          asignadas: 100,
          premioMonto: "999.00",
          premioDescripcion: "Premio que no debe entrar",
        },
      ],
    });
    const cabeceraDespues = await leerCabecera(adm, FECHA);
    const filasDespues = await adm.$queryRawUnsafe<FilaReal[]>(
      `SELECT "puesto", "posicion", "mensajero_id", "mensajero_nombre", "entregadas", "asignadas"
         FROM "${esquema}"."ranking_snapshot_fila"
        WHERE "snapshot_id" = $1
        ORDER BY "puesto"`,
      cabeceraAntes.id,
    );

    // --- R14 + el OTRO P2002 --------------------------------------------------------------
    // Dos filas con el MISMO puesto: choca contra `..._snapshot_id_puesto_key`, que tambien
    // es un P2002 pero NO es una reejecucion. Debe PROPAGARSE (si se lo tragara, un defecto
    // se convertiria en un `omitido` silencioso) y no debe dejar cabecera (R14).
    const filaChoque = (mensajeroId: string) => ({
      puesto: 1,
      posicion: null,
      mensajeroId,
      mensajeroNombre: "X",
      entregadas: 0,
      asignadas: 1,
      premioMonto: null,
      premioDescripcion: null,
    });
    const colisionDePuesto = await capturar(() =>
      repo.crearSnapshot({
        fecha: FECHA_QUE_FALLA,
        minAsignadasPodio: 5,
        filas: [filaChoque(m1), filaChoque(m2)],
      }),
    );
    const [{ n }] = await adm.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "${esquema}"."ranking_snapshot_dia" WHERE "fecha" = DATE '2026-08-09'`,
    );

    return {
      colisionDeFecha,
      corrida1,
      corrida2,
      cabeceraAntes,
      cabeceraDespues,
      filasDespues,
      colisionDePuesto,
      cabecerasDeLaFechaQueFallo: Number(n),
    };
  }

  async function leerCabecera(cli: PrismaClient, fecha: Date): Promise<CabeceraReal> {
    // La fecha viaja como TEXTO `YYYY-MM-DD`, no como `Date`: un `Date` se manda como
    // instante y el `::date` lo resolveria con la zona de la SESION, que en una maquina en
    // UTC-6 devolveria el dia ANTERIOR y haria fallar el test por un motivo que no es el suyo.
    const filas = await cli.$queryRawUnsafe<CabeceraReal[]>(
      `SELECT "id", "generado_at", "min_asignadas_podio", "filas"
         FROM "${esquema}"."ranking_snapshot_dia"
        WHERE "fecha" = $1::date`,
      fecha.toISOString().slice(0, 10),
    );
    if (filas.length !== 1) {
      throw new Error(`se esperaba UNA cabecera de ${fecha.toISOString()}, hay ${filas.length}`);
    }
    return filas[0];
  }

  it("la primera corrida congela la fecha con sus dos filas", () => {
    expect(medicion.corrida1).toEqual({ creado: true, filas: 2 });
    expect(medicion.cabeceraAntes.filas).toBe(2);
    expect(medicion.cabeceraAntes.min_asignadas_podio).toBe(5);
  });

  it("R12: el P2002 que emite POSTGRES DE VERDAD nombra la constraint de `fecha`", () => {
    // ESTE es el eslabon que el test unitario no puede medir: alli el error esta fabricado a
    // mano. Aqui viene del motor, atravesando `@prisma/adapter-pg`. Si el nombre real de la
    // constraint dejara de contener «fecha» —un rename en la migracion, por ejemplo—,
    // `esColisionDeFecha` dejaria de reconocerlo y la reejecucion del cron daria un 500 en
    // vez de `omitido`.
    expect(medicion.colisionDeFecha.esP2002).toBe(true);
    expect(medicion.colisionDeFecha.code).toBe("P2002");
    expect(medicion.colisionDeFecha.texto).toContain("ranking_snapshot_dia_fecha_key");
    // La condicion EXACTA que evalua `esColisionDeFecha` en produccion.
    expect(medicion.colisionDeFecha.texto).toContain("fecha");
  });

  it("R12: la segunda corrida sobre la misma fecha NO crea, y reporta lo YA congelado", () => {
    // El `2` es la clave doble: el repositorio se trago el P2002 REAL (no propago un 500) Y
    // el conteo que reporta es el de la base, no el de la entrada (que traia UNA fila).
    expect(medicion.corrida2).toEqual({ creado: false, filas: 2 });
  });

  it("R12: la reejecucion no altera la cabecera (ni el instante, ni el umbral, ni el conteo)", () => {
    expect(medicion.cabeceraDespues.id).toBe(medicion.cabeceraAntes.id);
    expect(medicion.cabeceraDespues.generado_at.getTime()).toBe(
      medicion.cabeceraAntes.generado_at.getTime(),
    );
    // El umbral de la segunda corrida era 99: si hubiera un upsert escondido, se veria aqui.
    expect(medicion.cabeceraDespues.min_asignadas_podio).toBe(5);
    expect(medicion.cabeceraDespues.filas).toBe(2);
  });

  it("R12: la reejecucion no altera NI UNA fila congelada", () => {
    expect(medicion.filasDespues.map((f) => f.puesto)).toEqual([1, 2]);
    expect(medicion.filasDespues.map((f) => f.mensajero_nombre)).toEqual([
      "Nombre Congelado A",
      "Nombre Congelado B",
    ]);
    expect(medicion.filasDespues[0].posicion).toBe(1);
    expect(medicion.filasDespues[1].posicion).toBeNull();
    expect(medicion.filasDespues.map((f) => f.entregadas)).toEqual([9, 1]);
  });

  it("R12/R14: un P2002 de OTRA constraint SI se propaga, y no deja cabecera", () => {
    expect(medicion.colisionDePuesto.esP2002).toBe(true);
    expect(medicion.colisionDePuesto.texto).toContain(
      "ranking_snapshot_fila_snapshot_id_puesto_key",
    );
    expect(medicion.colisionDePuesto.texto).not.toContain("fecha");
    // R14 contra Postgres real: el fallo del `createMany` se llevo por delante la cabecera
    // que se acababa de insertar en la misma transaccion. No existe el snapshot parcial.
    expect(medicion.cabecerasDeLaFechaQueFallo).toBe(0);
  });
});
