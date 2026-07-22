import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 102 (T7) — metodos de repo de la superficie de RECHAZOS POR SLA de la tienda. Prisma se
// mockea con dobles simples (patron orden-repository.novedades.test.ts): sin DB real, se verifica
// la FORMA del `where`/`select` y el mapeo money-safe. Cubre:
//   R12 la orden es rechazada + alcanzada por el cron SLA (origen_tipo escalado_devuelta_sla);
//   R13 acotada a la tienda del actor;
//   R14 monto de 56 (ingreso_bodega_rechazo de la gestion sintetica) STRING escala 2, null=pendiente;
//   R15 anclado al estado real (rechazada + no borrada); count y find comparten el MISMO where.

// El `where` que ambos metodos DEBEN construir (predicado central, §5.2).
const RECHAZO_SLA_WHERE = {
  tiendaId: "tienda-1",
  deletedAt: null, // R15: excluye borradas
  estatus: { value: "rechazada" }, // R12/R15: solo mientras REPOSE en `rechazada`
  historialEstados: { some: { origenTipo: "escalado_devuelta_sla" } }, // R12: alcanzada por el cron SLA
};

function buildPrisma() {
  return {
    orden: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };
}

describe("OrdenRepository.countRechazadasSlaByTienda (R12/R13/R15)", () => {
  it("R12/R13/R15: cuenta con el predicado anclado al estado (rechazada + tienda + no borrada + origen SLA)", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(4);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.countRechazadasSlaByTienda("tienda-1")).toBe(4);
    expect(prisma.orden.count).toHaveBeenCalledWith({ where: RECHAZO_SLA_WHERE });

    const { where } = prisma.orden.count.mock.calls[0][0];
    // R12: solo rechazos alcanzados por el cron SLA (no rechazos manuales del mensajero).
    expect(where.historialEstados).toEqual({ some: { origenTipo: "escalado_devuelta_sla" } });
    // R13: acotada a la tienda; R15: nunca cuenta borradas ni fuera de `rechazada`.
    expect(where.tiendaId).toBe("tienda-1");
    expect(where.deletedAt).toBeNull();
    expect(where.estatus).toEqual({ value: "rechazada" });
  });
});

describe("OrdenRepository.findRechazadasSlaByTienda (R12/R14/R15)", () => {
  it("R14: mapea el monto de 56 (ingreso_bodega_rechazo de la gestion SLA) a STRING escala 2; null=pendiente", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      {
        id: "o1",
        numGuia: 100,
        numRemision: "REM-1",
        destinatario: "Ana",
        historialEstados: [{ gestion: { ingresoBodegaRechazo: new Prisma.Decimal("3.5") } }],
      },
      {
        id: "o2",
        numGuia: null, // placeholder lo pone el front (patron NovedadDTO)
        numRemision: "REM-2",
        destinatario: "Beto",
        historialEstados: [{ gestion: { ingresoBodegaRechazo: null } }], // aun sin snapshot (Q2)
      },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findRechazadasSlaByTienda("tienda-1", { skip: 0, take: 10 });

    expect(rows).toEqual([
      { id: "o1", numGuia: 100, numRemision: "REM-1", destinatario: "Ana", monto: "3.50" },
      { id: "o2", numGuia: null, numRemision: "REM-2", destinatario: "Beto", monto: null },
    ]);
    // R18: el monto cruza como STRING (nunca number).
    expect(typeof rows[0].monto).toBe("string");
  });

  it("R15/R14: where anclado al estado, orderBy createdAt desc, skip/take y select con la gestion SLA", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findRechazadasSlaByTienda("tienda-1", { skip: 20, take: 10 });

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toEqual(RECHAZO_SLA_WHERE);
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
    expect(arg.skip).toBe(20);
    expect(arg.take).toBe(10);
    // El monto sale de la transicion SLA -> su gestion enlazada, en el MISMO query (sin N+1).
    expect(arg.select.historialEstados).toEqual({
      where: { origenTipo: "escalado_devuelta_sla" },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: { gestion: { select: { ingresoBodegaRechazo: true } } },
    });
    // Select minimo del resto: no arrastra columnas pesadas ni deletedAt.
    expect(arg.select).toMatchObject({
      id: true,
      numGuia: true,
      numRemision: true,
      destinatario: true,
    });
  });

  it("defensivo: orden sin fila de historial SLA -> monto null (no rompe)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      { id: "o9", numGuia: 9, numRemision: "REM-9", destinatario: "Zoe", historialEstados: [] },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findRechazadasSlaByTienda("tienda-1", { skip: 0, take: 10 });
    expect(rows[0].monto).toBeNull();
  });
});

describe("OrdenRepository — R15: count y find comparten el MISMO where", () => {
  it("R15: ambos metodos construyen exactamente el mismo predicado anclado al estado", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(2);
    prisma.orden.findMany.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.countRechazadasSlaByTienda("tienda-1");
    await repo.findRechazadasSlaByTienda("tienda-1", { skip: 0, take: 10 });

    const whereCount = prisma.orden.count.mock.calls[0][0].where;
    const whereFind = prisma.orden.findMany.mock.calls[0][0].where;
    expect(whereCount).toEqual(whereFind);
    expect(whereCount).toEqual(RECHAZO_SLA_WHERE);
  });
});
