import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 431 / T5+T25 (R30) — EL BACKFILL DE LOS HISTORICOS, EJECUTADO Y MEDIDO.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ UN BACKFILL SE MIDE, NO SE RAZONA. Este archivo NO comprueba que el SQL «diga» lo correcto:
// lo EJECUTA —el SQL REAL, extraido del archivo de migracion, no retecleado aqui— sobre filas
// sembradas que reproducen el estado del 2026-09-15, y mide lo que quedo.
//
// POR QUE EN UN ESQUEMA DESECHABLE Y NO EN `public`. Porque en `public` la migracion YA ESTA
// APLICADA y su `CHECK` de coherencia hace IMPOSIBLE sembrar el estado PREVIO: un `aprobado` sin
// datos de marca es exactamente lo que ese `CHECK` prohibe. Para medir un backfill hay que poder
// crear el «antes», y el «antes» ya no cabe en `public`. Se levanta por tanto una tabla minima —las
// columnas que el backfill lee y escribe— en un esquema propio, que se suelta al terminar.
//
// LO QUE MIDE, y son los tres numeros de T25:
//   (1) CUANTAS filas se backfillearon: las `aprobado`, TODAS, y ninguna otra;
//   (2) QUE se escribio: `conciliado_at = resuelto_at` (fecha ORIGINAL, no `now()`),
//       `conciliado_por = resuelto_por`, `monto_recibido = total_efectivo` y la NOTA visible;
//   (3) QUE NO SE TOCO: `updated_at` INTACTO, byte a byte. Es la prueba medible de que el backfill
//       no modifico nada mas — `updated_at` es `@updatedAt` de Prisma (capa de aplicacion), no un
//       trigger, asi que un `UPDATE` en SQL crudo lo deja igual… SI el `SET` no lo nombra.
//
// ⚠️ Y EL NUMERO QUE DECIDE LA FICHA: con `monto_recibido = total_efectivo`, el saldo del primer
// dia arranca en **0,00**. Con `total_general` —lo que decia el diseño original— arrancaria en
// **NEGATIVO** por el importe del SINPE (26,3 % del consolidado, medido en produccion). Ese caso
// esta abajo y es el que mata la mutacion.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const RAIZ = path.resolve(__dirname, "../../..");
const RUTA_MIGRACION = path.join(
  RAIZ,
  "db",
  "migrations",
  "20260919120100_cierre_bodega_conciliacion",
  "migration.sql",
);

/**
 * EL `UPDATE` DEL BACKFILL, TAL CUAL ESTA EN DISCO. Se extrae del archivo de migracion y NO se
 * escribe a mano: un backfill reteclado en el test se prueba a si mismo.
 */
function sentenciaDeBackfill(): string {
  const sql = fs.readFileSync(RUTA_MIGRACION, "utf8");
  const inicio = sql.indexOf('UPDATE "cierre_bodega"');
  if (inicio === -1) throw new Error("no se encontro el UPDATE del backfill en la migracion");
  const fin = sql.indexOf(";", inicio);
  if (fin === -1) throw new Error("el UPDATE del backfill no termina en `;`");
  return sql.slice(inicio, fin + 1);
}

describe("431/R30 — el backfill se extrae del disco, no se reteclea", () => {
  it("anti-vacuidad: la sentencia existe, es un UPDATE y toca las cuatro columnas", () => {
    // Si la extraccion devolviera algo vacio o equivocado, todo lo de abajo mediria otra cosa EN
    // VERDE. Este caso corre SIN base.
    const sql = sentenciaDeBackfill();
    expect(sql).toMatch(/^UPDATE "cierre_bodega"/);
    expect(sql).toContain('"conciliado_at"');
    expect(sql).toContain('"conciliado_por"');
    expect(sql).toContain('"monto_recibido"');
    expect(sql).toContain('"conciliado_nota"');
    expect(sql).toMatch(/WHERE "estado" = 'aprobado' AND "conciliado_at" IS NULL/);
  });
});

