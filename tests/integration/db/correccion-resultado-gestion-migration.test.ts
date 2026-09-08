import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { HISTORIAL_ACCION_TIPOS } from "@/lib/types/historial-accion";
import { ORDEN_HISTORIAL_ORIGEN_TIPO_SEED } from "@/lib/types/orden-historial";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 398 / T1.5 — cobertura de `20260908160000_correccion_resultado_gestion`.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// ES LA PRIMERA MIGRACION DE ENUM DE ESTE REPO QUE TOCA DOS TIPOS DISTINTOS a la vez
// (`orden_historial_origen_tipo` y `historial_accion_tipo`), asi que todo lo que el patron de la
// 380 hacia una vez, aqui se hace dos: dos origenes que descubrir, dos historias que reconstruir,
// dos listas del `down.sql` que comparar y dos precondiciones ruidosas que probar.
//
// LO QUE MIDE:
//   (estatico) el `up` son DOS `ADD VALUE`, uno por tipo, aditivos y sin tocar ninguna tabla; el
//       `down` NO nombra ninguno de los dos valores nuevos y recastea SOLO las dos columnas que
//       usan esos enums;
//   (a) los dos enums de `public` coinciden EXACTAMENTE con los catalogos cerrados de
//       `lib/types/` —el `satisfies` de TypeScript compara contra el cliente GENERADO, no contra
//       la base viva, asi que un `prisma generate` rancio lo dejaria pasar—;
//   (b) el `down.sql` recrea las listas PREVIAS (33 y 51) — medido COMPARANDO el estado de antes
//       del up con el de despues del down, no leyendo el archivo;
//   (c) con UNA fila que use cada valor nuevo, el rollback FALLA ruidosamente y NO borra la fila.
//
// ⚠️ LAS CARPETAS DEL ESTADO PREVIO SE DESCUBREN LEYENDO `db/migrations`, no se escriben a mano.
// Por que, y esta MEDIDO en este repo el 2026-09-07: un `down.sql` de enum recrea el tipo con la
// lista COMPLETA, que es una FOTO del momento en que se escribio; el `down.sql` de una rama
// ramificada antes del merge de la 376 BORRO `zona_central_cambiada` de la base local sin un solo
// error. Con las carpetas escritas a mano, este archivo no se enteraria de una ampliacion que
// `dev` mergee mientras esta rama esta abierta; descubriendolas, esa ampliacion ENTRA en la
// reconstruccion, la comparacion falla y obliga a actualizar la lista ANTES del PR.

const ROOT = process.cwd();
const MIGRACIONES = path.join(ROOT, "db", "migrations");
const DIR_ESTA = "20260908160000_correccion_resultado_gestion";

