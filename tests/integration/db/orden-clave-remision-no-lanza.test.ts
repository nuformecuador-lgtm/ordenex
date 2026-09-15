import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";
import { sembrarBase, estatusId, type BaseSembrada, type TxDeTest } from "./_semilla-rollup";

// FICHA 423 / R5 + R17 — LA CLAVE GENERADA NO PUEDE BLOQUEAR LA CREACION DE ORDENES.
//
// EL RIESGO QUE ESTE ARCHIVO MIDE, dicho sin rodeos: una columna GENERADA se evalua EN EL
// `INSERT`. Una expresion que lance ante una entrada rara no «ordena mal»: IMPIDE CREAR LA
// ORDEN, y en la carga masiva —un `createMany` por lotes— se lleva por delante el lote entero.
// La via «obvia» (castear el numero a `bigint`) hace exactamente eso: `'NA-'::bigint` lanza
// `invalid input syntax for type bigint`. Por eso la expresion rellena TEXTO con `lpad` y no
// convierte nada, y por eso esto se prueba metiendo la basura de verdad en Postgres de verdad.
//
// LA OTRA MITAD (R17): la clave la calcula la BASE y ninguna escritura de la aplicacion puede
// fijarla. No es una convencion que haya que recordar — Postgres RECHAZA el `INSERT`. Aqui se
// ejerce el rechazo, en vez de deducirlo del DDL.
//
// Todo corre dentro de una transaccion que SIEMPRE se revierte. NO hay ningun `if (!datos)
// return;`: `sembrarBase` revienta si la base local no tiene catalogos.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const T_RAROS = new Date(Date.UTC(2001, 8, 10, 12, 0, 0));

/**
 * LA TABLA DE `design §2.2`, ESCRITA A MANO — incluidos los dos valores que aquel documento no
 * enumeraba y que aqui se MIDIERON contra el Postgres local el 2026-09-14 (`'0'` y la cadena con
 * espacios al borde). Cada par es una promesa concreta: la remision entra, y la clave que sale
 * es esta y no otra.
 *
 * Ninguno de estos valores se calcula: se leen. Derivarlos de la misma expresion que la columna
 * usa dejaria el caso verde por construccion.
 */
const RAROS: readonly { remision: string; clave: string; porque: string }[] = [
  {
    remision: "SIN NUMERO",
    clave: "SINNUMERO000000000000000000",
    porque: "el espacio se cae del prefijo; sin digitos, el relleno queda a cero",
  },
  {
    remision: "---",
    clave: "000000000000000000",
    porque: "sin letras ni digitos: cae con las numericas, al principio",
  },
  {
    remision: "NA-",
    clave: "NA000000000000000000",
    porque: "serie sin numero: encabeza su propia serie",
  },
  {
    remision: "\u{1F4E6}-5",
    clave: "000000000000000005",
    porque: "el emoji se cae del prefijo (no es alfanumerico ASCII)",
  },
  {
    remision: "0",
    clave: "000000000000000000",
    porque: "un solo digito, rellenado a 18",
  },
  {
    remision: "1234567890123456789012345",
    clave: "123456789012345678",
    porque: "25 digitos: `lpad` TRUNCA a 18, sin error",
  },
  {
    remision: "  42  ",
    clave: "42000000000000000000",
    porque:
      "con espacios al borde los digitos NO estan al final, asi que caen en el PREFIJO y el " +
      "relleno queda a cero: degrada el orden, no falla",
  },
  {
    remision: "NA-1",
    clave: "NA000000000000000001",
    porque: "colision conocida con `N-A1` (la clave no es una identidad)",
  },
  {
    remision: "N-A1",
    clave: "NA000000000000000001",
    porque: "colision conocida con `NA-1`",
  },
];

function datosDeOrden(base: BaseSembrada, numRemision: string, id = randomUUID()) {
  return {
    id,
    numRemision,
    destinatario: "Persona De Prueba",
    telefonoDest: "80000000",
    producto: "caja",
    estatusId: estatusId(base, "en_bodega_central"),
    tiendaId: base.tienda1,
    zonaId: base.zonaA,
    provinciaId: base.provinciaId,
    cantonId: base.cantonId,
    createdAt: T_RAROS,
  };
}

interface Corpus {
  tx: TxDeTest;
  base: BaseSembrada;
}

