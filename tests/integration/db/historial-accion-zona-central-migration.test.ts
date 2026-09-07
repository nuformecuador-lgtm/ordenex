import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { HISTORIAL_ACCION_TIPOS } from "@/lib/types/historial-accion";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// FICHA 376 / T2 — cobertura de `20260907130000_historial_accion_zona_central_cambiada`.
//
// LAS TRES COSAS QUE MIDE, calcadas de la 375 porque el mecanismo es el mismo:
//   (a) el enum de la base coincide EXACTAMENTE con el catalogo cerrado de
//       `lib/types/historial-accion.ts` — el `satisfies` de TypeScript compara contra el cliente
//       GENERADO, no contra la base viva, asi que un `prisma generate` rancio lo dejaria pasar;
//   (b) el `down.sql` recrea la lista PREVIA (48 tipos) y NO nombra el valor nuevo — medido
//       COMPARANDO el estado de antes del up con el de despues del down, no leyendo el archivo:
//       una lista mal copiada se detecta sola y dice cual falta;
//   (c) con UNA fila que use el valor nuevo, el rollback FALLA ruidosamente y NO borra esa fila.
//
// COMO SE RECONSTRUYE EL PASADO SIN CIRCULARIDAD, y es lo que distingue este archivo de comparar
// el `down.sql` contra una lista escrita a mano: el estado previo NO se copia del `down.sql` que se
// esta probando. Se levanta ejecutando los archivos REALES de las migraciones anteriores — el
// `CREATE TYPE` de 45 del down de la 374, mas el `ADD VALUE` de la 374 (dos), mas el de la 375
// (uno) = los 48 previos.
//
// `historial_accion_entidad` NO se toca en esta migracion, y se AFIRMA: `zona` esta ahi desde los
// 17 valores originales de la 362 (la usa `zona_borrada`).

const ROOT = process.cwd();
const MIGRACIONES = path.join(ROOT, "db", "migrations");
const DIR_ESTA = "20260907130000_historial_accion_zona_central_cambiada";
const DIR_375 = "20260907120100_historial_accion_nodo_geografico_renombrado";
const DIR_374 = "20260906120100_historial_accion_nodo_geografico";
const DIR_362 = "20260902120000_historial_accion";

