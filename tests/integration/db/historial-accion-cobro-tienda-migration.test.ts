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
// ⭑ FICHA 381 / T B.7 — la mitad de HISTORIAL de
// `20260908140100_wallet_tienda_check_cobro_manual`: `cobro_tienda_registrado` en
// `historial_accion_tipo` y `wallet_tienda_movimiento` en `historial_accion_entidad`.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Molde: `historial-accion-zona-pago-mensajero-migration.test.ts` (ficha 380). LO QUE MIDE:
//   (estatico) el `up` amplia LOS DOS enums con un `ADD VALUE` cada uno y nada mas; el `down` NO
//       nombra ninguno de los dos valores nuevos y recastea LAS DOS columnas;
//   (a) los dos enums de `public` coinciden EXACTAMENTE con el catalogo cerrado de
//       `lib/types/historial-accion.ts` —el `satisfies` compara contra el cliente GENERADO, no
//       contra la base viva, asi que un `prisma generate` rancio lo dejaria pasar— y cada valor
//       nuevo va AL FINAL;
//   (b) el `down` recrea las listas PREVIAS (50 tipos y 20 entidades), medido COMPARANDO el estado
//       de antes del up con el de despues del down, no leyendo el archivo;
//   (c) con UNA fila que use los valores nuevos, el rollback FALLA ruidosamente y NO la borra.
//
// ⚠️ LAS CARPETAS DEL ESTADO PREVIO SE DESCUBREN LEYENDO `db/migrations`. Si `dev` mergea una
// ampliacion nueva mientras esta rama esta abierta, aparece SOLA en la reconstruccion y el bloque
// (b) se pone rojo diciendo que valor le falta al `down.sql`. Con carpetas escritas a mano, este
// archivo no se enteraria — y ese es exactamente el fallo que el 2026-09-07 borro
// `zona_central_cambiada` de la base local sin un solo error de Postgres.

const ROOT = process.cwd();
const MIGRACIONES = path.join(ROOT, "db", "migrations");
const DIR_ESTA = "20260908140100_wallet_tienda_check_cobro_manual";

