import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { NumRemisionDuplicadoError } from "@/lib/interfaces/repositories/IOrdenRepository";

function ordenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ord-1",
    numGuia: 1,
    numRemision: "REM-1",
    estatusId: "os-bodega",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    tiendaId: "t1",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "Caja",
    peso: new Prisma.Decimal("1.500"),
    notas: null,
    deletedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    estatus: { value: "en_bodega" },
    mensajeroSugeridoId: null,
    mensajeroAsignadoId: null,
    prioridad: false, // feature 101/R9: escalar de la fila que toDTO propaga al DTO
    ...overrides,
  };
}

// Tarifa anidada de la tienda (Decimal en las 8 columnas numericas, patron real
// de Prisma). El helper permite overrides para variar montos por caso.
function tarifaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tar-1",
    tiendaId: "t1",
    status: "activo",
    valorFlete: new Prisma.Decimal("3.50"),
    valorFleteDevuelto: new Prisma.Decimal("2.00"),
    valorFleteGam: new Prisma.Decimal("4.00"),
    valorFleteDevueltoGam: new Prisma.Decimal("2.50"),
    fulfillment: new Prisma.Decimal("1.00"),
    comisionCod: new Prisma.Decimal("5.00"),
    ivaFlete: new Prisma.Decimal("13.00"),
    ivaComisionCod: new Prisma.Decimal("13.00"),
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

// Fila del LISTADO: ademas del estatus trae los datos de TODAS las relaciones
// directas (FK) de la orden, y la tienda incluye sus tarifas (Usuario.tarifasTienda).
function ordenListRow(overrides: Record<string, unknown> = {}) {
  return {
    ...ordenRow(),
    estatus: { id: "os-bodega", value: "en_bodega" },
    tienda: {
      id: "t1",
      nombre: "Tienda Uno",
      email: "tienda1@ordenex.co",
      telefono: "0990000001",
      tarifasTienda: [tarifaRow()],
    },
    // Feature 30/R14: el listado incluye la zona (nombre + flag GAM).
    zona: { id: "z1", nombre: "GAM", esCentral: true },
    provincia: { id: "p1", nombre: "San José" },
    canton: { id: "c1", nombre: "Central" },
    distrito: null,
    mensajeroSugerido: null,
    mensajeroAsignado: null,
    // Gestión de reprogramación vigente (`take: 1`): vacío = sin reprogramación.
    gestiones: [],
    ...overrides,
  };
}

function baseCreateData() {
  return {
    numRemision: "REM-1",
    estatusId: "os-bodega",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    tiendaId: "t1",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    producto: "Caja",
    peso: 1.5,
  };
}

// Feature 49: create/update ahora corren en `$transaction`; el fake `$transaction`
// invoca el callback con el propio `prisma` como `tx` (tiene los modelos + el choke
// point `ordenHistorialEstado.createMany`), asi las aserciones sobre `prisma.orden.*`
// siguen viendo las llamadas hechas dentro de la tx.
function buildPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    orden: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    orderStatus: { findUnique: vi.fn() },
    zona: { findUnique: vi.fn() },
    provincia: { findUnique: vi.fn() },
    canton: { findUnique: vi.fn() },
    distrito: { findUnique: vi.fn() },
    usuario: { findUnique: vi.fn() },
    ordenHistorialEstado: { createMany: vi.fn() },
    $transaction: vi.fn(),
    ...overrides,
  };
  // El `$transaction` fake ejecuta el callback con el propio prisma como `tx`.
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

// Feature 49/#2/#10/#20: contexto de historial que el service inyecta al repo.
const HIST_CREACION = { actorUsuarioId: "u-actor", origenTipo: "creacion_manual" } as const;
const HIST_AJUSTE = { actorUsuarioId: "u-actor", origenTipo: "ajuste_estado" } as const;

