import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet-tienda";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 381 / T B.6 — cobertura de las DOS migraciones del cobro manual, en lo que toca al
// libro de la tienda:
//    · `20260908140000_wallet_tienda_categoria_cobro_manual` (el valor de enum)
//    · `20260908140100_wallet_tienda_check_cobro_manual`     (el CHECK que lo admite)
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// LO QUE MIDE, y por que cada cosa:
//
//   (estatico) el `up` de la 1 es UNA sola sentencia `ADD VALUE`, aditiva; su `down` NO nombra el
//       valor nuevo, lleva escrito el aviso de que su lista es una FOTO, y suelta el CHECK y los
//       DOS indices que dependen de la columna ANTES de recastear;
//   (a) el enum de `public` coincide EXACTAMENTE con el catalogo cerrado de
//       `lib/types/wallet-tienda.ts` —el `satisfies` de TypeScript compara contra el cliente
//       GENERADO, no contra la base viva, asi que un `prisma generate` rancio lo dejaria pasar—, y
//       el valor nuevo va AL FINAL (`ADD VALUE` sin `BEFORE`/`AFTER` apende);
//   (b) el `down` devuelve el enum a la lista PREVIA de 10 y los DOS indices a su forma exacta —
//       medido COMPARANDO el estado de antes del up con el de despues del down, no leyendo el
//       archivo—;
//   (c) ⭑ EL CHECK, MEDIDO POR CONDUCTA Y NO POR REGEX: se intenta un `INSERT` por cada par
//       (tipo, categoria) y se registra cual acepta la base. Es lo unico que demuestra que
//       `debito`/`cobro_manual` pasa, que `credito`/`cobro_manual` NO, y que la restriccion de HOY
//       sigue cubriendo el enum de HOY. Un `toContain` sobre el SQL no distingue eso de un cambio
//       de formato;
//   (d) con UNA fila que use el valor nuevo, el rollback FALLA ruidosamente y NO borra esa fila.
//
// ⚠️ LAS CARPETAS DEL ESTADO PREVIO SE DESCUBREN LEYENDO `db/migrations`, no se escriben como
// constantes. Motivo MEDIDO en este repo el 2026-09-07: un `down.sql` de enum recrea el tipo con la
// lista COMPLETA, y esa lista es una FOTO. Con las carpetas escritas a mano, si `dev` trae una
// ampliacion nueva mientras esta rama esta abierta, la reconstruccion la ignoraria y el bloque (b)
// seguiria verde con un `down.sql` rancio.

const ROOT = process.cwd();
const MIGRACIONES = path.join(ROOT, "db", "migrations");
const DIR_ENUM = "20260908140000_wallet_tienda_categoria_cobro_manual";
const DIR_CHECK = "20260908140100_wallet_tienda_check_cobro_manual";

const upEnum = fs.readFileSync(path.join(MIGRACIONES, DIR_ENUM, "migration.sql"), "utf8");
const downEnum = fs.readFileSync(path.join(MIGRACIONES, DIR_ENUM, "down.sql"), "utf8");
const upCheck = fs.readFileSync(path.join(MIGRACIONES, DIR_CHECK, "migration.sql"), "utf8");
const downCheck = fs.readFileSync(path.join(MIGRACIONES, DIR_CHECK, "down.sql"), "utf8");

const VALOR_NUEVO = "cobro_manual";
const TIPO_ENUM = "wallet_tienda_movimiento_categoria";
const CHECK = "wallet_tienda_movimiento_tipo_categoria_check";
const IDX_CATEGORIA = "wallet_tienda_movimiento_tienda_id_categoria_idx";
const IDX_UNICO = "wallet_tienda_movimiento_origen_uq";

function soloEjecutable(sql: string): string {
  return sql
    .split("\n")
    .filter((linea) => !/^\s*--/.test(linea))
    .join("\n");
}

