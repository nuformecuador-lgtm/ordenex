import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";
import { ESTADOS_BODEGA_SATELITE } from "@/lib/utils/estados-bodega-satelite";
import {
  assertTransicionValida,
  TRANSICIONES,
  TransicionIlegalError,
} from "@/lib/types/order-status-transiciones";

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

// Fila de `tarifas` tal como la devuelve la query de la pagina (Decimal en las columnas
// numericas, patron real de Prisma). Feature 274: ya NO viene anidada en `tienda` ni lleva
// `status` —esa columna murio con el enum—; llega de `prisma.tarifa.findMany` y la elige la
// cascada (tienda, zona). El helper permite overrides para variar montos y par por caso.
function tarifaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tar-1",
    tiendaId: "t1",
    valorFlete: new Prisma.Decimal("3.50"),
    valorFleteDevuelto: new Prisma.Decimal("2.00"),
    valorFleteGam: new Prisma.Decimal("4.00"),
    valorFleteDevueltoGam: new Prisma.Decimal("2.50"),
    fulfillment: new Prisma.Decimal("1.00"),
    comisionCod: new Prisma.Decimal("5.00"),
    ivaFlete: new Prisma.Decimal("13.00"),
    ivaComisionCod: new Prisma.Decimal("13.00"),
    tarifaEspecial: null, // columna opcional: null = sin pacto especial
    zonaId: null, // opcional: null = no acotada a una zona
    isDefault: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

