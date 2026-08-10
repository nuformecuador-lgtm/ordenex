import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  FECHA_CR,
  VENTANA,
  crearOrden,
  instanteCR,
  repositorio,
  sembrarBase,
  sumaDeLosOcho,
} from "./_semilla-tablero-dia";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
} from "./db/_postgres-real";

// Feature 192 (B2.5) — R6, R10.
//
// LA TRAMPA DE ESTE ARCHIVO ES DELIBERADA: los dos mensajeros de la siembra tienen
// `usuario.zona_id` = zona B, y sus ordenes viven en la zona A. Es la confusion natural —al
// agrupar por mensajero, la zona que se tiene a mano es la SUYA— y es exactamente el error que
// `alcance.ts:197-198` prohibe: la zona de la orden esta CONGELADA y puede diferir de la del
// mensajero que la gestiono.
//
// Si el recorte mirara la zona del usuario, el satelite de B veria estas ordenes y el de A no:
// justo al reves de lo que dice R6. Por eso el test comprueba LAS DOS direcciones.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Solo las filas de ESTA siembra: la base de desarrollo puede tener lo que quiera. */
function mias<T extends { mensajeroNombre: string }>(filas: readonly T[]): T[] {
  return filas.filter((f) => f.mensajeroNombre.endsWith("Prueba"));
}

describeSiHayBase("tablero del dia — aislamiento multi-tenant (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("el recorte mira la zona de la ORDEN, nunca la del mensajero asignado (R6)", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      // Mensajero de la zona B con una orden de la zona A.
      await crearOrden(tx, base, {
        clave: "de-zona-a",
        estatus: "en_reparto",
        zonaId: base.zonaA,
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });

      const repo = repositorio(tx);
      return {
        deA: mias(await repo.contarPorMensajero(VENTANA, { tipo: "zona", zonaId: base.zonaA })),
        deB: mias(await repo.contarPorMensajero(VENTANA, { tipo: "zona", zonaId: base.zonaB })),
        global: mias(await repo.contarPorMensajero(VENTANA, { tipo: "global" })),
      };
    });

    // El satelite de A SI la ve: la orden es de su zona, aunque el mensajero no lo sea.
    expect(resultado.deA).toHaveLength(1);
    expect(resultado.deA[0]).toMatchObject({ asignadas: 1, enReparto: 1 });
    // El satelite de B NO la ve, aunque el mensajero SI sea de su zona.
    expect(resultado.deB).toEqual([]);
    // Y el maestro ve todo (R4).
    expect(resultado.global).toHaveLength(1);
  });

  it("un satelite ve exclusivamente las ordenes de SU zona, ni una mas (R5)", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      for (const [clave, zonaId] of [
        ["a1", base.zonaA],
        ["a2", base.zonaA],
        ["b1", base.zonaB],
      ] as const) {
        await crearOrden(tx, base, {
          clave,
          estatus: "en_reparto",
          zonaId,
          mensajeroId: base.mensajero1,
          asignadoAt: instanteCR(FECHA_CR, "07:00"),
        });
      }

      const repo = repositorio(tx);
      return {
        deA: mias(await repo.contarPorMensajero(VENTANA, { tipo: "zona", zonaId: base.zonaA })),
        deB: mias(await repo.contarPorMensajero(VENTANA, { tipo: "zona", zonaId: base.zonaB })),
        global: mias(await repo.contarPorMensajero(VENTANA, { tipo: "global" })),
      };
    });

    expect(resultado.deA[0]).toMatchObject({ asignadas: 2 });
    expect(resultado.deB[0]).toMatchObject({ asignadas: 1 });
    expect(resultado.global[0]).toMatchObject({ asignadas: 3 });
    // La identidad se cumple en CADA alcance: el recorte no descuadra los cubos (R25).
    for (const filas of Object.values(resultado)) {
      for (const f of filas) expect(f.asignadas).toBe(sumaDeLosOcho(f));
    }
  });

  it("el recorte esta en el WHERE: la fila de otra zona no se trae para descartarla despues (R10)", async () => {
    // Se mide por el CONTEO devuelto, que es lo unico observable desde fuera: si la fila de la
    // otra zona llegara a memoria, el `asignadas` del satelite la incluiria o el codigo tendria
    // que filtrarla despues —y ese "despues" es una capa mas de la que fiarse.
    const filas = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      await crearOrden(tx, base, {
        clave: "ajena",
        estatus: "entregada",
        zonaId: base.zonaB,
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });
      return (await repositorio(tx).contarPorMensajero(VENTANA, {
        tipo: "zona",
        zonaId: base.zonaA,
      })).filter((f) => f.mensajeroNombre.endsWith("Prueba"));
    });

    expect(filas).toEqual([]);
  });
});
