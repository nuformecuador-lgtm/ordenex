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

// FICHA 374 (R57) — cobertura de `20260906120100_historial_accion_nodo_geografico`.
//
// LAS TRES COSAS QUE MIDE, y ninguna se puede afirmar con un regex:
//   (a) los DOS enums de la base coinciden EXACTAMENTE con el catalogo cerrado de
//       `lib/types/historial-accion.ts` — el `satisfies` de TypeScript compara contra el cliente
//       GENERADO, no contra la base viva, asi que un `prisma generate` rancio lo dejaria pasar;
//   (b) el `down.sql` recrea la lista PREVIA (45 tipos y 17 entidades) y NO nombra ninguno de los
//       cinco valores nuevos — y esto se mide COMPARANDO el estado antes del up con el de despues
//       del down, no leyendo el archivo: una lista mal copiada se detecta sola;
//   (c) con UNA fila que use un valor nuevo, el rollback FALLA ruidosamente y NO borra esa fila.
//
// COMO SE RECONSTRUYE EL PASADO SIN CIRCULARIDAD. El estado previo NO se copia del `down.sql` que
// se esta probando —eso seria compararlo consigo mismo—: se levanta ejecutando los archivos REALES
// de las migraciones anteriores (el `CREATE TYPE` de 44 del down de la 373, mas su propio
// `ADD VALUE`, y el `CREATE TYPE` de 17 de la 362).

const ROOT = process.cwd();
const MIGRACIONES = path.join(ROOT, "db", "migrations");
const DIR_ESTA = "20260906120100_historial_accion_nodo_geografico";
const DIR_373 = "20260904120000_historial_accion_api_key_eliminada";
const DIR_362 = "20260902120000_historial_accion";

const upSql = fs.readFileSync(path.join(MIGRACIONES, DIR_ESTA, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(MIGRACIONES, DIR_ESTA, "down.sql"), "utf8");

/** Los cinco valores que esta migracion añade. */
const VALORES_NUEVOS_TIPO = ["nodo_geografico_desactivado", "nodo_geografico_activado"] as const;
const VALORES_NUEVOS_ENTIDAD = ["provincia", "canton", "distrito"] as const;

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
 * ⚠️ EL TARGET DE `RENAME TO` NO SE CUALIFICA, y no es un olvido: Postgres rechaza un nombre
 * cualificado ahi (el tipo renombrado se queda en SU esquema). Se protege con un centinela antes
 * de sustituir y se restaura despues.
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
  const filas = await admin.$queryRawUnsafe<Array<{ valor: string }>>(
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
  const tipo44 = createTypeDe(path.join(MIGRACIONES, DIR_373, "down.sql"), "historial_accion_tipo");
  const entidad17 = createTypeDe(
    path.join(MIGRACIONES, DIR_362, "migration.sql"),
    "historial_accion_entidad",
  );
  await admin.$executeRawUnsafe(cualificar(tipo44, esquema));
  await admin.$executeRawUnsafe(cualificar(entidad17, esquema));
  // El `ADD VALUE` REAL de la 373: es lo que convierte los 44 en los 45 previos.
  await aplicar(admin, fs.readFileSync(path.join(MIGRACIONES, DIR_373, "migration.sql"), "utf8"), esquema);
  await admin.$executeRawUnsafe(
    `CREATE TABLE "${esquema}"."historial_accion" (
       "id" TEXT PRIMARY KEY,
       "accion" "${esquema}"."historial_accion_tipo" NOT NULL,
       "entidad_tipo" "${esquema}"."historial_accion_entidad" NOT NULL)`,
  );
}

// ---------------------------------------------------------------------------------------------
// Estatico: corre SIEMPRE.
// ---------------------------------------------------------------------------------------------
describe("374 — migracion del registro: forma en disco", () => {
  it("trae migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(MIGRACIONES, DIR_ESTA, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(MIGRACIONES, DIR_ESTA, "down.sql"))).toBe(true);
  });

  it("el up añade los DOS tipos y las TRES entidades, y nada mas", () => {
    const ejecutable = soloEjecutable(upSql);
    for (const valor of [...VALORES_NUEVOS_TIPO, ...VALORES_NUEVOS_ENTIDAD]) {
      expect(ejecutable).toContain(`'${valor}'`);
    }
    expect(sentencias(upSql)).toHaveLength(5);
    // ADITIVA: ni tablas, ni columnas, ni indices.
    expect(ejecutable).not.toMatch(/CREATE TABLE|ALTER TABLE|CREATE INDEX/i);
  });

  it("el down NO nombra ninguno de los cinco valores nuevos", () => {
    const ejecutable = soloEjecutable(downSql);
    for (const valor of [...VALORES_NUEVOS_TIPO, ...VALORES_NUEVOS_ENTIDAD]) {
      expect(ejecutable, `el down lista '${valor}', que es justo lo que viene a quitar`).not.toContain(
        `'${valor}'`,
      );
    }
  });

  it("el down recastea las DOS columnas de `historial_accion`", () => {
    const ejecutable = soloEjecutable(downSql);
    expect(ejecutable).toMatch(/ALTER COLUMN "accion" TYPE "historial_accion_tipo"/);
    expect(ejecutable).toMatch(/ALTER COLUMN "entidad_tipo" TYPE "historial_accion_entidad"/);
  });
});