function sentencias(sql: string): string[] {
  return soloEjecutable(sql)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Las sentencias de `sql` que TOCAN el libro de la tienda. El resto es del historial. */
function sentenciasDelLedger(sql: string): string[] {
  return sentencias(sql).filter((s) => /wallet_tienda_movimiento/.test(s));
}

/** Las que NO. Se afirman aparte, para que el filtro no pueda saltarse algo en silencio. */
function sentenciasAjenas(sql: string): string[] {
  return sentencias(sql).filter((s) => !/wallet_tienda_movimiento/.test(s));
}

/** El bloque `CREATE TYPE "<tipo>" AS ENUM ( … )` de un archivo de migracion, tal cual. */
function createTypeDe(archivo: string, tipo: string): string {
  const sql = soloEjecutable(fs.readFileSync(archivo, "utf8"));
  const patron = new RegExp(`CREATE TYPE "${tipo}" AS ENUM \\([\\s\\S]*?\\)`, "m");
  const encontrado = patron.exec(sql);
  if (encontrado === null) {
    throw new Error(`no se encontro el CREATE TYPE de "${tipo}" en ${archivo}`);
  }
  return encontrado[0];
}

/** La sentencia COMPLETA que contiene `ancla` en `archivo`. */
function sentenciaConAncla(archivo: string, ancla: string): string {
  const encontrada = sentencias(fs.readFileSync(archivo, "utf8")).find((s) => s.includes(ancla));
  if (encontrada === undefined) throw new Error(`no se encontro «${ancla}» en ${archivo}`);
  return encontrada;
}

// ---------------------------------------------------------------------------------------------
// EL DESCUBRIMIENTO DE LA HISTORIA, sin una sola carpeta escrita a mano
// ---------------------------------------------------------------------------------------------

function carpetasDeMigracion(): string[] {
  return fs
    .readdirSync(MIGRACIONES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function migrationSqlDe(dir: string): string {
  const ruta = path.join(MIGRACIONES, dir, "migration.sql");
  return fs.existsSync(ruta) ? fs.readFileSync(ruta, "utf8") : "";
}

/** La carpeta que CREA el enum de categorias desde cero. Se descubre, no se escribe. */
function carpetaDelOrigen(): string {
  const encontrada = carpetasDeMigracion().find((dir) =>
    new RegExp(`CREATE TYPE "${TIPO_ENUM}" AS ENUM`).test(soloEjecutable(migrationSqlDe(dir))),
  );
  if (encontrada === undefined) {
    throw new Error(
      `no se encontro ninguna migracion que CREE \`${TIPO_ENUM}\`: la reconstruccion del estado ` +
        "previo mediria sobre una historia inventada",
    );
  }
  return encontrada;
}

/** La carpeta que CREA el CHECK tipo<->categoria. Tambien se descubre. */
function carpetaDelCheck(): string {
  const encontrada = carpetasDeMigracion().find((dir) =>
    new RegExp(`ADD CONSTRAINT "${CHECK}"`).test(soloEjecutable(migrationSqlDe(dir))),
  );
  if (encontrada === undefined) throw new Error(`no se encontro la migracion que crea ${CHECK}`);
  return encontrada;
}

/**
 * Las carpetas que AMPLIAN el enum de categorias, entre el origen (excluido) y la de ESTA ficha
 * (excluida), en orden.
 *
 * ⚠️ Aqui esta la defensa: si `dev` mergea una ampliacion nueva mientras esta rama esta abierta,
 * aparece SOLA en esta lista, entra en la reconstruccion y el bloque (b) se pone rojo diciendo que
 * valor le falta al `down.sql`.
 */
function carpetasQueAmplian(): string[] {
  const origen = carpetaDelOrigen();
  return carpetasDeMigracion().filter(
    (dir) =>
      dir > origen &&
      dir < DIR_ENUM &&
      new RegExp(`ALTER TYPE "${TIPO_ENUM}"\\s+ADD VALUE`).test(soloEjecutable(migrationSqlDe(dir))),
  );
}

function ampliacionesDe(dir: string): string[] {
  const sql = soloEjecutable(migrationSqlDe(dir));
  const patron = new RegExp(`ALTER TYPE "${TIPO_ENUM}"\\s+ADD VALUE[^;]*`, "g");
  return sql.match(patron) ?? [];
}

// ---------------------------------------------------------------------------------------------
// Cualificacion al esquema desechable
// ---------------------------------------------------------------------------------------------

/**
 * ⚠️ EL ORDEN ES DE MAS LARGO A MAS CORTO: `wallet_tienda_movimiento` es PREFIJO de los otros tres,
 * y sustituir primero el corto dejaria los largos rotos. La sustitucion lleva las comillas, asi que
 * `"wallet_tienda_movimiento_tipo_categoria_check"` —el nombre del CHECK— NO casa con
 * `"wallet_tienda_movimiento_tipo"`, que es lo que se quiere: un nombre de restriccion vive en su
 * tabla y no se cualifica.
 */
const NOMBRES = [
  "wallet_tienda_movimiento_categoria_old",
  "wallet_tienda_movimiento_categoria",
  "wallet_tienda_movimiento_tipo",
  "wallet_tienda_movimiento",
] as const;

function cualificar(sql: string, esquema: string): string {
  let salida = sql.replaceAll(
    'RENAME TO "wallet_tienda_movimiento_categoria_old"',
    'RENAME TO "@@C_OLD@@"',
  );
  for (const nombre of NOMBRES) {
    salida = salida.replaceAll(`"${nombre}"`, `"${esquema}"."${nombre}"`);
  }
  // Un indice se CREA sin esquema (hereda el de su tabla) pero se SUELTA con el suyo.
  salida = salida.replace(
    /DROP INDEX IF EXISTS "([^"]+)"/g,
    (_m, nombre: string) => `DROP INDEX IF EXISTS "${esquema}"."${nombre}"`,
  );
  return salida.replaceAll('"@@C_OLD@@"', '"wallet_tienda_movimiento_categoria_old"');
}

async function aplicar(admin: PrismaClient, sentenciasSql: string[], esquema: string): Promise<void> {
  for (const stmt of sentenciasSql) {
    await admin.$executeRawUnsafe(cualificar(stmt, esquema));
  }
}

/** Los valores de un enum, EN SU ORDEN (`enumsortorder`), dentro de un esquema. */
async function valoresDeEnum(
  admin: PrismaClient,
  esquema: string,
  tipo: string,
): Promise<string[]> {
  const filas = await admin.$queryRawUnsafe<{ valor: string }[]>(
    `SELECT e.enumlabel AS valor
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = $1 AND t.typname = $2
      ORDER BY e.enumsortorder`,
    esquema,
    tipo,
  );
  return filas.map((f) => f.valor);
}

/** Los indices de la tabla en ese esquema: nombre -> definicion, normalizada de esquema. */
async function indicesDeLaTabla(
  admin: PrismaClient,
  esquema: string,
): Promise<Record<string, string>> {
  const filas = await admin.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = $1 AND tablename = 'wallet_tienda_movimiento'
      ORDER BY indexname`,
    esquema,
  );
  return Object.fromEntries(
    filas.map((f) => [f.indexname, f.indexdef.replaceAll(`${esquema}.`, "")]),
  );
}

/**
 * ⭑ EL CHECK, MEDIDO POR CONDUCTA. Intenta un `INSERT` de cada par y devuelve los que la base
 * ACEPTA. No lee el SQL: pregunta a Postgres.
 */
async function paresAceptados(admin: PrismaClient, esquema: string): Promise<string[]> {
  const aceptados: string[] = [];
  const categorias = await valoresDeEnum(admin, esquema, TIPO_ENUM);
  for (const tipo of ["credito", "debito"]) {
    for (const categoria of categorias) {
      const id = `p-${tipo}-${categoria}`;
      try {
        await admin.$executeRawUnsafe(
          `INSERT INTO "${esquema}"."wallet_tienda_movimiento"
             ("id","tienda_id","tipo","categoria","monto","origen_tipo","origen_id")
           VALUES ('${id}','t1','${tipo}','${categoria}',1.00,'manual',NULL)`,
        );
        await admin.$executeRawUnsafe(
          `DELETE FROM "${esquema}"."wallet_tienda_movimiento" WHERE "id" = '${id}'`,
        );
        aceptados.push(`${tipo}/${categoria}`);
      } catch {
        // Rechazado por el CHECK (o por el enum): no entra.
      }
    }
  }
  return aceptados;
}

/**
 * Levanta el estado PREVIO a esta ficha ejecutando las migraciones REALES anteriores: los dos
 * `CREATE TYPE` del origen, sus `ADD VALUE` posteriores DESCUBIERTOS, la tabla con sus dos indices y
 * el CHECK tal como lo escribio la migracion que lo creo.
 *
 * NO se copia nada de los `down.sql` que este archivo esta probando: si se copiara, la comparacion
 * seria circular y una lista mal escrita pasaria en verde.
 */
async function crearEstadoPrevio(admin: PrismaClient, esquema: string): Promise<void> {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
  const origen = path.join(MIGRACIONES, carpetaDelOrigen(), "migration.sql");
  await admin.$executeRawUnsafe(cualificar(createTypeDe(origen, TIPO_ENUM), esquema));
  await admin.$executeRawUnsafe(
    cualificar(createTypeDe(origen, "wallet_tienda_movimiento_tipo"), esquema),
  );
  for (const dir of carpetasQueAmplian()) {
    for (const stmt of ampliacionesDe(dir)) {
      await admin.$executeRawUnsafe(cualificar(stmt, esquema));
    }
  }
  // La tabla, recortada a las columnas que las dos migraciones tocan. `origen_tipo` va como TEXT:
  // `wallet_origen_tipo` vive en `public` y ninguna de las dos migraciones lo nombra.
  await admin.$executeRawUnsafe(
    `CREATE TABLE "${esquema}"."wallet_tienda_movimiento" (
       "id" TEXT PRIMARY KEY,
       "tienda_id" TEXT NOT NULL,
       "tipo" "${esquema}"."wallet_tienda_movimiento_tipo" NOT NULL,
       "categoria" "${esquema}"."${TIPO_ENUM}" NOT NULL,
       "monto" DECIMAL(12,2) NOT NULL,
       "origen_tipo" TEXT NOT NULL,
       "origen_id" TEXT)`,
  );
  await admin.$executeRawUnsafe(
    `CREATE INDEX "${IDX_CATEGORIA}" ON "${esquema}"."wallet_tienda_movimiento"("tienda_id", "categoria")`,
  );
  await admin.$executeRawUnsafe(
    `CREATE UNIQUE INDEX "${IDX_UNICO}" ON "${esquema}"."wallet_tienda_movimiento"("origen_tipo", "origen_id", "tienda_id", "categoria") WHERE "origen_id" IS NOT NULL`,
  );
  // Y el CHECK ORIGINAL, leido de la migracion que lo creo (no escrito aqui).
  await admin.$executeRawUnsafe(
    cualificar(
      sentenciaConAncla(
        path.join(MIGRACIONES, carpetaDelCheck(), "migration.sql"),
        `ADD CONSTRAINT "${CHECK}"`,
      ),
      esquema,
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Estatico: corre SIEMPRE, tambien sin base.
// ---------------------------------------------------------------------------------------------

describe("381/B.6 — la forma en disco de las dos migraciones", () => {
  it("las dos carpetas traen `migration.sql` y `down.sql`", () => {
    for (const dir of [DIR_ENUM, DIR_CHECK]) {
      expect(fs.existsSync(path.join(MIGRACIONES, dir, "migration.sql")), dir).toBe(true);
      expect(fs.existsSync(path.join(MIGRACIONES, dir, "down.sql")), dir).toBe(true);
    }
  });

  it("la 1 añade UN solo valor y NADA mas: ni tablas, ni columnas, ni indices, ni datos", () => {
    const ejecutable = soloEjecutable(upEnum);
    expect(sentencias(upEnum)).toHaveLength(1);
    expect(ejecutable).toMatch(new RegExp(`ALTER TYPE "${TIPO_ENUM}" ADD VALUE`));
    expect(ejecutable).toContain(`'${VALOR_NUEVO}'`);
    expect(ejecutable).not.toMatch(/CREATE TABLE|ALTER TABLE|CREATE INDEX/i);
    expect(ejecutable).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it("⭑ van SEPARADAS porque el CHECK USA el valor: la 2 no lo añade y la 1 no lo usa", () => {
    // Postgres prohibe usar un valor de enum en la misma transaccion que lo añade (55P04), y Prisma
    // corre cada `migration.sql` en la suya. Si alguien las fusionara, esto se pone rojo.
    expect(soloEjecutable(upEnum)).not.toMatch(new RegExp(`ADD CONSTRAINT "${CHECK}"`));
    expect(soloEjecutable(upCheck)).not.toMatch(
      new RegExp(`ALTER TYPE "${TIPO_ENUM}"\\s+ADD VALUE`),
    );
    expect(DIR_ENUM < DIR_CHECK).toBe(true); // el orden de aplicacion es el del nombre
  });

  it("la 2 mete `cobro_manual` en la rama `debito` y en ninguna otra", () => {
    const sentencia = sentenciasDelLedger(upCheck).find((s) => s.includes(`ADD CONSTRAINT "${CHECK}"`));
    expect(sentencia).toBeDefined();
    const [ramaCredito, ramaDebito] = (sentencia as string).split(/"tipo" = 'debito'/);
    expect(ramaCredito).not.toContain(`'${VALOR_NUEVO}'`);
    expect(ramaDebito).toContain(`'${VALOR_NUEVO}'`);
    // Falla CERRADO (R60 de la 172): disyuncion de listas cerradas, sin negaciones.
    expect(sentencia).not.toMatch(/\bNOT\b|\bNOT IN\b|<>/);
    // Y VALIDA las filas existentes: nada de `NOT VALID`.
    expect(sentencia).not.toMatch(/\bNOT\s+VALID\b/i);
  });

  it("el `down` de la 1 NO nombra el valor nuevo, que es justo lo que viene a quitar", () => {
    expect(soloEjecutable(downEnum)).not.toContain(`'${VALOR_NUEVO}'`);
  });

  it("el `down` de la 1 suelta el CHECK y los DOS indices ANTES de recastear", () => {
    const ejecutable = soloEjecutable(downEnum);
    const iCheck = ejecutable.indexOf(`DROP CONSTRAINT IF EXISTS "${CHECK}"`);
    const iIdx = ejecutable.indexOf(`DROP INDEX IF EXISTS "${IDX_CATEGORIA}"`);
    const iUq = ejecutable.indexOf(`DROP INDEX IF EXISTS "${IDX_UNICO}"`);
    // El recast se parte en dos lineas en el archivo, asi que se busca con un regex tolerante al
    // salto: un `indexOf` de la cadena contigua daria -1 y la comparacion de abajo pasaria sola.
    const recast = /ALTER COLUMN "categoria"\s+TYPE/.exec(ejecutable);
    expect(recast, "el down no recastea la columna: no esta revirtiendo nada").not.toBeNull();
    const iRecast = (recast as RegExpExecArray).index;
    for (const [nombre, i] of [["CHECK", iCheck], ["idx categoria", iIdx], ["unico", iUq]] as const) {
      expect(i, `el down no suelta ${nombre}`).toBeGreaterThanOrEqual(0);
      expect(i, `${nombre} se suelta DESPUES del recast`).toBeLessThan(iRecast);
    }
    // Y los vuelve a crear, con el predicado parcial intacto.
    expect(ejecutable).toContain(`CREATE INDEX "${IDX_CATEGORIA}"`);
    expect(ejecutable).toContain(`CREATE UNIQUE INDEX "${IDX_UNICO}"`);
    expect(ejecutable).toMatch(/WHERE "origen_id" IS NOT NULL/);
  });

  it("⭑ el `down` de la 1 lleva ESCRITO el aviso de que su lista es una FOTO que caduca", () => {
    // No es decoracion: es la unica defensa de quien lo corra a mano desde una rama vieja. El
    // 2026-09-07 un `down.sql` de enum borro `zona_central_cambiada` de la base local sin un solo
    // error de Postgres. Si alguien recorta este archivo, el aviso se va con el.
    expect(downEnum).toMatch(/FOTO DEL 2026-09-08/);
    expect(downEnum).toMatch(/pg_enum/); // la consulta con la que medir el catalogo de HOY
    expect(downEnum).toMatch(/PRECONDICION RUIDOSA/);
  });

  it("⭑ el `down` de la 2 devuelve el CHECK a su lista SIN el valor nuevo, y va PRIMERO", () => {
    const delLedger = sentenciasDelLedger(downCheck);
    const iAdd = delLedger.findIndex((s) => s.includes(`ADD CONSTRAINT "${CHECK}"`));
    expect(iAdd).toBeGreaterThanOrEqual(0);
    expect(delLedger[iAdd]).not.toContain(`'${VALOR_NUEVO}'`);
    // Va antes que TODO lo del historial: en un rollback los downs corren del mas nuevo al mas
    // viejo, y este CHECK nombra un valor que el down de la 1 retira despues.
    const todas = sentencias(downCheck);
    const iCheckGlobal = todas.findIndex((s) => s.includes(`ADD CONSTRAINT "${CHECK}"`));
    const iPrimeraAjena = todas.findIndex((s) => !/wallet_tienda_movimiento/.test(s));
    expect(iCheckGlobal).toBeLessThan(iPrimeraAjena);
  });

  it("el filtro «sentencias del ledger» no se salta nada: lo demas es SOLO del historial", () => {
    // Anti-vacuidad del propio mecanismo: si el filtro dejara fuera una sentencia del ledger, los
    // bloques contra Postgres mediran una migracion incompleta EN VERDE.
    for (const [nombre, sql] of [["up2", upCheck], ["down2", downCheck]] as const) {
      expect(sentenciasDelLedger(sql).length, nombre).toBeGreaterThan(0);
      for (const ajena of sentenciasAjenas(sql)) {
        expect(ajena, `${nombre}: sentencia que no es ni del ledger ni del historial`).toMatch(
          /historial_accion/,
        );
      }
    }
  });

  it("⭑ el descubrimiento de la historia encuentra algo (anti-vacuidad del mecanismo)", () => {
    const origen = carpetaDelOrigen();
    expect(origen).toMatch(/wallet_tienda_movimiento/);
    expect(carpetaDelCheck()).toMatch(/liquidacion_pago/);
    // ESTA carpeta NO se cuenta a si misma: si lo hiciera, el «estado previo» ya traeria el valor
    // nuevo y el bloque (b) compararia el down contra si mismo.
    expect(carpetasQueAmplian()).not.toContain(DIR_ENUM);
    for (const dir of carpetasQueAmplian()) {
      expect(dir > origen && dir < DIR_ENUM, `${dir} fuera de la ventana`).toBe(true);
      expect(ampliacionesDe(dir).length, `${dir} sin ADD VALUE`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// (a) La base viva contra el catalogo cerrado.
// ---------------------------------------------------------------------------------------------

describe.skipIf(!HAY_BASE_DE_DATOS)("381/B.6 (a) — el enum de la base ES el catalogo", () => {
  let admin: PrismaClient;

  beforeAll(() => {
    admin = crearPrismaDeTest();
  });

  afterAll(async () => {
    await admin?.$disconnect();
  });

  it("`wallet_tienda_movimiento_categoria` de `public` tiene exactamente las del SEED", async () => {
    const enLaBase = await valoresDeEnum(admin, "public", TIPO_ENUM);
    expect(enLaBase.length).toBeGreaterThan(0); // anti-vacuidad
    expect([...enLaBase].sort()).toEqual([...WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED].sort());
    expect(enLaBase).toContain(VALOR_NUEVO);
    expect(enLaBase).toHaveLength(WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED.length);
  });

  it("el valor nuevo va AL FINAL: `ADD VALUE` sin BEFORE/AFTER apende", async () => {
    // Es de donde saldra la lista previa del `down.sql` de la SIGUIENTE ficha que amplie el enum.
    const enLaBase = await valoresDeEnum(admin, "public", TIPO_ENUM);
    expect(enLaBase.at(-1)).toBe(VALOR_NUEVO);
    expect(enLaBase.indexOf(VALOR_NUEVO)).toBeGreaterThan(enLaBase.indexOf("ajuste_debito"));
  });

  it("⭑ el CHECK de `public` acepta `debito`/`cobro_manual` y RECHAZA `credito`/`cobro_manual`", async () => {
    const def = await admin.$queryRawUnsafe<{ def: string }[]>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'public.wallet_tienda_movimiento'::regclass AND conname = $1`,
      CHECK,
    );
    expect(def).toHaveLength(1);
    const [ramaCredito, ramaDebito] = def[0].def.split(/tipo = 'debito'/);
    expect(ramaDebito).toContain(`'${VALOR_NUEVO}'`);
    expect(ramaCredito).not.toContain(`'${VALOR_NUEVO}'`);
  });
});