describe("OrdenRepository.create", () => {
  it("serializa peso Decimal a number y arma OrdenDTO sin deletedAt", async () => {
    const prisma = buildPrisma();
    prisma.orden.create.mockResolvedValue(ordenRow());
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const dto = await repo.create(baseCreateData(), HIST_CREACION);

    expect(dto.peso).toBe(1.5);
    expect(dto.estatusValue).toBe("en_bodega");
    expect(dto).not.toHaveProperty("deletedAt");
  });

  // Feature 17/R2/R8: num_guia se asigna en "Generar guia" (nunca al insertar) y
  // mensajero_asignado_id nace NULL (es un acto posterior del maestro).
  it("no envia num_guia ni mensajero_asignado_id al crear (R2/R8)", async () => {
    const prisma = buildPrisma();
    prisma.orden.create.mockResolvedValue(ordenRow({ numGuia: null }));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.create(baseCreateData(), HIST_CREACION);

    const arg = prisma.orden.create.mock.calls[0][0];
    expect(arg.data).not.toHaveProperty("numGuia");
    expect(arg.data).not.toHaveProperty("mensajeroAsignadoId");
  });

  // Feature 17/R30: numGuia NULL se serializa como null (sin romper el DTO).
  it("serializa numGuia NULL como null (R30)", async () => {
    const prisma = buildPrisma();
    prisma.orden.create.mockResolvedValue(ordenRow({ numGuia: null }));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const dto = await repo.create(baseCreateData(), HIST_CREACION);

    expect(dto.numGuia).toBeNull();
  });

  it("traduce P2002 de num_remision a NumRemisionDuplicadoError (R14/R28)", async () => {
    const prisma = buildPrisma();
    const p2002 = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "7.8.0",
      meta: { target: ["num_remision"] },
    });
    prisma.orden.create.mockRejectedValue(p2002);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await expect(repo.create(baseCreateData(), HIST_CREACION)).rejects.toBeInstanceOf(
      NumRemisionDuplicadoError,
    );
  });

  // Feature 49/#2 (R10/R20/R7): la creacion deja 1 fila de historial con origen null
  // (creacion) -> destino estado inicial, actor y tipo creacion_manual, en la misma tx.
  it("R10/R20: registra 1 historial con origen null, destino=estado inicial, tipo creacion_manual", async () => {
    const prisma = buildPrisma();
    prisma.orden.create.mockResolvedValue(ordenRow({ id: "ord-1", estatusId: "os-bodega" }));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.create(baseCreateData(), HIST_CREACION);

    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const arg = prisma.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data).toEqual([
      {
        ordenId: "ord-1",
        estatusOrigenId: null,
        estatusDestinoId: "os-bodega",
        actorUsuarioId: "u-actor",
        origenTipo: "creacion_manual",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  // R7: si el append del historial falla, el create se revierte (nada persiste).
  it("R7: fallo del append propaga y aborta la tx (atomicidad)", async () => {
    const prisma = buildPrisma();
    prisma.orden.create.mockResolvedValue(ordenRow());
    prisma.ordenHistorialEstado.createMany.mockRejectedValue(new Error("append boom"));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await expect(repo.create(baseCreateData(), HIST_CREACION)).rejects.toThrow("append boom");
  });
});

describe("OrdenRepository.findById (R34)", () => {
  it("filtra deleted_at IS NULL en el where", async () => {
    const prisma = buildPrisma();
    prisma.orden.findFirst.mockResolvedValue(ordenRow());
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findById("ord-1");

    const arg = prisma.orden.findFirst.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: "ord-1", deletedAt: null });
  });

  it("devuelve null cuando no hay fila (borrada o inexistente)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findFirst.mockResolvedValue(null);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findById("x")).toBeNull();
  });
});

