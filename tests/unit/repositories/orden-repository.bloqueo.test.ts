import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 41/D1 (R12/R16/R17) — consultas del bloqueo derivado. Mockea Prisma (sin DB real).
//
// ⚠️ REESCRITO POR LA FEATURE 241 (2026-08-20), CON LA REGLA FIRMADA POR EL HUMANO DELANTE.
//
// Lo que decia este archivo hasta hoy —«cambia el umbral, no el conjunto»— describia el estado del
// 2026-08-18: los tres estados no-`aprobado` bloqueaban y se toleraba UNO. Ese tope era
// INALCANZABLE (109/R30: un mensajero nunca tiene 2 cierres abiertos), asi que no era un umbral,
// era el predicado apagado. Los siete casos del tope median una frontera que la base de datos no
// puede cruzar.
//
// AHORA SE MIDEN LAS CUATRO PROPIEDADES DE LA REGLA, y son cuatro, no una:
//
//   (1) con `solicitado`  -> PUEDE gestionar   (no bloquea: es espera del ADMIN)
//   (2) con `vencido`     -> NO puede gestionar
//   (3) con `rechazado`   -> NO puede gestionar
//   (4) con cualquiera de los tres -> RECIBE ASIGNACIONES (aqui, la mitad del repo: el UPDATE del
//       satelite ya no lleva guardia de cierre; ver `orden-repository.asignacion-satelite.test.ts`)
//
// EL DOBLE DE PRISMA FILTRA DE VERDAD. `cierreDia.findMany` respeta el `where.estado.in` que el
// repositorio le pasa, en vez de devolver una lista fija. Sin eso, «con `solicitado` no bloquea»
// pasaria en verde tambien si el repositorio preguntara por los tres estados y el doble devolviera
// vacio por casualidad: se estaria midiendo el doble, no la lista. Con el filtro puesto, devolver
// `solicitado` a `ESTADOS_CIERRE_BLOQUEAN_GESTION` pone rojo el caso (1) — comprobado por mutacion.

/** Un cierre_dia, reducido a lo que estas consultas miran. */
type CierreFila = { mensajeroId: string; estado: string };

/**
 * Doble de Prisma que FILTRA como la base: aplica `where.estado.in` y `where.mensajeroId.in` sobre
 * `cierres`, y deduplica si la consulta pide `distinct`. Es el instrumento de todo el archivo.
 */
function buildPrisma(cierres: CierreFila[] = [], overrides: Record<string, unknown> = {}) {
  const findMany = vi.fn(
    async (args: {
      where: { mensajeroId?: { in: string[] }; estado: { in: string[] } };
      distinct?: string[];
    }) => {
      const ids = args.where.mensajeroId?.in;
      const filas = cierres.filter(
        (c) =>
          args.where.estado.in.includes(c.estado) && (ids === undefined || ids.includes(c.mensajeroId)),
      );
      if (!args.distinct?.includes("mensajeroId")) return filas.map((c) => ({ mensajeroId: c.mensajeroId }));
      return [...new Set(filas.map((c) => c.mensajeroId))].map((mensajeroId) => ({ mensajeroId }));
    },
  );
  return {
    usuario: { findMany: vi.fn() },
    cierreDia: { findMany, count: vi.fn() },
    cierreBodega: { count: vi.fn() },
    ...overrides,
  };
}

function repoCon(prisma: ReturnType<typeof buildPrisma>) {
  return new OrdenRepository(prisma as unknown as PrismaClient);
}

