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
// ⭑ FICHA 380 / T3 — cobertura de `20260908120000_historial_accion_zona_pago_mensajero`.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// LAS CUATRO COSAS QUE MIDE:
//   (estatico) el `up` es UNA sola sentencia `ADD VALUE`, aditiva, y no nombra el enum de
//       entidades; el `down` NO nombra el valor nuevo y solo recastea `accion` (R14);
//   (a) el enum de `public` coincide EXACTAMENTE con el catalogo cerrado de
//       `lib/types/historial-accion.ts` —el `satisfies` de TypeScript compara contra el cliente
//       GENERADO, no contra la base viva, asi que un `prisma generate` rancio lo dejaria pasar—,
//       y el valor nuevo va DESPUES de `zona_central_cambiada` (R13);
//   (b) el `down.sql` recrea la lista PREVIA (49 tipos) — medido COMPARANDO el estado de antes del
//       up con el de despues del down, no leyendo el archivo (R15);
//   (c) con UNA fila que use el valor nuevo, el rollback FALLA ruidosamente y NO borra esa fila
//       (R16).
//
// ⚠️ LA MEJORA OBLIGATORIA RESPECTO DE `historial-accion-zona-central-migration.test.ts`: LAS
// CARPETAS DEL ESTADO PREVIO SE DESCUBREN LEYENDO `db/migrations`, no se escriben como constantes
// (`DIR_374`, `DIR_375`…).
//
// Por que, y esta MEDIDO en este repo el 2026-09-07: un `down.sql` de enum recrea el tipo con la
// lista COMPLETA, y esa lista es una FOTO del momento en que se escribio. El `down.sql` de una
// rama ramificada antes del merge de la 376 BORRO `zona_central_cambiada` de la base local sin un
// solo error; el sintoma fueron 7 tests rojos en 6 archivos ajenos. Con las carpetas escritas a
// mano, este archivo NO se enteraria: si `dev` trae una ampliacion nueva mientras esta rama esta
// abierta, la reconstruccion la ignoraria y el bloque (b) seguiria verde con un `down.sql` rancio.
// Descubriendolas, la ampliacion ajena ENTRA en la reconstruccion, la comparacion falla y obliga a
// actualizar la lista ANTES del PR. La diferencia entre un test que caduca en el merge y uno que
// se entera.
//
// Y una asercion mas que cierra el circulo: la lista previa reconstruida DEBE ser exactamente
// `HISTORIAL_ACCION_TIPOS` menos el valor nuevo. Si el catalogo de TypeScript y las migraciones
// discreparan, no hay forma de que las tres cosas cuadren por casualidad.

const ROOT = process.cwd();
const MIGRACIONES = path.join(ROOT, "db", "migrations");
const DIR_ESTA = "20260908120000_historial_accion_zona_pago_mensajero";

