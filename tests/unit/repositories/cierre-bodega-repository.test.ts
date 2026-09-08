import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CierreBodegaRepository } from "@/lib/repositories/CierreBodegaRepository";
// Feature 393 (R38): el maestro entra por OTRO repositorio pero por el MISMO mapper, y este
// archivo lo comprueba con la misma fila cruda para los dos.
import { CierresBodegaAdminRepository } from "@/lib/repositories/CierresBodegaAdminRepository";

// Feature 40 — tests unit del CierreBodegaRepository (mockea Prisma, sin DB real,
// patron cierre-dia-repository.test.ts). Cubre R5 (WHERE consolidables), R9
// (crearCierreBodega: $transaction INSERT + updateMany con guardia; atomico), R10
// (totales -> Prisma.Decimal), R8 (P2002 se propaga como senal de conflict).

function consolidableDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cd1",
    mensajeroId: "m1",
    totalEfectivo: new Prisma.Decimal("10"),
    totalSimpe: new Prisma.Decimal("5.5"),
    totalTransferencia: new Prisma.Decimal("0"),
    totalGeneral: new Prisma.Decimal("15.5"),
    totalPagoMensajero: new Prisma.Decimal("5"), // feature 39/R18: snapshot del pago
    totalIngresoBodegaRechazos: new Prisma.Decimal("3"), // feature 56/R17: snapshot del ingreso
    mensajero: { nombre: "Ana Mensajera" },
    ...overrides,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    cierreDia: { findMany: vi.fn(), count: vi.fn() },
    cierreBodega: { count: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
    ...overrides,
  };
}

describe("CierreBodegaRepository.findCierresDiaConsolidables (R5/R10)", () => {
  it("R5: WHERE aprobado + bodega_satelite + destino_zona_id + cierre_bodega_id null", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findMany.mockResolvedValue([]);
    const repo = new CierreBodegaRepository(prisma as unknown as PrismaClient);

    await repo.findCierresDiaConsolidables("z-cartago");

    const arg = prisma.cierreDia.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      estado: "aprobado",
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z-cartago",
      cierreBodegaId: null,
    });
  });

  it("R10: mapea mensajero + totales snapshot -> STRING toFixed(2)", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findMany.mockResolvedValue([consolidableDbRow()]);
    const repo = new CierreBodegaRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findCierresDiaConsolidables("z-cartago");

    expect(rows[0]).toEqual({
      cierreDiaId: "cd1",
      mensajeroId: "m1",
      mensajeroNombre: "Ana Mensajera",
      totales: { efectivo: "10.00", simpe: "5.50", transferencia: "0.00", general: "15.50" },
      totalPagoMensajero: "5.00", // feature 39/R18: snapshot money-safe STRING
      totalIngresoBodegaRechazos: "3.00", // feature 56/R17: snapshot money-safe STRING
    });
    expect(typeof rows[0].totales.general).toBe("string");
    expect(typeof rows[0].totalPagoMensajero).toBe("string");
    expect(typeof rows[0].totalIngresoBodegaRechazos).toBe("string");
  });
});

describe("CierreBodegaRepository.contarCierresDiaSolicitados (R6)", () => {
  it("cuenta cierre_dia de la zona en estado solicitado (destino satelite)", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.count.mockResolvedValue(3);
    const repo = new CierreBodegaRepository(prisma as unknown as PrismaClient);

    const n = await repo.contarCierresDiaSolicitados("z-cartago");

    expect(n).toBe(3);
    expect(prisma.cierreDia.count.mock.calls[0][0].where).toEqual({
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z-cartago",
      estado: "solicitado",
    });
  });
});