// Fila del LISTADO: ademas del estatus trae los datos de TODAS las relaciones
// directas (FK) de la orden. Feature 274: la tienda YA NO trae tarifas anidadas.
function ordenListRow(overrides: Record<string, unknown> = {}) {
  return {
    ...ordenRow(),
    estatus: { id: idEstado("en_bodega_central"), value: "en_bodega_central" },
    tienda: {
      id: "t1",
      nombre: "Tienda Uno",
      email: "tienda1@ordenex.co",
      telefono: "0990000001",
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
    // Feature 274 (T8.1): la tarifa de la pagina sale de SU PROPIA query. Por defecto no
    // resuelve ninguna (R20); cada test que quiera tarifa la siembra aqui.
    tarifa: { findMany: vi.fn().mockResolvedValue([]) },
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
  it("expone `relaciones` con las relaciones directas y la tarifa de la orden", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      ordenListRow({
        distrito: { id: "d1", nombre: "Carmen" },
        mensajeroAsignado: { id: "msj-1", nombre: "Luis" },
      }),
    ]);
    prisma.tarifa.findMany.mockResolvedValue([tarifaRow()]);
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

    // Feature 204: la fila trae ADEMÁS los dos importes derivados, ya en STRING.
    expect(res.items[0].fleteConIva).toBe("4.52"); // GAM 4.00 + 13%
    expect(res.items[0].comisionConIva).toBe("0.00"); // este fixture no lleva montoCobrar

    // Feature 274: el include de `tienda` YA NO trae tarifas. La tarifa llega de su propia
    // query, con la cascada, y por eso este `toEqual` deja constancia de lo que se fue.
    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.include.tienda.select).toEqual({
      id: true,
      nombre: true,
      email: true,
      telefono: true,
    });
    expect(arg.include.tienda.select).not.toHaveProperty("tarifasTienda");
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

  // -----------------------------------------------------------------------------------
  // Feature 204 — las columnas "Flete + IVA" y "Comisión + IVA" del listado se DERIVAN
  // aquí, en Decimal, y viajan como STRING. Antes las multiplicaba el navegador sobre los
  // `number` de `relaciones.tienda.tarifa`, y sobre las órdenes reales de la base 14 de 66
  // se veían un céntimo desviadas de lo que factura el cierre.
  //
  // Los casos son los MISMOS que midió la ficha, montados sobre la tarifa real (comisión
  // 3.50%, IVA 13%), y entran por donde entran de verdad: `Prisma.Decimal` en la fila.
  // -----------------------------------------------------------------------------------
  const TARIFA_REAL = {
    valorFlete: new Prisma.Decimal("3000.00"),
    valorFleteGam: new Prisma.Decimal("2000.00"),
    comisionCod: new Prisma.Decimal("3.50"),
    ivaFlete: new Prisma.Decimal("13.00"),
    ivaComisionCod: new Prisma.Decimal("13.00"),
  };

  async function derivadosDe(
    overrides: Record<string, unknown>,
    // Feature 274: las candidatas que la query de tarifas devuelve para la pagina. `[]` = el
    // par (tienda, zona) de la orden no resuelve ninguna (R20).
    tarifas: Array<Record<string, unknown>> = [tarifaRow(TARIFA_REAL)],
  ) {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      ordenListRow({
        // no-central: usa `valorFlete`, no la variante GAM.
        zona: { id: "z1", nombre: "Limón", esCentral: false },
        cobraComision: true,
        ...overrides,
      }),
    ]);
    prisma.tarifa.findMany.mockResolvedValue(tarifas);
    prisma.orden.count.mockResolvedValue(1);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    const res = await repo.list({
      where: {},
      sortBy: "created_at",
      sortDir: "desc",
      skip: 0,
      take: 20,
    });
    return res.items[0];
  }

  it("204: comisión + IVA de 14900.00 -> '589.30' (el navegador pintaba 589.29)", async () => {
    const item = await derivadosDe({ montoCobrar: new Prisma.Decimal("14900.00") });
    expect(item.comisionConIva).toBe("589.30");
  });

  it("204: comisión + IVA de 16618.40 -> '657.25' (el navegador pintaba 657.26)", async () => {
    const item = await derivadosDe({ montoCobrar: new Prisma.Decimal("16618.40") });
    expect(item.comisionConIva).toBe("657.25");
  });

  it("204: el flete sale de la columna que elige la zona, con su IVA", async () => {
    const noCentral = await derivadosDe({ montoCobrar: new Prisma.Decimal("100.00") });
    expect(noCentral.fleteConIva).toBe("3390.00"); // 3000 + 13%

    const central = await derivadosDe({
      montoCobrar: new Prisma.Decimal("100.00"),
      zona: { id: "z1", nombre: "GAM", esCentral: true },
    });
    expect(central.fleteConIva).toBe("2260.00"); // 2000 (GAM) + 13%
  });

  it("204: sin tarifa resuelta los dos importes son '0.00' (R9), no null", async () => {
    const item = await derivadosDe(
      { montoCobrar: new Prisma.Decimal("14900.00") },
      [], // la cascada no encontró fila para el par (tienda, zona)
    );
    expect(item.fleteConIva).toBe("0.00");
    expect(item.comisionConIva).toBe("0.00");
    expect(item.relaciones!.tienda!.tarifa).toBeNull();
  });

  it("204: una orden que no cobra comisión la trae en '0.00', con el flete intacto", async () => {
    const item = await derivadosDe({
      montoCobrar: new Prisma.Decimal("14900.00"),
      cobraComision: false,
    });
    expect(item.comisionConIva).toBe("0.00");
    expect(item.fleteConIva).toBe("3390.00");
  });

  it("204: son STRING de escala 2, nunca number (el dinero cruza así la frontera)", async () => {
    const item = await derivadosDe({ montoCobrar: new Prisma.Decimal("16618.40") });
    expect(typeof item.fleteConIva).toBe("string");
    expect(typeof item.comisionConIva).toBe("string");
    expect(item.fleteConIva).toMatch(/^\d+\.\d{2}$/);
    expect(item.comisionConIva).toMatch(/^\d+\.\d{2}$/);
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

// ---------------------------------------------------------------------------------------------
// Feature 239 (T1.4/T1.7, R25) — el PRE-ESTADO no se ofrece para nada operativo.
//
// «No aparece» se demuestra de dos maneras, y las dos hacen falta:
//   (a) por el WHERE: los tres listados que ofrecen trabajo acotan por IGUALDAD de estado, asi
//       que una orden en el pre-estado no puede entrar por ninguno;
//   (b) por el GRAFO: aunque alguien la colara en un listado, el pre-estado no tiene arista
//       legal hacia `por_recoger`, `en_ruta_bodega_satelite` ni `recolectando`, asi que la
//       accion fallaria en el choke point. La (b) es la que sobrevive a un refactor del WHERE.
// ---------------------------------------------------------------------------------------------
describe("239/R25 — el pre-estado no se ofrece para asignacion, ruteo, recoleccion ni ruta", () => {
  const PRE_ESTADO = "devolucion_por_confirmar";

  it("R25(a): el filtro `reasignables` acota por IGUALDAD a `en_bodega_central`", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([]);
    prisma.orden.count.mockResolvedValue(0);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.list({
      where: { reasignables: true },
      sortBy: "num_guia",
      sortDir: "asc",
      skip: 0,
      take: 20,
    });

    const arg = prisma.orden.findMany.mock.calls[0][0] as {
      where: { estatus?: { value?: unknown }; mensajeroAsignadoId?: unknown };
    };
    // Igualdad, no `in` ni `notIn`: el pre-estado no puede colarse ni por omision ni por
    // lista negra. Asignar y rutear a satelite parten del MISMO origen.
    expect(arg.where.estatus).toEqual({ value: "en_bodega_central" });
    expect(arg.where.mensajeroAsignadoId).toBeNull();
    expect(JSON.stringify(arg.where)).not.toContain(PRE_ESTADO);
  });

  it("R25(a): las PARADAS de ruta salen SOLO de `en_reparto`", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findParadasEnReparto("m1");

    const arg = prisma.orden.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where.estatus).toEqual({ value: "en_reparto" });
    expect(JSON.stringify(arg.where)).not.toContain(PRE_ESTADO);
  });

  it("R25(b): el grafo no ofrece salida del pre-estado hacia asignacion/ruteo/recoleccion", () => {
    // Las DOS unicas salidas son el anclaje (al aprobar el cierre) y el deshacer del mensajero.
    // Cualquier intento de asignar, rutear o recolectar desde aqui muere en el choke point.
    const salidas = TRANSICIONES.devolucion_por_confirmar.map((d) => d.to);
    expect([...salidas].sort()).toEqual(["devuelta", "en_reparto"]);
    for (const destino of ["por_recoger", "en_ruta_bodega_satelite", "recolectando"] as const) {
      expect(() => assertTransicionValida(PRE_ESTADO, destino)).toThrow(TransicionIlegalError);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// FEATURE 235 (T3.2/T3.4, R14/R17) — LA ORDEN EN AYUDA SALE DE LA RUTA, Y NO SE OFRECE PARA NADA.
//
// ESTE ES EL ARGUMENTO CENTRAL DE LA FICHA, medido. Con la BANDERA, `findParadasEnReparto` traia
// la orden igual —su `where` es `estatus = en_reparto` y la orden seguia ahi—, asi que el
// optimizador la seguia visitando y el mapa la seguia pintando aunque su card estuviera abajo en
// otra seccion. NO HIZO FALTA ESCRIBIR NINGUN FILTRO NUEVO: al mover el estatus, la orden deja de
// casar SOLA.
//
// Se demuestra por las MISMAS dos vias que la 239 (design §12 de aquella ficha):
//   (a) por el WHERE: los listados que ofrecen trabajo acotan por IGUALDAD de estado;
//   (b) por el GRAFO: aunque alguien la colara en un listado, `ayuda_tienda` no tiene arista legal
//       hacia `por_recoger`, `en_ruta_bodega_satelite` ni `recolectando`, asi que la accion
//       moriria en el choke point. La (b) es la que sobrevive a un refactor del WHERE.
//
// ⚠️ LA MUTACION QUE MATA EL PRIMER CASO: cambiar el `where` de `findParadasEnReparto` a
// `estatus: { value: { in: ["en_reparto", "ayuda_tienda"] } }`.
// ---------------------------------------------------------------------------------------------
describe("235/R14/R17 — la orden en ayuda no es parada de ruta ni se ofrece para operar", () => {
  const AYUDA = "ayuda_tienda";

  it("R14(a): `findParadasEnReparto` acota por IGUALDAD a `en_reparto` — un `in` la colaria", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findParadasEnReparto("m1");

    const arg = prisma.orden.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    // Igualdad, no `in` ni `notIn`. Es lo que hace que la orden en ayuda desaparezca de la ruta
    // sin que nadie escriba un filtro para ella.
    expect(arg.where.estatus).toEqual({ value: "en_reparto" });
    expect(JSON.stringify(arg.where)).not.toContain(AYUDA);
  });

  it("R14(a): el predicado, aplicado a filas, DEJA FUERA la del mensajero que pidio ayuda", async () => {
    // El `where` es lo unico que decide (este doble no ejecuta SQL), asi que se le da semantica:
    // se simula la igualdad sobre tres filas del MISMO mensajero. Sin esto, el caso de arriba
    // afirmaria una forma sin decir que efecto tiene.
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findParadasEnReparto("m1");
    const { where } = prisma.orden.findMany.mock.calls[0][0] as {
      where: { mensajeroAsignadoId: string; deletedAt: null; estatus: { value: string } };
    };

    const casa = (fila: { mensajero: string; estatus: string; borrada: boolean }) =>
      fila.mensajero === where.mensajeroAsignadoId &&
      fila.borrada === (where.deletedAt !== null) &&
      fila.estatus === where.estatus.value;

    expect(casa({ mensajero: "m1", estatus: "en_reparto", borrada: false })).toBe(true);
    // ⭑ La que importa: misma moto, mismo dia, y NO es parada.
    expect(casa({ mensajero: "m1", estatus: AYUDA, borrada: false })).toBe(false);
    expect(casa({ mensajero: "m2", estatus: "en_reparto", borrada: false })).toBe(false);
  });

  it("R17(a): el filtro `reasignables` tampoco la ofrece (acota a `en_bodega_central`)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([]);
    prisma.orden.count.mockResolvedValue(0);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.list({
      where: { reasignables: true },
      sortBy: "num_guia",
      sortDir: "asc",
      skip: 0,
      take: 20,
    });

    const arg = prisma.orden.findMany.mock.calls[0][0] as {
      where: { estatus?: { value?: unknown } };
    };
    // Asignar a mensajero y rutear a satelite parten del MISMO origen, asi que este unico caso
    // cubre las dos superficies. Igualdad: ni por omision ni por lista negra se cuela.
    expect(arg.where.estatus).toEqual({ value: "en_bodega_central" });
    expect(JSON.stringify(arg.where)).not.toContain(AYUDA);
  });

  it("R17(a): el listado de la bodega satelite tampoco la admite", () => {
    // Su lista blanca esta congelada en `estados-bodega-satelite.test.ts`; aqui se afirma la
    // consecuencia para esta feature: el paquete esta en la moto, no en el estante.
    expect(ESTADOS_BODEGA_SATELITE as readonly string[]).not.toContain(AYUDA);
  });

  it("R17(b): el GRAFO no ofrece salida de `ayuda_tienda` hacia asignacion, ruteo ni recoleccion", () => {
    // La via que sobrevive a un refactor del WHERE: aunque alguien la colara en un listado, la
    // accion moriria en el choke point.
    //
    // ⏳ 2026-08-20 (feature 237): las salidas pasan de DOS a CUATRO. A los dos caminos de vuelta
    // (el rescate y el corte) se suman los DOS DESENLACES que la tienda puede registrar desde su
    // pestaña de ayuda (#65 `reprogramada`, #66 `rechazada`), con su productor. Lo que R17(b)
    // vigila NO cambia: ninguna de las cuatro lleva a asignacion, ruteo ni recoleccion — el
    // paquete sigue en la moto, no en un estante.
    const salidas = TRANSICIONES.ayuda_tienda.map((d) => d.to);
    expect([...salidas].sort()).toEqual([
      "en_reparto",
      "rechazada",
      "reprogramada",
      "sin_gestionar",
    ]);
    for (const destino of [
      "por_recoger", // asignacion a mensajero
      "en_ruta_bodega_satelite", // ruteo a satelite
      "recolectando", // asignacion de recoleccion en tienda
      "en_bodega_central", // recuperacion manual
      "en_bodega_satelite",
    ] as const) {
      expect(() => assertTransicionValida(AYUDA, destino)).toThrow(TransicionIlegalError);
    }
  });
});

// =====================================================================================
// FEATURE 274 (T8.3) — LA TARIFA DEL LISTADO SALE DE LA CASCADA (tienda, zona).
//
// Hasta esta feature el listado traia `tienda.tarifasTienda { where: { status: "activo" },
// take: 1 }`: una regla PROPIA, distinta de la que liquida el cierre de dia. Con la misma
// base de datos, la pantalla podia MOSTRAR una fila y el cierre FACTURAR otra. Aqui se
// afirma que la fila la elige ahora la cascada del modulo puro, por el par (tienda, zona)
// de CADA orden, en UNA sola query adicional por pagina.
//
// El doble de Prisma es el del resto del archivo: `prisma.tarifa.findMany` devuelve las
// candidatas y las aserciones son sobre el `where`/`select` EXACTOS que recibe.
// =====================================================================================
describe("OrdenRepository.list — tarifa por cascada (R18/R19/R20)", () => {
  const paramsPagina = {
    where: {},
    sortBy: "created_at",
    sortDir: "desc",
    skip: 0,
    take: 50,
  } as const;

  // Tienda unica en DOS zonas, con una tarifa por zona (nivel 1 de la cascada) y ademas una
  // generica de la tienda (nivel 2) que NO debe ganarle a ninguna de las dos.
  function tarifasDeDosZonas() {
    return [
      tarifaRow({ id: "tar-z1", zonaId: "z1", valorFlete: new Prisma.Decimal("1000.00") }),
      tarifaRow({ id: "tar-z2", zonaId: "z2", valorFlete: new Prisma.Decimal("2000.00") }),
      // nivel 2: la de la tienda entera, la que NO debe ganar.
      tarifaRow({ id: "tar-generica", zonaId: null, valorFlete: new Prisma.Decimal("9999.00") }),
    ];
  }

  function dosOrdenesEnZonasDistintas() {
    return [
      ordenListRow({
        id: "ord-z1",
        zonaId: "z1",
        zona: { id: "z1", nombre: "Limón", esCentral: false },
      }),
      ordenListRow({
        id: "ord-z2",
        zonaId: "z2",
        zona: { id: "z2", nombre: "Puntarenas", esCentral: false },
      }),
    ];
  }

  it("R18: dos ordenes de la MISMA tienda en zonas distintas muestran importes distintos", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue(dosOrdenesEnZonasDistintas());
    prisma.tarifa.findMany.mockResolvedValue(tarifasDeDosZonas());
    prisma.orden.count.mockResolvedValue(2);

    const res = await new OrdenRepository(prisma as unknown as PrismaClient).list(paramsPagina);

    // Cada fila cobra la tarifa de SU zona (nivel 1), no la generica de la tienda.
    expect(res.items[0].relaciones!.tienda!.tarifa!.id).toBe("tar-z1");
    expect(res.items[1].relaciones!.tienda!.tarifa!.id).toBe("tar-z2");
    expect(res.items[0].fleteConIva).toBe("1130.00"); // 1000 + 13%
    expect(res.items[1].fleteConIva).toBe("2260.00"); // 2000 + 13%
    // Lo que la feature viene a arreglar, dicho como asercion: los dos importes DIFIEREN.
    expect(res.items[0].fleteConIva).not.toBe(res.items[1].fleteConIva);
  });

  it("R18: la cascada es la del modulo puro — `where` y `select` exactos de la query", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue(dosOrdenesEnZonasDistintas());
    prisma.tarifa.findMany.mockResolvedValue(tarifasDeDosZonas());
    prisma.orden.count.mockResolvedValue(2);

    await new OrdenRepository(prisma as unknown as PrismaClient).list(paramsPagina);

    const arg = prisma.tarifa.findMany.mock.calls[0][0];
    // Las TRES ramas de `whereCascada`, en el mismo orden: nivel 1 (tienda × zona), nivel 2
    // (tienda, zona NULL) y nivel 3 (zona, tienda NULL). Si alguien reescribe la regla aqui
    // dentro en vez de reusar el modulo puro, esta comparacion se pone roja.
    expect(arg.where).toEqual({
      OR: [
        { tiendaId: { in: ["t1"] }, zonaId: { in: ["z1", "z2"] } },
        { tiendaId: { in: ["t1"] }, zonaId: null },
        { tiendaId: null, zonaId: { in: ["z1", "z2"] } },
      ],
    });
    // Proyeccion del LISTADO: la de `TarifaDTO` (con `isDefault`, `tarifaEspecial` y las
    // fechas), no la de la ruta del dinero. Sin columnas de mas.
    expect(Object.keys(arg.select).sort()).toEqual([
      "comisionCod",
      "createdAt",
      "fulfillment",
      "id",
      "isDefault",
      "ivaComisionCod",
      "ivaFlete",
      "tarifaEspecial",
      "tiendaId",
      "updatedAt",
      "valorFlete",
      "valorFleteDevuelto",
      "valorFleteDevueltoGam",
      "valorFleteGam",
      "zonaId",
    ]);
  });

  // R19 — el numero de consultas de DATOS de una pagina no depende del numero de filas.
  // Se cuentan las dos que traen filas (ordenes + tarifas); el `count` de la paginacion es
  // una agregacion que ya existia, no una tercera lectura.
  for (const n of [1, 50]) {
    it("R19: una pagina de " + n + " fila(s) hace 2 consultas de datos, no N + 1", async () => {
      const prisma = buildPrisma();
      prisma.orden.findMany.mockResolvedValue(
        Array.from({ length: n }, (_, i) =>
          ordenListRow({
            id: "ord-" + i,
            // Mitad y mitad en dos zonas: los pares se DEDUPLICAN, asi que sigue siendo una
            // sola query por mas filas que traiga la pagina.
            zonaId: i % 2 === 0 ? "z1" : "z2",
            zona:
              i % 2 === 0
                ? { id: "z1", nombre: "Limón", esCentral: false }
                : { id: "z2", nombre: "Puntarenas", esCentral: false },
          }),
        ),
      );
      prisma.tarifa.findMany.mockResolvedValue(tarifasDeDosZonas());
      prisma.orden.count.mockResolvedValue(n);

      const res = await new OrdenRepository(prisma as unknown as PrismaClient).list(paramsPagina);

      expect(res.items).toHaveLength(n);
      expect(prisma.orden.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.tarifa.findMany).toHaveBeenCalledTimes(1);
      // La suma, dicha aparte: DOS consultas de datos, sea la pagina de 1 o de 50.
      expect(
        prisma.orden.findMany.mock.calls.length + prisma.tarifa.findMany.mock.calls.length,
      ).toBe(2);
      // Y los pares van DEDUPLICADOS: la unica tienda una vez y las zonas presentes una vez
      // cada una (con n = 50, dos entradas, no cincuenta).
      const arg = prisma.tarifa.findMany.mock.calls[0][0];
      expect(arg.where.OR[0]).toEqual({
        tiendaId: { in: ["t1"] },
        zonaId: { in: n === 1 ? ["z1"] : ["z1", "z2"] },
      });
    });
  }

  it("R20: una orden sin tarifa sale con `tarifa: null` y '0.00', sin romper la pagina", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      ordenListRow({
        id: "ord-con",
        zonaId: "z1",
        zona: { id: "z1", nombre: "Limón", esCentral: false },
      }),
      // Otra tienda: ningun nivel de la cascada tiene fila para su par.
      ordenListRow({
        id: "ord-sin",
        tiendaId: "t9",
        zonaId: "z9",
        zona: { id: "z9", nombre: "Sin cobertura", esCentral: false },
        montoCobrar: new Prisma.Decimal("14900.00"),
        cobraComision: true,
      }),
    ]);
    prisma.tarifa.findMany.mockResolvedValue([
      tarifaRow({ id: "tar-z1", zonaId: "z1", valorFlete: new Prisma.Decimal("1000.00") }),
    ]);
    prisma.orden.count.mockResolvedValue(2);

    const res = await new OrdenRepository(prisma as unknown as PrismaClient).list(paramsPagina);

    // R39: el gap NO bloquea el listado —a diferencia de los dos bordes de API por key, que
    // devuelven 409—. La pagina llega entera y la fila que si resuelve conserva su importe.
    expect(res.items).toHaveLength(2);
    expect(res.items[0].relaciones!.tienda!.tarifa!.id).toBe("tar-z1");
    expect(res.items[0].fleteConIva).toBe("1130.00");

    expect(res.items[1].relaciones!.tienda!.tarifa).toBeNull();
    expect(res.items[1].fleteConIva).toBe("0.00");
    expect(res.items[1].comisionConIva).toBe("0.00");
  });

  it("R20: una pagina VACIA no consulta tarifas (el `where` seria `{ OR: [] }`)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([]);
    prisma.orden.count.mockResolvedValue(0);

    const res = await new OrdenRepository(prisma as unknown as PrismaClient).list(paramsPagina);

    expect(res.items).toEqual([]);
    expect(prisma.tarifa.findMany).not.toHaveBeenCalled();
  });
});

