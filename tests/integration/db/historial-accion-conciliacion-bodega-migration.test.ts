import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import {
  HISTORIAL_ACCION_ENTIDADES,
  HISTORIAL_ACCION_TIPOS,
} from "@/lib/types/historial-accion";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 431 / T1 — cobertura de `20260919120000_historial_accion_conciliacion_bodega`.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// LAS CUATRO COSAS QUE MIDE, calcadas del archivo de la 429 (mismo enum, mismo patron de `down`):
//   (estatico) el `up` son DOS sentencias `ADD VALUE`, aditivas, y no nombra el enum de entidades;
//       el `down` NO nombra ninguno de los dos valores nuevos y solo recastea `accion`;
//   (a) el enum de `public` coincide EXACTAMENTE con el catalogo cerrado de
//       `lib/types/historial-accion.ts` —el `satisfies` de TypeScript compara contra el cliente
//       GENERADO, no contra la base viva, asi que un `prisma generate` rancio lo dejaria pasar—;
//   (b) el `down.sql` recrea la lista PREVIA (53 tipos) — medido COMPARANDO el estado de antes del
//       `up` con el de despues del `down`, no leyendo el archivo;
//   (c) con UNA fila que use un valor nuevo, el rollback FALLA ruidosamente y NO borra esa fila.
//
// ⚠️ POR QUE SON DOS VALORES Y NO UNO. La guardia del censo de historial mide POR METODO, no por
// escritura (medido dos veces en este repo, fichas 376 y 380). Con `marcarConciliado` y
// `revertirConciliacion` bajo un mismo tipo, borrar uno de los dos `appendAccion` dejaria la
// guardia verde. Dos tipos obligan a dos entradas de censo y por tanto a dos metodos.
//
// ⚠️ LAS CARPETAS DEL ESTADO PREVIO SE DESCUBREN LEYENDO `db/migrations`, nunca se escriben como
// constantes. Y esta MEDIDO en este repo el 2026-09-07 por que: un `down.sql` de enum recrea el
// tipo con la lista COMPLETA, y esa lista es una FOTO del momento en que se escribio. El de una
// rama ramificada antes del merge de la 376 BORRO `zona_central_cambiada` de la base local sin un
// solo error; el sintoma fueron 7 tests rojos en 6 archivos ajenos. Descubriendo las carpetas, una
// ampliacion que `dev` mergee mientras esta rama esta abierta ENTRA en la reconstruccion, la
// comparacion falla y obliga a actualizar la lista ANTES del PR.

const ROOT = process.cwd();
const MIGRACIONES = path.join(ROOT, "db", "migrations");
const DIR_ESTA = "20260919120000_historial_accion_conciliacion_bodega";