describeSiHayBase("una remision fuera de patron no bloquea la creacion (ficha 423 / R5)", () => {
  let prisma: PrismaClient;
  let conBase: <T>(fn: (ctx: Corpus) => Promise<T>) => Promise<T>;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
    conBase = (fn) =>
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        return fn({ tx, base: await sembrarBase(tx) });
      });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Las claves que Postgres calculo, leidas por SQL crudo (el cliente omite la columna). */
  async function clavesDe(tx: TxDeTest, ids: string[]): Promise<Record<string, string>> {
    const filas = await tx.$queryRawUnsafe<{ num_remision: string; clave_remision: string }[]>(
      `SELECT num_remision, clave_remision FROM orden WHERE id = ANY($1::text[])`,
      ids,
    );
    return Object.fromEntries(filas.map((f) => [f.num_remision, f.clave_remision]));
  }

  it("las NUEVE remisiones raras se crean UNA A UNA, sin una sola excepcion", async () => {
    const { creadas, claves } = await conBase(async ({ tx, base }) => {
      const ids: string[] = [];
      for (const caso of RAROS) {
        // Sin `try`: si alguna lanzara, el test se cae AQUI y con el nombre del valor delante.
        const fila = await tx.orden.create({
          data: datosDeOrden(base, caso.remision),
          select: { id: true },
        });
        ids.push(fila.id);
      }
      return { creadas: ids.length, claves: await clavesDe(tx, ids) };
    });

    expect(creadas).toBe(RAROS.length);
    // Y la clave de cada una es la de la tabla, valor por valor.
    for (const caso of RAROS) {
      expect(claves[caso.remision], `${caso.remision} — ${caso.porque}`).toBe(caso.clave);
    }
  });

  it("las dos COLISIONES conocidas conviven: dos remisiones, una sola clave, cero error", async () => {
    // Declarado en `design §2.2`: la clave NO es una identidad, es una clave de ORDEN. El orden
    // total lo cierra el desempate por `id` (ficha 352), no la unicidad de la clave.
    const claves = await conBase(async ({ tx, base }) => {
      const ids: string[] = [];
      for (const r of ["---", "0", "NA-1", "N-A1"]) {
        const fila = await tx.orden.create({
          data: datosDeOrden(base, r),
          select: { id: true },
        });
        ids.push(fila.id);
      }
      return clavesDe(tx, ids);
    });

    expect(claves["---"]).toBe(claves["0"]);
    expect(claves["NA-1"]).toBe(claves["N-A1"]);
    expect(claves["---"]).not.toBe(claves["NA-1"]);
  });

  it("un LOTE con una fila rara en medio entra COMPLETO (la carga masiva no se cae)", async () => {
    // ÉSTE es el caso que justifica todo el archivo. La carga masiva inserta con un `createMany`
    // dentro de una transaccion: si la expresion lanzara al evaluar UNA fila, se perderian las
    // 500 del lote y la tienda veria un error sin saber cual de sus filas lo causo.
    const { insertadas, remisiones } = await conBase(async ({ tx, base }) => {
      const lote = [
        "LOTE-001",
        "SIN NUMERO",
        "LOTE-002",
        "\u{1F4E6}-5",
        "LOTE-003",
        "---",
        "LOTE-004",
      ];
      const filas = lote.map((r) => datosDeOrden(base, r));
      const salida = await tx.orden.createMany({ data: filas });
      const leidas = await tx.orden.findMany({
        where: { id: { in: filas.map((f) => f.id) } },
        select: { numRemision: true },
        orderBy: { numRemision: "asc" },
      });
      return { insertadas: salida.count, remisiones: leidas.map((f) => f.numRemision).sort() };
    });

    expect(insertadas).toBe(7);
    expect(remisiones).toEqual(
      ["LOTE-001", "LOTE-002", "LOTE-003", "LOTE-004", "SIN NUMERO", "\u{1F4E6}-5", "---"].sort(),
    );
  });

  it("R17 — un intento de ESCRIBIR la clave lo rechaza la BASE, y la orden no nace", async () => {
    // `GENERATED ALWAYS` hace imposible por construccion el defecto de `design §5.3`: una
    // columna que escribe el codigo tiene tantos puntos de olvido como escrituras tenga
    // `num_remision`, y ninguno rompe el build. Aqui se EJERCE el rechazo.
    //
    // El SAVEPOINT es necesario: en Postgres un error aborta la transaccion entera, y sin el
    // punto de retorno las aserciones de despues no podrian consultar nada.
    const { mensaje, filasConEsaRemision } = await conBase(async ({ tx, base }) => {
      const remision = "R17-INTENTO-DE-ESCRITURA";
      await tx.$executeRawUnsafe("SAVEPOINT intento_r17");
      let capturado: string | null = null;
      try {
        await tx.orden.create({
          data: {
            ...datosDeOrden(base, remision),
            // Escritura DELIBERADA de la columna generada. Compila (Prisma no sabe que es
            // generada) y es justo por eso que la garantia tiene que venir de la base.
            claveRemision: "CLAVE-COLADA-A-MANO",
          },
          select: { id: true },
        });
      } catch (error) {
        capturado = error instanceof Error ? error.message : String(error);
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT intento_r17");
      }
      const filas = await tx.orden.count({ where: { numRemision: remision } });
      return { mensaje: capturado, filasConEsaRemision: filas };
    });

    // Si `mensaje` fuera null, la base habria ACEPTADO la escritura: R17 roto.
    expect(mensaje, "la base acepto escribir `clave_remision`").not.toBeNull();
    expect(mensaje).toMatch(/clave_remision/);
    expect(filasConEsaRemision).toBe(0);
  });
});
