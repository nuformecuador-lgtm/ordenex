import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

function ordenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ord-1",
    numGuia: 1,
    numRemision: "REM-1",
    estatusId: idEstado("en_bodega_central"),
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
    estatus: { value: "en_bodega_central" },
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
    estatus: { id: idEstado("en_bodega_central"), value: "en_bodega_central" },
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
    mensajeroAsignado: null,
    // Gestión de reprogramación vigente (`take: 1`): vacío = sin reprogramación.
    gestiones: [],
    ...overrides,
  };
}

// Feature 49: `update` corre en `$transaction`; el fake `$transaction` invoca el callback con
// el propio `prisma` como `tx` (tiene los modelos + el choke point
// `ordenHistorialEstado.createMany`), asi las aserciones sobre `prisma.orden.*` siguen viendo
// las llamadas hechas dentro de la tx. (`create` tambien lo hacia, hasta que se borro el
// 2026-08-07 por quedarse sin llamador.)
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
const HIST_AJUSTE = { actorUsuarioId: "u-actor", origenTipo: "ajuste_estado" } as const;

beforeEach(async () => {
  await sembrarCatalogoEstados(); // feature 140: la guardia del choke point es de fallo CERRADO (catalogo real + pares legales)
});

// BORRADO 2026-08-07 (tanda 2 del chore de deuda de superficie): aqui vivia el bloque de
// `create`, el insert individual, retirado al quedarse sin llamador. Ninguna de sus seis
// afirmaciones se queda huerfana, y se comprobo una a una:
//   - la serializacion del DTO (peso Decimal -> number, numGuia NULL -> null, sin deletedAt)
//     la afirman los bloques de `findById`, `list` y `update`, que comparten el mismo `toDTO`;
//   - la atomicidad historial/insert la afirma `orden-historial-atomicidad.test.ts`, reapuntado
//     a `createManyOrdenes` (mecanismo #2), y `orden-geocode-enqueue.test.ts` (R7);
//   - el historial de creacion lo afirman los tests de las dos rutas de lote;
//   - la traduccion de P2002 a `NumRemisionDuplicadoError` se va CON su traductor
//     (`mapCreateError`): la carga masiva detecta duplicados antes de insertar
//     (`findExistingRemisiones` + `skipDuplicates`) y nunca provoca ese error;
//   - «la creacion nunca escribe mensajero_asignado_id» (155/R9) pasa a estar garantizada por
//     el TIPO, que es mas fuerte que un test: `CreateOrdenData` no tiene ese campo, y el
//     insert en lote se construye desde el con `toCreateManyInput`.

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
      where: { estatusId: idEstado("reprogramada") },
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
      where: { estatusId: idEstado("en_bodega_central") },
      sortBy: "num_guia",
      sortDir: "asc",
      skip: 0,
      take: 20,
    });

    expect(res.total).toBe(2);
    expect(res.items).toHaveLength(2);

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ deletedAt: null, estatusId: idEstado("en_bodega_central") });
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

  // Feature 17/R20: las secciones por_recoger/en_bodega_central muestran el
  // mensajero asignado (el "sugerido" se retiro por completo).
  it("R20: mapea mensajeroAsignadoId en el DTO del listado", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      ordenListRow({ id: "ord-con", mensajeroAsignadoId: "msj-2" }),
      ordenListRow({ id: "ord-sin", mensajeroAsignadoId: null }),
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

    expect(res.items[0].mensajeroAsignadoId).toBe("msj-2");
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
        mensajeroAsignado: { id: "msj-1", nombre: "Luis" },
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
    expect(rel.estatus).toEqual({ id: idEstado("en_bodega_central"), value: "en_bodega_central" });
    expect(rel.zona).toEqual({ id: "z1", nombre: "GAM", esCentral: true });
    expect(rel.provincia).toEqual({ id: "p1", nombre: "San José" });
    expect(rel.canton).toEqual({ id: "c1", nombre: "Central" });
    expect(rel.distrito).toEqual({ id: "d1", nombre: "Carmen" });
    expect(rel.mensajeroAsignado).toEqual({ id: "msj-1", nombre: "Luis" });
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

  // Filtro MULTI-ESTADO (selector de seleccion multiple del listado de /ordenes): una
  // LISTA de ids se traduce a `IN (...)`; una lista vacia no filtra (equivale a "sin
  // filtro", igual que un estatusId ausente).
  it("un estatusId como LISTA se traduce a `IN (...)` en el where", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([]);
    prisma.orden.count.mockResolvedValue(0);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const ids = [idEstado("en_bodega_central"), idEstado("entregada")];
    await repo.list({
      where: { estatusId: ids },
      sortBy: "created_at",
      sortDir: "desc",
      skip: 0,
      take: 20,
    });

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ deletedAt: null, estatusId: { in: ids } });
    // El count usa el MISMO where (el total debe corresponder al filtro aplicado).
    expect(prisma.orden.count.mock.calls[0][0].where).toMatchObject({
      estatusId: { in: ids },
    });
  });

  it("un estatusId como lista VACIA no filtra por estado", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([]);
    prisma.orden.count.mockResolvedValue(0);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.list({
      where: { estatusId: [] },
      sortBy: "created_at",
      sortDir: "desc",
      skip: 0,
      take: 20,
    });

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where.estatusId).toBeUndefined();
    expect(arg.where).toMatchObject({ deletedAt: null });
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
      where: { estatusId: idEstado("en_bodega_central") },
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
      where: { estatusId: idEstado("en_bodega_central") },
      sortBy: "created_at",
      sortDir: "desc",
      skip: 0,
      take: 20,
    });

    expect(res.items[0].prioridad).toBe(true);
    expect(res.items[1].prioridad).toBe(false);
  });
});

