import { describe, it, expect, beforeAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { seedGeografia, type GeoRow } from "@/scripts/seed-zonas";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 375 — **EL SEED CRUZA POR `codigo_dta`, Y POR ESO EL RENOMBRADO ES SEGURO.** Contra
 * Postgres.
 *
 * ES EL TEST QUE SOSTIENE LA FICHA. La 374 dejo el renombrado fuera con un motivo medido:
 * `scripts/seed-zonas.ts` resolvia la geografia por NOMBRE EXACTO y, si no la encontraba, CREABA.
 * Renombrar un distrito hacia que la siguiente corrida del seed creara un DUPLICADO ACTIVO con el
 * nombre viejo, y a partir de ahi `resolveGeo` respondia «distrito ambiguo en el canton» a toda
 * carga masiva que lo mencionara. El `@@unique([canton_id, nombre])` NO lo atrapa: los nombres
 * difieren.
 *
 * ⚠️ POR QUE CONTRA POSTGRES Y NO CON EL DOBLE EN MEMORIA de `tests/unit/scripts/seed-zonas.test.ts`.
 * Lo que se afirma es que el `WHERE` del seed encuentra la fila por una COLUMNA CON INDICE UNICO
 * mientras el nombre ya no coincide. Un doble compara claves de un objeto: pasaria en verde con el
 * `where` mutado, que es exactamente el defecto que este archivo existe para detectar.
 *
 * LA MUTACION QUE TIENE QUE PONERLO ROJO: devolver `upsertDistrito` (o `resolverNodo`) a buscar
 * solo por nombre. Con eso, «el renombrado no duplica» crea una segunda fila y el test cae.
 *
 * NADA de `if (!x) return;`: el corpus se siembra dentro de la transaccion o el test revienta.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `f375s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/**
 * Codigos DE PRUEBA con la FORMA real (1 / 3 / 5 digitos) pero fuera del rango de la DTA: las
 * provincias reales van de `1` a `7`, asi que el `9` esta libre y no puede chocar con el catalogo
 * ya sembrado. Los dos ultimos digitos se aleatorizan para no chocar entre corridas paralelas.
 */
const BLOQUE = String(100 + Math.floor(Math.random() * 900)); // 3 digitos
const CODIGO_DISTRITO = `9${BLOQUE}${String(Math.floor(Math.random() * 10))}`; // 5 digitos
const CODIGO_CANTON = CODIGO_DISTRITO.slice(0, 3);
const CODIGO_PROVINCIA = CODIGO_DISTRITO.slice(0, 1);

const PROVINCIA = `Provincia ${SUFIJO}`;
const CANTON = `Canton ${SUFIJO}`;
const NOMBRE_VIEJO = `Distrito Viejo ${SUFIJO}`;
const NOMBRE_NUEVO = `Distrito Renombrado ${SUFIJO}`;

/** La fila del .xlsx: sigue trayendo el nombre VIEJO, que es justo el caso peligroso. */
function filaDelXlsx(overrides: Partial<GeoRow> = {}): GeoRow {
  return {
    provincia: PROVINCIA,
    canton: CANTON,
    distrito: NOMBRE_VIEJO,
    codigoDta: CODIGO_DISTRITO,
    ...overrides,
  };
}

describeSiHayBase("375 — el seed cruza por codigo, no por nombre (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  interface Sembrado {
    provinciaId: string;
    cantonId: string;
    distritoId: string;
  }

  /**
   * Siembra la terna CON sus codigos (como queda tras la migracion de backfill) y, opcionalmente,
   * sin ellos.
   */
  async function conCorpus<T>(
    opciones: { conCodigos: boolean },
    fn: (ctx: {
      s: Sembrado;
      tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
      distritosDelCanton: () => Promise<{ id: string; nombre: string; codigoDta: string | null }[]>;
    }) => Promise<T>,
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);

      const provinciaId = (
        await tx.provincia.create({
          data: {
            nombre: PROVINCIA,
            codigoDta: opciones.conCodigos ? CODIGO_PROVINCIA : null,
          },
          select: { id: true },
        })
      ).id;
      const cantonId = (
        await tx.canton.create({
          data: {
            nombre: CANTON,
            provinciaId,
            codigoDta: opciones.conCodigos ? CODIGO_CANTON : null,
          },
          select: { id: true },
        })
      ).id;
      const distritoId = (
        await tx.distrito.create({
          data: {
            nombre: NOMBRE_VIEJO,
            cantonId,
            codigoDta: opciones.conCodigos ? CODIGO_DISTRITO : null,
          },
          select: { id: true },
        })
      ).id;

      const distritosDelCanton = () =>
        tx.distrito.findMany({
          where: { cantonId },
          select: { id: true, nombre: true, codigoDta: true },
          orderBy: { nombre: "asc" },
        });

      return fn({ s: { provinciaId, cantonId, distritoId }, tx, distritosDelCanton });
    });
  }

  // ===============================================================================================
  // EL CASO QUE ABRE LA FICHA
  // ===============================================================================================

  describe("375 — un nodo RENOMBRADO no se duplica en la siguiente corrida del seed", () => {
    it("⭑ el seed lo encuentra por su codigo aunque el .xlsx traiga el nombre viejo", async () => {
      await conCorpus({ conCodigos: true }, async ({ s, tx, distritosDelCanton }) => {
        // El maestro renombra el distrito desde /configuracion/geografia.
        await tx.distrito.update({ where: { id: s.distritoId }, data: { nombre: NOMBRE_NUEVO } });
        expect(await distritosDelCanton()).toHaveLength(1);

        // Corre el seed con el .xlsx de siempre, que sigue diciendo el nombre VIEJO.
        const salida = await seedGeografia(tx, [filaDelXlsx()]);

        // 1. NO se creo ninguna fila nueva. Con el cruce por nombre habria DOS.
        const despues = await distritosDelCanton();
        expect(
          despues,
          "el seed creo un duplicado: volvio a cruzar por nombre y el renombrado deja de ser seguro",
        ).toHaveLength(1);

        // 2. Es EL MISMO nodo, con su id y su codigo.
        expect(despues[0].id).toBe(s.distritoId);
        expect(despues[0].codigoDta).toBe(CODIGO_DISTRITO);
        expect(salida.distritoByTerna.size).toBe(1);
        expect([...salida.distritoByTerna.values()]).toEqual([s.distritoId]);

        // 3. Y el nombre que decidio el maestro SIGUE EN PIE: el .xlsx es la foto de la DTA, no la
        //    autoridad sobre la etiqueta.
        expect(despues[0].nombre).toBe(NOMBRE_NUEVO);

        // 4. Los tres niveles se resolvieron por CODIGO, ninguno se creo.
        expect(salida.resolucion.porCodigo).toBe(3);
        expect(salida.resolucion.creados).toBe(0);
        expect(salida.resolucion.porNombre).toBe(0);
      });
    });

    it("tampoco se duplican el canton ni la provincia renombrados", async () => {
      await conCorpus({ conCodigos: true }, async ({ s, tx }) => {
        await tx.provincia.update({
          where: { id: s.provinciaId },
          data: { nombre: `Otra Provincia ${SUFIJO}` },
        });
        await tx.canton.update({
          where: { id: s.cantonId },
          data: { nombre: `Otro Canton ${SUFIJO}` },
        });

        const salida = await seedGeografia(tx, [filaDelXlsx()]);
        expect(salida.resolucion.creados).toBe(0);
        expect(salida.resolucion.porCodigo).toBe(3);

        expect(
          await tx.provincia.count({ where: { nombre: { in: [PROVINCIA, `Otra Provincia ${SUFIJO}`] } } }),
        ).toBe(1);
        expect(
          await tx.canton.count({ where: { provinciaId: s.provinciaId } }),
        ).toBe(1);
      });
    });

    it("re-correr el seed dos veces sigue sin duplicar (idempotente)", async () => {
      await conCorpus({ conCodigos: true }, async ({ s, tx, distritosDelCanton }) => {
        await tx.distrito.update({ where: { id: s.distritoId }, data: { nombre: NOMBRE_NUEVO } });
        await seedGeografia(tx, [filaDelXlsx()]);
        await seedGeografia(tx, [filaDelXlsx()]);
        const despues = await distritosDelCanton();
        expect(despues).toHaveLength(1);
        expect(despues[0].id).toBe(s.distritoId);
      });
    });
  });

  // ===============================================================================================
  // El respaldo por nombre, y la adopcion que lo hace converger
  // ===============================================================================================

  describe("375 — el nombre sigue siendo el respaldo de lo que no tiene codigo", () => {
    it("un nodo SIN codigo se resuelve por nombre y ADOPTA el de la fila", async () => {
      await conCorpus({ conCodigos: false }, async ({ s, tx, distritosDelCanton }) => {
        const salida = await seedGeografia(tx, [filaDelXlsx()]);

        expect(await distritosDelCanton()).toHaveLength(1);
        expect(salida.resolucion.porNombre).toBe(3);
        expect(salida.resolucion.porCodigo).toBe(0);
        expect(salida.resolucion.creados).toBe(0);
        expect(salida.resolucion.codigosAdoptados).toBe(3);

        // Tras adoptarlo, el nodo YA tiene clave estable: el siguiente renombrado es seguro.
        const distrito = await tx.distrito.findUniqueOrThrow({
          where: { id: s.distritoId },
          select: { codigoDta: true },
        });
        expect(distrito.codigoDta).toBe(CODIGO_DISTRITO);
      });
    });

    it("con el codigo ya adoptado, un renombrado posterior tampoco duplica", async () => {
      await conCorpus({ conCodigos: false }, async ({ s, tx, distritosDelCanton }) => {
        await seedGeografia(tx, [filaDelXlsx()]); // adopta los codigos
        await tx.distrito.update({ where: { id: s.distritoId }, data: { nombre: NOMBRE_NUEVO } });
        const segunda = await seedGeografia(tx, [filaDelXlsx()]);

        expect(await distritosDelCanton()).toHaveLength(1);
        expect(segunda.resolucion.porCodigo).toBe(3);
        expect(segunda.resolucion.creados).toBe(0);
      });
    });

    it("si el .xlsx NO trae codigo, el cruce cae al nombre y el renombrado SI duplicaria", async () => {
      // Se afirma el limite conocido en vez de esconderlo: sin codigo en la fila no hay clave
      // estable posible, y este es exactamente el mundo del que viene la ficha.
      await conCorpus({ conCodigos: true }, async ({ s, tx, distritosDelCanton }) => {
        await tx.distrito.update({ where: { id: s.distritoId }, data: { nombre: NOMBRE_NUEVO } });
        const salida = await seedGeografia(tx, [filaDelXlsx({ codigoDta: "" })]);

        expect(salida.resolucion.creados).toBe(1); // el distrito, con su nombre viejo
        expect(await distritosDelCanton()).toHaveLength(2);
      });
    });

    it("un codigo MAL FORMADO se ignora y se cae al nombre, en vez de cruzar con nada", async () => {
      await conCorpus({ conCodigos: true }, async ({ tx, distritosDelCanton }) => {
        // 4 digitos: no es un codigo DTA. Si se aceptara, no encontraria nada y CREARIA.
        const salida = await seedGeografia(tx, [filaDelXlsx({ codigoDta: "9801" })]);
        expect(salida.resolucion.porNombre).toBe(3);
        expect(salida.resolucion.creados).toBe(0);
        expect(salida.resolucion.codigosAdoptados).toBe(0);
        expect(await distritosDelCanton()).toHaveLength(1);
      });
    });
  });

  // ===============================================================================================
  // Alta de un nodo que no estaba
  // ===============================================================================================

  describe("375 — lo que el seed SI crea nace con su codigo", () => {
    it("un distrito ausente se crea y guarda su `codigo_dta`", async () => {
      await conCorpus({ conCodigos: true }, async ({ tx, distritosDelCanton }) => {
        const codigoNuevo = `${CODIGO_CANTON}9${String(Math.floor(Math.random() * 10))}`;
        const salida = await seedGeografia(tx, [
          filaDelXlsx({ distrito: `Distrito Nuevo ${SUFIJO}`, codigoDta: codigoNuevo }),
        ]);
        expect(salida.resolucion.creados).toBe(1);

        const filas = await distritosDelCanton();
        expect(filas).toHaveLength(2);
        const nuevo = filas.find((f) => f.nombre === `Distrito Nuevo ${SUFIJO}`);
        expect(nuevo?.codigoDta).toBe(codigoNuevo);
      });
    });
  });
});
