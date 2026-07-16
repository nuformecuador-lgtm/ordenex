import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type { GenerarGuiaDecisionData } from "@/lib/interfaces/repositories/IOrdenRepository";

// Feature 17 — repo de "Generar guia"/asignacion de mensajero. $transaction se
// mockea ejecutando el callback con un tx fake (patron zona-repository.test.ts).
// Feature 49: el `tx` fake ademas expone `orden.findMany` (pre-lectura de origen),
// `orden.updateMany` (asignarBodegaLote envuelto) y el choke point
// `ordenHistorialEstado.createMany` para verificar el append en la misma tx.
function buildTx() {
  return {
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    orden: {
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    ordenHistorialEstado: { createMany: vi.fn() },
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  const tx = buildTx();
  const prisma = {
    orden: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    usuario: {
      findMany: vi.fn(),
    },
    orderStatus: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
    ...overrides,
  };
  return { prisma, tx };
}

// Feature 49: contextos de historial (actor = el maestro) para los 3 puntos del maestro.
const HIST_GUIA = { actorUsuarioId: "maestro-1", origenTipo: "generacion_guia" } as const;
const HIST_BODEGA = { actorUsuarioId: "maestro-1", origenTipo: "asignacion_bodega" } as const;
const HIST_RUTEO = { actorUsuarioId: "maestro-1", origenTipo: "ruteo_satelite" } as const;

describe("OrdenRepository.findByIdsForTransicion (R27/R29 · feature 30/R8/R9)", () => {
  it("incluye ordenes borradas (deletedAt !== null) y mapea estatusValue/numGuia/zona", async () => {
    const { prisma } = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      {
        id: "o1",
        numGuia: null,
        deletedAt: null,
        estatus: { value: "en_fulfillment" },
        zonaId: "z-gam",
        zona: { esCentral: true },
      },
      {
        id: "o2",
        numGuia: 5,
        deletedAt: new Date("2026-01-01"),
        estatus: { value: "entregada" },
        zonaId: "z-limon",
        zona: { esCentral: false },
      },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findByIdsForTransicion(["o1", "o2"]);

    // Feature 30/R8/R9: la fila de transicion suma zonaId + zonaEsGam.
    expect(rows).toEqual([
      {
        id: "o1",
        estatusValue: "en_fulfillment",
        numGuia: null,
        deletedAt: null,
        zonaId: "z-gam",
        zonaEsGam: true,
      },
      {
        id: "o2",
        estatusValue: "entregada",
        numGuia: 5,
        deletedAt: new Date("2026-01-01"),
        zonaId: "z-limon",
        zonaEsGam: false,
      },
    ]);
    const arg = prisma.orden.findMany.mock.calls[0][0];
    // R29: NO filtra deletedAt — el service es quien reporta "orden borrada".
    expect(arg.where).toEqual({ id: { in: ["o1", "o2"] } });
    // Feature 30: proyecta zonaId + zona.esGam.
    expect(arg.select.zonaId).toBe(true);
    expect(arg.select.zona).toEqual({ select: { esCentral: true } });
  });

  it("devuelve vacio sin consultar cuando ids esta vacio", async () => {
    const { prisma } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findByIdsForTransicion([])).toEqual([]);
    expect(prisma.orden.findMany).not.toHaveBeenCalled();
  });
});

describe("OrdenRepository.findMensajeroIdsValidos (R28)", () => {
  it("filtra por rol mensajero, sin filtro de zona", async () => {
    const { prisma } = buildPrisma();
    prisma.usuario.findMany.mockResolvedValue([{ id: "m1" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const set = await repo.findMensajeroIdsValidos(["m1", "no-mensajero"]);

    expect(set.has("m1")).toBe(true);
    expect(set.has("no-mensajero")).toBe(false);
    const arg = prisma.usuario.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: { in: ["m1", "no-mensajero"] }, rol: { value: "mensajero" } });
    expect(arg.where).not.toHaveProperty("zonaId");
  });
});

describe("OrdenRepository.findAllMensajeros (R28/T15)", () => {
  it("devuelve TODOS los usuarios rol mensajero, sin filtro de zona", async () => {
    const { prisma } = buildPrisma();
    prisma.usuario.findMany.mockResolvedValue([
      { id: "m1", nombre: "Ana" },
      { id: "m2", nombre: "Beto" },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const mensajeros = await repo.findAllMensajeros();

    expect(mensajeros).toEqual([
      { id: "m1", nombre: "Ana" },
      { id: "m2", nombre: "Beto" },
    ]);
    const arg = prisma.usuario.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ rol: { value: "mensajero" } });
    expect(arg.where).not.toHaveProperty("zonaId");
  });
});

describe("OrdenRepository.findMensajerosByZona (feature 30/R5)", () => {
  it("filtra por rol mensajero Y zonaId = gamZonaId (excluye otras zonas y zonaId NULL)", async () => {
    const { prisma } = buildPrisma();
    prisma.usuario.findMany.mockResolvedValue([{ id: "m1", nombre: "Ana" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const mensajeros = await repo.findMensajerosByZona("z-gam");

    expect(mensajeros).toEqual([{ id: "m1", nombre: "Ana" }]);
    const arg = prisma.usuario.findMany.mock.calls[0][0];
    // R5: el filtro exige rol mensajero Y la zona GAM; sin zona (NULL) o de otra
    // zona no matchea la igualdad zonaId = gamZonaId.
    expect(arg.where).toEqual({ rol: { value: "mensajero" }, zonaId: "z-gam" });
    expect(arg.orderBy).toEqual({ nombre: "asc" });
  });
});

describe("OrdenRepository.findMensajeroIdsValidosByZona (feature 30/R6)", () => {
  it("subconjunto con rol mensajero Y zonaId = gamZonaId; excluye otras zonas/NULL", async () => {
    const { prisma } = buildPrisma();
    // La DB solo devuelve el mensajero GAM; m-otra-zona y m-sin-zona no matchean.
    prisma.usuario.findMany.mockResolvedValue([{ id: "m-gam" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const set = await repo.findMensajeroIdsValidosByZona(
      ["m-gam", "m-otra-zona", "m-sin-zona"],
      "z-gam",
    );

    expect(set.has("m-gam")).toBe(true);
    expect(set.has("m-otra-zona")).toBe(false);
    expect(set.has("m-sin-zona")).toBe(false);
    const arg = prisma.usuario.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      id: { in: ["m-gam", "m-otra-zona", "m-sin-zona"] },
      rol: { value: "mensajero" },
      zonaId: "z-gam",
    });
  });

  it("devuelve vacio sin consultar cuando ids esta vacio", async () => {
    const { prisma } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect((await repo.findMensajeroIdsValidosByZona([], "z-gam")).size).toBe(0);
    expect(prisma.usuario.findMany).not.toHaveBeenCalled();
  });
});

describe("OrdenRepository.rutearBodegaSateliteLote (feature 30/R10/R13)", () => {
  it("num_guia idempotente (WHERE num_guia IS NULL, secuencia constante) + estatus + mensajero NULL", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.findMany.mockResolvedValue([
      { id: "o1", estatusId: "os-prep" },
      { id: "o2", estatusId: "os-prep" },
    ]);
    tx.orden.update.mockResolvedValue({ id: "o1" });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.rutearBodegaSateliteLote(["o1", "o2"], "os-ruta-satelite", HIST_RUTEO);

    expect(count).toBe(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // R10: una asignacion de guia idempotente por orden.
    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    const [sql, ordenId] = tx.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain("num_guia IS NULL");
    expect(sql).toContain("nextval('orden_num_guia_seq')");
    expect(ordenId).toBe("o1");
    // R9: fija estatus y deja mensajeroAsignadoId NULL. Feature 76/LC1 (C2): limpia asignado_at.
    expect(tx.orden.update).toHaveBeenCalledWith({
      where: { id: "o1" },
      data: { estatusId: "os-ruta-satelite", mensajeroAsignadoId: null, asignadoAt: null },
    });
  });

  // Feature 49/#5 (R13/R7): 1 historial por orden ruteada (origen leido -> en_ruta_bodega_satelite).
  it("R13: registra historial por orden con origen pre-leido y tipo ruteo_satelite", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.findMany.mockResolvedValue([
      { id: "o1", estatusId: "os-prep" },
      { id: "o2", estatusId: "os-bodega" },
    ]);
    tx.orden.update.mockResolvedValue({ id: "o1" });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.rutearBodegaSateliteLote(["o1", "o2"], "os-ruta-satelite", HIST_RUTEO);

    const arg = tx.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: "os-prep",
        estatusDestinoId: "os-ruta-satelite",
        actorUsuarioId: "maestro-1",
        origenTipo: "ruteo_satelite",
        motivo: null,
        gestionOrdenId: null,
      },
      {
        ordenId: "o2",
        estatusOrigenId: "os-bodega",
        estatusDestinoId: "os-ruta-satelite",
        actorUsuarioId: "maestro-1",
        origenTipo: "ruteo_satelite",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  it("devuelve 0 sin abrir transaccion cuando el lote esta vacio", async () => {
    const { prisma } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.rutearBodegaSateliteLote([], "os-ruta-satelite", HIST_RUTEO)).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("OrdenRepository.listOrderStatus (R15/R16)", () => {
  it("devuelve el catalogo completo con id y value", async () => {
    const { prisma } = buildPrisma({
      orderStatus: {
        findMany: vi.fn().mockResolvedValue([
          { id: "os-1", value: "en_fulfillment" },
          { id: "os-2", value: "en_preparacion" },
        ]),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const estatus = await repo.listOrderStatus();

    expect(estatus).toEqual([
      { id: "os-1", value: "en_fulfillment" },
      { id: "os-2", value: "en_preparacion" },
    ]);
    const arg = prisma.orderStatus.findMany.mock.calls[0][0];
    expect(arg.select).toEqual({ id: true, value: true });
  });

  it("feature 63/R5: incluye orderBy determinista (value asc) para tabs estables", async () => {
    const { prisma } = buildPrisma({
      orderStatus: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.listOrderStatus();

    const arg = prisma.orderStatus.findMany.mock.calls[0][0];
    expect(arg.orderBy).toEqual({ value: "asc" });
  });
});

describe("OrdenRepository.generarGuiaLote (R5/R19/R25)", () => {
  function decision(overrides: Partial<GenerarGuiaDecisionData> = {}): GenerarGuiaDecisionData {
    return { ordenId: "o1", estatusId: "os-espera", mensajeroAsignadoId: "m1", ...overrides };
  }

  it("ejecuta TODO el lote dentro de una sola $transaction", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.update.mockResolvedValue({ numGuia: 10 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.generarGuiaLote(
      [decision({ ordenId: "o1" }), decision({ ordenId: "o2" })],
      HIST_GUIA,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    expect(tx.orden.update).toHaveBeenCalledTimes(2);
  });

  it("el UPDATE crudo filtra WHERE num_guia IS NULL y usa la secuencia constante (R5/R3)", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.update.mockResolvedValue({ numGuia: 10 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.generarGuiaLote([decision({ ordenId: "o1" })], HIST_GUIA);

    const [sql, ordenId] = tx.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain("num_guia IS NULL");
    expect(sql).toContain("nextval('orden_num_guia_seq')");
    expect(ordenId).toBe("o1");
  });

  it("fija estatusId y mensajeroAsignadoId (con mensajero -> en_espera_aceptacion, R21/R22)", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.update.mockResolvedValue({ numGuia: 7 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const resultados = await repo.generarGuiaLote(
      [decision({ ordenId: "o1", estatusId: "os-espera", mensajeroAsignadoId: "m1" })],
      HIST_GUIA,
    );

    // Feature 76/R23 (W1): con mensajero no nulo estampa asignado_at = now.
    expect(tx.orden.update).toHaveBeenCalledWith({
      where: { id: "o1" },
      data: { estatusId: "os-espera", mensajeroAsignadoId: "m1", asignadoAt: expect.any(Date) },
      select: { numGuia: true },
    });
    expect(resultados).toEqual([{ ordenId: "o1", numGuia: 7 }]);
  });

  it("sin mensajero -> mensajeroAsignadoId NULL, estatus en_bodega, igual recibe num_guia (R23/R19)", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.update.mockResolvedValue({ numGuia: 8 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const resultados = await repo.generarGuiaLote(
      [decision({ ordenId: "o2", estatusId: "os-bodega", mensajeroAsignadoId: null })],
      HIST_GUIA,
    );

    // Feature 76/R23 (W1): SIN mensajero (null) NO estampa asignado_at (queda ausente).
    expect(tx.orden.update).toHaveBeenCalledWith({
      where: { id: "o2" },
      data: { estatusId: "os-bodega", mensajeroAsignadoId: null },
      select: { numGuia: true },
    });
    const dataSinMensajero = tx.orden.update.mock.calls.at(-1)![0].data;
    expect(dataSinMensajero).not.toHaveProperty("asignadoAt");
    expect(resultados).toEqual([{ ordenId: "o2", numGuia: 8 }]);
  });

  it("lote mixto (con y sin mensajero) en una sola llamada produce todos los resultados (R24)", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.update
      .mockResolvedValueOnce({ numGuia: 1 })
      .mockResolvedValueOnce({ numGuia: 2 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const resultados = await repo.generarGuiaLote(
      [
        decision({ ordenId: "o1", mensajeroAsignadoId: "m1" }),
        decision({ ordenId: "o2", mensajeroAsignadoId: null, estatusId: "os-bodega" }),
      ],
      HIST_GUIA,
    );

    expect(resultados).toEqual([
      { ordenId: "o1", numGuia: 1 },
      { ordenId: "o2", numGuia: 2 },
    ]);
  });

  // Feature 49/#3 (R11/R7/R8): lote mixto deja historial con el destino REAL por orden
  // (en_espera_aceptacion / en_bodega) y el origen pre-leido; en la misma tx.
  it("R11: registra historial con destino real por orden y origen pre-leido", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.findMany.mockResolvedValue([
      { id: "o1", estatusId: "os-fulfillment" },
      { id: "o2", estatusId: "os-fulfillment" },
    ]);
    tx.orden.update
      .mockResolvedValueOnce({ numGuia: 1 })
      .mockResolvedValueOnce({ numGuia: 2 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.generarGuiaLote(
      [
        decision({ ordenId: "o1", estatusId: "os-espera", mensajeroAsignadoId: "m1" }),
        decision({ ordenId: "o2", estatusId: "os-bodega", mensajeroAsignadoId: null }),
      ],
      HIST_GUIA,
    );

    expect(tx.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const arg = tx.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: "os-fulfillment",
        estatusDestinoId: "os-espera",
        actorUsuarioId: "maestro-1",
        origenTipo: "generacion_guia",
        motivo: null,
        gestionOrdenId: null,
      },
      {
        ordenId: "o2",
        estatusOrigenId: "os-fulfillment",
        estatusDestinoId: "os-bodega",
        actorUsuarioId: "maestro-1",
        origenTipo: "generacion_guia",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  it("lanza si num_guia queda NULL tras el UPDATE (guarda defensiva)", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.update.mockResolvedValue({ numGuia: null });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await expect(repo.generarGuiaLote([decision()], HIST_GUIA)).rejects.toThrow(/num_guia/);
  });

  it("devuelve vacio sin abrir transaccion cuando el lote esta vacio", async () => {
    const { prisma } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.generarGuiaLote([], HIST_GUIA)).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("OrdenRepository.asignarBodegaLote (R26 · feature 49/#4)", () => {
  it("actualiza mensajeroAsignadoId/estatusId en lote SIN tocar numGuia (dentro de $transaction)", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.findMany.mockResolvedValue([
      { id: "o1", estatusId: "os-bodega" },
      { id: "o2", estatusId: "os-bodega" },
    ]);
    tx.orden.updateMany.mockResolvedValue({ count: 2 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.asignarBodegaLote(["o1", "o2"], "m1", "os-espera", HIST_BODEGA);

    expect(count).toBe(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const arg = tx.orden.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: { in: ["o1", "o2"] } });
    // Feature 76/R23 (W2): asignacion de bodega siempre estampa asignado_at = now.
    expect(arg.data).toEqual({
      mensajeroAsignadoId: "m1",
      estatusId: "os-espera",
      asignadoAt: expect.any(Date),
    });
    expect(arg.data).not.toHaveProperty("numGuia");
  });

  // Feature 49/#4 (R12/R8): 1 historial por orden afectada (origen pre-leido -> destino).
  it("R12: registra historial (asignacion_bodega) solo de las filas afectadas", async () => {
    const { prisma, tx } = buildPrisma();
    tx.orden.findMany.mockResolvedValue([{ id: "o1", estatusId: "os-bodega" }]);
    tx.orden.updateMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.asignarBodegaLote(["o1"], "m1", "os-espera", HIST_BODEGA);

    const arg = tx.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: "os-bodega",
        estatusDestinoId: "os-espera",
        actorUsuarioId: "maestro-1",
        origenTipo: "asignacion_bodega",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  it("devuelve 0 sin abrir transaccion cuando ordenIds esta vacio", async () => {
    const { prisma, tx } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.asignarBodegaLote([], "m1", "os-espera", HIST_BODEGA)).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.orden.updateMany).not.toHaveBeenCalled();
  });
});