const upSql = fs.readFileSync(path.join(MIGRACIONES, DIR_ESTA, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(MIGRACIONES, DIR_ESTA, "down.sql"), "utf8");

const VALOR_ORIGEN = "correccion_resultado_gestion";
const VALOR_ACCION = "cierre_dia_gestion_corregida";

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
// EL DESCUBRIMIENTO DE LA HISTORIA, sin una sola carpeta escrita a mano — y por DUPLICADO
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

/** La carpeta que CREA `<tipo>` desde cero. Se descubre, no se escribe. */
function carpetaDelOrigen(tipo: string): string {
  const encontrada = carpetasDeMigracion().find((dir) =>
    new RegExp(`CREATE TYPE "${tipo}" AS ENUM`).test(soloEjecutable(migrationSqlDe(dir))),
  );
  if (encontrada === undefined) {
    throw new Error(
      `no se encontro ninguna migracion que CREE \`${tipo}\`: la reconstruccion del estado ` +
        "previo mediria sobre una historia inventada",
    );
  }
  return encontrada;
}

/**
 * Las carpetas que AMPLIAN `<tipo>` entre su origen (excluido) y ESTA (excluida), en orden.
 *
 * ⚠️ Aqui esta la defensa: si `dev` mergea una ampliacion nueva mientras esta rama esta abierta,
 * aparece SOLA en esta lista, entra en la reconstruccion y el bloque (b) se pone rojo diciendo que
 * valor le falta al `down.sql`.
 */
function carpetasQueAmplian(tipo: string): string[] {
  const origen = carpetaDelOrigen(tipo);
  return carpetasDeMigracion().filter(
    (dir) =>
      dir > origen &&
      dir < DIR_ESTA &&
      new RegExp(`ALTER TYPE "${tipo}"\\s+ADD VALUE`).test(soloEjecutable(migrationSqlDe(dir))),
  );
}

/** Solo los `ALTER TYPE "<tipo>" … ADD VALUE …` de UN archivo. */
function ampliacionesDe(dir: string, tipo: string): string[] {
  const sql = soloEjecutable(migrationSqlDe(dir));
  return sql.match(new RegExp(`ALTER TYPE "${tipo}"\\s+ADD VALUE[^;]*`, "g")) ?? [];
}

/**
 * Cualifica los nombres de tipo y de tabla al esquema desechable.
 *
 * ⚠️ EL TARGET DE `RENAME TO` NO SE CUALIFICA: Postgres lo rechaza (el tipo renombrado se queda en
 * SU esquema). Se protege con un centinela antes de sustituir y se restaura despues.
 *
 * El orden importa: los nombres LARGOS primero. Como todos van entrecomillados, `"historial_accion"`
 * no casa dentro de `"historial_accion_tipo"`; el orden es la red por si algun dia dejaran de ir
 * entre comillas.
 */
const NOMBRES = [
  "orden_historial_origen_tipo_old",
  "historial_accion_entidad_old",
  "historial_accion_tipo_old",
  "orden_historial_origen_tipo",
  "historial_accion_entidad",
  "historial_accion_tipo",
  "orden_historial_estado",
  "historial_accion",
] as const;

const CENTINELAS: Record<string, string> = {
  orden_historial_origen_tipo_old: "@@O_OLD@@",
  historial_accion_entidad_old: "@@E_OLD@@",
  historial_accion_tipo_old: "@@T_OLD@@",
};

function cualificar(sql: string, esquema: string): string {
  let salida = sql;
  for (const [nombre, centinela] of Object.entries(CENTINELAS)) {
    salida = salida.replaceAll(`RENAME TO "${nombre}"`, `RENAME TO "${centinela}"`);
  }
  for (const nombre of NOMBRES) {
    salida = salida.replaceAll(`"${nombre}"`, `"${esquema}"."${nombre}"`);
  }
  for (const [nombre, centinela] of Object.entries(CENTINELAS)) {
    salida = salida.replaceAll(`"${centinela}"`, `"${nombre}"`);
  }
  return salida;
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
 * Levanta el estado PREVIO a esta ficha ejecutando las migraciones REALES anteriores: los tres
 * `CREATE TYPE` de origen mas TODOS los `ADD VALUE` posteriores, DESCUBIERTOS leyendo el disco.
 *
 * NO se copia nada del `down.sql` que este archivo esta probando: si se copiara, la comparacion
 * del bloque (b) seria circular y una lista mal escrita pasaria en verde.
 */
async function crearEstadoPrevio(admin: PrismaClient, esquema: string): Promise<void> {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);

  const origenOrigen = path.join(MIGRACIONES, carpetaDelOrigen("orden_historial_origen_tipo"), "migration.sql");
  const origenAccion = path.join(MIGRACIONES, carpetaDelOrigen("historial_accion_tipo"), "migration.sql");
  await admin.$executeRawUnsafe(
    cualificar(createTypeDe(origenOrigen, "orden_historial_origen_tipo"), esquema),
  );
  await admin.$executeRawUnsafe(
    cualificar(createTypeDe(origenAccion, "historial_accion_tipo"), esquema),
  );
  // `historial_accion_entidad` NO lo toca esta migracion, pero la TABLA lo necesita para existir.
  await admin.$executeRawUnsafe(
    cualificar(createTypeDe(origenAccion, "historial_accion_entidad"), esquema),
  );

  for (const tipo of ["orden_historial_origen_tipo", "historial_accion_tipo"] as const) {
    for (const dir of carpetasQueAmplian(tipo)) {
      for (const stmt of ampliacionesDe(dir, tipo)) {
        await admin.$executeRawUnsafe(cualificar(stmt, esquema));
      }
    }
  }

  // Las DOS tablas, con la MINIMA forma que el `down.sql` necesita recastear.
  await admin.$executeRawUnsafe(
    `CREATE TABLE "${esquema}"."orden_historial_estado" (
       "id" TEXT PRIMARY KEY,
       "orden_id" TEXT NOT NULL,
       "origen_tipo" "${esquema}"."orden_historial_origen_tipo" NOT NULL)`,
  );
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

describe("398/T1.5 — la migracion de la correccion: forma en disco", () => {
  it("trae migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(MIGRACIONES, DIR_ESTA, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(MIGRACIONES, DIR_ESTA, "down.sql"))).toBe(true);
  });

  it("el up son DOS `ADD VALUE`, uno por enum, sin `BEFORE`/`AFTER`", () => {
    const ejecutable = soloEjecutable(upSql);
    expect(sentencias(upSql)).toHaveLength(2);
    expect(ejecutable).toMatch(
      new RegExp(`ALTER TYPE "orden_historial_origen_tipo" ADD VALUE[^;]*'${VALOR_ORIGEN}'`),
    );
    expect(ejecutable).toMatch(
      new RegExp(`ALTER TYPE "historial_accion_tipo" ADD VALUE[^;]*'${VALOR_ACCION}'`),
    );
    // Sin `BEFORE`/`AFTER`: los dos APENDEN, y ese es el `enumsortorder` que el `down` reproduce.
    expect(ejecutable).not.toMatch(/ADD VALUE[^;]*\b(BEFORE|AFTER)\b/);
    // NO amplia el enum de ENTIDADES: `gestion_orden` ya estaba entre los 17 originales de la 362.
    expect(ejecutable).not.toMatch(/ALTER TYPE "historial_accion_entidad"/);
  });

  it("el up es ADITIVO: ni tablas, ni columnas, ni indices, ni datos", () => {
    const ejecutable = soloEjecutable(upSql);
    expect(ejecutable).not.toMatch(/CREATE TABLE|ALTER TABLE|CREATE INDEX|DROP /i);
    expect(ejecutable).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it("el down NO nombra ninguno de los dos valores nuevos, que es lo que viene a quitar", () => {
    const ejecutable = soloEjecutable(downSql);
    expect(ejecutable).not.toContain(`'${VALOR_ORIGEN}'`);
    expect(ejecutable).not.toContain(`'${VALOR_ACCION}'`);
  });

  it("el down recastea SOLO las dos columnas de esos enums y no toca `entidad_tipo`", () => {
    const ejecutable = soloEjecutable(downSql);
    expect(ejecutable).toMatch(/ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"/);
    expect(ejecutable).toMatch(/ALTER COLUMN "accion" TYPE "historial_accion_tipo"/);
    expect(ejecutable).not.toMatch(/ALTER COLUMN "entidad_tipo"/);
  });

  it("⭑ el down lleva ESCRITO el aviso de que sus listas son una FOTO que caduca", () => {
    // No es decoracion: es la unica defensa de quien lo corra a mano desde una rama vieja. El
    // 2026-09-07 un `down.sql` de enum borro `zona_central_cambiada` de la base local sin un solo
    // error de Postgres. Si alguien recorta este archivo, el aviso se va con el.
    expect(downSql).toMatch(/FOTO DEL 2026-09-08/);
    expect(downSql).toMatch(/pg_enum/); // la consulta con la que medir los catalogos de HOY
    // Y las DOS precondiciones ruidosas, una por enum.
    expect(downSql).toContain(VALOR_ORIGEN);
    expect(downSql).toContain(VALOR_ACCION);
  });

  it("⭑ el descubrimiento de la historia encuentra algo, para los DOS enums (anti-vacuidad)", () => {
    // Corre SIN base: si el descubrimiento devolviera vacio, el bloque (b) reconstruiria enums de
    // origen sin ninguna ampliacion y compararia contra una historia inventada, EN VERDE.
    for (const tipo of ["orden_historial_origen_tipo", "historial_accion_tipo"] as const) {
      const origen = carpetaDelOrigen(tipo);
      const amplian = carpetasQueAmplian(tipo);
      expect(origen.length).toBeGreaterThan(0);
      expect(amplian.length, `ninguna migracion intermedia amplia ${tipo}: imposible`).toBeGreaterThan(3);
      for (const dir of amplian) {
        expect(dir > origen && dir < DIR_ESTA, `${dir} fuera de la ventana`).toBe(true);
        expect(ampliacionesDe(dir, tipo).length, `${dir} sin ADD VALUE de ${tipo}`).toBeGreaterThan(0);
      }
      // Y ESTA carpeta NO se cuenta a si misma: si lo hiciera, el «estado previo» ya traeria los
      // valores nuevos y el bloque (b) compararia el down contra si mismo.
      expect(amplian).not.toContain(DIR_ESTA);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// (a) La base viva contra los catalogos cerrados.
// ---------------------------------------------------------------------------------------------

describe.skipIf(!HAY_BASE_DE_DATOS)("398/T1.5 (a) — los enums de la base SON los catalogos", () => {
  let admin: PrismaClient;

  beforeAll(() => {
    admin = crearPrismaDeTest();
  });

  afterAll(async () => {
    await admin?.$disconnect();
  });

  it("`orden_historial_origen_tipo` de `public` tiene exactamente los del SEED", async () => {
    const enLaBase = await valoresDeEnum(admin, "public", "orden_historial_origen_tipo");
    expect(enLaBase.length).toBeGreaterThan(0); // anti-vacuidad
    expect([...enLaBase].sort()).toEqual([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED].sort());
    expect(enLaBase).toContain(VALOR_ORIGEN);
    expect(enLaBase).toHaveLength(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.length);
  });

  it("`historial_accion_tipo` de `public` tiene exactamente los del catalogo", async () => {
    const enLaBase = await valoresDeEnum(admin, "public", "historial_accion_tipo");
    expect(enLaBase.length).toBeGreaterThan(0); // anti-vacuidad
    expect([...enLaBase].sort()).toEqual([...HISTORIAL_ACCION_TIPOS].sort());
    expect(enLaBase).toContain(VALOR_ACCION);
    // ⚠️ EL CONTEO SE COMPARA CONTRA EL CATALOGO, NO CONTRA UN NUMERO CONGELADO. El numero duro
    // vive en su sitio: la guardia de escrituras cubiertas, que ademas obliga a censar el
    // productor del tipo nuevo.
    expect(enLaBase).toHaveLength(HISTORIAL_ACCION_TIPOS.length);
  });

  it("los DOS valores nuevos van AL FINAL de su enum: `ADD VALUE` sin BEFORE/AFTER apende", async () => {
    // Es de donde sale la lista previa del `down.sql` de la SIGUIENTE ficha que amplie cada enum.
    const origenes = await valoresDeEnum(admin, "public", "orden_historial_origen_tipo");
    const acciones = await valoresDeEnum(admin, "public", "historial_accion_tipo");
    expect(origenes.at(-1)).toBe(VALOR_ORIGEN);
    expect(acciones.at(-1)).toBe(VALOR_ACCION);
    // La POSICION RELATIVA frente a los dos ultimos valores previos de cada enum, que es el
    // invariante real y no caduca con la siguiente ficha como si lo haria «es el ultimo».
    expect(origenes.indexOf(VALOR_ORIGEN)).toBeGreaterThan(origenes.indexOf("habilitacion_api"));
    expect(origenes.indexOf(VALOR_ORIGEN)).toBeGreaterThan(
      origenes.indexOf("rechazo_tope_intentos"),
    );
    expect(acciones.indexOf(VALOR_ACCION)).toBeGreaterThan(
      acciones.indexOf("cobro_tienda_registrado"),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// (b) El down devuelve EXACTAMENTE las listas previas. Se mide comparando, no leyendo.
// ---------------------------------------------------------------------------------------------

describe.skipIf(!HAY_BASE_DE_DATOS)("398/T1.5 (b) — el down recrea las listas PREVIAS", () => {
  const esquema = `t_398_enum_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let admin: PrismaClient;
  let origenAntes: string[] = [];
  let accionAntes: string[] = [];
  let entidadAntes: string[] = [];
  let origenTrasUp: string[] = [];
  let accionTrasUp: string[] = [];
  let origenTrasDown: string[] = [];
  let accionTrasDown: string[] = [];
  let entidadTrasDown: string[] = [];

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await crearEstadoPrevio(admin, esquema);
    origenAntes = await valoresDeEnum(admin, esquema, "orden_historial_origen_tipo");
    accionAntes = await valoresDeEnum(admin, esquema, "historial_accion_tipo");
    entidadAntes = await valoresDeEnum(admin, esquema, "historial_accion_entidad");
    await aplicar(admin, upSql, esquema);
    origenTrasUp = await valoresDeEnum(admin, esquema, "orden_historial_origen_tipo");
    accionTrasUp = await valoresDeEnum(admin, esquema, "historial_accion_tipo");
    await aplicar(admin, downSql, esquema);
    origenTrasDown = await valoresDeEnum(admin, esquema, "orden_historial_origen_tipo");
    accionTrasDown = await valoresDeEnum(admin, esquema, "historial_accion_tipo");
    entidadTrasDown = await valoresDeEnum(admin, esquema, "historial_accion_entidad");
  }, 120_000);

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  it("el estado PREVIO reconstruido son 33 origenes y 51 acciones", () => {
    // Numeros DUROS: si las migraciones anteriores dejaran otra cosa, todo lo de abajo mediria
    // sobre una historia inventada.
    expect(origenAntes).toHaveLength(33);
    expect(accionAntes).toHaveLength(51);
    expect(origenAntes.at(-1)).toBe("rechazo_tope_intentos");
    expect(accionAntes.at(-1)).toBe("cobro_tienda_registrado");
  });

  it("⭑ los estados previos reconstruidos SON los catalogos de hoy menos estos dos valores", () => {
    // El cierre del circulo: si los catalogos de TypeScript y las migraciones discreparan, no hay
    // forma de que esto y los casos del bloque (a) cuadren a la vez por casualidad.
    //
    // ⚠️ CADA FICHA QUE AMPLIE UNO DE LOS DOS ENUMS DESPUES DE ESTA ENTRA AQUI, en orden de
    // migracion, en la lista `POSTERIORES` que le toque. Es lo que convierte la comparacion en una
    // cadena verificable en vez de en algo que caduca en silencio.
    const ORIGENES_POSTERIORES: string[] = [];
    const ACCIONES_POSTERIORES: string[] = [];
    expect([...origenAntes].sort()).toEqual(
      ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.filter(
        (t) => t !== VALOR_ORIGEN && !ORIGENES_POSTERIORES.includes(t),
      )
        .slice()
        .sort(),
    );
    expect([...accionAntes].sort()).toEqual(
      HISTORIAL_ACCION_TIPOS.filter((t) => t !== VALOR_ACCION && !ACCIONES_POSTERIORES.includes(t))
        .slice()
        .sort(),
    );
  });

  it("el up deja 34 origenes y 52 acciones, con los nuevos AL FINAL (`ADD VALUE` apende)", () => {
    expect(origenTrasUp).toHaveLength(34);
    expect(accionTrasUp).toHaveLength(52);
    expect(origenTrasUp.at(-1)).toBe(VALOR_ORIGEN);
    expect(accionTrasUp.at(-1)).toBe(VALOR_ACCION);
  });

  it("⭑ el down devuelve los DOS enums a su lista previa, valor a valor y EN ORDEN", () => {
    // La comparacion es contra el estado medido ANTES del up —reconstruido con las migraciones
    // REALES, descubiertas leyendo el disco—, no contra una lista escrita a mano: si el `down.sql`
    // copiara la lista equivocada, esto se pone rojo diciendo cual falta.
    expect(origenTrasDown).toEqual(origenAntes);
    expect(accionTrasDown).toEqual(accionAntes);
  });

  it("el down deja `historial_accion_entidad` intacto: no era suyo", () => {
    expect(entidadTrasDown).toEqual(entidadAntes);
  });
});

// ---------------------------------------------------------------------------------------------
// (c) Las precondiciones ruidosas: con una fila que use cada valor nuevo, el rollback ABORTA.
// ---------------------------------------------------------------------------------------------

describe.skipIf(!HAY_BASE_DE_DATOS)(
  "398/T1.5 (c) — el down aborta si queda rastro de una correccion",
  () => {
    const esquema = `t_398_enum2_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    let admin: PrismaClient;

    beforeAll(async () => {
      admin = crearPrismaDeTest();
      await crearEstadoPrevio(admin, esquema);
      await aplicar(admin, upSql, esquema);
      await admin.$executeRawUnsafe(
        `INSERT INTO "${esquema}"."orden_historial_estado" ("id","orden_id","origen_tipo")
         VALUES ('h1','o1','${VALOR_ORIGEN}')`,
      );
      await admin.$executeRawUnsafe(
        `INSERT INTO "${esquema}"."historial_accion"
           ("id","accion","entidad_tipo","valor_anterior","valor_nuevo")
         VALUES ('a1','${VALOR_ACCION}','gestion_orden','entregada','rechazada')`,
      );
    }, 120_000);

    afterAll(async () => {
      await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
      await admin?.$disconnect();
    });

    it("las dos filas con los valores nuevos estan escritas (anti-vacuidad)", async () => {
      const [historial] = await admin.$queryRawUnsafe<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM "${esquema}"."orden_historial_estado"
          WHERE "origen_tipo" = '${VALOR_ORIGEN}'`,
      );
      const [accion] = await admin.$queryRawUnsafe<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM "${esquema}"."historial_accion"
          WHERE "accion" = '${VALOR_ACCION}'`,
      );
      expect(historial.n).toBe(1);
      expect(accion.n).toBe(1);
    });

    it("el rollback FALLA ruidosamente y NO borra ni reescribe esas filas", async () => {
      await expect(aplicar(admin, downSql, esquema)).rejects.toThrow();
      // Y las filas siguen ahi. Son lo unico que dice quien convirtio una entrega cobrada en un
      // rechazo que no cobra y que ademas le paga 0.00 al mensajero.
      const [historial] = await admin.$queryRawUnsafe<{ n: number; origen: string }[]>(
        `SELECT COUNT(*)::int AS n, MIN("origen_tipo"::text) AS origen
           FROM "${esquema}"."orden_historial_estado"`,
      );
      const [accion] = await admin.$queryRawUnsafe<
        { n: number; accion: string; anterior: string; nuevo: string }[]
      >(
        `SELECT COUNT(*)::int AS n, MIN("accion"::text) AS accion,
                MIN("valor_anterior") AS anterior, MIN("valor_nuevo") AS nuevo
           FROM "${esquema}"."historial_accion"`,
      );
      expect(historial.n).toBe(1);
      expect(historial.origen).toBe(VALOR_ORIGEN);
      expect(accion.n).toBe(1);
      expect(accion.accion).toBe(VALOR_ACCION);
      expect(accion.anterior).toBe("entregada");
      expect(accion.nuevo).toBe("rechazada");
    });
  },
);