// ---------------------------------------------------------------------------------------------
// (a) La base viva contra el catalogo cerrado.
// ---------------------------------------------------------------------------------------------
describe.skipIf(!HAY_BASE_DE_DATOS)("374/R57 (a) — el enum de la base ES el catalogo", () => {
  let admin: PrismaClient;

  beforeAll(() => {
    admin = crearPrismaDeTest();
  });

  afterAll(async () => {
    await admin?.$disconnect();
  });

  it("`historial_accion_tipo` de `public` tiene exactamente los 47 del catalogo", async () => {
    const enLaBase = await valoresDeEnum(admin, "public", "historial_accion_tipo");
    expect(enLaBase.length).toBeGreaterThan(0); // anti-vacuidad
    expect([...enLaBase].sort()).toEqual([...HISTORIAL_ACCION_TIPOS].sort());
  });

  it("`historial_accion_entidad` de `public` tiene exactamente las 20 del catalogo", async () => {
    const enLaBase = await valoresDeEnum(admin, "public", "historial_accion_entidad");
    expect(enLaBase.length).toBeGreaterThan(0);
    expect([...enLaBase].sort()).toEqual([...HISTORIAL_ACCION_ENTIDADES].sort());
  });
});

// ---------------------------------------------------------------------------------------------
// (b) El down devuelve EXACTAMENTE la lista previa. Se mide comparando, no leyendo.
// ---------------------------------------------------------------------------------------------
describe.skipIf(!HAY_BASE_DE_DATOS)("374/R57 (b) — el down recrea la lista PREVIA", () => {
  const esquema = `t_374_reg_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
    await aplicar(admin, upSql, esquema);
    tiposTrasUp = await valoresDeEnum(admin, esquema, "historial_accion_tipo");
    entidadesTrasUp = await valoresDeEnum(admin, esquema, "historial_accion_entidad");
    await aplicar(admin, downSql, esquema);
    tiposTrasDown = await valoresDeEnum(admin, esquema, "historial_accion_tipo");
    entidadesTrasDown = await valoresDeEnum(admin, esquema, "historial_accion_entidad");
  }, 120_000);

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  it("el estado PREVIO reconstruido son 45 tipos y 17 entidades", () => {
    // Numeros DUROS: si las migraciones anteriores dejaran otra cosa, todo lo de abajo mediria
    // sobre una historia inventada.
    expect(tiposAntes).toHaveLength(45);
    expect(entidadesAntes).toHaveLength(17);
    expect(tiposAntes.at(-1)).toBe("api_key_eliminada");
  });

  it("el up deja 47 tipos y 20 entidades, con los nuevos AL FINAL (`ADD VALUE` apende)", () => {
    expect(tiposTrasUp).toHaveLength(47);
    expect(entidadesTrasUp).toHaveLength(20);
    expect(tiposTrasUp.slice(-2)).toEqual([...VALORES_NUEVOS_TIPO]);
    expect(entidadesTrasUp.slice(-3)).toEqual([...VALORES_NUEVOS_ENTIDAD]);
  });

  it("el down devuelve los DOS enums a la lista previa, valor a valor y EN ORDEN", () => {
    // La comparacion es contra el estado medido ANTES del up, no contra una lista escrita a mano:
    // si el `down.sql` copiara la lista equivocada, esto se pone rojo diciendo cual falta.
    expect(tiposTrasDown).toEqual(tiposAntes);
    expect(entidadesTrasDown).toEqual(entidadesAntes);
  });
});

// ---------------------------------------------------------------------------------------------
// (c) La precondicion ruidosa: con una fila que use un valor nuevo, el rollback ABORTA.
// ---------------------------------------------------------------------------------------------
describe.skipIf(!HAY_BASE_DE_DATOS)("374/R57 (c) — el down aborta si queda rastro", () => {
  const esquema = `t_374_reg2_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let admin: PrismaClient;

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await crearEstadoPrevio(admin, esquema);
    await aplicar(admin, upSql, esquema);
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."historial_accion" ("id","accion","entidad_tipo")
       VALUES ('h1','nodo_geografico_desactivado','distrito')`,
    );
  }, 120_000);

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  it("la fila con el valor nuevo esta escrita (anti-vacuidad)", async () => {
    const [fila] = await admin.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM "${esquema}"."historial_accion"
        WHERE "accion" = 'nodo_geografico_desactivado'`,
    );
    expect(fila.n).toBe(1);
  });

  it("el rollback FALLA ruidosamente y NO borra ni reescribe esa fila", async () => {
    await expect(aplicar(admin, downSql, esquema)).rejects.toThrow();
    // Y la fila sigue ahi: borrar el rastro de quien retiro un distrito no es seguro (R57).
    const [fila] = await admin.$queryRawUnsafe<Array<{ n: number; accion: string }>>(
      `SELECT COUNT(*)::int AS n, MIN("accion"::text) AS accion
         FROM "${esquema}"."historial_accion"`,
    );
    expect(fila.n).toBe(1);
    expect(fila.accion).toBe("nodo_geografico_desactivado");
  });
});