const upSql = fs.readFileSync(path.join(MIGRACIONES, DIR_ESTA, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(MIGRACIONES, DIR_ESTA, "down.sql"), "utf8");

const TIPO_NUEVO = "cobro_tienda_registrado";
const ENTIDAD_NUEVA = "wallet_tienda_movimiento";

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

/**
 * Las sentencias que tocan el HISTORIAL. Las demas son el CHECK del libro de la tienda, que cubre
 * `wallet-tienda-cobro-migration.test.ts`.
 *
 * ⚠️ `historial_accion` es prefijo de sus dos enums, asi que un unico patron los cubre a los tres.
 */
function sentenciasDelHistorial(sql: string): string[] {
  return sentencias(sql).filter((s) => /historial_accion/.test(s));
}

function sentenciasAjenas(sql: string): string[] {
  return sentencias(sql).filter((s) => !/historial_accion/.test(s));
}

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

async function aplicar(
  admin: PrismaClient,
  sentenciasSql: string[],
  esquema: string,
): Promise<void> {
  for (const stmt of sentenciasSql) {
    await admin.$executeRawUnsafe(cualificar(stmt, esquema));
  }
}

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
       "monto" DECIMAL(12,2),
       "valor_anterior" VARCHAR(60),
       "valor_nuevo" VARCHAR(60))`,
  );
}

// ---------------------------------------------------------------------------------------------
// Estatico: corre SIEMPRE, tambien sin base.
// ---------------------------------------------------------------------------------------------

describe("381/B.7 — la migracion del historial: forma en disco", () => {
  it("trae migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(MIGRACIONES, DIR_ESTA, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(MIGRACIONES, DIR_ESTA, "down.sql"))).toBe(true);
  });

  it("el up amplia LOS DOS enums, con un `ADD VALUE` cada uno", () => {
    const delHistorial = sentenciasDelHistorial(upSql);
    expect(delHistorial).toHaveLength(2);
    expect(delHistorial.join("\n")).toMatch(
      new RegExp(`ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS '${TIPO_NUEVO}'`),
    );
    expect(delHistorial.join("\n")).toMatch(
      new RegExp(
        `ALTER TYPE "historial_accion_entidad" ADD VALUE IF NOT EXISTS '${ENTIDAD_NUEVA}'`,
      ),
    );
  });

  it("el up es ADITIVO en el historial: ni tablas, ni columnas, ni indices, ni datos", () => {
    // Un backfill o un `CREATE TABLE` aqui reventaria con 55P04 o dejaria el `down` cojo. Y no hay
    // backfill posible: ningun cobro manual existe todavia, esta ficha es la que los crea.
    const delHistorial = sentenciasDelHistorial(upSql).join("\n");
    expect(delHistorial).not.toMatch(/CREATE TABLE|CREATE INDEX/i);
    expect(delHistorial).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it("el down NO nombra ninguno de los dos valores nuevos: es lo que viene a quitar", () => {
    const delHistorial = sentenciasDelHistorial(downSql).join("\n");
    expect(delHistorial).not.toContain(`'${TIPO_NUEVO}'`);
    expect(delHistorial).not.toContain(`'${ENTIDAD_NUEVA}'`);
  });

  it("el down recastea LAS DOS columnas: la del tipo y la de la entidad", () => {
    const ejecutable = soloEjecutable(downSql);
    expect(ejecutable).toMatch(/ALTER COLUMN "accion"\s+TYPE "historial_accion_tipo"/);
    expect(ejecutable).toMatch(/ALTER COLUMN "entidad_tipo"\s+TYPE "historial_accion_entidad"/);
    // Y suelta los dos tipos viejos: dejarse uno con una columna dependiente aborta el rollback a
    // mitad (esta escrito en `20260730130000_orden_incidente/down.sql`).
    expect(ejecutable).toContain('DROP TYPE "historial_accion_tipo_old"');
    expect(ejecutable).toContain('DROP TYPE "historial_accion_entidad_old"');
  });

  it("⭑ el down lleva ESCRITO el aviso de que sus listas son una FOTO que caduca", () => {
    // No es decoracion: es la unica defensa de quien lo corra a mano desde una rama vieja. Y esta
    // ficha nace justo despues de que la 380 ampliara este mismo enum.
    expect(downSql).toMatch(/FOTO DEL 2026-09-08/);
    expect(downSql).toMatch(/pg_enum/); // las consultas con las que medir los catalogos de HOY
    expect(downSql).toMatch(/PRECONDICION RUIDOSA/);
    expect(downSql).toMatch(/zona_pago_mensajero_cambiado/); // el ultimo valor de la foto
  });

  it("el filtro «sentencias del historial» no se salta nada: lo demas es SOLO del ledger", () => {
    for (const [nombre, sql] of [["up", upSql], ["down", downSql]] as const) {
      expect(sentenciasDelHistorial(sql).length, nombre).toBeGreaterThan(0);
      for (const ajena of sentenciasAjenas(sql)) {
        expect(ajena, `${nombre}: sentencia que no es ni del historial ni del ledger`).toMatch(
          /wallet_tienda_movimiento/,
        );
      }
    }
  });

  it("⭑ el descubrimiento de la historia encuentra algo (anti-vacuidad del mecanismo)", () => {
    const origen = carpetaDelOrigen();
    const amplian = carpetasQueAmplian();
    expect(origen).toMatch(/historial_accion/);
    expect(
      amplian.length,
      "ninguna migracion intermedia amplia el enum: imposible",
    ).toBeGreaterThan(3);
    for (const dir of amplian) {
      expect(dir > origen && dir < DIR_ESTA, `${dir} fuera de la ventana`).toBe(true);
      expect(ampliacionesDe(dir).length, `${dir} sin ADD VALUE`).toBeGreaterThan(0);
    }
    // ⭑ La de la 380 TIENE que estar: se mergeo unas horas antes que esta y su valor es el ultimo
    // de la foto del `down.sql`. Si el descubrimiento la perdiera, el bloque (b) mediria de menos.
    expect(amplian.some((d) => d.includes("zona_pago_mensajero"))).toBe(true);
    // Y ESTA carpeta NO se cuenta a si misma.
    expect(amplian).not.toContain(DIR_ESTA);
  });
});

// ---------------------------------------------------------------------------------------------
// (a) La base viva contra el catalogo cerrado.
// ---------------------------------------------------------------------------------------------

describe.skipIf(!HAY_BASE_DE_DATOS)("381/B.7 (a) — los enums de la base SON el catalogo", () => {
  let admin: PrismaClient;

  beforeAll(() => {
    admin = crearPrismaDeTest();
  });

  afterAll(async () => {
    await admin?.$disconnect();
  });

  it("`historial_accion_tipo` de `public` tiene exactamente los del catalogo", async () => {
    const enLaBase = await valoresDeEnum(admin, "public", "historial_accion_tipo");
    expect(enLaBase.length).toBeGreaterThan(0); // anti-vacuidad
    expect([...enLaBase].sort()).toEqual([...HISTORIAL_ACCION_TIPOS].sort());
    expect(enLaBase).toContain(TIPO_NUEVO);
    // El conteo se compara contra el CATALOGO, no contra un numero congelado: el numero duro vive
    // en su sitio (la guardia de escrituras cubiertas, que ademas obliga a censar el productor).
    expect(enLaBase).toHaveLength(HISTORIAL_ACCION_TIPOS.length);
  });

  it("`historial_accion_entidad` de `public` tambien, y gana `wallet_tienda_movimiento`", async () => {
    const enLaBase = await valoresDeEnum(admin, "public", "historial_accion_entidad");
    expect([...enLaBase].sort()).toEqual([...HISTORIAL_ACCION_ENTIDADES].sort());
    expect(enLaBase).toContain(ENTIDAD_NUEVA);
    expect(enLaBase).toHaveLength(HISTORIAL_ACCION_ENTIDADES.length);
  });

  it("los dos valores nuevos van AL FINAL: `ADD VALUE` sin BEFORE/AFTER apende", async () => {
    // Es de donde saldran las listas previas del `down.sql` de la SIGUIENTE ficha que los amplie.
    const tipos = await valoresDeEnum(admin, "public", "historial_accion_tipo");
    expect(tipos.indexOf(TIPO_NUEVO)).toBeGreaterThan(tipos.indexOf("zona_pago_mensajero_cambiado"));
    // ⏳ 2026-09-08 (ficha 398): YA NO ES EL ULTIMO, y esa es la señal que este caso existe para
    // dar. `cierre_dia_gestion_corregida` se apendio DESPUES, y al hacerlo tuvo que pasar por
    // aqui. Se afirma la POSICION RELATIVA —que es el invariante real, «`ADD VALUE` APENDE»— en
    // vez de «es el ultimo», que caduca con cada ficha nueva. La afirmacion es MAS estrecha, no
    // menos: inmediatamente antes del siguiente. Mismo cambio que la 380 hizo cuando la 381 la
    // desplazo.
    expect(tipos.indexOf("cierre_dia_gestion_corregida")).toBe(tipos.indexOf(TIPO_NUEVO) + 1);
    const entidades = await valoresDeEnum(admin, "public", "historial_accion_entidad");
    expect(entidades.indexOf(ENTIDAD_NUEVA)).toBeGreaterThan(entidades.indexOf("distrito"));
    expect(entidades.at(-1)).toBe(ENTIDAD_NUEVA);
  });
});

// ---------------------------------------------------------------------------------------------
// (b) El down devuelve EXACTAMENTE las listas previas. Se mide comparando, no leyendo.
// ---------------------------------------------------------------------------------------------

describe.skipIf(!HAY_BASE_DE_DATOS)("381/B.7 (b) — el down recrea 50 tipos y 20 entidades", () => {
  const esquema = `t_381_hist_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let admin: PrismaClient;
  let tiposAntes: string[] = [];
  let entidadesAntes: string[] = [];
  let tiposTrasUp: string[] = [];
  let entidadesTrasUp: string[] = [];
  let tiposTrasDown: string[] = [];
  let entidadesTrasDown: string[] = [];

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await crearEstadoPrevio(admin, esquema);
    tiposAntes = await valoresDeEnum(admin, esquema, "historial_accion_tipo");
    entidadesAntes = await valoresDeEnum(admin, esquema, "historial_accion_entidad");
    await aplicar(admin, sentenciasDelHistorial(upSql), esquema);
    tiposTrasUp = await valoresDeEnum(admin, esquema, "historial_accion_tipo");
    entidadesTrasUp = await valoresDeEnum(admin, esquema, "historial_accion_entidad");
    await aplicar(admin, sentenciasDelHistorial(downSql), esquema);
    tiposTrasDown = await valoresDeEnum(admin, esquema, "historial_accion_tipo");
    entidadesTrasDown = await valoresDeEnum(admin, esquema, "historial_accion_entidad");
  }, 180_000);

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  it("el estado PREVIO reconstruido son 50 tipos y 20 entidades", () => {
    // Numeros DUROS: si las migraciones anteriores dejaran otra cosa, todo lo de abajo mediria
    // sobre una historia inventada.
    expect(tiposAntes).toHaveLength(50);
    expect(entidadesAntes).toHaveLength(20);
    expect(tiposAntes.at(-1)).toBe("zona_pago_mensajero_cambiado"); // el de la 380
    expect(entidadesAntes.at(-1)).toBe("distrito"); // el ultimo de la 374
  });

  it("⭑ el estado previo reconstruido ES el catalogo de HOY menos los dos valores nuevos", () => {
    // El cierre del circulo: si el catalogo de TypeScript y las migraciones discreparan, no hay
    // forma de que esto y el caso de arriba cuadren a la vez por casualidad.
    // ⚠️ CADA FICHA QUE AMPLIE EL ENUM DESPUES DE ESTA ENTRA AQUI, en orden de migracion. Es lo
    // que convierte la comparacion en una cadena verificable —«el catalogo de hoy menos la 381
    // menos la 398»— en vez de en algo que caduca en silencio. Cada una tiene ademas su archivo:
    //   · 398 — `cierre_dia_gestion_corregida`, en `correccion-resultado-gestion-migration.test.ts`.
    const POSTERIORES = ["cierre_dia_gestion_corregida"];
    expect([...tiposAntes].sort()).toEqual(
      [...HISTORIAL_ACCION_TIPOS]
        .filter((t) => t !== TIPO_NUEVO && !POSTERIORES.includes(t))
        .sort(),
    );
    expect([...entidadesAntes].sort()).toEqual(
      [...HISTORIAL_ACCION_ENTIDADES].filter((e) => e !== ENTIDAD_NUEVA).sort(),
    );
  });

  it("el up deja 51 tipos y 21 entidades, con los nuevos AL FINAL", () => {
    expect(tiposTrasUp).toHaveLength(51);
    expect(tiposTrasUp.at(-1)).toBe(TIPO_NUEVO);
    expect(entidadesTrasUp).toHaveLength(21);
    expect(entidadesTrasUp.at(-1)).toBe(ENTIDAD_NUEVA);
  });

  it("⭑ el down devuelve LOS DOS enums a su lista previa, valor a valor y EN ORDEN", () => {
    // La comparacion es contra el estado medido ANTES del up —reconstruido con las migraciones
    // REALES, descubiertas leyendo el disco—, no contra una lista escrita a mano: si el `down.sql`
    // copiara la lista equivocada, esto se pone rojo diciendo cual falta.
    expect(tiposTrasDown).toEqual(tiposAntes);
    expect(entidadesTrasDown).toEqual(entidadesAntes);
  });
});