describe("OrdenRepository.list (R30/R31/R34)", () => {
  // La columna "Liberada el" de la tab `reprogramada` sale de la gestión VIGENTE
  // (`orden -> gestiones` es 1:N). El repo la resuelve con el MISMO shape que el
  // cron de liberación (LiberacionReprogramadaRepository) y la serializa a
  // `YYYY-MM-DD`, para que la fecha mostrada no pueda divergir de la que libera.
  it("resuelve fechaReprogramacion de la gestión vigente y la serializa a YYYY-MM-DD", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      ordenListRow({
        // @db.Date se guarda a medianoche UTC.
        gestiones: [{ fechaReprogramacion: new Date("2026-07-20T00:00:00.000Z") }],
      }),
    ]);
    prisma.orden.count.mockResolvedValue(1);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.list({
      where: { estatusId: "os-reprogramada" },
      sortBy: "num_guia",
      sortDir: "asc",
      skip: 0,
      take: 20,
    });

    expect(res.items[0].fechaReprogramacion).toBe("2026-07-20");
  });

  it("sin gestión de reprogramación vigente, fechaReprogramacion es null", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([ordenListRow({ gestiones: [] })]);
    prisma.orden.count.mockResolvedValue(1);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.list({
      where: {},
      sortBy: "num_guia",
      sortDir: "asc",
      skip: 0,
      take: 20,
    });

    expect(res.items[0].fechaReprogramacion).toBeNull();
  });

  it("pide SOLO la gestión de reprogramación vigente: no anulada y la más reciente", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([ordenListRow()]);
    prisma.orden.count.mockResolvedValue(1);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.list({
      where: {},
      sortBy: "num_guia",
      sortDir: "asc",
      skip: 0,
      take: 20,
    });

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.include.gestiones).toMatchObject({
      where: { resultado: "reprogramada", anuladaAt: null },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
  });

  it("devuelve items y total, excluye borradas y mapea el orden de lista blanca", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      ordenListRow(),
      ordenListRow({ id: "ord-2" }),
    ]);
    prisma.orden.count.mockResolvedValue(2);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.list({
      where: { estatusId: "os-bodega" },
      sortBy: "num_guia",
      sortDir: "asc",
      skip: 0,
      take: 20,
    });

    expect(res.total).toBe(2);
    expect(res.items).toHaveLength(2);

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ deletedAt: null, estatusId: "os-bodega" });
    // Feature 101/R6: prioridad-first PRIMERO, luego la columna mapeada (R31) como desempate.
    expect(arg.orderBy).toEqual([{ prioridad: "desc" }, { numGuia: "asc" }]);
    expect(arg.skip).toBe(0);
    expect(arg.take).toBe(20);

    const countArg = prisma.orden.count.mock.calls[0][0];
    expect(countArg.where).toMatchObject({ deletedAt: null });
  });

  it("R25/R26: incluye tienda.nombre en el select y mapea tiendaNombre por item", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      ordenListRow(),
      ordenListRow({
        id: "ord-2",
        tienda: {
          id: "t2",
          nombre: "Tienda Dos",
          email: "tienda2@ordenex.co",
          telefono: "0990000002",
          tarifasTienda: [],
        },
      }),
    ]);
    prisma.orden.count.mockResolvedValue(2);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.list({
      where: {},
      sortBy: "created_at",
      sortDir: "desc",
      skip: 0,
      take: 20,
    });

    expect(res.items[0].tiendaNombre).toBe("Tienda Uno");
    expect(res.items[1].tiendaNombre).toBe("Tienda Dos");

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.include).toMatchObject({ tienda: { select: { nombre: true } } });
    // R25: el listado sigue trayendo el value del estatus.
    expect(arg.include).toMatchObject({ estatus: { select: { value: true } } });
  });

  // Feature 17/R20: el modal "Generar guia" agrupa por mensajero sugerido y las
  // secciones en_espera_aceptacion/en_bodega muestran el mensajero asignado.
  it("R20: mapea mensajeroSugeridoId y mensajeroAsignadoId en el DTO del listado", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      ordenListRow({ id: "ord-con", mensajeroSugeridoId: "msj-1", mensajeroAsignadoId: "msj-2" }),
      ordenListRow({ id: "ord-sin", mensajeroSugeridoId: null, mensajeroAsignadoId: null }),
    ]);
    prisma.orden.count.mockResolvedValue(2);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.list({
      where: {},
      sortBy: "created_at",
      sortDir: "desc",
      skip: 0,
      take: 20,
    });

    expect(res.items[0].mensajeroSugeridoId).toBe("msj-1");
    expect(res.items[0].mensajeroAsignadoId).toBe("msj-2");
    expect(res.items[1].mensajeroSugeridoId).toBeNull();
    expect(res.items[1].mensajeroAsignadoId).toBeNull();
  });

  // Feature 30/R14/R19: el listado suma zonaNombre/zonaEsGam (columna de zona),
  // sin romper el contrato del listado (tiendaNombre/mensajero* siguen presentes).
  it("R14: incluye zona.{nombre,esCentral} en el select y mapea zonaNombre/zonaEsGam por item", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      ordenListRow(),
      ordenListRow({ id: "ord-2", zona: { id: "z2", nombre: "Limón", esCentral: false } }),
    ]);
    prisma.orden.count.mockResolvedValue(2);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.list({
      where: {},
      sortBy: "created_at",
      sortDir: "desc",
      skip: 0,
      take: 20,
    });

    expect(res.items[0].zonaNombre).toBe("GAM");
    expect(res.items[0].zonaEsGam).toBe(true);
    expect(res.items[1].zonaNombre).toBe("Limón");
    expect(res.items[1].zonaEsGam).toBe(false);
    // R19: no rompe los campos previos del listado.
    expect(res.items[0].tiendaNombre).toBe("Tienda Uno");

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.include).toMatchObject({ zona: { select: { nombre: true, esCentral: true } } });
  });

  // El listado trae los datos de TODAS las relaciones directas (FK) via joins, y
  // la tienda incluye sus tarifas (Decimal -> number) sin exponer deletedAt.
  it("expone `relaciones` con las relaciones directas y las tarifas de la tienda", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      ordenListRow({
        distrito: { id: "d1", nombre: "Carmen" },
        mensajeroSugerido: { id: "msj-1", nombre: "Luis" },
        mensajeroAsignado: null,
      }),
    ]);
    prisma.orden.count.mockResolvedValue(1);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.list({
      where: {},
      sortBy: "created_at",
      sortDir: "desc",
      skip: 0,
      take: 20,
    });

    const rel = res.items[0].relaciones!;
    expect(rel.estatus).toEqual({ id: "os-bodega", value: "en_bodega" });
    expect(rel.zona).toEqual({ id: "z1", nombre: "GAM", esCentral: true });
    expect(rel.provincia).toEqual({ id: "p1", nombre: "San José" });
    expect(rel.canton).toEqual({ id: "c1", nombre: "Central" });
    expect(rel.distrito).toEqual({ id: "d1", nombre: "Carmen" });
    expect(rel.mensajeroSugerido).toEqual({ id: "msj-1", nombre: "Luis" });
    expect(rel.mensajeroAsignado).toBeNull();
    // La tienda trae sus datos + tarifas anidadas (Decimal -> number).
    expect(rel.tienda).toMatchObject({
      id: "t1",
      nombre: "Tienda Uno",
      email: "tienda1@ordenex.co",
      telefono: "0990000001",
    });
    expect(rel.tienda!.tarifa).toMatchObject({ id: "tar-1", valorFlete: 3.5, comisionCod: 5 });
    expect(rel.tienda!.tarifa).not.toHaveProperty("deletedAt");

    // El include filtra las tarifas borradas/inactivas (solo la ACTIVA) y
    // selecciona la relacion tienda.tarifasTienda.
    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.include.tienda.select.tarifasTienda.where).toEqual({
      status: "activo",
      deletedAt: null,
    });
  });

  it("inyecta tiendaId en el where cuando se pasa (alcance adminTienda)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([]);
    prisma.orden.count.mockResolvedValue(0);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.list({
      where: { tiendaId: "t1" },
      sortBy: "created_at",
      sortDir: "desc",
      skip: 10,
      take: 5,
    });

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ deletedAt: null, tiendaId: "t1" });
    // Feature 101/R6: prioridad-first PRIMERO, luego la recencia (created_at desc) como desempate.
    expect(arg.orderBy).toEqual([{ prioridad: "desc" }, { createdAt: "desc" }]);
  });

  // Feature 101/R6: el listado de reasignacion de la bodega central encabeza por
  // `prioridad DESC` para que las ordenes liberadas por SLA floten a la primera pagina, sin
  // perder el criterio de recencia como desempate.
  it("R6: orderBy encabeza con { prioridad: 'desc' } y conserva el criterio vigente como desempate", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([]);
    prisma.orden.count.mockResolvedValue(0);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.list({
      where: { estatusId: "os-bodega" },
      sortBy: "created_at",
      sortDir: "desc",
      skip: 0,
      take: 20,
    });

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(Array.isArray(arg.orderBy)).toBe(true);
    expect(arg.orderBy[0]).toEqual({ prioridad: "desc" }); // prioridad-first
    expect(arg.orderBy[1]).toEqual({ createdAt: "desc" }); // desempate por recencia
  });

  // Feature 101/R9: toDTO (y por herencia toListItemDTO) propaga el flag `prioridad` de la
  // fila al DTO del listado, para el sort (R6) y el resalte de fila (R8) del frontend.
  it("R9: propaga `prioridad` de la fila al OrdenListItemDTO", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      ordenListRow({ id: "ord-prio", prioridad: true }),
      ordenListRow({ id: "ord-normal", prioridad: false }),
    ]);
    prisma.orden.count.mockResolvedValue(2);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const res = await repo.list({
      where: { estatusId: "os-bodega" },
      sortBy: "created_at",
      sortDir: "desc",
      skip: 0,
      take: 20,
    });

    expect(res.items[0].prioridad).toBe(true);
    expect(res.items[1].prioridad).toBe(false);
  });
});