describe("OrdenRepository.findMensajerosBloqueadosParaGestion (R12/R16 + 109/R29 + feature 241)", () => {
  // ===== LAS TRES PRIMERAS PROPIEDADES, UNA POR ESTADO =====

  it("PROPIEDAD 1 — con un cierre `solicitado` NO se bloquea: puede gestionar y cobrar", async () => {
    // El caso que la regla firmada protege. `solicitado` es ESPERA DEL ADMIN: el mensajero ya hizo
    // lo suyo. Bloquearlo aqui lo castiga por una demora ajena de 8,2 h de mediana y 22,1 h en p90.
    const prisma = buildPrisma([{ mensajeroId: "m1", estado: "solicitado" }]);

    expect(await repoCon(prisma).findMensajerosBloqueadosParaGestion(["m1"])).toEqual(new Set());
  });

  it("PROPIEDAD 2 — con un cierre `vencido` SE BLOQUEA", async () => {
    // La pelota esta en SU tejado: solo el puede solicitar el vencido (111/R9, la salida existe).
    const prisma = buildPrisma([{ mensajeroId: "m1", estado: "vencido" }]);

    expect(await repoCon(prisma).findMensajerosBloqueadosParaGestion(["m1"])).toEqual(
      new Set(["m1"]),
    );
  });

  it("PROPIEDAD 3 — con un cierre `rechazado` SE BLOQUEA", async () => {
    // Feature 109/R29: `rechazado` dejo de ser terminal y es RE-SOLICITABLE por el mensajero.
    const prisma = buildPrisma([{ mensajeroId: "m1", estado: "rechazado" }]);

    expect(await repoCon(prisma).findMensajerosBloqueadosParaGestion(["m1"])).toEqual(
      new Set(["m1"]),
    );
  });

  it("`aprobado` no bloquea: es el unico TERMINAL (dinero conciliado)", async () => {
    const prisma = buildPrisma([{ mensajeroId: "m1", estado: "aprobado" }]);

    expect(await repoCon(prisma).findMensajerosBloqueadosParaGestion(["m1"])).toEqual(new Set());
  });

  // ===== EL CRITERIO ES «TIENE ALGUNO», SIN TOPE =====

  it("UN SOLO cierre bloqueante basta: no hay umbral que superar", async () => {
    // Entre el 2026-08-18 y el 2026-08-20 hacian falta DOS, y 109/R30 impide que existan dos.
    // Que UNO baste es lo que devuelve el predicado a la vida.
    const prisma = buildPrisma([{ mensajeroId: "m1", estado: "vencido" }]);

    expect(await repoCon(prisma).findMensajerosBloqueadosParaGestion(["m1"])).toEqual(
      new Set(["m1"]),
    );
  });

  it("separa, en la misma consulta, a quien bloquea de quien no", async () => {
    const prisma = buildPrisma([
      { mensajeroId: "m1", estado: "vencido" },
      { mensajeroId: "m2", estado: "solicitado" }, // espera al admin: sigue gestionando
      { mensajeroId: "m3", estado: "rechazado" },
      { mensajeroId: "m4", estado: "aprobado" },
    ]);

    expect(
      await repoCon(prisma).findMensajerosBloqueadosParaGestion(["m1", "m2", "m3", "m4"]),
    ).toEqual(new Set(["m1", "m3"]));
  });

  it("la consulta pide SOLO los dos estados que bloquean, con `distinct` sobre el mensajero", async () => {
    // El WHERE, medido donde vive. Un test de servicio con dobles nunca ve esta lista.
    const prisma = buildPrisma();

    await repoCon(prisma).findMensajerosBloqueadosParaGestion(["m1", "m2"]);

    const arg = prisma.cierreDia.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      mensajeroId: { in: ["m1", "m2"] },
      estado: { in: ["vencido", "rechazado"] },
    });
    expect(arg.distinct).toEqual(["mensajeroId"]); // interesa QUIEN, no cuantos
  });

  it("un mensajero sin ningun cierre no aparece", async () => {
    const prisma = buildPrisma([]);

    expect(await repoCon(prisma).findMensajerosBloqueadosParaGestion(["m1", "m2"])).toEqual(
      new Set(),
    );
  });

  it("ids vacio -> set vacio sin consultar", async () => {
    const prisma = buildPrisma();

    expect(await repoCon(prisma).findMensajerosBloqueadosParaGestion([])).toEqual(new Set());
    expect(prisma.cierreDia.findMany).not.toHaveBeenCalled();
  });
});