// ---------------------------------------------------------------------------------------------
// (c) La precondicion ruidosa: con una fila que use los valores nuevos, el rollback ABORTA.
// ---------------------------------------------------------------------------------------------

describe.skipIf(!HAY_BASE_DE_DATOS)(
  "381/B.7 (c) — el down aborta si queda el rastro de un cobro",
  () => {
    const esquema = `t_381_hist2_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    let admin: PrismaClient;

    beforeAll(async () => {
      admin = crearPrismaDeTest();
      await crearEstadoPrevio(admin, esquema);
      await aplicar(admin, sentenciasDelHistorial(upSql), esquema);
      // ⚠️ `valor_anterior`/`valor_nuevo` van NULL y `monto` lleva el importe cobrado: es la forma
      // exacta de la fila que escribe `registrarCobroEnHistorial`.
      await admin.$executeRawUnsafe(
        `INSERT INTO "${esquema}"."historial_accion"
           ("id","accion","entidad_tipo","monto","valor_anterior","valor_nuevo")
         VALUES ('h1','${TIPO_NUEVO}','${ENTIDAD_NUEVA}',1500.00,NULL,NULL)`,
      );
    }, 180_000);

    afterAll(async () => {
      await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
      await admin?.$disconnect();
    });

    it("la fila con los valores nuevos esta escrita (anti-vacuidad)", async () => {
      const [fila] = await admin.$queryRawUnsafe<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM "${esquema}"."historial_accion"
          WHERE "accion" = '${TIPO_NUEVO}' AND "entidad_tipo" = '${ENTIDAD_NUEVA}'`,
      );
      expect(fila.n).toBe(1);
    });

    it("el rollback FALLA ruidosamente y NO borra ni reescribe esa fila", async () => {
      await expect(aplicar(admin, sentenciasDelHistorial(downSql), esquema)).rejects.toThrow();
      // Y la fila sigue ahi, con su importe. Es lo unico que dice quien le cobro a una tienda,
      // cuanto y cuando.
      const [fila] = await admin.$queryRawUnsafe<
        { n: number; accion: string; entidad: string; monto: string }[]
      >(
        `SELECT COUNT(*)::int AS n, MIN("accion"::text) AS accion,
                MIN("entidad_tipo"::text) AS entidad, MIN("monto")::text AS monto
           FROM "${esquema}"."historial_accion"`,
      );
      expect(fila.n).toBe(1);
      expect(fila.accion).toBe(TIPO_NUEVO);
      expect(fila.entidad).toBe(ENTIDAD_NUEVA);
      expect(fila.monto).toBe("1500.00");
    });
  },
);