// ---------------------------------------------------------------------------------------------
// (b)+(c) El ciclo completo sobre un esquema desechable: up1 -> up2 -> down2 -> down1.
// ---------------------------------------------------------------------------------------------

describe.skipIf(!HAY_BASE_DE_DATOS)("381/B.6 (b)(c) — el ciclo up/down, medido comparando", () => {
  const esquema = `t_381_ledger_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let admin: PrismaClient;
  let enumAntes: string[] = [];
  let indicesAntes: Record<string, string> = {};
  let paresAntes: string[] = [];
  let enumTrasUp1: string[] = [];
  let paresTrasUp1: string[] = [];
  let paresTrasUp2: string[] = [];
  let paresTrasDown2: string[] = [];
  let enumTrasDown1: string[] = [];
  let indicesTrasDown1: Record<string, string> = {};
  let paresTrasDown1: string[] = [];

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await crearEstadoPrevio(admin, esquema);
    enumAntes = await valoresDeEnum(admin, esquema, TIPO_ENUM);
    indicesAntes = await indicesDeLaTabla(admin, esquema);
    paresAntes = await paresAceptados(admin, esquema);

    await aplicar(admin, sentencias(upEnum), esquema);
    enumTrasUp1 = await valoresDeEnum(admin, esquema, TIPO_ENUM);
    paresTrasUp1 = await paresAceptados(admin, esquema);

    await aplicar(admin, sentenciasDelLedger(upCheck), esquema);
    paresTrasUp2 = await paresAceptados(admin, esquema);

    await aplicar(admin, sentenciasDelLedger(downCheck), esquema);
    paresTrasDown2 = await paresAceptados(admin, esquema);

    await aplicar(admin, sentencias(downEnum), esquema);
    enumTrasDown1 = await valoresDeEnum(admin, esquema, TIPO_ENUM);
    indicesTrasDown1 = await indicesDeLaTabla(admin, esquema);
    paresTrasDown1 = await paresAceptados(admin, esquema);
  }, 180_000);

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  it("el estado PREVIO reconstruido son 10 categorias, 3 indices y 10 pares aceptados", () => {
    // Numeros DUROS: si las migraciones anteriores dejaran otra cosa, todo lo de abajo mediria
    // sobre una historia inventada.
    expect(enumAntes).toHaveLength(10);
    expect(enumAntes.at(-1)).toBe("ajuste_debito");
    // pkey + los dos de la 43.
    expect(Object.keys(indicesAntes).sort()).toEqual([
      IDX_UNICO,
      "wallet_tienda_movimiento_pkey",
      IDX_CATEGORIA,
    ].sort());
    // El CHECK original clasifica las 10 categorias, cada una en UNA sola rama.
    expect(paresAntes).toHaveLength(10);
    expect(paresAntes).not.toContain(`debito/${VALOR_NUEVO}`);
  });

  it("⭑ el estado previo reconstruido ES el catalogo de HOY menos el valor nuevo", () => {
    const sinElNuevo = WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED.filter((c) => c !== VALOR_NUEVO);
    expect([...enumAntes].sort()).toEqual([...sinElNuevo].sort());
  });

  it("la 1 deja 11 valores, con el nuevo AL FINAL, y el CHECK TODAVIA lo rechaza", () => {
    expect(enumTrasUp1).toHaveLength(11);
    expect(enumTrasUp1.at(-1)).toBe(VALOR_NUEVO);
    // ⚠️ ESTA ES LA VENTANA ENTRE LAS DOS MIGRACIONES, y esta medida: el CHECK NO se extiende solo.
    // Un `INSERT` con el valor nuevo lo rechaza la base hasta que corra la 2. Es la red de R60, no
    // un descuido.
    expect(paresTrasUp1).toEqual(paresAntes);
    expect(paresTrasUp1).not.toContain(`debito/${VALOR_NUEVO}`);
  });

  it("⭑ la 2 abre EXACTAMENTE un par: `debito`/`cobro_manual`, y ninguno mas", () => {
    const nuevos = paresTrasUp2.filter((p) => !paresAntes.includes(p));
    expect(nuevos).toEqual([`debito/${VALOR_NUEVO}`]);
    // Y no CIERRA ninguno: la ampliacion no puede invalidar filas que ya existian.
    expect(paresAntes.filter((p) => !paresTrasUp2.includes(p))).toEqual([]);
    // Cada categoria sigue teniendo EXACTAMENTE un tipo valido: 11 pares para 11 categorias.
    expect(paresTrasUp2).toHaveLength(11);
    expect(paresTrasUp2).not.toContain(`credito/${VALOR_NUEVO}`);
  });

  it("⭑ el CHECK de HOY cubre el enum de HOY: ni una categoria sin clasificar", () => {
    // La invariante que la 172 escribio (R58/R60) y que esta ficha hereda: toda categoria del enum
    // casa una rama, y solo una. Un valor futuro sin clasificar daria menos pares que categorias.
    const categorias = enumTrasUp1; // las 11 de despues del up1
    expect(paresTrasUp2).toHaveLength(categorias.length);
    for (const categoria of categorias) {
      const enCuantasRamas = paresTrasUp2.filter((p) => p.endsWith(`/${categoria}`)).length;
      expect(enCuantasRamas, `\`${categoria}\` no casa exactamente una rama`).toBe(1);
    }
  });

  it("el down de la 2 devuelve el CHECK a su conducta previa, par a par", () => {
    expect(paresTrasDown2).toEqual(paresAntes);
  });

  it("⭑ el down de la 1 devuelve el enum a la lista previa, valor a valor y EN ORDEN", () => {
    // La comparacion es contra el estado medido ANTES del up —reconstruido con las migraciones
    // REALES, descubiertas leyendo el disco—, no contra una lista escrita a mano: si el `down.sql`
    // copiara la lista equivocada, esto se pone rojo diciendo cual falta.
    expect(enumTrasDown1).toEqual(enumAntes);
  });

  it("⭑ el down de la 1 devuelve los DOS indices con su nombre Y su forma exactos", () => {
    // Incluido el predicado parcial del unico: perderlo convertiria la idempotencia del feed del
    // cierre en un `UNIQUE` sobre los manuales, que llevan `origen_id` NULL.
    expect(indicesTrasDown1).toEqual(indicesAntes);
    expect(indicesTrasDown1[IDX_UNICO]).toMatch(/WHERE \(origen_id IS NOT NULL\)/);
  });

  it("y la conducta del CHECK vuelve a ser la de antes de todo", () => {
    expect(paresTrasDown1).toEqual(paresAntes);
  });
});