describe("CierreBodegaRepository.existeCierreBodegaSolicitado (R8)", () => {
  it("true si hay un cierre de bodega solicitado de la zona", async () => {
    const prisma = buildPrisma();
    prisma.cierreBodega.count.mockResolvedValue(1);
    const repo = new CierreBodegaRepository(prisma as unknown as PrismaClient);

    expect(await repo.existeCierreBodegaSolicitado("z-cartago")).toBe(true);
    expect(prisma.cierreBodega.count.mock.calls[0][0].where).toEqual({
      zonaId: "z-cartago",
      estado: "solicitado",
    });
  });
});

describe("CierreBodegaRepository.crearCierreBodega (R9/R10/R8)", () => {
  it("R9/R10: $transaction INSERT (Decimal snapshot) + updateMany con guardia; devuelve id", async () => {
    const tx = {
      cierreBodega: { create: vi.fn(async () => ({ id: "cb1" })) },
      cierreDia: { updateMany: vi.fn(async () => ({ count: 2 })) },
    };
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreBodegaRepository(prisma as unknown as PrismaClient);

    const id = await repo.crearCierreBodega({
      zonaId: "z-cartago",
      solicitadoPor: "adm-sat",
      cierreDiaIds: ["cd1", "cd2"],
      totales: { efectivo: "10.01", simpe: "5.55", transferencia: "100.44", general: "116.00" },
      totalPagoMensajero: "10.75", // feature 39/R19: snapshot agregado del pago
      totalIngresoBodegaRechazos: "6.50", // feature 56/R18: snapshot agregado del ingreso
    });

    expect(id).toBe("cb1");

    // R10: totales snapshot como Prisma.Decimal.
    const createArg = (tx.cierreBodega.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      zonaId: "z-cartago",
      solicitadoPor: "adm-sat",
      estado: "solicitado",
    });
    expect(createArg.data.totalEfectivo).toBeInstanceOf(Prisma.Decimal);
    expect(createArg.data.totalGeneral.toFixed(2)).toBe("116.00");
    // R19: snapshot agregado del pago a mensajeros como Prisma.Decimal.
    expect(createArg.data.totalPagoMensajero).toBeInstanceOf(Prisma.Decimal);
    expect(createArg.data.totalPagoMensajero.toFixed(2)).toBe("10.75");
    // feature 56/R18: snapshot agregado del ingreso de bodega como Prisma.Decimal, mismo INSERT.
    expect(createArg.data.totalIngresoBodegaRechazos).toBeInstanceOf(Prisma.Decimal);
    expect(createArg.data.totalIngresoBodegaRechazos.toFixed(2)).toBe("6.50");

    // R9: vincula SOLO los consolidables de la zona (guardia concurrencia-segura).
    const updArg = (tx.cierreDia.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updArg.where).toEqual({
      id: { in: ["cd1", "cd2"] },
      cierreBodegaId: null,
      estado: "aprobado",
      destinoZonaId: "z-cartago",
    });
    expect(updArg.data).toEqual({ cierreBodegaId: "cb1" });
  });

  it("R8: una violacion del indice unico parcial (P2002) se propaga (senal de conflict)", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("unique violation", {
      code: "P2002",
      clientVersion: "test",
    });
    const tx = {
      cierreBodega: {
        create: vi.fn(async () => {
          throw p2002;
        }),
      },
      cierreDia: { updateMany: vi.fn() },
    };
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreBodegaRepository(prisma as unknown as PrismaClient);

    await expect(
      repo.crearCierreBodega({
        zonaId: "z-cartago",
        solicitadoPor: "adm-sat",
        cierreDiaIds: ["cd1"],
        totales: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
        totalPagoMensajero: "0.00",
        totalIngresoBodegaRechazos: "0.00",
      }),
    ).rejects.toBe(p2002);
    // no llega a vincular si la INSERT fallo.
    expect(tx.cierreDia.updateMany).not.toHaveBeenCalled();
  });
});

