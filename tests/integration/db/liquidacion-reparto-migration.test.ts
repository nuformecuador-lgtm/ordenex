import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";
import { quitarComentarios } from "../../fixtures/sin-comentarios";

// Feature 205 (T1.4) — cobertura de la migracion `*_liquidacion_reparto`. Cubre R29 (la barrera
// de la idempotencia es DE DATOS) y R49 (aditiva, reversible, con RLS).
//
// DOS BLOQUES, y la diferencia importa:
//
//  A. ESTATICO (molde `ranking-snapshot-migration` / `liquidacion-migration`): lee
//     `migration.sql`, `down.sql` y `db/schema.prisma` y los contrasta por regex. No necesita
//     Postgres, corre siempre, y verifica la FORMA del DDL: que la migracion sea ADITIVA, que
//     el DOWN suelte la columna ANTES que la tabla, y —lo mas importante de esta feature— que
//     `liquidacion_pago` no gane ninguna RESTRICCION UNICA.
//
//  B. COMPORTAMIENTO CONTRA POSTGRES DE VERDAD. Una regex no puede demostrar que el `UNIQUE`
//     RECHACE el duplicado, que el CHECK rechace `monto_total = 0`, que el RESTRICT haga FALLAR
//     el borrado del usuario, ni que `liquidacion_pago` tenga DESPUES exactamente los mismos
//     indices unicos que tenia ANTES. Eso son hechos del motor. El bloque B los mide, y lo hace
//     SIN APLICAR LA MIGRACION A NINGUNA BASE: dentro de una transaccion que SIEMPRE se
//     revierte, crea un ESQUEMA temporal, CLONA ahi `liquidacion_pago` y ejecuta el
//     `migration.sql` REAL (no una parafrasis). `_prisma_migrations` no se toca y en `public`
//     no queda absolutamente nada.
//
// POR QUE SE CLONA `liquidacion_pago` EN EL ESQUEMA TEMPORAL: el UP hace `ALTER TABLE
// "liquidacion_pago" ADD COLUMN`. Con el `search_path` apuntando primero al esquema temporal, esa
// sentencia resuelve contra el CLON y no contra la tabla real, asi que el test no toma un
// `ACCESS EXCLUSIVE` sobre una tabla de produccion-de-desarrollo ni depende de que la
// transaccion se revierta para no dejar rastro. El clon se hace con `INCLUDING ALL`, asi que
// trae los MISMOS indices y las MISMAS restricciones CHECK/UNIQUE que la tabla real — que es
// precisamente lo que se va a medir antes y despues.
//
// Y POR QUE EL CLON SE NORMALIZA ANTES DE MEDIR NADA: el clon es una FOTO de `public`, y `public`
// puede estar CON esta migracion ya aplicada — lo estara en cuanto se despliegue, y lo esta hoy
// en cualquier maquina con la base al dia. Una foto tomada en ese estado ya trae `reparto_id`, y
// el `ADD COLUMN` del UP moria con «ya existe la columna en la relacion liquidacion_pago»: un
// rojo que no habla de la migracion, que aparece SOLO despues del despliegue —justo cuando este
// bloque mas falta hace— y cuyo sintoma no apunta a su causa. Por eso, antes de medir, al clon se
// le aplica el `down.sql` REAL: lleve la foto la columna o no, la LINEA BASE es siempre el estado
// ANTERIOR a la migracion, y el UP se ejerce ENTERO en los dos casos.
//
// NO SE DETECTA NADA NI SE SALTA NADA. La normalizacion es incondicional (el `down.sql` es
// `IF EXISTS` por contrato, y el bloque A fija su contenido exacto por igualdad de lista), y que
// haya funcionado esta MEDIDO por una igualdad con contenido en los DOS estados de la base:
// «linea base == columnas de `public` menos `reparto_id`» (test «la LINEA BASE es el estado
// ANTERIOR…»). Un `if (yaTieneLaColumna) return;` habria dejado de proteger exactamente el dia
// del despliegue; esto no deja de protegerlo ningun dia.
//
// EL `search_path` NO ES DECORACION. El `down.sql` corre SIEMPRE con el search_path reducido al
// esquema temporal, SIN `public`: en la normalizacion previa el esquema temporal todavia no tiene
// `liquidacion_reparto`, asi que con `public` a la vista el `DROP TABLE IF EXISTS
// "liquidacion_reparto"` del down resolveria contra la tabla REAL. El UP, en cambio, SI necesita
// `public`: sus dos FK apuntan a la tabla `usuario` de verdad.
//
// POR QUE ESTE ARCHIVO NO PUEDE QUEDAR VERDE POR VACIO: no consulta datos preexistentes ni tiene
// un solo `if (...) return;`. Crea su propio usuario, su propio reparto y sus propias filas, y
// cada asercion es sobre el MENSAJE de error de una sentencia que debia fallar, o sobre un
// conjunto medido. Si la tabla no se creara, o si faltara una restriccion, la sentencia pasaria y
// el test se pondria rojo por «no fallo lo que tenia que fallar». Lo unico que lo salta es la
// ausencia de `DATABASE_URL`, y entonces vitest lo marca SKIPPED (nunca passed).
//
// AL LEER UNA CORRIDA EN ROJO: si el `beforeAll` del bloque B revienta, vitest lista sus 8 tests
// como SKIPPED y el fichero como FAILED. Ese «8 skipped» es el SINTOMA del fallo del hook, no una
// guarda de entorno: con la base alcanzable y el hook sano, este fichero corre sus 24 tests y
// salta CERO.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const SUFIJO = "_liquidacion_reparto";

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
 * El SQL EJECUTABLE, sin lineas de comentario. La prosa de estos dos archivos nombra a proposito
 * lo que las aserciones NEGATIVAS buscan (`UNIQUE`, `DROP`, `UPDATE`, `NOT VALID`): sin limpiar
 * primero, el test se leeria a si mismo y fallaria por su propia documentacion.
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