// Zonas con >=1 mensajero bloqueado PARA GESTIONAR. Feature 241: vuelve a UNA consulta (quitado el
// tope, «tiene alguno» si es expresable como un `some`). ⚠️ Sin consumidor de produccion desde el
// 2026-08-18 (§2.6 de la investigacion): hoy solo lo tocan estos tests.
describe("OrdenRepository.findZonasConMensajeroBloqueado", () => {
  function buildPrismaZonas(filas: { zonaId: string | null }[]) {
    const prisma = buildPrisma();
    prisma.usuario.findMany.mockResolvedValue(filas);
    return prisma;
  }

  it("devuelve las zonas distintas de los mensajeros bloqueados, en UNA consulta", async () => {
    const prisma = buildPrismaZonas([{ zonaId: "z-gam" }, { zonaId: "z-limon" }]);

    expect(await repoCon(prisma).findZonasConMensajeroBloqueado()).toEqual(
      new Set(["z-gam", "z-limon"]),
    );
    expect(prisma.usuario.findMany).toHaveBeenCalledTimes(1); // sin N+1 por zona
    // Feature 241: y sin la SEGUNDA consulta que el tope obligaba a hacer.
    expect(prisma.cierreDia.findMany).not.toHaveBeenCalled();
  });

  it("el `some` usa los DOS estados que bloquean la gestion, no los tres abiertos", async () => {
    // La propiedad que importa: este agregado y el predicado por-mensajero miden LO MISMO. Si aqui
    // entrara `solicitado`, la zona se marcaria por un mensajero al que nadie esta bloqueando.
    const prisma = buildPrismaZonas([]);

    await repoCon(prisma).findZonasConMensajeroBloqueado();

    expect(prisma.usuario.findMany.mock.calls[0][0].where).toMatchObject({
      rol: { value: "mensajero" },
      zonaId: { not: null },
      cierresRealizados: { some: { estado: { in: ["vencido", "rechazado"] } } },
    });
  });

  it("nadie bloqueado -> set vacio", async () => {
    expect(await repoCon(buildPrismaZonas([])).findZonasConMensajeroBloqueado()).toEqual(new Set());
  });

  it("descarta zonaId null (defensivo) sin romper el set", async () => {
    const prisma = buildPrismaZonas([{ zonaId: "z1" }, { zonaId: null }]);

    expect(await repoCon(prisma).findZonasConMensajeroBloqueado()).toEqual(new Set(["z1"]));
  });
});