// BORRADO 2026-08-07 (tanda 2): aqui vivia el bloque de `softDelete`. R39/R40 eran los
// requisitos DEL borrado logico de una orden, capacidad retirada: no hay pantalla que la
// ofrezca ni servicio que la invoque. El predicado `deleted_at IS NULL` sigue vivo y probado
// en las LECTURAS (`findById (R34)` arriba, y el bloque de `list`).
describe("OrdenRepository.update (R36/R37)", () => {
  it("aplica cambios solo sobre no borradas y devuelve el DTO", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    // pre-lectura del origen (call 1) + relectura final para el DTO (call 2).
    prisma.orden.findFirst
      .mockResolvedValueOnce({ estatusId: idEstado("devolviendo_a_tienda") })
      .mockResolvedValueOnce(ordenRow({ estatusId: idEstado("devuelta_a_tienda") }));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    // Feature 140: `ajuste_estado` pasa por la MISMA guardia (Q3, sin override), asi que el
    // par tiene que ser una arista declarada: #28 `devolviendo_a_tienda -> devuelta_a_tienda`.
    const dto = await repo.update(
      "ord-1",
      { estatusId: idEstado("devuelta_a_tienda") },
      HIST_AJUSTE,
    );

    const arg = prisma.orden.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: "ord-1", deletedAt: null });
    expect(dto?.estatusId).toBe(idEstado("devuelta_a_tienda"));
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
      .mockResolvedValueOnce({ estatusId: idEstado("devolviendo_a_tienda") }) // origen pre-leido
      .mockResolvedValueOnce(ordenRow({ estatusId: idEstado("devuelta_a_tienda") }));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.update("ord-1", { estatusId: idEstado("devuelta_a_tienda") }, HIST_AJUSTE);

    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const arg = prisma.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data).toEqual([
      {
        ordenId: "ord-1",
        estatusOrigenId: idEstado("devolviendo_a_tienda"),
        estatusDestinoId: idEstado("devuelta_a_tienda"),
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
      .mockResolvedValueOnce({ estatusId: idEstado("en_bodega_central") }) // origen
      .mockResolvedValueOnce(ordenRow({ estatusId: idEstado("en_bodega_central") }));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.update("ord-1", { estatusId: idEstado("en_bodega_central") }, HIST_AJUSTE);

    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});

// El bloque afirmaba `existsGeo`, `existsEstatus` y `findEstatusIdByValue`. Los DOS primeros se
// borraron el 2026-08-07 con el alta manual y la edicion individual, sus unicos llamadores:
// `existsGeo` comprobaba fila a fila que zona/provincia/canton existieran antes de un alta
// manual —la carga masiva resuelve la geografia por NOMBRE, no por id, y las FK NOT NULL siguen
// siendo la garantia dura—, y `existsEstatus` era la guarda de catalogo de `actualizar`.
// `findEstatusIdByValue` esta MUY vivo: lo usan trece servicios de dominio.
describe("OrdenRepository.findEstatusIdByValue", () => {
  it("findEstatusIdByValue resuelve el id por value", async () => {
    const prisma = buildPrisma();
    prisma.orderStatus.findUnique.mockResolvedValue({ id: idEstado("en_bodega_central"), value: "en_bodega_central" });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findEstatusIdByValue("en_bodega_central")).toBe(idEstado("en_bodega_central"));
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