/**
 * Un modelo de `schema.prisma` SIN sus comentarios `//`. Es obligatorio y esta medido: los
 * docstrings de estos dos modelos CITAN a proposito lo que las aserciones negativas buscan
 * («SIN updatedAt / deletedAt», «jamas UNIQUE»), asi que un barrido literal fallaria por la
 * documentacion en vez de por el codigo. Es la misma cicatriz que documenta
 * `tests/fixtures/sin-comentarios.ts`, que es de donde sale el quitador (feature 209).
 */
function modeloSinComentarios(nombre: string): string {
  const bloque = new RegExp(`model ${nombre} \\{[\\s\\S]*?\\n\\}`).exec(schemaPrisma);
  if (!bloque) throw new Error(`No se encontro el modelo ${nombre} en db/schema.prisma`);
  return quitarComentarios(bloque[0]);
}

const CUERPO_REPARTO = /CREATE TABLE "liquidacion_reparto" \(([\s\S]*?)\n\);/.exec(upSql)![1];
const MODELO_REPARTO = modeloSinComentarios("LiquidacionReparto");
const MODELO_PAGO = modeloSinComentarios("LiquidacionPago");

// ===========================================================================================
// BLOQUE A — ESTATICO
// ===========================================================================================

describe("205 / R29 — el acto de repartir es una fila propia, con su barrera de datos", () => {
  it("la carpeta de la migracion trae los DOS archivos", () => {
    expect(path.basename(migrationDir)).toBe("20260811140000_liquidacion_reparto");
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });

  it("la tabla lleva las SEIS columnas del design y ni una mas", () => {
    const columnas = [...CUERPO_REPARTO.matchAll(/^\s{4}"([a-z_0-9]+)"/gm)].map((m) => m[1]);
    expect(columnas.sort()).toEqual([
      "clave_idempotencia",
      "created_at",
      "id",
      "mensajero_id",
      "monto_total",
      "registrado_por",
    ]);
    expect(CUERPO_REPARTO).toMatch(/"monto_total" DECIMAL\(12,2\) NOT NULL/);
    expect(CUERPO_REPARTO).toMatch(/"mensajero_id" TEXT NOT NULL/);
    expect(CUERPO_REPARTO).toMatch(/"registrado_por" TEXT NOT NULL/);
    expect(CUERPO_REPARTO).toMatch(/"created_at" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  });

  it("R52: fila INMUTABLE — ni `updated_at` ni `deleted_at`, ni en el SQL ni en el modelo", () => {
    expect(upDdl).not.toMatch(/"updated_at"/);
    expect(upDdl).not.toMatch(/"deleted_at"/);
    expect(MODELO_REPARTO).not.toMatch(/@updatedAt/);
    expect(MODELO_REPARTO).not.toMatch(/deletedAt/);
  });

  it("R29: la clave de idempotencia es UNICA — la barrera es de DATOS, no un SELECT previo", () => {
    expect(upDdl).toMatch(
      /CREATE UNIQUE INDEX "liquidacion_reparto_clave_idempotencia_key" ON "liquidacion_reparto"\("clave_idempotencia"\);/,
    );
    expect(MODELO_REPARTO).toMatch(/claveIdempotencia\s+String\s+@unique @map\("clave_idempotencia"\)/);
  });

  it("el CHECK exige un importe positivo, y se anade VALIDANDO (sin NOT VALID)", () => {
    expect(upDdl).toMatch(
      /ADD CONSTRAINT "liquidacion_reparto_monto_total_check"\s*\n?\s*CHECK \("monto_total" > 0\);/,
    );
    // `NOT VALID` dejaria el NOMBRE de la restriccion y perderia la PROPIEDAD. Se mira sobre el
    // SQL sin comentarios porque la cabecera explica en prosa por que no esta.
    expect(upDdl).not.toMatch(/\bNOT\s+VALID\b/i);
  });

  it("las dos FK a `usuario` son RESTRICT: el rastro no se pierde borrando a nadie", () => {
    expect(upDdl).toMatch(
      /"liquidacion_reparto_mensajero_id_fkey" FOREIGN KEY \("mensajero_id"\) REFERENCES "usuario"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/,
    );
    expect(upDdl).toMatch(
      /"liquidacion_reparto_registrado_por_fkey" FOREIGN KEY \("registrado_por"\) REFERENCES "usuario"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/,
    );
    // Ninguna FK de esta migracion borra en cascada ni pone a NULL.
    expect(upDdl).not.toMatch(/ON DELETE (CASCADE|SET NULL)/);
    expect(upDdl.match(/FOREIGN KEY/g)).toHaveLength(3); // 2 del reparto + la del pago
  });

  it("el indice de auditoria es (mensajero_id, created_at DESC)", () => {
    expect(upDdl).toMatch(
      /CREATE INDEX "liquidacion_reparto_mensajero_id_created_at_idx" ON "liquidacion_reparto"\("mensajero_id", "created_at" DESC\);/,
    );
    expect(MODELO_REPARTO).toMatch(/@@index\(\[mensajeroId, createdAt\(sort: Desc\)\]\)/);
  });

  it("RLS habilitada y CERO policies (solo service role)", () => {
    expect(upDdl).toMatch(/ALTER TABLE "liquidacion_reparto" ENABLE ROW LEVEL SECURITY;/);
    expect(upDdl).not.toMatch(/CREATE POLICY/i);
    expect(upDdl).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    expect(upDdl).not.toMatch(/\bGRANT\b/i);
    expect(upDdl).not.toMatch(/\banon\b/i);
    expect(upDdl).not.toMatch(/\bauthenticated\b/i);
  });
});

describe("205 / R28 — `liquidacion_pago` gana la columna que agrupa, y NADA MAS", () => {
  it("`reparto_id` es NULLABLE, con FK RESTRICT e INDICE (no unico)", () => {
    expect(upDdl).toMatch(/ALTER TABLE "liquidacion_pago" ADD COLUMN\s+"reparto_id" TEXT;/);
    // NULLABLE de verdad: ni `NOT NULL`, ni `DEFAULT`, ni backfill.
    expect(upDdl).not.toMatch(/"reparto_id" TEXT NOT NULL/);
    expect(upDdl).toMatch(
      /CREATE INDEX "liquidacion_pago_reparto_id_idx" ON "liquidacion_pago"\("reparto_id"\);/,
    );
    expect(upDdl).toMatch(
      /"liquidacion_pago_reparto_id_fkey" FOREIGN KEY \("reparto_id"\) REFERENCES "liquidacion_reparto"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/,
    );
    expect(MODELO_PAGO).toMatch(/repartoId\s+String\?\s+@map\("reparto_id"\)/);
    expect(MODELO_PAGO).toMatch(/@@index\(\[repartoId\]\)/);
  });

  it("EL CRITERIO DURO: la migracion NO le anade ninguna restriccion UNICA a `liquidacion_pago`", () => {
    // Es la trampa medida de esta feature. `LiquidacionPagoRepository.esChoqueDeClave` lee un
    // P2002 SIN pista como choque de `clave_idempotencia` —y bajo el driver adapter de Prisma 7
    // el `meta.target` llega VACIO—, asi que el choque de un unico NUEVO en esta tabla se
    // interpretaria como clave repetida y el servicio responderia `no_encontrado` para un pago
    // legitimo. El unico UNIQUE de esta migracion vive en la tabla NUEVA.
    const unicos = [...upDdl.matchAll(/CREATE UNIQUE INDEX "([a-z_0-9]+)" ON "([a-z_0-9]+)"/g)];
    expect(unicos.map((m) => `${m[2]}.${m[1]}`)).toEqual([
      "liquidacion_reparto.liquidacion_reparto_clave_idempotencia_key",
    ]);
    // Ni por la otra via de escribir un unico: `ADD CONSTRAINT ... UNIQUE (...)`.
    expect(upDdl).not.toMatch(/ADD CONSTRAINT\s+"[a-z_0-9]+"\s+UNIQUE/i);
    // Y el datamodel tampoco: en `LiquidacionPago` el unico `@unique` sigue siendo el de la
    // clave de idempotencia del pago, y no hay ningun `@@unique` compuesto.
    expect([...MODELO_PAGO.matchAll(/^\s*(\w+)\s+\S+\s+@unique/gm)].map((m) => m[1])).toEqual([
      "claveIdempotencia",
    ]);
    expect(MODELO_PAGO).not.toMatch(/@@unique/);
  });

  it("R49: la migracion es ADITIVA — no destruye, no renombra, no reescribe, no crea enums", () => {
    expect(upDdl).not.toMatch(/DROP TABLE/i);
    expect(upDdl).not.toMatch(/DROP COLUMN/i);
    expect(upDdl).not.toMatch(/DROP INDEX/i);
    expect(upDdl).not.toMatch(/DROP CONSTRAINT/i);
    expect(upDdl).not.toMatch(/ALTER COLUMN/i);
    expect(upDdl).not.toMatch(/RENAME/i);
    expect(upDdl).not.toMatch(/CREATE TYPE/i);
    expect(upDdl).not.toMatch(/ALTER TYPE/i);
    expect(upDdl).not.toMatch(/DROP TYPE/i);
    // Ni una sentencia de DML: ni backfill, ni semilla, ni borrado. Se mira por SENTENCIA y no
    // por palabra suelta, porque `ON UPDATE CASCADE` es una clausula legitima de las tres FK.
    for (const sentencia of sentenciasDe(upDdl)) {
      expect(sentencia, sentencia).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|SELECT)\b/i);
    }
  });

  it("solo crea UNA tabla y solo altera las DOS que le tocan", () => {
    expect([...upDdl.matchAll(/CREATE TABLE "([a-z_0-9]+)"/g)].map((m) => m[1])).toEqual([
      "liquidacion_reparto",
    ]);
    const alteradas = new Set(
      [...upDdl.matchAll(/ALTER TABLE "([a-z_0-9]+)"/g)].map((m) => m[1]),
    );
    expect([...alteradas].sort()).toEqual(["liquidacion_pago", "liquidacion_reparto"]);
  });

  it("ninguna cadena del SQL contiene `;` — lo que hace valido partir el DDL por `;`", () => {
    // El bloque B ejecuta el `migration.sql` REAL partiendolo por `;`. Si algun dia un literal
    // llevara un `;` dentro, ese split partiria una sentencia por la mitad y el bloque B
    // fallaria por un motivo que no es el suyo. La invariante se fija aqui, donde el mensaje de
    // error dice exactamente que pasa.
    for (const literal of upSql.match(/'[^']*'/g) ?? []) {
      expect(literal, `este literal del .sql contiene un ';': ${literal}`).not.toContain(";");
    }
  });
});