// ---------------------------------------------------------------------------------------------
// (d) La precondicion ruidosa: con una fila que use el valor nuevo, el rollback ABORTA.
// ---------------------------------------------------------------------------------------------

describe.skipIf(!HAY_BASE_DE_DATOS)(
  "381/B.6 (d) — el down aborta si queda un cobro escrito",
  () => {
    const esquema = `t_381_ledger2_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    let admin: PrismaClient;

    beforeAll(async () => {
      admin = crearPrismaDeTest();
      await crearEstadoPrevio(admin, esquema);
      await aplicar(admin, sentencias(upEnum), esquema);
      await aplicar(admin, sentenciasDelLedger(upCheck), esquema);
      await admin.$executeRawUnsafe(
        `INSERT INTO "${esquema}"."wallet_tienda_movimiento"
           ("id","tienda_id","tipo","categoria","monto","origen_tipo","origen_id")
         VALUES ('cobro-1','t1','debito','${VALOR_NUEVO}',1500.00,'manual',NULL)`,
      );
    }, 180_000);

    afterAll(async () => {
      await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
      await admin?.$disconnect();
    });

    it("el cobro esta escrito (anti-vacuidad) y con su importe intacto", async () => {
      const [fila] = await admin.$queryRawUnsafe<{ n: number; monto: string }[]>(
        `SELECT COUNT(*)::int AS n, MIN("monto")::text AS monto
           FROM "${esquema}"."wallet_tienda_movimiento" WHERE "categoria" = '${VALOR_NUEVO}'`,
      );
      expect(fila.n).toBe(1);
      expect(fila.monto).toBe("1500.00");
    });

    it("el rollback del enum FALLA ruidosamente y NO borra ni reescribe ese cobro", async () => {
      await expect(aplicar(admin, sentencias(downEnum), esquema)).rejects.toThrow();
      // Y la fila sigue ahi, entera. Es dinero que una tienda DEBE: el reverso de un libro
      // append-only no puede ser un borrado silencioso.
      const [fila] = await admin.$queryRawUnsafe<
        { n: number; categoria: string; monto: string }[]
      >(
        `SELECT COUNT(*)::int AS n, MIN("categoria"::text) AS categoria, MIN("monto")::text AS monto
           FROM "${esquema}"."wallet_tienda_movimiento"`,
      );
      expect(fila.n).toBe(1);
      expect(fila.categoria).toBe(VALOR_NUEVO);
      expect(fila.monto).toBe("1500.00");
    });
  },
);
