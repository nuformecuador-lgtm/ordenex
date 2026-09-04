import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { HISTORIAL_ACCION_TIPOS } from "@/lib/types/historial-accion";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

/**
 * ⭑ FICHA 371 — LA MIGRACION DE LA FICHA, LEIDA DE LA BASE APLICADA.
 *
 * Hace DOS cosas y las dos se comprueban aqui:
 *   · la TABLA `gestion_fecha_reprogramacion_cambio` (el rastro con su motivo);
 *   · el VALOR de enum `gestion_fecha_reprogramacion_corregida` (la fila transversal de la 362).
 *
 * Lo que se mide, y de DONDE sale cada cosa:
 *   · la forma de la tabla -> de `information_schema` y `pg_constraint`, no del `.sql` (afirmarlo
 *     leyendo la migracion que lo escribe seguiria verde aunque nunca se hubiera aplicado);
 *   · el valor del enum -> de `pg_enum`, por el mismo motivo;
 *   · que el catalogo de TypeScript y el enum de Postgres dicen LO MISMO -> dos fuentes
 *     independientes, comparadas entre si;
 *   · que el `down.sql` recrea el tipo con la lista PREVIA EXACTA -> comparada contra el
 *     `CREATE TYPE` de la 362 mas el valor que añadio la 366, que son OTROS archivos.
 *
 * El CHECK `fecha_nueva <> fecha_anterior` se prueba MORDIENDO, con un INSERT real, en
 * `correccion-fecha-reprogramacion.int.test.ts` (ahi ya hay corpus con FKs validas).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const RAIZ = path.resolve(__dirname, "../../..");
const CARPETA = "20260903150000_correccion_fecha_reprogramacion";
const CARPETA_362 = "20260902120000_historial_accion";
const CARPETA_366 = "20260903120000_historial_accion_orden_zona_reconciliada";
const VALOR_NUEVO = "gestion_fecha_reprogramacion_corregida";
const VALOR_366 = "orden_zona_reconciliada";
const TABLA = "gestion_fecha_reprogramacion_cambio";

function sql(carpeta: string, archivo: string): string {
  return readFileSync(path.join(RAIZ, "db", "migrations", carpeta, archivo), "utf8");
}

/** Los literales `'x'` del PRIMER bloque `CREATE TYPE "historial_accion_tipo" AS ENUM ( ... )`. */
function valoresDelCreateType(texto: string): string[] {
  const inicio = texto.indexOf('CREATE TYPE "historial_accion_tipo" AS ENUM');
  if (inicio === -1) return [];
  const fin = texto.indexOf(");", inicio);
  return [...texto.slice(inicio, fin).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("371/T1 — el `migration.sql` y el `down.sql`, como texto", () => {
  it("⭑ el UP añade el valor del enum y CREA la tabla, y NO USA el valor nuevo", () => {
    const up = sql(CARPETA, "migration.sql");
    expect(up).toContain(
      `ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS '${VALOR_NUEVO}';`,
    );
    expect(up).toContain(`CREATE TABLE "${TABLA}"`);

    // Postgres prohibe USAR un valor de enum recien añadido en la MISMA transaccion (55P04), y
    // Prisma corre cada migracion en una. Añadirlo junto a DDL que no lo nombra es seguro; lo que
    // no puede haber es una escritura con ese literal.
    const lineas = up
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--") && l.trim().length > 0);
    // Se miran los COMIENZOS de sentencia y no el texto entero: `ON DELETE RESTRICT` y
    // `ON UPDATE CASCADE` son parte de una FK, no DML, y una regex a secas los denunciaria.
    const dml = lineas.filter((l) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(l));
    expect(dml, "el up escribe datos: no puede usar el valor de enum que acaba de añadir").toEqual(
      [],
    );
    expect(lineas.join("\n").match(new RegExp(VALOR_NUEVO, "g"))).toHaveLength(1);
  });

  it("el UP declara el CHECK, las tres FK y la RLS", () => {
    const up = sql(CARPETA, "migration.sql");
    expect(up).toContain(`CONSTRAINT "${TABLA}_fecha_distinta"`);
    expect(up).toContain('CHECK ("fecha_nueva" <> "fecha_anterior")');
    for (const fk of ["gestion_id_fkey", "orden_id_fkey", "actor_usuario_id_fkey"]) {
      expect(up).toContain(`CONSTRAINT "${TABLA}_${fk}"`);
    }
    // RESTRICT en las tres: el rastro es evidencia y no se pierde al borrar su sujeto.
    expect(up.match(/ON DELETE RESTRICT/g)).toHaveLength(3);
    expect(up).toContain(`ALTER TABLE "${TABLA}" ENABLE ROW LEVEL SECURITY;`);
  });

  it("⭑ el DOWN deshace las DOS cosas, y en orden inverso", () => {
    const down = sql(CARPETA, "down.sql");
    const iTabla = down.indexOf(`DROP TABLE IF EXISTS "${TABLA}"`);
    const iEnum = down.indexOf('ALTER TYPE "historial_accion_tipo" RENAME TO');
    expect(iTabla).toBeGreaterThan(-1);
    expect(iEnum).toBeGreaterThan(-1);
    expect(iTabla, "la tabla se suelta ANTES de recrear el enum").toBeLessThan(iEnum);
    expect(down).toContain('USING ("accion"::text::"historial_accion_tipo")');
    expect(down).toContain('DROP TYPE "historial_accion_tipo_old"');
  });

  it("⭑ el DOWN recrea el tipo con la lista PREVIA EXACTA (362 + el valor de la 366)", () => {
    const down = sql(CARPETA, "down.sql");
    // La lista previa se COMPONE de otros dos archivos, no se escribe a mano en la aserción: asi
    // la comprobacion sigue siendo independiente del texto que se esta comprobando.
    const previos = [...valoresDelCreateType(sql(CARPETA_362, "migration.sql")), VALOR_366];
    const recreados = valoresDelCreateType(down);

    // Anti-vacuidad: si el parser no encontrara nada, los dos arrays serian [] y el test pasaria.
    expect(previos.length).toBeGreaterThan(42);
    expect(recreados).toEqual(previos);
    expect(recreados).not.toContain(VALOR_NUEVO);
    // Y el `ADD VALUE` de la 366 sigue existiendo donde debe: si alguien lo borrara, la lista
    // previa de arriba dejaria de ser la de la base.
    expect(sql(CARPETA_366, "migration.sql")).toContain(`ADD VALUE IF NOT EXISTS '${VALOR_366}'`);
  });

  it("NINGUN `down.sql` anterior se toco: son fotos historicas", () => {
    // El de la 366 recrea el enum con los 42 de la 362 y NADA de esta ficha.
    const down366 = sql(CARPETA_366, "down.sql");
    expect(down366).not.toContain(VALOR_NUEVO);
    expect(valoresDelCreateType(down366)).toEqual(
      valoresDelCreateType(sql(CARPETA_362, "migration.sql")),
    );
  });
});

describeSiHayBase("371/T1 — la base APLICADA", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("⭑ `pg_enum` tiene el valor nuevo, y el catalogo y la base dicen lo mismo", async () => {
    const filas = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'historial_accion_tipo' ORDER BY e.enumsortorder`,
    );
    const enLaBase = filas.map((f) => f.enumlabel);
    expect(enLaBase, "la migracion no esta aplicada en esta base").toContain(VALOR_NUEVO);
    // Las DOS direcciones: ni el catalogo nombra algo que la base no tiene, ni al reves.
    expect(enLaBase.slice().sort()).toEqual([...HISTORIAL_ACCION_TIPOS].sort());
    // El orden FISICO del enum en la base: los `ADD VALUE` apenden, asi que el de esta ficha va
    // JUSTO DESPUES del de la 366. Es la lista que el `down.sql` tiene que recrear.
    //
    // Se afirma la POSICION RELATIVA y no «es el ultimo»: la ficha 373 apendio despues
    // (`api_key_eliminada`) y la siguiente volvera a hacerlo. Lo que esta ficha tiene que
    // sostener en el tiempo es su sitio respecto al valor que la precede, no que nadie mas
    // amplie el enum nunca.
    expect(enLaBase.indexOf(VALOR_NUEVO)).toBe(enLaBase.indexOf(VALOR_366) + 1);
  });

  it("⭑ la tabla existe con sus siete columnas y sus tipos", async () => {
    const columnas = await prisma.$queryRawUnsafe<
      { column_name: string; data_type: string; is_nullable: string }[]
    >(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_name = '${TABLA}' ORDER BY ordinal_position`,
    );
    const porNombre = new Map(columnas.map((c) => [c.column_name, c]));
    expect([...porNombre.keys()].sort()).toEqual(
      [
        "actor_usuario_id",
        "created_at",
        "fecha_anterior",
        "fecha_nueva",
        "gestion_id",
        "id",
        "motivo",
        "orden_id",
      ].sort(),
    );
    // ⭑ Las dos fechas son DATE y no timestamp: son FECHAS calendario, y un `timestamp` reabriria
    // la trampa de las seis horas que cerro la 166.
    expect(porNombre.get("fecha_anterior")?.data_type).toBe("date");
    expect(porNombre.get("fecha_nueva")?.data_type).toBe("date");
    // Y NINGUNA de las ocho admite nulo: una fila que dijera «no tenia fecha» o «no se quien lo
    // hizo» no la puede escribir ningun productor.
    for (const [nombre, columna] of porNombre) {
      expect(columna.is_nullable, `${nombre} admite NULL`).toBe("NO");
    }
    // Append-only: ni `updated_at` ni `deleted_at`.
    expect(porNombre.has("updated_at")).toBe(false);
    expect(porNombre.has("deleted_at")).toBe(false);
  });

  it("⭑ el CHECK de fecha distinta y las tres FK RESTRICT estan en la base", async () => {
    // `contype` es `char` y Prisma no sabe deserializarlo: se castea a texto en el SQL.
    const constraints = await prisma.$queryRawUnsafe<{ conname: string; contype: string }[]>(
      `SELECT c.conname, c.contype::text AS contype FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid WHERE t.relname = '${TABLA}'`,
    );
    const nombres = constraints.map((c) => c.conname);
    expect(nombres).toContain(`${TABLA}_fecha_distinta`);
    expect(constraints.filter((c) => c.contype === "f")).toHaveLength(3);

    const restrict = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = '${TABLA}' AND c.contype = 'f' AND c.confdeltype = 'r'`,
    );
    expect(Number(restrict[0].n), "alguna FK dejo de ser RESTRICT").toBe(3);
  });

  it("la RLS esta habilitada y sin policies (solo service role)", async () => {
    const filas = await prisma.$queryRawUnsafe<{ relrowsecurity: boolean }[]>(
      `SELECT relrowsecurity FROM pg_class WHERE relname = '${TABLA}'`,
    );
    expect(filas[0].relrowsecurity).toBe(true);
    const policies = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM pg_policies WHERE tablename = '${TABLA}'`,
    );
    expect(Number(policies[0].n)).toBe(0);
  });

  it("los tres indices declarados existen", async () => {
    const filas = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = '${TABLA}'`,
    );
    const nombres = filas.map((f) => f.indexname);
    for (const sufijo of [
      "orden_id_created_at_idx",
      "gestion_id_created_at_idx",
      "actor_usuario_id_idx",
    ]) {
      expect(nombres, `falta el indice ${sufijo}`).toContain(`${TABLA}_${sufijo}`);
    }
  });
});