describe("OrdenRepository.softDelete (R39/R40)", () => {
  it("fija deleted_at solo si la orden no estaba borrada", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.softDelete("ord-1")).toBe(true);
    const arg = prisma.orden.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: "ord-1", deletedAt: null });
    expect(arg.data.deletedAt).toBeInstanceOf(Date);
  });

  it("devuelve false si no habia fila que borrar (R40)", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 0 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.softDelete("x")).toBe(false);
  });
});

describe("OrdenRepository.update (R36/R37)", () => {
  it("aplica cambios solo sobre no borradas y devuelve el DTO", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    // pre-lectura del origen (call 1) + relectura final para el DTO (call 2).
    prisma.orden.findFirst
      .mockResolvedValueOnce({ estatusId: "os-bodega" })
      .mockResolvedValueOnce(ordenRow({ estatusId: "os-entregada" }));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const dto = await repo.update("ord-1", { estatusId: "os-entregada" }, HIST_AJUSTE);

    const arg = prisma.orden.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: "ord-1", deletedAt: null });
    expect(dto?.estatusId).toBe("os-entregada");
  });

  it("devuelve null si no existe o esta borrada (R36)", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 0 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.update("x", { producto: "Otro" }, HIST_AJUSTE)).toBeNull();
  });

  // Feature 49/#11 (R19/R20): cuando el update CAMBIA estatus_id, deja 1 historial con
  // origen = estatus previo, destino = nuevo, tipo ajuste_estado.
  it("R19/R20: registra historial cuando cambia estatus_id (origen previo -> nuevo)", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    prisma.orden.findFirst
      .mockResolvedValueOnce({ estatusId: "os-bodega" }) // origen pre-leido
      .mockResolvedValueOnce(ordenRow({ estatusId: "os-entregada" }));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.update("ord-1", { estatusId: "os-entregada" }, HIST_AJUSTE);

    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const arg = prisma.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data).toEqual([
      {
        ordenId: "ord-1",
        estatusOrigenId: "os-bodega",
        estatusDestinoId: "os-entregada",
        actorUsuarioId: "u-actor",
        origenTipo: "ajuste_estado",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  // R19: un update que NO toca estatus_id no deja rastro.
  it("R19: actualizar otro campo (sin estatus) no registra historial", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    prisma.orden.findFirst.mockResolvedValueOnce(ordenRow());
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.update("ord-1", { producto: "Otro" }, HIST_AJUSTE);

    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  // R20: un update a estatus_id IGUAL al actual (no-op de estado) no deja rastro.
  it("R20: estatus_id igual al previo no registra historial (no hubo transicion)", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    prisma.orden.findFirst
      .mockResolvedValueOnce({ estatusId: "os-bodega" }) // origen
      .mockResolvedValueOnce(ordenRow({ estatusId: "os-bodega" }));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.update("ord-1", { estatusId: "os-bodega" }, HIST_AJUSTE);

    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});

describe("OrdenRepository.existsGeo / existsEstatus / findEstatusIdByValue", () => {
  it("existsGeo marca distrito=true cuando no se consulta (opcional)", async () => {
    const prisma = buildPrisma();
    prisma.zona.findUnique.mockResolvedValue({ id: "z1" });
    prisma.provincia.findUnique.mockResolvedValue({ id: "p1" });
    prisma.canton.findUnique.mockResolvedValue({ id: "c1" });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const geo = await repo.existsGeo({ zonaId: "z1", provinciaId: "p1", cantonId: "c1" });
    expect(geo).toEqual({ zona: true, provincia: true, canton: true, distrito: true });
    expect(prisma.distrito.findUnique).not.toHaveBeenCalled();
  });

  it("existsGeo detecta geografia inexistente", async () => {
    const prisma = buildPrisma();
    prisma.zona.findUnique.mockResolvedValue(null);
    prisma.provincia.findUnique.mockResolvedValue({ id: "p1" });
    prisma.canton.findUnique.mockResolvedValue(null);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const geo = await repo.existsGeo({ zonaId: "z9", provinciaId: "p1", cantonId: "c9" });
    expect(geo.zona).toBe(false);
    expect(geo.canton).toBe(false);
    expect(geo.provincia).toBe(true);
  });

  it("findEstatusIdByValue resuelve el id por value", async () => {
    const prisma = buildPrisma();
    prisma.orderStatus.findUnique.mockResolvedValue({ id: "os-bodega", value: "en_bodega" });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findEstatusIdByValue("en_bodega")).toBe("os-bodega");
  });

  it("existsEstatus devuelve false cuando no existe", async () => {
    const prisma = buildPrisma();
    prisma.orderStatus.findUnique.mockResolvedValue(null);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.existsEstatus("os-x")).toBe(false);
  });
});

describe("OrdenRepository.findUsuarioFulfillment (feature 27/R15/R16/R17)", () => {
  it("devuelve el flag fulfillment de la tienda que carga", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findUnique.mockResolvedValue({ fulfillment: true });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findUsuarioFulfillment("store-1")).toBe(true);
    const arg = prisma.usuario.findUnique.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "store-1" });
    expect(arg.select).toEqual({ fulfillment: true }); // R14: nunca passwordHash
  });

  it("devuelve false cuando el flag es false (R17)", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findUnique.mockResolvedValue({ fulfillment: false });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findUsuarioFulfillment("store-1")).toBe(false);
  });

  it("default false cuando el usuario no resuelve", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findUnique.mockResolvedValue(null);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findUsuarioFulfillment("desconocido")).toBe(false);
  });
});