describeSiHayBase("431/R30 — el backfill, EJECUTADO sobre el estado del 2026-09-15", () => {
  const esquema = `t_431_bf_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let admin: PrismaClient;

  /**
   * La tabla MINIMA que el backfill necesita: las columnas que lee y las que escribe. Reusa el enum
   * REAL `public.cierre_estado` —no una copia— para que un estado que la base no admite reviente
   * aqui igual que reventaria en produccion.
   */
  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
    await admin.$executeRawUnsafe(
      `CREATE TABLE "${esquema}"."cierre_bodega" (
         "id"              TEXT PRIMARY KEY,
         "estado"          public."cierre_estado" NOT NULL,
         "total_efectivo"  DECIMAL(12,2) NOT NULL DEFAULT 0,
         "total_simpe"     DECIMAL(12,2) NOT NULL DEFAULT 0,
         "total_general"   DECIMAL(12,2) NOT NULL DEFAULT 0,
         "resuelto_at"     TIMESTAMP(3),
         "resuelto_por"    TEXT,
         "conciliado_at"   TIMESTAMP(3),
         "conciliado_por"  TEXT,
         "monto_recibido"  DECIMAL(12,2),
         "conciliado_nota" TEXT,
         "updated_at"      TIMESTAMP(3) NOT NULL)`,
    );
  }, 120_000);

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  async function limpiar(): Promise<void> {
    await admin.$executeRawUnsafe(`DELETE FROM "${esquema}"."cierre_bodega"`);
  }

  async function correrBackfill(): Promise<number> {
    // La MISMA sentencia del disco, cualificada al esquema desechable.
    const sql = sentenciaDeBackfill().replace(
      '"cierre_bodega"',
      `"${esquema}"."cierre_bodega"`,
    );
    return admin.$executeRawUnsafe(sql);
  }

  interface Fila {
    id: string;
    estado: string;
    efectivo: string;
    simpe: string;
    resueltoAt: string | null;
    resueltoPor: string | null;
  }

  async function sembrar(filas: Fila[]): Promise<void> {
    for (const f of filas) {
      await admin.$executeRawUnsafe(
        `INSERT INTO "${esquema}"."cierre_bodega"
           ("id","estado","total_efectivo","total_simpe","total_general",
            "resuelto_at","resuelto_por","updated_at")
         VALUES ($1, $2::public."cierre_estado", $3::decimal, $4::decimal,
                 ($3::decimal + $4::decimal), $5::timestamp, $6, '2026-09-01T10:00:00Z')`,
        f.id,
        f.estado,
        f.efectivo,
        f.simpe,
        f.resueltoAt,
        f.resueltoPor,
      );
    }
  }

  async function leer() {
    return admin.$queryRawUnsafe<
      {
        id: string;
        estado: string;
        conciliado_at: Date | null;
        conciliado_por: string | null;
        monto_recibido: string | null;
        conciliado_nota: string | null;
        updated_at: Date;
      }[]
    >(
      `SELECT "id","estado"::text AS estado,"conciliado_at","conciliado_por",
              "monto_recibido"::text AS monto_recibido,"conciliado_nota","updated_at"
         FROM "${esquema}"."cierre_bodega" ORDER BY "id"`,
    );
  }

  it("⭑ R30: backfillea TODAS las `aprobado` y NINGUNA otra", async () => {
    await limpiar();
    await sembrar([
      { id: "a1", estado: "aprobado", efectivo: "1000.00", simpe: "400.00", resueltoAt: "2026-09-05T15:00:00Z", resueltoPor: "u-maestro" },
      { id: "a2", estado: "aprobado", efectivo: "2000.00", simpe: "0.00", resueltoAt: "2026-09-06T09:30:00Z", resueltoPor: "u-admin" },
      { id: "s1", estado: "solicitado", efectivo: "500.00", simpe: "100.00", resueltoAt: null, resueltoPor: null },
      { id: "r1", estado: "rechazado", efectivo: "900.00", simpe: "0.00", resueltoAt: "2026-09-07T11:00:00Z", resueltoPor: "u-maestro" },
    ]);

    const afectadas = await correrBackfill();
    const filas = await leer();

    // (1) el numero: las DOS aprobadas, y nada mas.
    expect(afectadas).toBe(2);

    const porId = new Map(filas.map((f) => [f.id, f]));
    // La `solicitado` y la `rechazado` siguen LIMPIAS: si alguna se marcara, el `CHECK` de
    // coherencia de la migracion la habria rechazado en produccion y la migracion no terminaria.
    expect(porId.get("s1")!.conciliado_at).toBeNull();
    expect(porId.get("s1")!.monto_recibido).toBeNull();
    expect(porId.get("r1")!.conciliado_at).toBeNull();
    expect(porId.get("r1")!.monto_recibido).toBeNull();
  });

  it("⭑ R30: escribe la FECHA ORIGINAL y la persona ORIGINAL, no la de la migracion", async () => {
    await limpiar();
    await sembrar([
      { id: "a1", estado: "aprobado", efectivo: "1000.00", simpe: "400.00", resueltoAt: "2026-09-05T15:00:00Z", resueltoPor: "u-maestro" },
    ]);
    await correrBackfill();
    const [fila] = await leer();

    // Con `now()`, la antiguedad de R21 arrancaria falseada y el historial diria que 32
    // consolidaciones se recibieron en el mismo segundo.
    expect(fila.conciliado_at?.toISOString()).toBe("2026-09-05T15:00:00.000Z");
    expect(fila.conciliado_por).toBe("u-maestro");
  });

  it("⭑ R30/Q2: `monto_recibido` = `total_efectivo` -> EL SALDO DEL PRIMER DIA ES 0,00", async () => {
    // ESTE ES EL CASO QUE MATA LA MUTACION. Se siembran las proporciones REALES de produccion
    // (2026-09-15): ₡3.091.107 de efectivo y ₡1.105.790 de SINPE, ₡4.196.897 en total.
    //
    //   · con `total_efectivo`  -> saldo = 3.091.107 − 3.091.107 = 0,00      ✅ lo que Q1 decidio
    //   · con `total_general`   -> saldo = 3.091.107 − 4.196.897 = −1.105.790 ❌ la central le
    //     estaria debiendo ₡1,1 M a sus propias bodegas el primer dia.
    await limpiar();
    await sembrar([
      { id: "a1", estado: "aprobado", efectivo: "3091107.00", simpe: "1105790.00", resueltoAt: "2026-09-05T15:00:00Z", resueltoPor: "u-maestro" },
    ]);
    await correrBackfill();

    const [saldo] = await admin.$queryRawUnsafe<{ saldo: string }[]>(
      `SELECT COALESCE(SUM("total_efectivo" - COALESCE("monto_recibido",0)),0)::text AS saldo
         FROM "${esquema}"."cierre_bodega" WHERE "estado" <> 'rechazado'`,
    );

    expect(saldo.saldo).toBe("0.00");
    const [fila] = await leer();
    expect(fila.monto_recibido).toBe("3091107.00"); // el EFECTIVO, no el general (4196897.00)
  });

  it("⭑ R30: `updated_at` queda INTACTO — la prueba de que no se toco nada mas", async () => {
    await limpiar();
    await sembrar([
      { id: "a1", estado: "aprobado", efectivo: "1000.00", simpe: "400.00", resueltoAt: "2026-09-05T15:00:00Z", resueltoPor: "u-maestro" },
    ]);
    const [antes] = await leer();
    await correrBackfill();
    const [despues] = await leer();

    expect(despues.updated_at.toISOString()).toBe(antes.updated_at.toISOString());
  });

  it("⭑ R30: la NOTA es visible y distingue la conciliacion retroactiva de una real", async () => {
    // No es un backfill mudo: cada fila ensena en pantalla por que esta marcada. Quien mire la del
    // 2026-09-01 sabra que nadie conto ese dinero hoy.
    await limpiar();
    await sembrar([
      { id: "a1", estado: "aprobado", efectivo: "1000.00", simpe: "0.00", resueltoAt: "2026-09-05T15:00:00Z", resueltoPor: "u-maestro" },
    ]);
    await correrBackfill();
    const [fila] = await leer();

    expect(fila.conciliado_nota).toContain("Conciliación retroactiva (ficha 431)");
    expect(fila.conciliado_nota).toContain("sin verificación del efectivo recibido");
  });

  it("R30: correrlo DOS VECES no cambia nada (el `WHERE` lo hace idempotente)", async () => {
    // `AND "conciliado_at" IS NULL`: la segunda pasada no encuentra candidatas. Importa porque una
    // migracion se puede reintentar tras un fallo de red a mitad de despliegue.
    await limpiar();
    await sembrar([
      { id: "a1", estado: "aprobado", efectivo: "1000.00", simpe: "0.00", resueltoAt: "2026-09-05T15:00:00Z", resueltoPor: "u-maestro" },
    ]);
    const primera = await correrBackfill();
    const trasLaPrimera = await leer();
    const segunda = await correrBackfill();
    const trasLaSegunda = await leer();

    expect(primera).toBe(1);
    expect(segunda).toBe(0);
    expect(trasLaSegunda).toEqual(trasLaPrimera);
  });

  it("R30: con CERO aprobadas no hace nada y no falla (el caso de una base limpia)", async () => {
    // Es el caso de la base LOCAL de desarrollo y el de cualquier entorno nuevo: produccion se
    // vacio a proposito el 2026-08-25, asi que un cero aqui significa «aun no ha pasado».
    await limpiar();
    await sembrar([
      { id: "s1", estado: "solicitado", efectivo: "500.00", simpe: "0.00", resueltoAt: null, resueltoPor: null },
    ]);
    expect(await correrBackfill()).toBe(0);
  });
});
