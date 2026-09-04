import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { HISTORIAL_ACCION_TIPOS } from "@/lib/types/historial-accion";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

/**
 * ⭑ FICHA 366 / T1 — LA MIGRACION DEL VALOR NUEVO DEL ENUM, LEIDA DE LA BASE APLICADA.
 *
 * Lo que se mide, y de DONDE sale cada cosa:
 *   · que `historial_accion_tipo` tiene `orden_zona_reconciliada` -> de `pg_enum`, no del `.sql`
 *     (afirmarlo leyendo la migracion que lo escribe seguiria verde aunque nunca se hubiera
 *     aplicado);
 *   · que el catalogo de TypeScript y el enum de Postgres dicen LO MISMO -> dos fuentes
 *     independientes, comparadas entre si;
 *   · que el `up` va SOLO (sin backfill ni uso del valor nuevo): Postgres no permite usarlo en la
 *     misma transaccion que lo añade;
 *   · que el `down.sql` recrea el tipo con la lista PREVIA EXACTA -> comparada contra el
 *     `CREATE TYPE` de la migracion de la ficha 362, que es otro archivo.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const RAIZ = path.resolve(__dirname, "../../..");
const CARPETA = "20260903120000_historial_accion_orden_zona_reconciliada";
const CARPETA_362 = "20260902120000_historial_accion";
const VALOR_NUEVO = "orden_zona_reconciliada";

function sql(carpeta: string, archivo: string): string {
  return readFileSync(path.join(RAIZ, "db", "migrations", carpeta, archivo), "utf8");
}

/** Los literales `'x'` del PRIMER bloque `CREATE TYPE "historial_accion_tipo" AS ENUM ( ... )`. */
function valoresDelCreateType(texto: string): string[] {
  const inicio = texto.indexOf('CREATE TYPE "historial_accion_tipo" AS ENUM');
  if (inicio === -1) return [];
  const fin = texto.indexOf(");", inicio);
  const cuerpo = texto.slice(inicio, fin);
  return [...cuerpo.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("366/T1 — el `migration.sql` y el `down.sql`, como texto", () => {
  it("⭑ el UP es UNA sola sentencia: `ADD VALUE IF NOT EXISTS`, sin backfill ni uso del valor", () => {
    const up = sql(CARPETA, "migration.sql");
    expect(up).toContain(
      `ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS '${VALOR_NUEVO}';`,
    );
    const sentencias = up
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--") && l.trim().length > 0);
    expect(sentencias, "el up tiene que ir SOLO: Postgres no deja usar el valor recien añadido")
      .toHaveLength(1);
    // Ni una escritura de datos NI DDL de tabla — medido sobre el SQL SIN COMENTARIOS, que es lo
    // unico que Postgres ejecuta (la prosa de arriba si nombra `ZonaRepository.update`).
    expect(sentencias.join("\n")).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE TABLE)\b/i);
  });

  it("⭑ el DOWN recrea el tipo con la lista PREVIA EXACTA (la del `CREATE TYPE` de la 362)", () => {
    const down = sql(CARPETA, "down.sql");
    const previos = valoresDelCreateType(sql(CARPETA_362, "migration.sql"));
    const recreados = valoresDelCreateType(down);

    // Anti-vacuidad: si el parser no encontrara nada, los dos arrays serian [] y el test pasaria.
    expect(previos.length).toBeGreaterThan(40);
    // MISMO orden, mismos valores: es la foto de lo que habia antes de esta migracion.
    expect(recreados).toEqual(previos);
    expect(recreados).not.toContain(VALOR_NUEVO);

    // Y el resto del rito: renombrar, recastear la unica columna que usa el tipo, soltar el viejo.
    expect(down).toContain('ALTER TYPE "historial_accion_tipo" RENAME TO "historial_accion_tipo_old"');
    expect(down).toContain('USING ("accion"::text::"historial_accion_tipo")');
    expect(down).toContain('DROP TYPE "historial_accion_tipo_old"');
  });

  it("el catalogo de TypeScript es la lista previa MAS este valor y los posteriores", () => {
    const previos = valoresDelCreateType(sql(CARPETA_362, "migration.sql"));
    // Cada ficha que añada un valor entra AQUI, en orden de migracion. Es lo que convierte esta
    // comparacion en una cadena verificable —«la 362, mas la 366, mas la 371, mas la 373»— en vez
    // de en un numero que caduca. La 371 (`gestion_fecha_reprogramacion_corregida`) y la 373
    // (`api_key_eliminada`) tienen ademas su propio archivo de migracion, que comprueba su `up`,
    // su `down` y la base aplicada.
    const POSTERIORES = ["gestion_fecha_reprogramacion_corregida", "api_key_eliminada"];
    expect([...HISTORIAL_ACCION_TIPOS].sort()).toEqual(
      [...previos, VALOR_NUEVO, ...POSTERIORES].sort(),
    );
  });
});

describeSiHayBase("366/T1 — el enum en la base APLICADA", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("⭑ `pg_enum` tiene `orden_zona_reconciliada`, y el catalogo y la base dicen lo mismo", async () => {
    const filas = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'historial_accion_tipo' ORDER BY e.enumsortorder`,
    );
    const enLaBase = filas.map((f) => f.enumlabel);
    expect(enLaBase, "la migracion no esta aplicada en esta base").toContain(VALOR_NUEVO);
    // Las DOS direcciones: ni el catalogo nombra algo que la base no tiene, ni al reves. Es el
    // mismo cierre que hacen `satisfies` y `_AsegurarExhaustivo` en compilacion, pero medido
    // contra la base REAL.
    expect(enLaBase.slice().sort()).toEqual([...HISTORIAL_ACCION_TIPOS].sort());
  });

  it("una fila con el valor nuevo se puede escribir (el enum lo acepta de verdad)", async () => {
    // Se ejecuta como una consulta que castea el literal al tipo: si el valor no existiera en el
    // enum, Postgres lo rechazaria aqui. No escribe ninguna fila.
    const filas = await prisma.$queryRawUnsafe<{ ok: string }[]>(
      `SELECT '${VALOR_NUEVO}'::"historial_accion_tipo"::text AS ok`,
    );
    expect(filas[0].ok).toBe(VALOR_NUEVO);
  });
});
