import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import type { PrismaClient } from "@prisma/client";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

// Feature 238 (T3.1, R20/R21/R43) — la migracion `*_gestion_orden_confirmacion_fisica`.
//
// DOS mitades, y las dos hacen falta:
//
//  1. COBERTURA ESTATICA por regex sobre `migration.sql` / `down.sql` (patron
//     `gestion-orden-causa-devolucion-migration.test.ts`, la hermana literal sobre la MISMA
//     tabla): protege la FORMA de los dos .sql para que un cambio posterior no los desalinee en
//     silencio.
//  2. LA FORMA REAL EN LA BASE, cuando hay una alcanzable: que la columna EXISTA, sea NULLABLE y
//     no tenga DEFAULT no es algo que una regex demuestre — lo demuestra `information_schema`.
//
// El round-trip up -> down -> pendiente -> up lo corrio la fase backend contra el Postgres local
// y esta registrado en `progress/impl_238.md` (con la salida real de `pnpm run db:rollback`).

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");
const SUFIJO = "_gestion_orden_confirmacion_fisica";

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

/**
 * Quita los comentarios `--` para que las aserciones NEGATIVAS («no hay CHECK», «no toca RLS»)
 * miren SENTENCIAS y no prosa: los comentarios de esta migracion citan justamente las palabras
 * prohibidas al explicar por que NO se usan, y sin esto un `not.toMatch` daria falso positivo.
 */
function soloSentencias(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}