describe("205 / R49 — el DOWN revierte en orden inverso", () => {
  it("suelta la COLUMNA antes que la TABLA, y nada mas", () => {
    expect(sentenciasDe(downDdl)).toEqual([
      'ALTER TABLE "liquidacion_pago" DROP COLUMN IF EXISTS "reparto_id"',
      'DROP TABLE IF EXISTS "liquidacion_reparto"',
    ]);
    // El orden es lo que lo hace ejecutable: al reves, la FK viva desde `liquidacion_pago`
    // haria fallar el DROP TABLE. La asercion de arriba lo fija por igualdad de la lista, pero
    // se deja escrito el porque en indices, que es lo que un mensaje de fallo enseña.
    const iColumna = downDdl.indexOf('DROP COLUMN IF EXISTS "reparto_id"');
    const iTabla = downDdl.indexOf('DROP TABLE IF EXISTS "liquidacion_reparto"');
    expect(iColumna).toBeGreaterThanOrEqual(0);
    expect(iTabla).toBeGreaterThan(iColumna);
  });

  it("el DOWN no toca enums, no borra datos y no roza ninguna otra tabla", () => {
    expect(downDdl).not.toMatch(/DROP TYPE/i);
    expect(downDdl).not.toMatch(/CREATE TYPE/i);
    expect(downDdl).not.toMatch(/ALTER TYPE/i);
    expect(downDdl).not.toMatch(/\bUPDATE\b/i);
    expect(downDdl).not.toMatch(/\bDELETE\b/i);
    expect(downDdl).not.toMatch(/CASCADE/i);
    const tocadas = new Set(
      [...downDdl.matchAll(/(?:ALTER|DROP) TABLE(?: IF EXISTS)? "([a-z_0-9]+)"/g)].map((m) => m[1]),
    );
    expect([...tocadas].sort()).toEqual(["liquidacion_pago", "liquidacion_reparto"]);
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

/** Un indice UNICO tal como vive en `pg_index`, con las columnas que cubre. */
interface UnicoReal {
  indice: string;
  columnas: string;
}

/** Una FK tal como vive en `pg_constraint`: a donde apunta y con que regla de borrado. */
interface FkReal {
  constraint: string;
  columna: string;
  tabla_destino: string;
  columna_destino: string;
  on_delete: string;
}

interface Medicion {
  columnasReparto: ColumnaReal[];
  rls: { relname: string; relrowsecurity: boolean }[];
  unicosDelPagoAntes: UnicoReal[];
  unicosDelPagoDespues: UnicoReal[];
  fkDelRepartoId: FkReal[];
  errores: Record<string, string>;
  repartoIdDelPagoSuelto: string | null;
  /** Las columnas de la tabla REAL de `public`, tal como esta la base HOY (con o sin migracion). */
  columnasDelPagoEnPublic: string[];
  /** La LINEA BASE: el clon ya normalizado al estado ANTERIOR a la migracion. */
  columnasDelPagoAntes: string[];
  columnasDelPagoTrasElDown: string[];
  tablasTrasElDown: string[];
}

describeSiHayBase("205 / bloque B — las restricciones RECHAZAN de verdad (Postgres real)", () => {
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
   * Corre el `migration.sql` REAL en un esquema temporal y ejercita todo. Todo lo que pasa aqui
   * vive dentro de la transaccion que `enTransaccionRevertida` deshace: ni el esquema temporal,
   * ni el usuario, ni las filas sobreviven al test.
   */
  async function medir(tx: Tx): Promise<Medicion> {
    const esquema = `t205_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);

    // El CLON de `liquidacion_pago`, con sus mismos indices y restricciones (`INCLUDING ALL`).
    // Es lo que hace que el `ALTER TABLE "liquidacion_pago" ADD COLUMN` del UP caiga aqui y no
    // sobre la tabla real. `LIKE` no copia las FK, y da igual: lo que se mide en esta tabla es
    // la columna nueva, su FK NUEVA y —sobre todo— el conjunto de indices UNICOS antes/despues.
    await tx.$executeRawUnsafe(
      `CREATE TABLE "${esquema}"."liquidacion_pago" (LIKE public."liquidacion_pago" INCLUDING ALL)`,
    );
    const columnasDelPagoEnPublic = await nombresDeColumnas(tx, "public", "liquidacion_pago");

    // NORMALIZACION (ver cabecera). El clon acaba de copiar `public`, que puede estar CON la
    // migracion aplicada; el `down.sql` REAL lo lleva SIEMPRE al estado ANTERIOR. Se aplica sin
    // `public` en el search_path para que su `DROP TABLE IF EXISTS "liquidacion_reparto"` —que
    // aqui todavia no encuentra nada en el esquema temporal— no pueda alcanzar la tabla real.
    await aplicarDdl(tx, downDdl, [esquema]);

    const columnasDelPagoAntes = await nombresDeColumnas(tx, esquema, "liquidacion_pago");
    if (columnasDelPagoAntes.includes("reparto_id")) {
      // FALLA con el motivo escrito, no se salta: si la normalizacion dejara de funcionar, el
      // UP moriria dos lineas mas abajo con «ya existe la columna en la relacion
      // liquidacion_pago» —un sintoma que no apunta a su causa y que cuesta una tarde—. Es la
      // misma politica que `crearUsuario`: cuando el ENTORNO no permite medir, se falla
      // diciendo por que; nunca se reporta verde.
      throw new Error(
        "El clon de `liquidacion_pago` sigue teniendo `reparto_id` DESPUES de normalizarlo con " +
          "el `down.sql` REAL, asi que la linea base no es el estado anterior a la migracion y " +
          "el `ADD COLUMN` del UP va a chocar. Revisa que el down siga soltando esa columna " +
          "(bloque A lo fija por igualdad) y que se aplique al esquema temporal.",
      );
    }
    const unicosDelPagoAntes = await unicosDe(tx, esquema, "liquidacion_pago");

    // El UP REAL, sentencia a sentencia. Aqui `public` SI va en el search_path: las FK del
    // reparto apuntan a la tabla `usuario` REAL y sin ella este bloque probaria un RESTRICT de
    // mentira contra una tabla de juguete. Lo que crea o altera, en cambio, cae en el esquema
    // temporal, que va primero: la tabla nueva, y el `ADD COLUMN` sobre el CLON.
    await aplicarDdl(tx, upDdl, [esquema, "public"]);

    const columnasReparto = await columnasDe(tx, esquema, "liquidacion_reparto");
    const unicosDelPagoDespues = await unicosDe(tx, esquema, "liquidacion_pago");
    const fkDelRepartoId = await fksDe(tx, esquema, "liquidacion_pago", "reparto_id");
    const rls = await tx.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
      `SELECT c.relname, c.relrowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind = 'r' AND c.relname = 'liquidacion_reparto'`,
      esquema,
    );

    // --- datos PROPIOS del test (nada preexistente) --------------------------------------
    const mensajero = await crearUsuario(tx);
    const actor = await crearUsuario(tx);
    const repartoId = randomUUID();
    const CLAVE = randomUUID();
    await tx.$executeRawUnsafe(
      `INSERT INTO "liquidacion_reparto"
         ("id","clave_idempotencia","mensajero_id","monto_total","registrado_por")
       VALUES ($1, $2, $3, 45000.00, $4)`,
      repartoId,
      CLAVE,
      mensajero.id,
      actor.id,
    );
    // Un pago que SI cuelga del reparto y otro que NO (columna nullable, R49/R51).
    const pagoDelReparto = await insertarPago(tx, mensajero.id, actor.id, repartoId);
    const pagoSuelto = await insertarPago(tx, mensajero.id, actor.id, null);

    const errores: Record<string, string> = {
      // R29 — la MISMA clave dos veces: la rechaza la BASE, no un `if`.
      clave_repetida: await resultadoDe(
        tx,
        `INSERT INTO "liquidacion_reparto"
           ("id","clave_idempotencia","mensajero_id","monto_total","registrado_por")
         VALUES ('${randomUUID()}', '${CLAVE}', '${mensajero.id}', 1.00, '${actor.id}')`,
      ),
      // Y una clave DISTINTA para el MISMO mensajero SI entra: el unico es de la clave, no del
      // mensajero. Sin este control, el caso de arriba pasaria igual con un unico equivocado.
      segundo_reparto_del_mismo_mensajero: await resultadoDe(
        tx,
        `INSERT INTO "liquidacion_reparto"
           ("id","clave_idempotencia","mensajero_id","monto_total","registrado_por")
         VALUES ('${randomUUID()}', '${randomUUID()}', '${mensajero.id}', 1.00, '${actor.id}')`,
      ),
      monto_cero: await resultadoDe(
        tx,
        `INSERT INTO "liquidacion_reparto"
           ("id","clave_idempotencia","mensajero_id","monto_total","registrado_por")
         VALUES ('${randomUUID()}', '${randomUUID()}', '${mensajero.id}', 0, '${actor.id}')`,
      ),
      monto_negativo: await resultadoDe(
        tx,
        `INSERT INTO "liquidacion_reparto"
           ("id","clave_idempotencia","mensajero_id","monto_total","registrado_por")
         VALUES ('${randomUUID()}', '${randomUUID()}', '${mensajero.id}', -1.00, '${actor.id}')`,
      ),
      mensajero_inexistente: await resultadoDe(
        tx,
        `INSERT INTO "liquidacion_reparto"
           ("id","clave_idempotencia","mensajero_id","monto_total","registrado_por")
         VALUES ('${randomUUID()}', '${randomUUID()}', '${randomUUID()}', 1.00, '${actor.id}')`,
      ),
      borrar_mensajero_con_repartos: await resultadoDe(
        tx,
        `DELETE FROM public."usuario" WHERE "id" = '${mensajero.id}'`,
      ),
      borrar_actor_con_repartos: await resultadoDe(
        tx,
        `DELETE FROM public."usuario" WHERE "id" = '${actor.id}'`,
      ),
      // R28: el reparto que tiene pagos colgando no se puede borrar (RESTRICT del lado del pago).
      borrar_reparto_con_pagos: await resultadoDe(
        tx,
        `DELETE FROM "liquidacion_reparto" WHERE "id" = '${repartoId}'`,
      ),
      pago_con_reparto_inexistente: await resultadoDe(
        tx,
        `UPDATE "liquidacion_pago" SET "reparto_id" = '${randomUUID()}' WHERE "id" = '${pagoDelReparto}'`,
      ),
      // La contracara del CRITERIO DURO, medida por comportamiento: DOS pagos del MISMO reparto
      // conviven. Si `reparto_id` fuera unico, el segundo INSERT chocaria.
      dos_pagos_del_mismo_reparto: await resultadoDe(
        tx,
        sqlDeUnPago(randomUUID(), mensajero.id, actor.id, repartoId),
      ),
    };

    const [{ reparto_id }] = await tx.$queryRawUnsafe<{ reparto_id: string | null }[]>(
      `SELECT "reparto_id" FROM "liquidacion_pago" WHERE "id" = $1`,
      pagoSuelto,
    );

    // R49 — el DOWN real deja el esquema como estaba. Los pagos se borran primero porque su FK
    // apunta al reparto: lo que se mide del down es que la COLUMNA y la TABLA se van, no que el
    // down sepa borrar filas (no lo hace, y no debe). El DELETE va CUALIFICADO a proposito: es
    // la unica sentencia destructiva de datos de todo el bloque y no se deja al arbitrio del
    // search_path.
    await tx.$executeRawUnsafe(`DELETE FROM "${esquema}"."liquidacion_pago"`);
    await aplicarDdl(tx, downDdl, [esquema]);
    const columnasDelPagoTrasElDown = await nombresDeColumnas(tx, esquema, "liquidacion_pago");
    const tablasTrasElDown = (
      await tx.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
        esquema,
      )
    ).map((r) => r.table_name);

    return {
      columnasReparto,
      rls,
      unicosDelPagoAntes,
      unicosDelPagoDespues,
      fkDelRepartoId,
      errores,
      repartoIdDelPagoSuelto: reparto_id,
      columnasDelPagoEnPublic,
      columnasDelPagoAntes,
      columnasDelPagoTrasElDown,
      tablasTrasElDown,
    };
  }

  /**
   * Ejecuta un DDL REAL (el `migration.sql` o el `down.sql`) sentencia a sentencia, con el
   * `search_path` fijado a `esquemas` para todas ellas.
   *
   * QUE EL search_path SE FIJE AQUI, Y NO UNA VEZ AL PRINCIPIO, ES EL ARREGLO: el UP necesita
   * `public` a la vista (sus FK apuntan a `usuario`) y el DOWN necesita NO tenerla (sus dos
   * sentencias son `IF EXISTS`, y la normalizacion del clon corre cuando el esquema temporal
   * todavia no tiene `liquidacion_reparto`: con `public` en el search_path, ese `DROP TABLE`
   * caeria sobre la tabla real).
   *
   * `SET LOCAL` vale para la transaccion en curso, y una transaccion interactiva de Prisma fija
   * UNA conexion del pool, asi que las sentencias siguientes lo ven.
   */
  async function aplicarDdl(tx: Tx, ddl: string, esquemas: string[]): Promise<void> {
    await tx.$executeRawUnsafe(
      `SET LOCAL search_path TO ${esquemas.map((e) => `"${e}"`).join(", ")}`,
    );
    for (const sentencia of sentenciasDe(ddl)) await tx.$executeRawUnsafe(sentencia);
  }

  /** El INSERT de un pago valido (satisface los 3 CHECK de la 172: XOR, cierre-sii-mensajero, monto>0). */
  function sqlDeUnPago(
    id: string,
    mensajeroId: string,
    actorId: string,
    repartoId: string | null,
  ): string {
    // `cierre_id` va NULL y `mensajero_id` tambien: el CHECK de la 172 exige que vayan juntos, y
    // el clon no tiene FK, asi que la fila valida mas barata es la del beneficiario TIENDA. Lo
    // que este bloque mide de `liquidacion_pago` es la columna nueva, no el XOR de la 172.
    void mensajeroId;
    return `INSERT INTO "liquidacion_pago"
        ("id","clave_idempotencia","mensajero_id","tienda_id","cierre_id","monto","metodo",
         "fecha_pago","registrado_por","reparto_id")
      VALUES ('${id}', '${randomUUID()}', NULL, '${actorId}', NULL, 1000.00, 'SINPE',
              DATE '2026-08-11', '${actorId}', ${repartoId === null ? "NULL" : `'${repartoId}'`})`;
  }

  async function insertarPago(
    tx: Tx,
    mensajeroId: string,
    actorId: string,
    repartoId: string | null,
  ): Promise<string> {
    const id = randomUUID();
    await tx.$executeRawUnsafe(sqlDeUnPago(id, mensajeroId, actorId, repartoId));
    return id;
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

  async function nombresDeColumnas(tx: Tx, esquema: string, tabla: string): Promise<string[]> {
    return (await columnasDe(tx, esquema, tabla)).map((c) => c.column_name).sort();
  }

  /** Los indices UNICOS reales de una tabla (incluye los que respaldan PK y constraints). */
  async function unicosDe(tx: Tx, esquema: string, tabla: string): Promise<UnicoReal[]> {
    return tx.$queryRawUnsafe<UnicoReal[]>(
      `SELECT ci.relname AS indice,
              array_to_string(ARRAY(
                SELECT a.attname
                  FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
                  JOIN pg_attribute a ON a.attrelid = ct.oid AND a.attnum = k.attnum
                 ORDER BY k.ord
              ), ',') AS columnas
         FROM pg_index i
         JOIN pg_class ct ON ct.oid = i.indrelid
         JOIN pg_class ci ON ci.oid = i.indexrelid
         JOIN pg_namespace n ON n.oid = ct.relnamespace
        WHERE n.nspname = $1 AND ct.relname = $2 AND i.indisunique
        ORDER BY columnas`,
      esquema,
      tabla,
    );
  }

  /** Las FK de una columna concreta: a donde apuntan y con que regla de borrado. */
  async function fksDe(
    tx: Tx,
    esquema: string,
    tabla: string,
    columna: string,
  ): Promise<FkReal[]> {
    return tx.$queryRawUnsafe<FkReal[]>(
      `SELECT con.conname AS constraint,
              att.attname AS columna,
              destino.relname AS tabla_destino,
              attd.attname AS columna_destino,
              con.confdeltype::text AS on_delete
         FROM pg_constraint con
         JOIN pg_class ct ON ct.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = ct.relnamespace
         JOIN pg_class destino ON destino.oid = con.confrelid
         JOIN pg_attribute att ON att.attrelid = ct.oid AND att.attnum = con.conkey[1]
         JOIN pg_attribute attd ON attd.attrelid = destino.oid AND attd.attnum = con.confkey[1]
        WHERE n.nspname = $1 AND ct.relname = $2 AND con.contype = 'f' AND att.attname = $3`,
      esquema,
      tabla,
      columna,
    );
  }

  /**
   * Ejecuta `sql` dentro de un SAVEPOINT y devuelve el MENSAJE de error, o `""` si la sentencia
   * paso. El savepoint es obligatorio: en Postgres un error aborta la transaccion entera y sin
   * el, la primera violacion esperada dejaria muerto todo el resto del test. En los dos casos se
   * vuelve al savepoint, asi que el estado queda igual y las mediciones no dependen del orden.
   */
  async function resultadoDe(tx: Tx, sql: string): Promise<string> {
    await tx.$executeRawUnsafe("SAVEPOINT s205");
    try {
      await tx.$executeRawUnsafe(sql);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT s205");
      return "";
    } catch (error) {
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT s205");
      return error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Un usuario NUEVO, creado por el test. Toma rol y tipo de identificacion de los catalogos
   * (los siembran las migraciones de catalogo); si no hubiera ninguno FALLA con el motivo
   * escrito en vez de saltarse: un test que se abstiene porque la base esta vacia es exactamente
   * el verde-en-falso que este archivo existe para evitar.
   */
  async function crearUsuario(tx: Tx): Promise<{ id: string }> {
    const [rol] = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM public."rol" LIMIT 1`);
    const [tipo] = await tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM public."tipo_identificacion" LIMIT 1`,
    );
    if (!rol || !tipo) {
      throw new Error(
        "La base de pruebas no tiene catalogos `rol`/`tipo_identificacion` sembrados: sin ellos " +
          "no se puede crear el usuario propio del test. Corre `pnpm db:seed` antes. Este test " +
          "NO se salta en ese caso a proposito (si lo hiciera, quedaria verde sin haber " +
          "comprobado los RESTRICT de R49).",
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
      `t205-${sufijo}@example.test`,
      `t205${sufijo}`,
      tipo.id,
      rol.id,
    );
    return { id };
  }

  it("la LINEA BASE es el estado ANTERIOR a la migracion, este o no aplicada en `public`", () => {
    // La asercion que hace que este bloque NO dependa del estado de la base, y que tiene
    // contenido en los DOS estados:
    //  · base AL DIA (migracion aplicada): `public` ya trae `reparto_id`, y esta igualdad solo
    //    se cumple porque la normalizacion se la quito al clon. Si la normalizacion se quedara
    //    corta, el `throw` de `medir` corta antes con el motivo escrito; si se pasara de largo
    //    —llevandose alguna columna ajena—, lo que lo delata es ESTA igualdad.
    //  · base SIN la migracion: las dos listas coinciden tal cual, y la igualdad afirma que la
    //    normalizacion no se llevo por delante ninguna otra columna.
    expect(medicion.columnasDelPagoAntes).toEqual(
      medicion.columnasDelPagoEnPublic.filter((c) => c !== "reparto_id"),
    );
    expect(medicion.columnasDelPagoAntes).not.toContain("reparto_id");
    // Y el clon es de la tabla REAL, no de una de juguete: conserva las columnas de la 172 con
    // las que este bloque escribe sus pagos.
    expect(medicion.columnasDelPagoAntes).toEqual(
      expect.arrayContaining([
        "cierre_id",
        "clave_idempotencia",
        "fecha_pago",
        "id",
        "mensajero_id",
        "metodo",
        "monto",
        "registrado_por",
        "tienda_id",
      ]),
    );
  });

  it("R29: la tabla existe con sus seis columnas y los tipos del design", () => {
    const porNombre = Object.fromEntries(medicion.columnasReparto.map((c) => [c.column_name, c]));
    expect(Object.keys(porNombre).sort()).toEqual([
      "clave_idempotencia",
      "created_at",
      "id",
      "mensajero_id",
      "monto_total",
      "registrado_por",
    ]);
    expect(porNombre.monto_total.data_type).toBe("numeric");
    expect(porNombre.monto_total.numeric_precision).toBe(12);
    expect(porNombre.monto_total.numeric_scale).toBe(2);
    expect(porNombre.created_at.data_type).toBe("timestamp without time zone");
    // R52: fila inmutable — ninguna columna es NULLABLE y no hay `updated_at`/`deleted_at`.
    for (const c of medicion.columnasReparto) expect(c.is_nullable, c.column_name).toBe("NO");
  });

  it("R29: la MISMA clave dos veces la rechaza la BASE, y una clave distinta SI entra", () => {
    expect(medicion.errores.clave_repetida).toMatch(/liquidacion_reparto_clave_idempotencia_key/);
    // El control: si el unico estuviera sobre `mensajero_id` (o sobre cualquier otra cosa), el
    // caso de arriba tambien fallaria y este delataria el error.
    expect(medicion.errores.segundo_reparto_del_mismo_mensajero).toBe("");
  });

  it("un reparto de 0 —o negativo— es imposible", () => {
    expect(medicion.errores.monto_cero).toMatch(/liquidacion_reparto_monto_total_check/);
    expect(medicion.errores.monto_negativo).toMatch(/liquidacion_reparto_monto_total_check/);
  });

  it("R49: el beneficiario tiene que existir, y borrar a quien cobro o registro FALLA (RESTRICT)", () => {
    expect(medicion.errores.mensajero_inexistente).toMatch(
      /liquidacion_reparto_mensajero_id_fkey/,
    );
    expect(medicion.errores.borrar_mensajero_con_repartos).toMatch(
      /liquidacion_reparto_mensajero_id_fkey/,
    );
    expect(medicion.errores.borrar_actor_con_repartos).toMatch(
      /liquidacion_reparto_registrado_por_fkey/,
    );
  });

  it("R28: `reparto_id` apunta a `liquidacion_reparto(id)` con RESTRICT, y admite NULL", () => {
    // «Apunta a donde dice» medido en `pg_constraint`, no en el texto del .sql: es la unica
    // forma de que una FK dirigida a otra tabla (o a otra columna) ponga el test en rojo.
    expect(medicion.fkDelRepartoId).toEqual([
      {
        constraint: "liquidacion_pago_reparto_id_fkey",
        columna: "reparto_id",
        tabla_destino: "liquidacion_reparto",
        columna_destino: "id",
        on_delete: "r", // 'r' = RESTRICT en pg_constraint.confdeltype
      },
    ]);
    expect(medicion.errores.pago_con_reparto_inexistente).toMatch(
      /liquidacion_pago_reparto_id_fkey/,
    );
    expect(medicion.errores.borrar_reparto_con_pagos).toMatch(/liquidacion_pago_reparto_id_fkey/);
    // R51: el pago suelto —el que se sigue registrando contra UN cierre— entra con NULL.
    expect(medicion.repartoIdDelPagoSuelto).toBeNull();
  });

  it("EL CRITERIO DURO, medido en el motor: `liquidacion_pago` NO gana ni un indice UNICO", () => {
    // El conjunto de indices unicos ANTES y DESPUES de aplicar la migracion tiene que ser
    // IDENTICO. Es la comprobacion que sobrevive a cualquier forma de escribir el unico
    // (`CREATE UNIQUE INDEX`, `ADD CONSTRAINT ... UNIQUE`, un `@@unique` del datamodel).
    expect(medicion.unicosDelPagoDespues).toEqual(medicion.unicosDelPagoAntes);
    // Y lo que ese conjunto ES: la PK y la clave de idempotencia. Ni uno mas.
    expect(medicion.unicosDelPagoDespues.map((u) => u.columnas).sort()).toEqual([
      "clave_idempotencia",
      "id",
    ]);
    // La contracara por COMPORTAMIENTO: dos pagos del mismo reparto conviven. Si `reparto_id`
    // fuera unico, este INSERT chocaria — y el servicio interpretaria ese P2002 como clave de
    // idempotencia repetida, respondiendo `no_encontrado` a un pago legitimo.
    expect(medicion.errores.dos_pagos_del_mismo_reparto).toBe("");
  });

  it("R49: RLS habilitada (relrowsecurity = true) en la tabla nueva", () => {
    expect(medicion.rls).toEqual([{ relname: "liquidacion_reparto", relrowsecurity: true }]);
  });

  it("R49: el `down.sql` REAL deja el esquema EXACTAMENTE como estaba", () => {
    // No «parecido»: la lista de columnas de `liquidacion_pago` comparada con la de antes, y la
    // tabla nueva desaparecida. El clon sobrevive porque el down no lo creo.
    expect(medicion.columnasDelPagoTrasElDown).toEqual(medicion.columnasDelPagoAntes);
    expect(medicion.columnasDelPagoAntes).not.toContain("reparto_id");
    expect(medicion.tablasTrasElDown).toEqual(["liquidacion_pago"]);
  });
});