const upSql = fs.readFileSync(path.join(MIGRACIONES, DIR_ESTA, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(MIGRACIONES, DIR_ESTA, "down.sql"), "utf8");

const VALOR_NUEVO = "zona_pago_mensajero_cambiado";

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
// EL DESCUBRIMIENTO DE LA HISTORIA (la mejora de T3), sin una sola carpeta escrita a mano
// ---------------------------------------------------------------------------------------------

/** Las carpetas de `db/migrations`, en orden de nombre (que es el orden en que Prisma las aplica). */
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

/**
 * Las carpetas que AMPLIAN alguno de los dos enums del historial, entre el origen (excluido) y
 * ESTA (excluida), en orden.
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
      dir < DIR_ESTA &&
      /ALTER TYPE "historial_accion_(?:tipo|entidad)"\s+ADD VALUE/.test(
        soloEjecutable(migrationSqlDe(dir)),
      ),
  );
}

/** Solo los `ALTER TYPE … ADD VALUE …` de los dos enums del historial de UN archivo. */
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
 * Levanta el estado PREVIO a esta ficha ejecutando las migraciones REALES anteriores: el
 * `CREATE TYPE` del origen mas TODOS los `ADD VALUE` posteriores, DESCUBIERTOS leyendo el disco.
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

describe("380/T3 — migracion del pago al mensajero: forma en disco", () => {
  it("trae migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(MIGRACIONES, DIR_ESTA, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(MIGRACIONES, DIR_ESTA, "down.sql"))).toBe(true);
  });

  it("el up añade UN solo valor, y a `historial_accion_tipo`", () => {
    const ejecutable = soloEjecutable(upSql);
    expect(sentencias(upSql)).toHaveLength(1);
    expect(ejecutable).toContain(`'${VALOR_NUEVO}'`);
    expect(ejecutable).toMatch(/ALTER TYPE "historial_accion_tipo" ADD VALUE/);
    // R14: NO amplia el enum de entidades. `zona` ya estaba entre los 17 originales de la 362.
    expect(ejecutable).not.toMatch(/historial_accion_entidad/);
  });

  it("el up es ADITIVO: ni tablas, ni columnas, ni indices, ni datos (R14)", () => {
    // Un backfill o un `CREATE TABLE` aqui dentro reventaria con 55P04 o dejaria el `down` cojo.
    // Y no hay backfill posible: nadie registro los cambios de pago anteriores.
    const ejecutable = soloEjecutable(upSql);
    expect(ejecutable).not.toMatch(/CREATE TABLE|ALTER TABLE|CREATE INDEX/i);
    expect(ejecutable).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it("el down NO nombra el valor nuevo, que es justo lo que viene a quitar", () => {
    expect(soloEjecutable(downSql)).not.toContain(`'${VALOR_NUEVO}'`);
  });

  it("el down recastea SOLO la columna `accion` y no toca `entidad_tipo`", () => {
    const ejecutable = soloEjecutable(downSql);
    expect(ejecutable).toMatch(/ALTER COLUMN "accion" TYPE "historial_accion_tipo"/);
    expect(ejecutable).not.toMatch(/ALTER COLUMN "entidad_tipo"/);
  });

  it("⭑ el down lleva ESCRITO el aviso de que su lista es una FOTO que caduca", () => {
    // No es decoracion: es la unica defensa de quien lo corra a mano desde una rama vieja. El
    // 2026-09-07 un `down.sql` de enum borro `zona_central_cambiada` de la base local sin un solo
    // error de Postgres. Si alguien recorta este archivo, el aviso se va con el.
    expect(downSql).toMatch(/FOTO DEL 2026-09-08/);
    expect(downSql).toMatch(/pg_enum/); // la consulta con la que medir el catalogo de HOY
  });

  it("⭑ el descubrimiento de la historia encuentra algo (anti-vacuidad del propio mecanismo)", () => {
    // Corre SIN base: si el descubrimiento devolviera vacio, el bloque (b) reconstruiria un enum
    // de origen sin ninguna ampliacion y compararia contra una historia inventada, EN VERDE.
    const origen = carpetaDelOrigen();
    const amplian = carpetasQueAmplian();
    expect(origen).toMatch(/historial_accion/);
    expect(amplian.length, "ninguna migracion intermedia amplia el enum: imposible").toBeGreaterThan(
      3,
    );
    // Todas ordenan entre el origen y esta, y todas traen al menos un `ADD VALUE`.
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
// (a) La base viva contra el catalogo cerrado (R13).
// ---------------------------------------------------------------------------------------------

describe.skipIf(!HAY_BASE_DE_DATOS)("380/T3 (a) — el enum de la base ES el catalogo", () => {
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
    expect(enLaBase).toContain(VALOR_NUEVO);
    // ⚠️ EL CONTEO SE COMPARA CONTRA EL CATALOGO, NO CONTRA UN NUMERO CONGELADO. El numero duro
    // vive en su sitio: la guardia de escrituras cubiertas, que ademas obliga a censar el
    // productor del tipo nuevo.
    expect(enLaBase).toHaveLength(HISTORIAL_ACCION_TIPOS.length);
  });

  it("el valor nuevo va DESPUES del de la 376: `ADD VALUE` sin BEFORE/AFTER apende", async () => {
    // Es de donde sale la lista previa del `down.sql` de la SIGUIENTE ficha que amplie el enum.
    const enLaBase = await valoresDeEnum(admin, "public", "historial_accion_tipo");
    expect(enLaBase.indexOf(VALOR_NUEVO)).toBeGreaterThan(
      enLaBase.indexOf("zona_central_cambiada"),
    );
    // ⚠️ YA NO ES EL ULTIMO, y esa es la señal que este caso existe para dar: la ficha 381 añadio
    // `cobro_tienda_registrado` DESPUES (2026-09-08), y al hacerlo tuvo que pasar por aqui. Se
    // afirma la POSICION RELATIVA —que es el invariante real, «`ADD VALUE` APENDE»— en vez de «es
    // el ultimo», que caduca con cada ficha nueva. La afirmacion es MAS estrecha, no menos:
    // inmediatamente antes del siguiente.
    expect(enLaBase.indexOf("cobro_tienda_registrado")).toBe(enLaBase.indexOf(VALOR_NUEVO) + 1);
  });

  it("la 380 NO amplio el enum de entidades: `zona` ya estaba", async () => {
    const entidades = await valoresDeEnum(admin, "public", "historial_accion_entidad");
    expect(entidades).toContain("zona");
    // El conteo se compara contra el CATALOGO, no contra un numero congelado —el mismo criterio que
    // el caso de los tipos aqui arriba—. La ficha 381 amplio este enum con
    // `wallet_tienda_movimiento` (de 20 a 21) y la 380 sigue sin haberlo tocado.
    expect(entidades).toHaveLength(HISTORIAL_ACCION_ENTIDADES.length);
    expect(entidades).toEqual(expect.arrayContaining([...HISTORIAL_ACCION_ENTIDADES]));
  });
});

// ---------------------------------------------------------------------------------------------
// (b) El down devuelve EXACTAMENTE la lista previa. Se mide comparando, no leyendo (R15).
// ---------------------------------------------------------------------------------------------

describe.skipIf(!HAY_BASE_DE_DATOS)("380/T3 (b) — el down recrea la lista PREVIA de 49", () => {
  const esquema = `t_380_enum_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

  it("el estado PREVIO reconstruido son 49 tipos y 20 entidades", () => {
    // Numeros DUROS: si las migraciones anteriores dejaran otra cosa, todo lo de abajo mediria
    // sobre una historia inventada.
    expect(tiposAntes).toHaveLength(49);
    expect(entidadesAntes).toHaveLength(20);
    expect(tiposAntes.at(-1)).toBe("zona_central_cambiada");
    expect(entidadesAntes).toContain("zona");
  });

  it("⭑ el estado previo reconstruido ES el catalogo de HOY menos este valor y los posteriores", () => {
    // El cierre del circulo: si el catalogo de TypeScript y las migraciones discreparan, no hay
    // forma de que esto y el caso de arriba cuadren a la vez por casualidad.
    //
    // ⚠️ CADA FICHA QUE AMPLIE EL ENUM DESPUES DE ESTA ENTRA AQUI, en orden de migracion. Es lo que
    // convierte la comparacion en una cadena verificable —«el catalogo de hoy menos la 380 menos la
    // 381»— en vez de en algo que caduca en silencio. Cada una tiene ademas su propio archivo:
    //   · 381 — `cobro_tienda_registrado`, en `historial-accion-cobro-tienda-migration.test.ts`.
    const POSTERIORES = ["cobro_tienda_registrado"];
    const catalogoPrevio = HISTORIAL_ACCION_TIPOS.filter(
      (t) => t !== VALOR_NUEVO && !POSTERIORES.includes(t),
    );
    expect([...tiposAntes].sort()).toEqual([...catalogoPrevio].sort());
  });

  it("el up deja 50 tipos, con el nuevo AL FINAL (`ADD VALUE` apende)", () => {
    expect(tiposTrasUp).toHaveLength(50);
    expect(tiposTrasUp.at(-1)).toBe(VALOR_NUEVO);
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
// (c) La precondicion ruidosa: con una fila que use el valor nuevo, el rollback ABORTA (R16).
// ---------------------------------------------------------------------------------------------

describe.skipIf(!HAY_BASE_DE_DATOS)(
  "380/T3 (c) — el down aborta si queda rastro de un cambio de pago",
  () => {
    const esquema = `t_380_enum2_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    let admin: PrismaClient;

    beforeAll(async () => {
      admin = crearPrismaDeTest();
      await crearEstadoPrevio(admin, esquema);
      await aplicar(admin, upSql, esquema);
      // ⚠️ `valor_anterior`/`valor_nuevo` van a NULL, que es la firma de Q2: la fila dice QUE el
      // pago cambio, no de cuanto a cuanto.
      await admin.$executeRawUnsafe(
        `INSERT INTO "${esquema}"."historial_accion"
         ("id","accion","entidad_tipo","valor_anterior","valor_nuevo")
       VALUES ('h1','${VALOR_NUEVO}','zona',NULL,NULL)`,
      );
    }, 120_000);

    afterAll(async () => {
      await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
      await admin?.$disconnect();
    });

    it("la fila con el valor nuevo esta escrita (anti-vacuidad)", async () => {
      const [fila] = await admin.$queryRawUnsafe<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM "${esquema}"."historial_accion"
        WHERE "accion" = '${VALOR_NUEVO}'`,
      );
      expect(fila.n).toBe(1);
    });

    it("el rollback FALLA ruidosamente y NO borra ni reescribe esa fila", async () => {
      await expect(aplicar(admin, downSql, esquema)).rejects.toThrow();
      // Y la fila sigue ahi. Es lo unico que dice quien cambio lo que cobra una persona por
      // entregar: por la firma de Q2 no hay ninguna otra copia de ese hecho en ninguna parte.
      const [fila] = await admin.$queryRawUnsafe<
        { n: number; accion: string; entidad: string }[]
      >(
        `SELECT COUNT(*)::int AS n, MIN("accion"::text) AS accion,
              MIN("entidad_tipo"::text) AS entidad
         FROM "${esquema}"."historial_accion"`,
      );
      expect(fila.n).toBe(1);
      expect(fila.accion).toBe(VALOR_NUEVO);
      expect(fila.entidad).toBe("zona");
    });
  },
);