describe("CierreBodegaRepository.findCierresBodegaByZona (F1.4-h)", () => {
  it("filtra por zona, orderBy solicitadoAt desc, totales STRING + cantidadCierres del _count", async () => {
    const prisma = buildPrisma();
    prisma.cierreBodega.findMany.mockResolvedValue([
      {
        id: "cb1",
        zonaId: "z-cartago",
        solicitadoPor: "adm-sat",
        estado: "aprobado",
        totalEfectivo: new Prisma.Decimal("10"),
        totalSimpe: new Prisma.Decimal("0"),
        totalTransferencia: new Prisma.Decimal("5.5"),
        totalGeneral: new Prisma.Decimal("15.5"),
        totalPagoMensajero: new Prisma.Decimal("7.5"), // feature 39/R19/R20: snapshot agregado
        totalIngresoBodegaRechazos: new Prisma.Decimal("6.5"), // feature 56/R18/R19: snapshot agregado
        solicitadoAt: new Date("2026-07-12T10:00:00.000Z"),
        resueltoAt: new Date("2026-07-12T12:00:00.000Z"),
        motivoRechazo: null,
        zona: { nombre: "Cartago" },
        solicitadoPorUsuario: { nombre: "Sara Satelite" },
        _count: { cierresDia: 3 },
      },
    ]);
    const repo = new CierreBodegaRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findCierresBodegaByZona("z-cartago");

    expect(prisma.cierreBodega.findMany.mock.calls[0][0].where).toEqual({ zonaId: "z-cartago" });
    expect(prisma.cierreBodega.findMany.mock.calls[0][0].orderBy).toMatchObject({ solicitadoAt: "desc" });
    expect(rows[0]).toEqual({
      cierreBodegaId: "cb1",
      zonaId: "z-cartago",
      zonaNombre: "Cartago",
      solicitadoPorId: "adm-sat",
      solicitadoPorNombre: "Sara Satelite",
      estado: "aprobado",
      totales: { efectivo: "10.00", simpe: "0.00", transferencia: "5.50", general: "15.50" },
      totalPagoMensajero: "7.50", // feature 39/R19/R20: snapshot money-safe STRING
      totalIngresoBodegaRechazos: "6.50", // feature 56/R18/R19: snapshot money-safe STRING
      cantidadCierres: 3,
      solicitadoAt: "2026-07-12T10:00:00.000Z",
      resueltoAt: "2026-07-12T12:00:00.000Z",
      motivoRechazo: null,
      // Feature 393 (R9/R20/R38): el MAPPER deriva la cascada B. 15.50 - 7.50 - 6.50 = 1.50;
      // el efectivo (10.00) NO cubre los dos descuentos (14.00), asi que el aviso se enciende.
      paraLaCentral: "1.50",
      efectivoCubreDescuentos: false,
    });
  });
});

/**
 * Feature 393 (B7, R38) — «Para la central» sale del MAPPER, y por eso las CUATRO lecturas de
 * la cabecera de un cierre de bodega dicen exactamente lo mismo.
 *
 * Esto es la red perenne de R38 en la capa de datos. La ficha decidio derivar en
 * `toBodegaResumenRow` —y no en cada servicio— precisamente para que la tarjeta del maestro y
 * la del `adminSatelite` NO PUEDAN discrepar: una copia por lectura es exactamente el modo de
 * fallo que esto tiene que morder (mutacion M15).
 *
 * Se ejercitan los OCHO metodos de lectura de los DOS repositorios con LA MISMA fila cruda; si
 * alguno dejara de pasar por el mapper, su valor se caeria o cambiaria y este test lo dice con
 * el nombre del metodo.
 */