const migrationDir = migrationDirFor(SUFIJO);
const upSql = soloSentencias(fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8"));
const downSql = soloSentencias(fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8"));
const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

describe("Feature 238 · UP — una columna nullable y nada mas (R17/R20/R21)", () => {
  it("R17: anade `confirmada_fisica_at` a gestion_orden como TIMESTAMP(3)", () => {
    expect(upSql).toMatch(
      /ALTER TABLE "gestion_orden" ADD COLUMN "confirmada_fisica_at" TIMESTAMP\(3\);/,
    );
  });

  it("R20: es NULLABLE y SIN default -> el historico queda en NULL y no se backfillea", () => {
    expect(upSql).not.toMatch(/"confirmada_fisica_at"[^;]*NOT NULL/);
    expect(upSql).not.toMatch(/"confirmada_fisica_at"[^;]*DEFAULT/);
    // No se inventa una confirmacion para las gestiones ya aprobadas: no hay ninguna cierta que
    // inventar, y poder distinguirlas del confirmado es justo lo que R20 pide.
    expect(upSql).not.toMatch(/UPDATE "gestion_orden"/i);
    expect(upSql).not.toMatch(/INSERT INTO/i);
  });

  it("SIN CHECK: la obligatoriedad vive en el servicio (cobertura exacta), no en la base", () => {
    expect(upSql).not.toMatch(/CHECK/i);
    expect(upSql).not.toMatch(/ADD CONSTRAINT/i);
  });

  it("SIN indice: no hay ninguna consulta declarada que filtre por esta columna", () => {
    expect(upSql).not.toMatch(/CREATE INDEX/i);
    expect(upSql).not.toMatch(/CREATE UNIQUE INDEX/i);
  });

  it("es ADITIVA — no altera ni borra columnas, datos ni indices preexistentes", () => {
    expect(upSql).not.toMatch(/DROP COLUMN/i);
    expect(upSql).not.toMatch(/ALTER COLUMN/i);
    expect(upSql).not.toMatch(/DROP TABLE/i);
    expect(upSql).not.toMatch(/DELETE FROM/i);
    expect(upSql).not.toMatch(/DROP INDEX/i);
  });

  it("NO toca RLS — `gestion_orden` conserva la suya (habilitada, sin policies)", () => {
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/DROP POLICY/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("no crea enums, ni estados, ni valores de origen del historial", () => {
    // El estado es binario (NULL / NOT NULL) porque D2 se firmo SIN faltantes declarados. Si esa
    // decision se invirtiera, esto pasaria a ser un enum y su down tendria que recrear el tipo.
    expect(upSql).not.toMatch(/CREATE TYPE/i);
    expect(upSql).not.toMatch(/ALTER TYPE/i);
    expect(upSql).not.toMatch(/order_status/i);
    expect(upSql).not.toMatch(/orden_historial_origen_tipo/i);
  });

  it("R41: no toca ninguna tabla de dinero", () => {
    for (const tabla of ["wallet_movimiento", "wallet_tienda_movimiento", "pago_mensajero_movimiento", "cierre_dia", "cierre_detail"]) {
      expect(upSql).not.toContain(tabla);
    }
  });
});

describe("Feature 238 · DOWN — reversible (R43, OBLIGATORIO)", () => {
  it("suelta la columna, con `IF EXISTS` (rollback idempotente)", () => {
    expect(downSql).toMatch(
      /ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "confirmada_fisica_at";/,
    );
  });

  it("revierte EXACTAMENTE la sentencia del UP, ni una mas", () => {
    const sentencias = downSql.split("\n").filter((l) => l.trim() !== "");
    expect(sentencias).toHaveLength(1);
  });

  it("R43: el down NO toca ninguna otra columna, ni RLS, ni datos de otras tablas", () => {
    expect(downSql).not.toMatch(/CREATE POLICY/i);
    expect(downSql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(downSql).not.toMatch(/UPDATE "orden"/i);
    expect(downSql).not.toMatch(/DELETE FROM/i);
    // R43 se cumple porque el codigo anterior NUNCA leyo esta columna: la base revertida es
    // exactamente la que ese codigo espera. La perdida de las marcas esta declarada en el propio
    // down y es el mismo trato que la 158 da a los montos.
    expect(downSql).not.toMatch(/DROP COLUMN IF EXISTS "indemnizacion"/i);
  });
});

describe("Feature 238 · schema.prisma refleja la migracion (sin drift)", () => {
  it("GestionOrden declara `confirmadaFisicaAt` OPCIONAL y mapeada a la columna", () => {
    expect(schemaPrisma).toMatch(/confirmadaFisicaAt\s+DateTime\?\s+@map\("confirmada_fisica_at"\)/);
  });

  it("NO declara `confirmadaFisicaPor` (quien confirmo es `cierre_dia.resuelto_por`)", () => {
    // D1, firmada: una segunda copia de «quien» es una segunda verdad que puede divergir.
    expect(schemaPrisma).not.toMatch(/confirmadaFisicaPor/);
    expect(schemaPrisma).not.toMatch(/confirmada_fisica_por/);
  });

  it("la columna no tiene `@default` ni `@@index` propios", () => {
    const modelo = schemaPrisma.match(/model GestionOrden \{([\s\S]*?)\n\}/);
    expect(modelo).not.toBeNull();
    const cuerpo = (modelo as RegExpMatchArray)[1];
    expect(cuerpo).not.toMatch(/confirmadaFisicaAt[^\n]*@default/);
    expect(cuerpo).not.toMatch(/@@index\(\[confirmadaFisicaAt\]\)/);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a la ultima previa", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    // Posterior a `20260819160000_orden_retiro_ayuda`, la ultima aplicada en `dev` cuando esta
    // feature empezo. Un timestamp anterior se aplicaria fuera de orden en una base que ya tenga
    // aquella, o no se aplicaria nunca.
    expect(path.basename(migrationDir) > "20260819160000_orden_retiro_ayuda").toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// La forma REAL en la base. Sin base alcanzable se SALTA (se ve en la salida); no se disfraza de
// verde con un `return` dentro del caso.
// ---------------------------------------------------------------------------------------------

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** El nombre de la migracion en `_prisma_migrations`: el instante de referencia sale de aqui. */
const MIGRACION = "20260819170000_gestion_orden_confirmacion_fisica";

/** Cliente minimo que las dos auditorias necesitan (sirve `PrismaClient` y una `tx`). */
type ClienteSql = { $queryRawUnsafe: (sql: string, ...args: unknown[]) => Promise<unknown> };

async function contarGestiones(cliente: ClienteSql): Promise<{ total: number; marcadas: number }> {
  const filas = (await cliente.$queryRawUnsafe(
    `SELECT count(*) AS total, count("confirmada_fisica_at") AS marcadas FROM "gestion_orden"`,
  )) as Array<{ total: bigint; marcadas: bigint }>;
  return { total: Number(filas[0].total), marcadas: Number(filas[0].marcadas) };
}

/**
 * LAS DOS INVARIANTES DE R20/R17, en una sola funcion para que el caso real y la
 * autocomprobacion midan EXACTAMENTE lo mismo. Si cada uno escribiera su SQL, podrian dejar de
 * medir lo mismo sin que nada lo delate.
 *
 * OJO CON LOS TIPOS DE FECHA, que aqui no es un detalle: `confirmada_fisica_at` es
 * `timestamp without time zone` (lo que Prisma escribe en UTC) y `_prisma_migrations.finished_at`
 * es `timestamptz`. Compararlos a pelo los convierte usando el TimeZone DE LA SESION —medido:
 * `America/Bogota` en esta base—, y la comparacion se desviaria cinco horas. El
 * `AT TIME ZONE 'UTC'` los pone en el mismo marco.
 */
async function auditarMarcas(
  cliente: ClienteSql,
): Promise<{ anterioresALaMigracion: number; fueraDeUnCierreAprobado: number }> {
  const anteriores = (await cliente.$queryRawUnsafe(
    `SELECT count(*) AS n
       FROM "gestion_orden" g
       JOIN "_prisma_migrations" m ON m."migration_name" = $1
      WHERE g."confirmada_fisica_at" IS NOT NULL
        AND g."confirmada_fisica_at" < (m."finished_at" AT TIME ZONE 'UTC')`,
    MIGRACION,
  )) as Array<{ n: bigint }>;

  const fuera = (await cliente.$queryRawUnsafe(
    `SELECT count(*) AS n
       FROM "gestion_orden" g
       LEFT JOIN "cierre_dia" c ON c."id" = g."cierre_id"
      WHERE g."confirmada_fisica_at" IS NOT NULL
        AND (c."id" IS NULL OR c."estado" <> 'aprobado')`,
  )) as Array<{ n: bigint }>;

  return {
    anterioresALaMigracion: Number(anteriores[0].n),
    fueraDeUnCierreAprobado: Number(fuera[0].n),
  };
}

describeSiHayBase("Feature 238 · la columna, tal como quedo en Postgres (R20)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("R17/R20: existe, es NULLABLE y no tiene DEFAULT", async () => {
    const filas = (await prisma.$queryRawUnsafe(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'gestion_orden' AND column_name = 'confirmada_fisica_at'`,
    )) as Array<{ data_type: string; is_nullable: string; column_default: string | null }>;

    expect(filas, "la migracion no esta aplicada en esta base").toHaveLength(1);
    expect(filas[0].is_nullable).toBe("YES");
    expect(filas[0].column_default).toBeNull();
    expect(filas[0].data_type).toMatch(/timestamp/);
  });

  // -------------------------------------------------------------------------------------------
  // R20 — «no hay backfill», REESCRITO el 2026-08-19 tras un rojo del gate.
  //
  // QUE DECIA ANTES, Y POR QUE ESTABA MAL. El caso afirmaba que ninguna gestion CREADA antes del
  // dia de la feature podia tener marca. Eso codifica «gestion vieja => nunca marcada», y es
  // FALSO POR DISENO: un cierre solicitado la semana pasada se aprueba hoy y sus gestiones —
  // creadas antes— se marcan hoy. Es el CAMINO FELIZ de la feature. El caso pasaba solo porque
  // nadie la habia ejercido todavia; en cuanto el leader aprobo un cierre real en la base local
  // se puso rojo, y en produccion se habria puesto rojo con la primera aprobacion de bodega.
  //
  // Era la cara opuesta del test que pasa sin datos: un test **verde por el estado ambiental**.
  //
  // QUE DICE R20 DE VERDAD: es una propiedad de LA MIGRACION —no inventa confirmaciones, no hay
  // backfill—, no una propiedad de todo lo que pase despues. Se traduce en DOS invariantes que
  // siguen siendo ciertas CON la feature en uso, y que son complementarias a proposito:
  //
  //   (1) NINGUNA MARCA ES ANTERIOR A LA MIGRACION. Distingue «lo escribio la app» de «lo invento
  //       un backfill»: un `UPDATE` masivo que copiara, por ejemplo, `cierre_dia.resuelto_at` de
  //       los cierres ya aprobados dejaria marcas con fecha anterior a que la columna existiera.
  //   (2) NINGUNA MARCA VIVE FUERA DE UN CIERRE APROBADO. Es la invariante de la ESCRITURA (R17):
  //       la marca solo nace dentro de la transaccion de aprobacion, que exige `estado =
  //       'solicitado'` y lo deja en `aprobado`.
  //
  // NINGUNA DE LAS DOS BASTA SOLA, y no es simetria:
  //   - (1) sola no ve un backfill ejecutado DESPUES de la migracion: sus marcas llevarian `now()`.
  //   - (2) sola no ve un backfill sobre cierres ya aprobados — y eso NO es hipotetico: la
  //     medicion de T0.1 encontro en produccion **12 cierres, los 12 `aprobado`, y 0
  //     `solicitado`**. Un `UPDATE` a ciegas sobre esa base seria invisible para (2).
  //
  // La ANTI-VACUIDAD se conserva y se refuerza: se exige que haya gestiones que mirar, que la
  // fila de la migracion exista con su `finished_at` (sin ella el `JOIN` de (1) daria cero sin
  // comparar nada), y ademas el caso siguiente PLANTA un backfill de mentira y comprueba que los
  // dos contadores lo cazan.
  it("R20/R17: ninguna marca es anterior a la migracion ni vive fuera de un cierre aprobado", async () => {
    const universo = await contarGestiones(prisma);
    // Anti-vacuidad 1: hay filas que mirar.
    expect(Number(universo.total), "esta base no tiene gestiones que comprobar").toBeGreaterThan(0);

    // Anti-vacuidad 2: la migracion figura como aplicada y con instante. Es el punto de
    // referencia de (1); sin el, el `JOIN` no casaria y el contador daria cero sin comparar nada.
    const migracion = (await prisma.$queryRawUnsafe(
      `SELECT "finished_at" FROM "_prisma_migrations" WHERE "migration_name" = $1`,
      MIGRACION,
    )) as Array<{ finished_at: Date | null }>;
    expect(migracion, `la migracion ${MIGRACION} no figura aplicada en esta base`).toHaveLength(1);
    expect(migracion[0].finished_at).not.toBeNull();

    const auditoria = await auditarMarcas(prisma);
    expect(
      auditoria.anterioresALaMigracion,
      "hay marcas con fecha ANTERIOR a que la columna existiera: eso solo lo produce un backfill",
    ).toBe(0);
    expect(
      auditoria.fueraDeUnCierreAprobado,
      "hay marcas en gestiones sin cierre o de un cierre no aprobado: la marca solo nace dentro " +
        "de la transaccion de aprobacion (R17)",
    ).toBe(0);
  });

  // AUTOCOMPROBACION (obligatoria, `docs/verification.md`) — la auditoria de arriba se sabe
  // romper. Se plantan los DOS backfills de mentira DENTRO de una transaccion que SIEMPRE se
  // revierte: si el test pasa, si falla o si el proceso muere, no queda ni una fila tocada.
  //
  // Sin esto, el caso anterior seria verde en una base donde la feature nunca se ha usado y
  // tambien en una donde la auditoria estuviera mal escrita. Aqui se demuestra que los dos
  // contadores CUENTAN.
  it("AUTOCOMPROBACION: la auditoria caza un backfill plantado (y se revierte)", async () => {
    const { antes, conBackfill } = await enTransaccionRevertida(prisma, async (tx) => {
      // PRIMERA sentencia: serializa contra los otros archivos que escriben en las tablas reales
      // de `public` (ver `_postgres-real.ts`).
      await serializarEscriturasReales(tx);
      const antes = await auditarMarcas(tx);

      // (1) Backfill historico: una marca con fecha ANTERIOR a la migracion. Es exactamente la
      // forma que tendria «copiar `resuelto_at` de los cierres ya aprobados».
      await tx.$executeRawUnsafe(
        `UPDATE "gestion_orden" SET "confirmada_fisica_at" = TIMESTAMP '2026-01-01 00:00:00'
          WHERE "id" = (SELECT "id" FROM "gestion_orden" ORDER BY "created_at" LIMIT 1)`,
      );
      // (2) Marca fuera de la transaccion de aprobacion: una gestion sin cierre, marcada.
      await tx.$executeRawUnsafe(
        `UPDATE "gestion_orden" SET "confirmada_fisica_at" = now(), "cierre_id" = NULL
          WHERE "id" = (SELECT "id" FROM "gestion_orden" ORDER BY "created_at" DESC LIMIT 1)`,
      );

      return { antes, conBackfill: await auditarMarcas(tx) };
    });

    // La base REAL cumple las dos invariantes...
    expect(antes.anterioresALaMigracion).toBe(0);
    expect(antes.fueraDeUnCierreAprobado).toBe(0);
    // ...y la auditoria caza las dos violaciones en cuanto existen.
    expect(conBackfill.anterioresALaMigracion).toBeGreaterThan(0);
    expect(conBackfill.fueraDeUnCierreAprobado).toBeGreaterThan(0);

    // Y la transaccion revirtio: la base sigue limpia.
    const despues = await auditarMarcas(prisma);
    expect(despues.anterioresALaMigracion).toBe(0);
    expect(despues.fueraDeUnCierreAprobado).toBe(0);
  });

  it("no se creo ningun indice sobre la columna", async () => {
    const filas = (await prisma.$queryRawUnsafe(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'gestion_orden' AND indexdef LIKE '%confirmada_fisica_at%'`,
    )) as unknown[];
    expect(filas).toEqual([]);
  });
});