const upSql = fs.readFileSync(path.join(MIGRACIONES, DIR_ESTA, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(MIGRACIONES, DIR_ESTA, "down.sql"), "utf8");

const VALOR_CONCILIADO = "cierre_bodega_conciliado";
const VALOR_REVERTIDA = "cierre_bodega_conciliacion_revertida";
const VALORES_NUEVOS = [VALOR_CONCILIADO, VALOR_REVERTIDA] as const;

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

/** La carpeta que CREA `historial_accion_tipo` desde cero. Se descubre, no se escribe. */
function carpetaDelOrigen(): string {
  const encontrada = carpetasDeMigracion().find((dir) =>
    /CREATE TYPE "historial_accion_tipo" AS ENUM/.test(soloEjecutable(migrationSqlDe(dir))),
  );
  if (encontrada === undefined) {
    throw new Error(
      "no se encontro ninguna migracion que CREE `historial_accion_tipo`: la reconstruccion del " +
        "estado previo mediria sobre una historia inventada",
    );
  }
  return encontrada;
}

function carpetasQueAmplian(): string[] {
  const origen = carpetaDelOrigen();
  return carpetasDeMigracion().filter(
    (dir) =>
      dir > origen &&
      dir < DIR_ESTA &&
      /ALTER TYPE "historial_accion_(?:tipo|entidad)"\s+ADD VALUE/.test(
        soloEjecutable(migrationSqlDe(dir)),
      ),
  );
}

function ampliacionesDe(dir: string): string[] {
  const sql = soloEjecutable(migrationSqlDe(dir));
  const patron = /ALTER TYPE "historial_accion_(?:tipo|entidad)"\s+ADD VALUE[^;]*/g;
  return sql.match(patron) ?? [];
}

/**
 * Cualifica los nombres de tipo y de tabla al esquema desechable.
 *
 * ⚠️ EL TARGET DE `RENAME TO` NO SE CUALIFICA: Postgres lo rechaza (el tipo renombrado se queda en
 * SU esquema). Se protege con un centinela antes de sustituir y se restaura despues.
 */
const NOMBRES = [
  "historial_accion_entidad_old",
  "historial_accion_tipo_old",
  "historial_accion_entidad",
  "historial_accion_tipo",
  "historial_accion",
] as const;

function cualificar(sql: string, esquema: string): string {
  let salida = sql
    .replaceAll('RENAME TO "historial_accion_tipo_old"', 'RENAME TO "@@T_OLD@@"')
    .replaceAll('RENAME TO "historial_accion_entidad_old"', 'RENAME TO "@@E_OLD@@"');
  for (const nombre of NOMBRES) {
    salida = salida.replaceAll(`"${nombre}"`, `"${esquema}"."${nombre}"`);
  }
  return salida
    .replaceAll('"@@T_OLD@@"', '"historial_accion_tipo_old"')
    .replaceAll('"@@E_OLD@@"', '"historial_accion_entidad_old"');
}

async function aplicar(admin: PrismaClient, sql: string, esquema: string): Promise<void> {
  for (const stmt of sentencias(cualificar(sql, esquema))) {
    await admin.$executeRawUnsafe(stmt);
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

/**
 * Levanta el estado PREVIO a esta ficha ejecutando las migraciones REALES anteriores.
 *
 * NO se copia nada del `down.sql` que este archivo esta probando: si se copiara, la comparacion
 * del bloque (b) seria circular y una lista mal escrita pasaria en verde.
 */
async function crearEstadoPrevio(admin: PrismaClient, esquema: string): Promise<void> {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
  const origen = path.join(MIGRACIONES, carpetaDelOrigen(), "migration.sql");
  await admin.$executeRawUnsafe(cualificar(createTypeDe(origen, "historial_accion_tipo"), esquema));
  await admin.$executeRawUnsafe(
    cualificar(createTypeDe(origen, "historial_accion_entidad"), esquema),
  );
  for (const dir of carpetasQueAmplian()) {
    for (const stmt of ampliacionesDe(dir)) {
      await admin.$executeRawUnsafe(cualificar(stmt, esquema));
    }
  }
  await admin.$executeRawUnsafe(
    `CREATE TABLE "${esquema}"."historial_accion" (
       "id" TEXT PRIMARY KEY,
       "accion" "${esquema}"."historial_accion_tipo" NOT NULL,
       "entidad_tipo" "${esquema}"."historial_accion_entidad" NOT NULL,
       "valor_anterior" VARCHAR(60),
       "valor_nuevo" VARCHAR(60))`,
  );
}

// ---------------------------------------------------------------------------------------------
// Estatico: corre SIEMPRE, tambien sin base.
// ---------------------------------------------------------------------------------------------

describe("431/T1 — migracion de la conciliacion de bodega: forma en disco", () => {
  it("trae migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(MIGRACIONES, DIR_ESTA, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(MIGRACIONES, DIR_ESTA, "down.sql"))).toBe(true);
  });

  it("el up añade LOS DOS valores, y a `historial_accion_tipo`", () => {
    const ejecutable = soloEjecutable(upSql);
    expect(sentencias(upSql)).toHaveLength(2);
    for (const valor of VALORES_NUEVOS) expect(ejecutable).toContain(`'${valor}'`);
    expect(ejecutable).toMatch(/ALTER TYPE "historial_accion_tipo" ADD VALUE/);
    // NO amplia el enum de entidades: `cierre_bodega` ya estaba entre los 17 originales de la 362
    // (la usan `cierre_bodega_aprobado` y `cierre_bodega_rechazado`).
    expect(ejecutable).not.toMatch(/historial_accion_entidad/);
  });

  it("⭑ son DOS valores y no uno: la guardia del censo mide POR METODO", () => {
    // No es cosmetica: con UN solo tipo, `marcarConciliado` y `revertirConciliacion` cabrian en un
    // metodo con un booleano, y borrar uno de los dos `appendAccion` dejaria la guardia del censo
    // VERDE. Medido dos veces en este repo (fichas 376 y 380).
    expect(new Set(VALORES_NUEVOS).size).toBe(2);
    expect(HISTORIAL_ACCION_TIPOS).toContain(VALOR_CONCILIADO);
    expect(HISTORIAL_ACCION_TIPOS).toContain(VALOR_REVERTIDA);
  });

  it("el up es ADITIVO: ni tablas, ni columnas, ni indices, ni datos", () => {
    // Un backfill o un `CREATE TABLE` aqui dentro reventaria con 55P04 o dejaria el `down` cojo. El
    // backfill de datos que SI lleva la ficha (R30) vive en la migracion hermana
    // `20260919120100_cierre_bodega_conciliacion`, que no toca este enum.
    const ejecutable = soloEjecutable(upSql);
    expect(ejecutable).not.toMatch(/CREATE TABLE|ALTER TABLE|CREATE INDEX/i);
    expect(ejecutable).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it("el down NO nombra los valores nuevos, que es justo lo que viene a quitar", () => {
    for (const valor of VALORES_NUEVOS) {
      expect(soloEjecutable(downSql)).not.toContain(`'${valor}'`);
    }
  });

  it("el down recastea SOLO la columna `accion` y no toca `entidad_tipo`", () => {
    const ejecutable = soloEjecutable(downSql);
    expect(ejecutable).toMatch(/ALTER COLUMN "accion" TYPE "historial_accion_tipo"/);
    expect(ejecutable).not.toMatch(/ALTER COLUMN "entidad_tipo"/);
  });

  it("⭑ el down lleva ESCRITO el aviso de que su lista es una FOTO que caduca", () => {
    // No es decoracion: es la unica defensa de quien lo corra a mano desde una rama vieja. Si
    // alguien recorta este archivo, el aviso se va con el.
    expect(downSql).toMatch(/FOTO DEL 2026-09-16/);
    expect(downSql).toMatch(/pg_enum/); // la consulta con la que medir el catalogo de HOY
  });

  it("⭑ el descubrimiento de la historia encuentra algo (anti-vacuidad del propio mecanismo)", () => {
    // Corre SIN base: si el descubrimiento devolviera vacio, el bloque (b) reconstruiria un enum
    // de origen sin ninguna ampliacion y compararia contra una historia inventada, EN VERDE.
    const origen = carpetaDelOrigen();
    const amplian = carpetasQueAmplian();
    expect(origen).toMatch(/historial_accion/);
    expect(
      amplian.length,
      "ninguna migracion intermedia amplia el enum: imposible",
    ).toBeGreaterThan(5);
    for (const dir of amplian) {
      expect(dir > origen && dir < DIR_ESTA, `${dir} fuera de la ventana`).toBe(true);
      expect(ampliacionesDe(dir).length, `${dir} sin ADD VALUE`).toBeGreaterThan(0);
    }
    // Y ESTA carpeta NO se cuenta a si misma: si lo hiciera, el «estado previo» ya traeria el
    // valor nuevo y el bloque (b) compararia el down contra si mismo.
    expect(amplian).not.toContain(DIR_ESTA);
  });
});

// ---------------------------------------------------------------------------------------------
// (a) La base viva contra el catalogo cerrado.
// ---------------------------------------------------------------------------------------------

describe.skipIf(!HAY_BASE_DE_DATOS)("431/T1 (a) — el enum de la base ES el catalogo", () => {
  let admin: PrismaClient;

  beforeAll(() => {
    admin = crearPrismaDeTest();
  });

  afterAll(async () => {
    await admin?.$disconnect();
  });

  it("`historial_accion_tipo` de `public` tiene exactamente los tipos del catalogo", async () => {
    const enLaBase = await valoresDeEnum(admin, "public", "historial_accion_tipo");
    expect(enLaBase.length).toBeGreaterThan(0); // anti-vacuidad
    expect([...enLaBase].sort()).toEqual([...HISTORIAL_ACCION_TIPOS].sort());
    for (const valor of VALORES_NUEVOS) expect(enLaBase).toContain(valor);
    // ⚠️ EL CONTEO SE COMPARA CONTRA EL CATALOGO, NO CONTRA UN NUMERO CONGELADO. El numero duro
    // vive en su sitio: la guardia de escrituras cubiertas, que ademas obliga a censar el
    // productor del tipo nuevo.
    expect(enLaBase).toHaveLength(HISTORIAL_ACCION_TIPOS.length);
  });

  it("los dos valores van DESPUES del de la 429, y EN SU ORDEN: `ADD VALUE` apende", async () => {
    // Es de donde sale la lista previa del `down.sql` de la SIGUIENTE ficha que amplie el enum.
    const enLaBase = await valoresDeEnum(admin, "public", "historial_accion_tipo");
    expect(enLaBase.indexOf(VALOR_CONCILIADO)).toBeGreaterThan(
      enLaBase.indexOf("zona_sinpe_cambiado"),
    );
    // Y el segundo despues del primero: se añadieron en ese orden, en dos sentencias.
    expect(enLaBase.indexOf(VALOR_REVERTIDA)).toBeGreaterThan(enLaBase.indexOf(VALOR_CONCILIADO));
  });

  it("la 431 NO amplio el enum de entidades: `cierre_bodega` ya estaba", async () => {
    const entidades = await valoresDeEnum(admin, "public", "historial_accion_entidad");
    expect(entidades).toContain("cierre_bodega");
    expect(entidades).toHaveLength(HISTORIAL_ACCION_ENTIDADES.length);
    expect(entidades).toEqual(expect.arrayContaining([...HISTORIAL_ACCION_ENTIDADES]));
  });
});

// ---------------------------------------------------------------------------------------------
// (b) El down devuelve EXACTAMENTE la lista previa. Se mide comparando, no leyendo.
// ---------------------------------------------------------------------------------------------

describe.skipIf(!HAY_BASE_DE_DATOS)("431/T1 (b) — el down recrea la lista PREVIA de 53", () => {
  const esquema = `t_431_enum_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let admin: PrismaClient;
  let tiposAntes: string[] = [];
  let entidadesAntes: string[] = [];
  let tiposTrasUp: string[] = [];
  let tiposTrasDown: string[] = [];
  let entidadesTrasDown: string[] = [];

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await crearEstadoPrevio(admin, esquema);
    tiposAntes = await valoresDeEnum(admin, esquema, "historial_accion_tipo");
    entidadesAntes = await valoresDeEnum(admin, esquema, "historial_accion_entidad");
    await aplicar(admin, upSql, esquema);
    tiposTrasUp = await valoresDeEnum(admin, esquema, "historial_accion_tipo");
    await aplicar(admin, downSql, esquema);
    tiposTrasDown = await valoresDeEnum(admin, esquema, "historial_accion_tipo");
    entidadesTrasDown = await valoresDeEnum(admin, esquema, "historial_accion_entidad");
  }, 120_000);

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  it("el estado PREVIO reconstruido son 53 tipos y 21 entidades", () => {
    // Numeros DUROS: si las migraciones anteriores dejaran otra cosa, todo lo de abajo mediria
    // sobre una historia inventada.
    expect(tiposAntes).toHaveLength(53);
    expect(entidadesAntes).toHaveLength(21);
    expect(tiposAntes.at(-1)).toBe("zona_sinpe_cambiado"); // el ultimo antes de esta ficha (429)
    expect(entidadesAntes).toContain("cierre_bodega");
  });

  it("⭑ el estado previo reconstruido ES el catalogo de HOY menos este valor y los posteriores", () => {
    // El cierre del circulo: si el catalogo de TypeScript y las migraciones discreparan, no hay
    // forma de que esto y el caso de (a) cuadren a la vez por casualidad.
    //
    // ⚠️ CADA FICHA QUE AMPLIE EL ENUM DESPUES DE ESTA ENTRA AQUI, en orden de migracion. Es lo que
    // convierte la comparacion en una cadena verificable en vez de en algo que caduca en silencio.
    const POSTERIORES: string[] = [
      // ficha 459 (2026-09-25): el pago por cuenta de una tienda y el saldo inicial o aporte de
      // capital, registrar y anular cada uno (la guardia del censo mide por metodo). Su archivo:
      // `caja-459-migration.test.ts`.
      "pago_por_cuenta_tienda_registrado",
      "pago_por_cuenta_tienda_anulado",
      "aporte_capital_registrado",
      "aporte_capital_anulado",
      // Ficha 461 (2026-09-25): la anulacion del cobro de Ordenex a una tienda (migracion 1 de la
      // 461) y la anulacion de una correccion de caja (migracion 4, auditoria D3).
      "cobro_tienda_anulado",
      "wallet_movimiento_manual_anulado",
      // Ficha 457 (2026-09-25): el pago de una tienda a Ordenex, registrar y anular (la guardia del censo
      // mide por metodo). Su archivo: `abono-tienda-457-migration.test.ts`.
      "abono_tienda_registrado",
      "abono_tienda_anulado",
      // Ficha 458-B (2026-09-26): la anulacion del cobro por rechazo aprobado (D7) y la de un egreso de
      // caja (D13). Su migracion: `20260928120000_wallet_458_enums`.
      "cobro_rechazo_tienda_anulado",
      "egreso_caja_anulado",
    ];
    const catalogoPrevio = HISTORIAL_ACCION_TIPOS.filter(
      (t) => !VALORES_NUEVOS.includes(t as (typeof VALORES_NUEVOS)[number]) &&
        !POSTERIORES.includes(t),
    );
    expect([...tiposAntes].sort()).toEqual([...catalogoPrevio].sort());
  });

  it("el up deja 55 tipos, con los DOS nuevos AL FINAL (`ADD VALUE` apende)", () => {
    expect(tiposTrasUp).toHaveLength(55);
    expect(tiposTrasUp.slice(-2)).toEqual([VALOR_CONCILIADO, VALOR_REVERTIDA]);
  });

  it("⭑ el down devuelve el enum a la lista previa, valor a valor y EN ORDEN", () => {
    // La comparacion es contra el estado medido ANTES del up —reconstruido con las migraciones
    // REALES, descubiertas leyendo el disco—, no contra una lista escrita a mano: si el `down.sql`
    // copiara la lista equivocada, esto se pone rojo diciendo cual falta.
    expect(tiposTrasDown).toEqual(tiposAntes);
  });

  it("el down deja `historial_accion_entidad` intacto: no era suyo", () => {
    expect(entidadesTrasDown).toEqual(entidadesAntes);
  });
});

// ---------------------------------------------------------------------------------------------
// (c) La precondicion ruidosa: con una fila que use el valor nuevo, el rollback ABORTA.
// ---------------------------------------------------------------------------------------------

describe.skipIf(!HAY_BASE_DE_DATOS)(
  "431/T1 (c) — el down aborta si queda rastro de una conciliacion",
  () => {
    const esquema = `t_431_enum2_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    let admin: PrismaClient;

    beforeAll(async () => {
      admin = crearPrismaDeTest();
      await crearEstadoPrevio(admin, esquema);
      await aplicar(admin, upSql, esquema);
      // DOS filas, una por tipo nuevo: si el `down` solo tropezara con una de ellas, este bloque
      // pasaria en verde con la mitad del rastro perdiendose en silencio.
      await admin.$executeRawUnsafe(
        `INSERT INTO "${esquema}"."historial_accion"
         ("id","accion","entidad_tipo","valor_anterior","valor_nuevo")
       VALUES ('h1','${VALOR_CONCILIADO}','cierre_bodega',NULL,NULL),
              ('h2','${VALOR_REVERTIDA}','cierre_bodega',NULL,NULL)`,
      );
    }, 120_000);

    afterAll(async () => {
      await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
      await admin?.$disconnect();
    });

    it("las dos filas con los valores nuevos estan escritas (anti-vacuidad)", async () => {
      const [fila] = await admin.$queryRawUnsafe<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM "${esquema}"."historial_accion"
        WHERE "accion" IN ('${VALOR_CONCILIADO}','${VALOR_REVERTIDA}')`,
      );
      expect(fila.n).toBe(2);
    });

    it("el rollback FALLA ruidosamente y NO borra ni reescribe esas filas", async () => {
      await expect(aplicar(admin, downSql, esquema)).rejects.toThrow();
      // Y las dos filas siguen ahi. Son lo unico que dice quien afirmo que el bulto de efectivo de
      // una bodega llego a la central, por cuanto y cuando — el UNICO rastro, porque revertir la
      // marca VACIA las cuatro columnas de `cierre_bodega`.
      const filas = await admin.$queryRawUnsafe<{ accion: string }[]>(
        `SELECT "accion"::text AS accion FROM "${esquema}"."historial_accion" ORDER BY "id"`,
      );
      expect(filas.map((f) => f.accion)).toEqual([VALOR_CONCILIADO, VALOR_REVERTIDA]);
    });
  },
);