describe("feature 393 — el mapper deriva «Para la central» para TODAS las lecturas (R38)", () => {
  // Una fila con CENTIMOS: 106089.17 - 14001.00 - 1250.45 = 90837.72, y el efectivo
  // (100000.55) cubre de sobra los dos descuentos (15251.45).
  function filaCruda(overrides: Record<string, unknown> = {}) {
    return {
      id: "cb1",
      zonaId: "z-cartago",
      solicitadoPor: "adm-sat",
      estado: "aprobado",
      totalEfectivo: new Prisma.Decimal("100000.55"),
      totalSimpe: new Prisma.Decimal("5000.10"),
      totalTransferencia: new Prisma.Decimal("1088.52"),
      totalGeneral: new Prisma.Decimal("106089.17"),
      totalPagoMensajero: new Prisma.Decimal("14001.00"),
      totalIngresoBodegaRechazos: new Prisma.Decimal("1250.45"),
      solicitadoAt: new Date("2026-09-01T10:00:00.000Z"),
      resueltoAt: null,
      motivoRechazo: null,
      zona: { nombre: "Cartago" },
      solicitadoPorUsuario: { nombre: "Sara Satelite" },
      _count: { cierresDia: 2 },
      ...overrides,
    };
  }

  const ESPERADO = { paraLaCentral: "90837.72", efectivoCubreDescuentos: true };

  function prismaSatelite(filas: unknown[]) {
    return {
      cierreDia: { findMany: vi.fn(), count: vi.fn() },
      cierreBodega: {
        count: vi.fn().mockResolvedValue(filas.length),
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue(filas),
      },
      $transaction: vi.fn(),
    };
  }

  function prismaMaestro(filas: unknown[]) {
    return {
      cierreBodega: {
        findMany: vi.fn().mockResolvedValue(filas),
        findUnique: vi.fn().mockResolvedValue(filas[0]),
        count: vi.fn().mockResolvedValue(filas.length),
        updateMany: vi.fn(),
      },
      cierreDia: { findMany: vi.fn().mockResolvedValue([]) },
      gestionOrden: { findMany: vi.fn().mockResolvedValue([]) },
      cierreDetail: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(),
      historialAccion: { createMany: vi.fn() },
      usuario: { findUnique: vi.fn() },
    };
  }

  it("las CUATRO lecturas (cola, historico, solicitados de la zona y conjuntos completos) traen el MISMO valor", async () => {
    const rango = { skip: 0, take: 10 };

    const satelite = new CierreBodegaRepository(
      prismaSatelite([filaCruda()]) as unknown as PrismaClient,
    );
    const maestro = new CierresBodegaAdminRepository(
      prismaMaestro([filaCruda()]) as unknown as PrismaClient,
    );

    const porLectura: Record<string, { paraLaCentral: string; efectivoCubreDescuentos: boolean }> =
      {
        // adminSatelite — la unica superficie que ella ve.
        "satelite · findCierresBodegaByZona": (await satelite.findCierresBodegaByZona("z-cartago"))[0],
        "satelite · findCierresBodegaByZonaPaginado": (
          await satelite.findCierresBodegaByZonaPaginado("z-cartago", rango)
        ).items[0],
        // maestro — cola, historico, sus dos paginas y sus dos conjuntos de descarga.
        "maestro · findCierresBodega": (await maestro.findCierresBodega())[0],
        "maestro · findHistoricoCompleto": (await maestro.findHistoricoCompleto())[0],
        "maestro · findColaCompleta": (await maestro.findColaCompleta())[0],
        "maestro · findHistoricoPaginado": (await maestro.findHistoricoPaginado(rango)).items[0],
        "maestro · findColaPaginada": (await maestro.findColaPaginada(rango)).items[0],
      };

    // Autocomprobacion: si un dia se renombra un metodo y este censo se queda corto, el test
    // dejaria de vigilar sin decir nada.
    expect(Object.keys(porLectura)).toHaveLength(7);

    for (const [lectura, fila] of Object.entries(porLectura)) {
      expect(fila, `${lectura} no trae la cascada B`).toMatchObject(ESPERADO);
    }

    // Y el detalle, que es la octava puerta a la misma cabecera.
    const detalle = await maestro.findCierreBodegaConDetalle("cb1");
    expect(detalle?.cierre).toMatchObject(ESPERADO);
  });

  it("el NEGATIVO y el aviso del efectivo tambien viajan por el mapper, sin recortarse (R36/R37)", async () => {
    // 8500.35 - 9500.40 - 0.00 = -1000.05, y el efectivo (1000.00) no llega ni de lejos.
    // Los dos casos se midieron contra produccion el 2026-09-08: 1 y 2 de 14 cierres.
    const cruda = filaCruda({
      totalEfectivo: new Prisma.Decimal("1000.00"),
      totalSimpe: new Prisma.Decimal("7500.35"),
      totalTransferencia: new Prisma.Decimal("0.00"),
      totalGeneral: new Prisma.Decimal("8500.35"),
      totalPagoMensajero: new Prisma.Decimal("9500.40"),
      totalIngresoBodegaRechazos: new Prisma.Decimal("0.00"),
    });

    const satelite = new CierreBodegaRepository(
      prismaSatelite([cruda]) as unknown as PrismaClient,
    );
    const maestro = new CierresBodegaAdminRepository(
      prismaMaestro([cruda]) as unknown as PrismaClient,
    );

    const deLaSatelite = (await satelite.findCierresBodegaByZona("z-cartago"))[0];
    const delMaestro = (await maestro.findCierresBodega())[0];

    expect(deLaSatelite.paraLaCentral).toBe("-1000.05");
    expect(deLaSatelite.paraLaCentral).not.toBe("0.00"); // nunca recortado (R36)
    expect(deLaSatelite.efectivoCubreDescuentos).toBe(false);
    // R38 al pie de la letra: el mismo cierre, el mismo numero, en las dos pantallas.
    expect(delMaestro.paraLaCentral).toBe(deLaSatelite.paraLaCentral);
    expect(delMaestro.efectivoCubreDescuentos).toBe(deLaSatelite.efectivoCubreDescuentos);
  });

  it("el aviso mira el EFECTIVO y no el general: con casi todo en SINPE se enciende (R37)", async () => {
    // EL CASO DISCRIMINANTE, y el que una fixture perezosa deja pasar: «Para la central» es
    // POSITIVO (90837.72) y el GENERAL cubre de sobra los descuentos, pero el EFECTIVO no. Si
    // el mapper comparara contra el general —la mutacion M14— este aviso se quedaria mudo justo
    // en el escenario que lo motiva. Medido contra produccion el 2026-09-08: 2 de 14 cierres.
    const cruda = filaCruda({
      totalEfectivo: new Prisma.Decimal("1000.00"),
      totalSimpe: new Prisma.Decimal("104000.55"),
      totalTransferencia: new Prisma.Decimal("1088.62"),
      totalGeneral: new Prisma.Decimal("106089.17"),
    });
    const satelite = new CierreBodegaRepository(
      prismaSatelite([cruda]) as unknown as PrismaClient,
    );
    const maestro = new CierresBodegaAdminRepository(
      prismaMaestro([cruda]) as unknown as PrismaClient,
    );

    const deLaSatelite = (await satelite.findCierresBodegaByZona("z-cartago"))[0];
    const delMaestro = (await maestro.findCierresBodega())[0];

    expect(deLaSatelite.paraLaCentral).toBe("90837.72"); // positivo
    expect(deLaSatelite.efectivoCubreDescuentos).toBe(false); // 1000.00 < 15251.45
    expect(delMaestro.efectivoCubreDescuentos).toBe(false); // R38: y el maestro ve lo mismo
  });

  it("los dos campos son STRING/boolean money-safe, nunca un number", async () => {
    const satelite = new CierreBodegaRepository(
      prismaSatelite([filaCruda()]) as unknown as PrismaClient,
    );
    const fila = (await satelite.findCierresBodegaByZona("z-cartago"))[0];
    expect(typeof fila.paraLaCentral).toBe("string");
    expect(fila.paraLaCentral).toMatch(/^-?\d+\.\d{2}$/);
    expect(typeof fila.efectivoCubreDescuentos).toBe("boolean");
  });
});