const upSql = fs.readFileSync(path.join(MIGRACIONES, DIR_ESTA, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(MIGRACIONES, DIR_ESTA, "down.sql"), "utf8");

const VALOR_NUEVO = "zona_central_cambiada";

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

/** Levanta el estado PREVIO a esta ficha ejecutando las migraciones REALES anteriores. */
async function crearEstadoPrevio(admin: PrismaClient, esquema: string): Promise<void> {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
  const tipo45 = createTypeDe(path.join(MIGRACIONES, DIR_374, "down.sql"), "historial_accion_tipo");
  const entidad17 = createTypeDe(
    path.join(MIGRACIONES, DIR_362, "migration.sql"),
    "historial_accion_entidad",
  );
  await admin.$executeRawUnsafe(cualificar(tipo45, esquema));
  await admin.$executeRawUnsafe(cualificar(entidad17, esquema));
  // Los `ADD VALUE` REALES de la 374 (dos tipos + tres entidades) y de la 375 (un tipo): 45 -> 48.
  for (const dir of [DIR_374, DIR_375]) {
    await aplicar(admin, fs.readFileSync(path.join(MIGRACIONES, dir, "migration.sql"), "utf8"), esquema);
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
// Estatico: corre SIEMPRE.
// ---------------------------------------------------------------------------------------------

describe("376/T2 — migracion del cambio de zona central: forma en disco", () => {
  it("trae migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(MIGRACIONES, DIR_ESTA, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(MIGRACIONES, DIR_ESTA, "down.sql"))).toBe(true);
  });

  it("el up añade UN solo valor, y a `historial_accion_tipo`", () => {
    const ejecutable = soloEjecutable(upSql);
    expect(sentencias(upSql)).toHaveLength(1);
    expect(ejecutable).toContain(`'${VALOR_NUEVO}'`);
    expect(ejecutable).toMatch(/ALTER TYPE "historial_accion_tipo" ADD VALUE/);
    // NO amplia el enum de entidades: `zona` ya estaba entre los 17 originales de la 362.
    expect(ejecutable).not.toMatch(/historial_accion_entidad/);
  });

  it("el up es ADITIVO: ni tablas, ni columnas, ni indices, ni datos", () => {
    // Un backfill o un `CREATE TABLE` aqui dentro reventaria con 55P04 o dejaria el `down` cojo.
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
});

// ---------------------------------------------------------------------------------------------
// (a) La base viva contra el catalogo cerrado.
// ---------------------------------------------------------------------------------------------

describe.skipIf(!HAY_BASE_DE_DATOS)("376/T2 (a) — el enum de la base ES el catalogo", () => {
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
    // ⚠️ EL CONTEO SE COMPARA CONTRA EL CATALOGO, NO CONTRA UN NUMERO CONGELADO: la leccion esta
    // escrita en `api-key-eliminada-migration.test.ts`. El numero duro vive en su sitio, la
    // guardia de escrituras cubiertas, que ademas obliga a censar el productor del tipo nuevo.
    expect(enLaBase).toHaveLength(HISTORIAL_ACCION_TIPOS.length);
  });

  it("el valor nuevo va DESPUES del de la 375: `ADD VALUE` sin BEFORE/AFTER apende", async () => {
    // Es de donde sale la lista previa del `down.sql` de la SIGUIENTE ficha que amplie el enum.
    const enLaBase = await valoresDeEnum(admin, "public", "historial_accion_tipo");
    expect(enLaBase.indexOf(VALOR_NUEVO)).toBeGreaterThan(
      enLaBase.indexOf("nodo_geografico_renombrado"),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// (b) El down devuelve EXACTAMENTE la lista previa. Se mide comparando, no leyendo.
// ---------------------------------------------------------------------------------------------

describe.skipIf(!HAY_BASE_DE_DATOS)("376/T2 (b) — el down recrea la lista PREVIA de 48", () => {
  const esquema = `t_376_enum_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

  it("el estado PREVIO reconstruido son 48 tipos y 20 entidades", () => {
    // Numeros DUROS: si las migraciones anteriores dejaran otra cosa, todo lo de abajo mediria
    // sobre una historia inventada.
    expect(tiposAntes).toHaveLength(48);
    expect(entidadesAntes).toHaveLength(20);
    expect(tiposAntes.at(-1)).toBe("nodo_geografico_renombrado");
    // Y `zona` ya estaba: esta migracion no amplia el enum de entidades porque no le hace falta.
    expect(entidadesAntes).toContain("zona");
  });

  it("el up deja 49 tipos, con el nuevo AL FINAL (`ADD VALUE` apende)", () => {
    expect(tiposTrasUp).toHaveLength(49);
    expect(tiposTrasUp.at(-1)).toBe(VALOR_NUEVO);
  });

  it("⭑ el down devuelve el enum a la lista previa, valor a valor y EN ORDEN", () => {
    // La comparacion es contra el estado medido ANTES del up, no contra una lista escrita a mano:
    // si el `down.sql` copiara la lista equivocada, esto se pone rojo diciendo cual falta.
    // Probado a mano el 2026-09-07: quitandole un valor a la lista del `down.sql`, este caso falla.
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
  "376/T2 (c) — el down aborta si queda rastro de un cambio de marca",
  () => {
    const esquema = `t_376_enum2_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    let admin: PrismaClient;

    beforeAll(async () => {
      admin = crearPrismaDeTest();
      await crearEstadoPrevio(admin, esquema);
      await aplicar(admin, upSql, esquema);
      await admin.$executeRawUnsafe(
        `INSERT INTO "${esquema}"."historial_accion"
         ("id","accion","entidad_tipo","valor_anterior","valor_nuevo")
       VALUES ('h1','${VALOR_NUEVO}','zona','true','false')`,
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
      // Y la fila sigue ahi con la DIRECCION del cambio: es lo unico que dice quien le quito la
      // marca a una zona, y por tanto por que cambio la columna de flete que se le factura.
      const [fila] = await admin.$queryRawUnsafe<
        { n: number; accion: string; anterior: string; nuevo: string }[]
      >(
        `SELECT COUNT(*)::int AS n, MIN("accion"::text) AS accion,
              MIN("valor_anterior") AS anterior, MIN("valor_nuevo") AS nuevo
         FROM "${esquema}"."historial_accion"`,
      );
      expect(fila.n).toBe(1);
      expect(fila.accion).toBe(VALOR_NUEVO);
      expect(fila.anterior).toBe("true");
      expect(fila.nuevo).toBe("false");
    });
  },
);