describe("OrdenRepository.existeBodegaSateliteBloqueada (feature 241)", () => {
  /**
   * `mensajeros` = ids de la zona; `cierres` = sus cierre_dia; `countBodega` = CierreBodega
   * pendiente (causa ii).
   */
  async function run(mensajeros: string[], cierres: CierreFila[], countBodega: number) {
    const prisma = buildPrisma(cierres);
    prisma.usuario.findMany.mockResolvedValue(mensajeros.map((id) => ({ id })));
    prisma.cierreBodega.count.mockResolvedValue(countBodega);
    const res = await repoCon(prisma).existeBodegaSateliteBloqueada("z1");
    return { res, prisma };
  }

  // PROPIEDAD 4, la mitad de la bodega: da igual el estado del cierre, la bodega sigue recibiendo.
  it.each([["solicitado"], ["vencido"], ["rechazado"]])(
    "con TODOS sus mensajeros en cierre `%s` la bodega NO se bloquea: sigue recibiendo ordenes",
    async (estado) => {
      const { res } = await run(
        ["m1", "m2"],
        [
          { mensajeroId: "m1", estado },
          { mensajeroId: "m2", estado },
        ],
        0,
      );

      expect(res).toMatchObject({
        bloqueada: false, // <- la causa (i) NO bloquea, y la 241 la deja asi a proposito
        porMensajeros: true, // informativo: es cierto, y el aviso de la pantalla lo dice
        porCierreBodega: false,
        cierresAbiertos: 2, // nombre heredado: cuenta MENSAJEROS con cierre, no cierres
        totalMensajeros: 2,
      });
      expect(new Set(res.mensajerosConCierreIds)).toEqual(new Set(["m1", "m2"]));
    },
  );

  // Y ESTE ES EL CASO QUE SEPARA EL AVISO DEL BLOQUEO. `solicitado` NO bloquea a nadie para
  // gestionar, pero SI es un cierre abierto: el adminSatelite que cuadra caja tiene que verlo.
  // Si los campos informativos se calcularan con el predicado de bloqueo, este contador diria 0 y
  // la bodega perderia de vista los cierres que estan esperando su aprobacion.
  it("un `solicitado` NO bloquea, pero SI cuenta como cierre abierto en el aviso", async () => {
    const { res } = await run(
      ["m1", "m2", "m3"],
      [{ mensajeroId: "m2", estado: "solicitado" }],
      0,
    );

    expect(res).toMatchObject({
      bloqueada: false,
      porMensajeros: true,
      cierresAbiertos: 1,
      totalMensajeros: 3,
      mensajerosConCierreIds: ["m2"],
    });
  });

  it("`aprobado` no cuenta ni para el aviso: el dinero ya esta conciliado", async () => {
    const { res } = await run(["m1"], [{ mensajeroId: "m1", estado: "aprobado" }], 0);

    expect(res).toMatchObject({
      bloqueada: false,
      porMensajeros: false,
      cierresAbiertos: 0,
      totalMensajeros: 1,
      mensajerosConCierreIds: [],
    });
  });

  // La causa (ii), que NO se toco en ninguna de las dos fichas: es el cierre de la PROPIA bodega
  // hacia la central, no el de un mensajero.
  it("causa (ii): CierreBodega pendiente -> bloqueo duro aunque nadie tenga cierre", async () => {
    const { res } = await run(["m1", "m2"], [], 1);

    expect(res).toMatchObject({
      bloqueada: true,
      porMensajeros: false,
      porCierreBodega: true,
      cierresAbiertos: 0,
      totalMensajeros: 2,
    });
  });

  it("con mensajeros en cierre Y CierreBodega pendiente, bloquea SOLO por la causa (ii)", async () => {
    const { res } = await run(["m1"], [{ mensajeroId: "m1", estado: "vencido" }], 1);

    expect(res).toMatchObject({ bloqueada: true, porMensajeros: true, porCierreBodega: true });
  });

  it("ningun mensajero con cierre y sin CierreBodega -> no bloqueada, cierresAbiertos 0", async () => {
    const { res } = await run(["m1", "m2"], [], 0);

    expect(res).toMatchObject({
      bloqueada: false,
      porMensajeros: false,
      porCierreBodega: false,
      cierresAbiertos: 0,
      totalMensajeros: 2,
      mensajerosConCierreIds: [],
    });
  });

  it("zona SIN mensajeros -> no bloquea por (i) (vacuo), cierresAbiertos 0", async () => {
    const { res, prisma } = await run([], [], 0);

    expect(res).toMatchObject({
      bloqueada: false,
      porMensajeros: false,
      cierresAbiertos: 0,
      totalMensajeros: 0,
      mensajerosConCierreIds: [],
    });
    // Sin mensajeros se corta antes de consultar cierre_dia.
    expect(prisma.cierreDia.findMany).not.toHaveBeenCalled();
  });

  it("filtros: mensajeros por rol+zona; cierre_dia por los TRES estados abiertos; cierre_bodega solicitado", async () => {
    const { prisma } = await run(["m1"], [{ mensajeroId: "m1", estado: "solicitado" }], 1);

    expect(prisma.usuario.findMany.mock.calls[0][0].where).toMatchObject({
      rol: { value: "mensajero" },
      zonaId: "z1",
    });
    // ⚠️ AQUI SI van los tres: este dato es el AVISO («tienes N cierres abiertos»), no el veto.
    // Es la unica consulta del repositorio que sigue preguntando por `solicitado`, y esa asimetria
    // con el predicado de bloqueo es deliberada (feature 241).
    expect(prisma.cierreDia.findMany.mock.calls[0][0].where).toMatchObject({
      mensajeroId: { in: ["m1"] },
      estado: { in: ["solicitado", "vencido", "rechazado"] },
    });
    expect(prisma.cierreBodega.count.mock.calls[0][0].where).toMatchObject({
      zonaId: "z1",
      estado: "solicitado",
    });
  });
});