// El detalle del tablero del dia se hidrata por `findListItemsByIds`, que comparte include y
// mapeo con `list()`. Si la tarifa NO recibiera el mismo tratamiento, las dos pantallas
// volverian a divergir por la puerta de atras.
describe("OrdenRepository.findListItemsByIds — la MISMA tarifa que el listado (R18-R20)", () => {
  it("resuelve por cascada y con UNA sola query adicional", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      ordenListRow({
        id: "ord-z1",
        zonaId: "z1",
        zona: { id: "z1", nombre: "Limón", esCentral: false },
      }),
      ordenListRow({
        id: "ord-z2",
        zonaId: "z2",
        zona: { id: "z2", nombre: "Puntarenas", esCentral: false },
      }),
    ]);
    prisma.tarifa.findMany.mockResolvedValue([
      tarifaRow({ id: "tar-z1", zonaId: "z1", valorFlete: new Prisma.Decimal("1000.00") }),
      tarifaRow({ id: "tar-z2", zonaId: "z2", valorFlete: new Prisma.Decimal("2000.00") }),
    ]);

    const items = await new OrdenRepository(prisma as unknown as PrismaClient).findListItemsByIds(
      ["ord-z1", "ord-z2"],
      { tipo: "global" },
    );

    expect(items[0].relaciones!.tienda!.tarifa!.id).toBe("tar-z1");
    expect(items[1].relaciones!.tienda!.tarifa!.id).toBe("tar-z2");
    expect(items[0].fleteConIva).toBe("1130.00");
    expect(items[1].fleteConIva).toBe("2260.00");
    expect(prisma.tarifa.findMany).toHaveBeenCalledTimes(1);
  });

  it("sin tarifa para el par: `tarifa: null` y '0.00', igual que el listado (R20/R39)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([ordenListRow({ id: "ord-sin" })]);
    prisma.tarifa.findMany.mockResolvedValue([]);

    const items = await new OrdenRepository(prisma as unknown as PrismaClient).findListItemsByIds(
      ["ord-sin"],
      { tipo: "global" },
    );

    expect(items[0].relaciones!.tienda!.tarifa).toBeNull();
    expect(items[0].fleteConIva).toBe("0.00");
  });

  it("con la lista vacia no consulta tarifas (R5: cero ids, cero consultas)", async () => {
    const prisma = buildPrisma();
    const items = await new OrdenRepository(prisma as unknown as PrismaClient).findListItemsByIds(
      [],
      { tipo: "global" },
    );

    expect(items).toEqual([]);
    expect(prisma.orden.findMany).not.toHaveBeenCalled();
    expect(prisma.tarifa.findMany).not.toHaveBeenCalled();
  });
});
