import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  FECHA_CR,
  VENTANA,
  crearGestion,
  crearOrden,
  instanteCR,
  repositorio,
  sembrarBase,
  transicionDeRecoleccion,
} from "./_semilla-tablero-dia";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
} from "./db/_postgres-real";

// Feature 192 (B7.7) — R41, R42.
//
// El detalle es la SEGUNDA puerta a las mismas filas. Un adminSatelite que pida el detalle de
// un mensajero con ordenes en dos zonas tiene que recibir SOLO las de la suya, y las demas no
// pueden asomar "ni por conteo, ni por paginacion, ni por mensaje de error": si el `total`
// dijera 3 y las filas fueran 1, el conteo seria el oraculo que R41 prohibe.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const PAGINA = { pagina: 1, pageSize: 25 };

describeSiHayBase("detalle del mensajero — aislamiento (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("un satelite recibe SOLO las ordenes de su zona, y el total tampoco delata las otras (R41)", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      for (const [clave, zonaId] of [
        ["a1", base.zonaA],
        ["a2", base.zonaA],
        ["b1", base.zonaB],
        ["b2", base.zonaB],
        ["b3", base.zonaB],
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
        deA: await repo.listarOrdenesDelDia(
          VENTANA,
          { tipo: "zona", zonaId: base.zonaA },
          base.mensajero1,
          PAGINA,
        ),
        deB: await repo.listarOrdenesDelDia(
          VENTANA,
          { tipo: "zona", zonaId: base.zonaB },
          base.mensajero1,
          PAGINA,
        ),
        global: await repo.listarOrdenesDelDia(VENTANA, { tipo: "global" }, base.mensajero1, PAGINA),
      };
    });

    expect(resultado.deA.ordenes).toHaveLength(2);
    expect(resultado.deA.total).toBe(2);
    expect(resultado.deB.ordenes).toHaveLength(3);
    expect(resultado.deB.total).toBe(3);
    expect(resultado.global.total).toBe(5);
  });

  it("un mensajero inexistente y uno fuera de alcance devuelven exactamente lo mismo: vacio (R42)", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      // `mensajero2` SI existe y tiene ordenes, pero de la zona B.
      await crearOrden(tx, base, {
        clave: "de-b",
        estatus: "en_reparto",
        zonaId: base.zonaB,
        mensajeroId: base.mensajero2,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });

      const repo = repositorio(tx);
      const alcanceA = { tipo: "zona", zonaId: base.zonaA } as const;
      return {
        inexistente: await repo.listarOrdenesDelDia(
          VENTANA,
          alcanceA,
          "no-existe-este-id",
          PAGINA,
        ),
        fueraDeAlcance: await repo.listarOrdenesDelDia(
          VENTANA,
          alcanceA,
          base.mensajero2,
          PAGINA,
        ),
        sinOrdenesHoy: await repo.listarOrdenesDelDia(
          VENTANA,
          alcanceA,
          base.mensajero1,
          PAGINA,
        ),
      };
    });

    const vacio = { ordenes: [], total: 0 };
    expect(resultado.inexistente).toEqual(vacio);
    expect(resultado.fueraDeAlcance).toEqual(vacio);
    expect(resultado.sinOrdenesHoy).toEqual(vacio);
  });

  it("el detalle no muestra las ordenes de OTRO mensajero de la misma zona (R47)", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      await crearOrden(tx, base, {
        clave: "de-ana",
        estatus: "en_reparto",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });
      await crearOrden(tx, base, {
        clave: "de-beto",
        estatus: "en_reparto",
        mensajeroId: base.mensajero2,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });

      return repositorio(tx).listarOrdenesDelDia(
        VENTANA,
        { tipo: "global" },
        base.mensajero1,
        PAGINA,
      );
    });

    expect(resultado.total).toBe(1);
    expect(resultado.ordenes[0].cliente).toBe("Cliente de-ana");
  });

  it("las ordenes del dia ANTERIOR no aparecen en el detalle de hoy (R47)", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      await crearOrden(tx, base, {
        clave: "de-ayer",
        estatus: "en_reparto",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR("2001-06-14", "23:00"),
      });
      return repositorio(tx).listarOrdenesDelDia(
        VENTANA,
        { tipo: "global" },
        base.mensajero1,
        PAGINA,
      );
    });

    expect(resultado).toEqual({ ordenes: [], total: 0 });
  });

  it("trae el resultado del dia de cada orden y el estatus crudo, sin inventar etiquetas (R49)", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      const entregada = await crearOrden(tx, base, {
        clave: "entregada",
        estatus: "entregada",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });
      // Dos gestiones: gana la ULTIMA vigente, igual que en la tarjeta.
      await crearGestion(tx, {
        ordenId: entregada,
        mensajeroId: base.mensajero1,
        resultado: "reprogramada",
        at: instanteCR(FECHA_CR, "09:00"),
      });
      await crearGestion(tx, {
        ordenId: entregada,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: instanteCR(FECHA_CR, "13:00"),
      });
      await crearOrden(tx, base, {
        clave: "pendiente",
        estatus: "por_recoger",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "08:00"),
      });

      return repositorio(tx).listarOrdenesDelDia(
        VENTANA,
        { tipo: "global" },
        base.mensajero1,
        PAGINA,
      );
    });

    expect(resultado.total).toBe(2);
    // Orden determinista: `asignado_at` DESC. La de las 08:00 va primero.
    expect(resultado.ordenes.map((o) => o.estatus)).toEqual(["por_recoger", "entregada"]);
    expect(resultado.ordenes.map((o) => o.resultadoDelDia)).toEqual([null, "entregada"]);
  });

  it("una orden del camino de RECOLECCION aparece en el detalle con un asignadoAt util (R57)", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      const orden = await crearOrden(tx, base, {
        clave: "recolectada",
        estatus: "recolectando",
        mensajeroId: base.mensajero1,
        asignadoAt: null,
      });
      await transicionDeRecoleccion(tx, base, orden, instanteCR(FECHA_CR, "08:00"));

      return repositorio(tx).listarOrdenesDelDia(
        VENTANA,
        { tipo: "global" },
        base.mensajero1,
        PAGINA,
      );
    });

    expect(resultado.total).toBe(1);
    // `asignado_at` es NULL en la base (R59: no se estampa). El detalle cae al instante de la
    // transicion, que es cuando la orden paso de verdad a manos del mensajero.
    expect(resultado.ordenes[0].asignadoAt).toBe(instanteCR(FECHA_CR, "08:00").toISOString());
  });

  it("la paginacion recorta la pagina pero no el total (R55)", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      for (let i = 0; i < 5; i += 1) {
        await crearOrden(tx, base, {
          clave: `p${i}`,
          estatus: "en_reparto",
          mensajeroId: base.mensajero1,
          asignadoAt: instanteCR(FECHA_CR, `0${7 + i}:00`),
        });
      }
      const repo = repositorio(tx);
      return {
        primera: await repo.listarOrdenesDelDia(VENTANA, { tipo: "global" }, base.mensajero1, {
          pagina: 1,
          pageSize: 2,
        }),
        tercera: await repo.listarOrdenesDelDia(VENTANA, { tipo: "global" }, base.mensajero1, {
          pagina: 3,
          pageSize: 2,
        }),
      };
    });

    expect(resultado.primera.ordenes).toHaveLength(2);
    expect(resultado.primera.total).toBe(5);
    expect(resultado.tercera.ordenes).toHaveLength(1);
    expect(resultado.tercera.total).toBe(5);
  });
});
