import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CierresBodegaAdminRepository } from "@/lib/repositories/CierresBodegaAdminRepository";
import { CierreDetalleFaltanteError } from "@/lib/utils/cierre-detalle";

// Feature 40 — tests unit del CierresBodegaAdminRepository (mockea Prisma, sin DB real).
// Cubre R15 (findCierresBodega orderBy desc + totales string), R11
// (findCierreBodegaConDetalle: WHERE cierre_id por cada cierre_dia),
// R16/R18 (resolverCierreBodega: updateMany WHERE estado='solicitado'; count 1->updated;
// 0+existe->conflict; 0+no existe->fuera_de_alcance), R21/R22 (solo toca cierre_bodega).
//
// Feature 69/T23 (R15 de la 69): el detalle de un cierre_dia YA CREADO sale del SNAPSHOT
// `cierre_detail`, no de la orden VIVA. Los tests de aqui abajo lo fijan afirmando sobre el
// doble de Prisma que `orden`/`zona`/`tarifas` NUNCA se consultan.

function bodegaDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cb1",
    zonaId: "z-cartago",
    solicitadoPor: "adm-sat",
    estado: "solicitado",
    totalEfectivo: new Prisma.Decimal("10"),
    totalSimpe: new Prisma.Decimal("5.5"),
    totalTransferencia: new Prisma.Decimal("0"),
    totalGeneral: new Prisma.Decimal("15.5"),
    totalPagoMensajero: new Prisma.Decimal("7.5"), // feature 39/R20: snapshot agregado
    totalIngresoBodegaRechazos: new Prisma.Decimal("6.5"), // feature 56/R19: snapshot agregado
    solicitadoAt: new Date("2026-07-12T10:00:00.000Z"),
    resueltoAt: null,
    motivoRechazo: null,
    zona: { nombre: "Cartago" },
    solicitadoPorUsuario: { nombre: "Sara Satelite" },
    _count: { cierresDia: 2 },
    ...overrides,
  };
}

function detalleCierreDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cd1",
    mensajeroId: "m1",
    totalEfectivo: new Prisma.Decimal("10"),
    totalSimpe: new Prisma.Decimal("0"),
    totalTransferencia: new Prisma.Decimal("0"),
    totalGeneral: new Prisma.Decimal("10"),
    totalPagoMensajero: new Prisma.Decimal("5"), // feature 39/R20: snapshot del cierre_dia
    totalIngresoBodegaRechazos: new Prisma.Decimal("3"), // feature 56/R19: snapshot del cierre_dia
    mensajero: { nombre: "Ana Mensajera" },
    ...overrides,
  };
}

// Feature 69/T23: la GESTION aporta SOLO lo suyo (resultado/montos/evidencia); ya no navega
// la relacion `orden`.
function gestionDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "g1",
    ordenId: "o1",
    resultado: "entregada",
    montoRecibido: new Prisma.Decimal("10.00"),
    metodoPago: "efectivo",
    motivo: null,
    fechaReprogramacion: null,
    evidenciaStoragePath: "o1/e.jpg",
    pagoMensajero: new Prisma.Decimal("5.00"), // feature 39/R20: snapshot leido
    ingresoBodegaRechazo: new Prisma.Decimal("0.00"), // feature 56/R19: snapshot leido
    // Feature 158/R9/R19: campos POR RAMA del incidente, tal como los lee
    // `GESTION_ADMIN_SELECT`. `null` en un resultado que no sea `incidente`.
    causaIncidente: null,
    indemnizacion: null,
    // Feature 208/R21/R23: el TERCER camino de lectura tambien trae el desglose.
    pagos: [{ metodo: "efectivo", monto: new Prisma.Decimal("10.00") }],
    historialEstados: [], // feature 102: acotado al origen SLA (vacio = rechazo NO-SLA/otro resultado)
    ...overrides,
  };
}

// Feature 69/T23: la fila CONGELADA de la orden en ese cierre.
function detalleDbRow(overrides: Record<string, unknown> = {}) {
  return {
    ordenId: "o1",
    numGuia: 10,
    numRemision: "REM-1",
    destinatario: "Ana",
    direccion: "Av 1",
    producto: "Caja",
    tiendaNombre: "Tienda X",
    zonaNombre: "Cartago",
    provinciaNombre: "Cartago",
    cantonNombre: "Central",
    distritoNombre: "Oriental",
    // Entradas de la fórmula del ingreso + tarifa congelada (feature 69/R6/R8). Default sin
    // tarifa (`tarifaId: null` = gap real de la R9): estos tests miran los descriptivos.
    montoCobrar: null,
    cobraComision: false,
    esCentral: false,
    tarifaId: null,
    tarifaValorFlete: null,
    tarifaValorFleteGam: null,
    tarifaValorFleteDevuelto: null,
    tarifaValorFleteDevueltoGam: null,
    tarifaComisionCod: null,
    tarifaIvaFlete: null,
    tarifaIvaComisionCod: null,
    ...overrides,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    cierreBodega: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    cierreDia: { findMany: vi.fn() },
    gestionOrden: { findMany: vi.fn() },
    // Feature 69/T23 (R15): el detalle de un cierre YA CREADO sale del SNAPSHOT.
    cierreDetail: { findMany: vi.fn().mockResolvedValue([]) },
    // Dobles de las tablas VIVAS que esta vista NO debe volver a mirar. No estan en el tipo
    // del cliente del repo: existen solo para que un `expect(...).not.toHaveBeenCalled()`
    // pueda MORDER si alguien reintroduce la lectura viva.
    orden: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    zona: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    tarifas: { findMany: vi.fn(), findFirst: vi.fn() },
    ...overrides,
  };
}

describe("CierresBodegaAdminRepository.findCierresBodega (R15)", () => {
  it("R15: todos, orderBy solicitadoAt desc, totales STRING + cantidadCierres del _count", async () => {
    const prisma = buildPrisma();
    prisma.cierreBodega.findMany.mockResolvedValue([bodegaDbRow()]);
    const repo = new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findCierresBodega();

    const arg = prisma.cierreBodega.findMany.mock.calls[0][0];
    expect(arg.orderBy).toMatchObject({ solicitadoAt: "desc" });
    expect(arg).not.toHaveProperty("where"); // el maestro no se acota por zona
    expect(rows[0]).toEqual({
      cierreBodegaId: "cb1",
      zonaId: "z-cartago",
      zonaNombre: "Cartago",
      solicitadoPorId: "adm-sat",
      solicitadoPorNombre: "Sara Satelite",
      estado: "solicitado",
      totales: { efectivo: "10.00", simpe: "5.50", transferencia: "0.00", general: "15.50" },
      totalPagoMensajero: "7.50", // feature 39/R20: snapshot money-safe STRING
      totalIngresoBodegaRechazos: "6.50", // feature 56/R19: snapshot money-safe STRING
      cantidadCierres: 2,
      solicitadoAt: "2026-07-12T10:00:00.000Z",
      resueltoAt: null,
      motivoRechazo: null,
    });
    expect(typeof rows[0].totales.general).toBe("string");
  });
});

describe("CierresBodegaAdminRepository.findCierreBodegaConDetalle (R11/R19)", () => {
  it("R19: cierre de bodega inexistente -> null, sin cargar cierre_dia ni gestiones", async () => {
    const prisma = buildPrisma();
    prisma.cierreBodega.findUnique.mockResolvedValue(null);
    const repo = new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);

    const r = await repo.findCierreBodegaConDetalle("cb-x");

    expect(r).toBeNull();
    expect(prisma.cierreBodega.findUnique.mock.calls[0][0].where).toEqual({ id: "cb-x" });
    expect(prisma.cierreDia.findMany).not.toHaveBeenCalled();
    expect(prisma.gestionOrden.findMany).not.toHaveBeenCalled();
    expect(prisma.cierreDetail.findMany).not.toHaveBeenCalled();
  });

  it("R11: por cada cierre_dia (WHERE cierre_bodega_id=id) carga gestiones y snapshot WHERE cierre_id=cd.id y mapea", async () => {
    const prisma = buildPrisma();
    prisma.cierreBodega.findUnique.mockResolvedValue(bodegaDbRow());
    prisma.cierreDia.findMany.mockResolvedValue([
      detalleCierreDbRow({ id: "cd1" }),
      detalleCierreDbRow({ id: "cd2", mensajeroId: "m2", mensajero: { nombre: "Beto" } }),
    ]);
    prisma.gestionOrden.findMany
      .mockResolvedValueOnce([gestionDbRow({ id: "g1" })])
      .mockResolvedValueOnce([gestionDbRow({ id: "g2", ordenId: "o2", resultado: "devuelta", montoRecibido: null, metodoPago: null, evidenciaStoragePath: null })]);
    prisma.cierreDetail.findMany
      .mockResolvedValueOnce([detalleDbRow({ ordenId: "o1" })])
      .mockResolvedValueOnce([detalleDbRow({ ordenId: "o2" })]);
    const repo = new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);

    const r = await repo.findCierreBodegaConDetalle("cb1");

    expect(r).not.toBeNull();
    // los cierre_dia se buscan por cierre_bodega_id.
    expect(prisma.cierreDia.findMany.mock.calls[0][0].where).toEqual({ cierreBodegaId: "cb1" });
    // una llamada de gestiones por cada cierre_dia, WHERE cierre_id = cd.id.
    expect(prisma.gestionOrden.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.gestionOrden.findMany.mock.calls[0][0].where).toEqual({ cierreId: "cd1" });
    expect(prisma.gestionOrden.findMany.mock.calls[1][0].where).toEqual({ cierreId: "cd2" });
    // 69/T23: y el snapshot de ESE cierre_dia, no el de otro.
    expect(prisma.cierreDetail.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.cierreDetail.findMany.mock.calls[0][0].where).toEqual({ cierreId: "cd1" });
    expect(prisma.cierreDetail.findMany.mock.calls[1][0].where).toEqual({ cierreId: "cd2" });
    expect(r?.cierre.cierreBodegaId).toBe("cb1");
    expect(r?.cierresDia.map((cd) => cd.resumen.cierreDiaId)).toEqual(["cd1", "cd2"]);
    // MISMO DTO que antes de la 69: la UI no cambia.
    expect(r?.cierresDia[0].gestiones[0]).toMatchObject({
      gestionId: "g1",
      montoRecibido: "10.00",
      evidenciaStoragePath: "o1/e.jpg",
      pagoMensajero: "5.00",
      ingresoBodegaRechazo: "0.00",
    });
    expect(r?.cierresDia[1].gestiones[0].gestionId).toBe("g2");
    expect(r?.cierresDia[1].gestiones[0].montoRecibido).toBeNull();
  });

  it("69/R15: los descriptivos salen del SNAPSHOT, no de la orden viva", async () => {
    const prisma = buildPrisma();
    prisma.cierreBodega.findUnique.mockResolvedValue(bodegaDbRow());
    prisma.cierreDia.findMany.mockResolvedValue([detalleCierreDbRow({ id: "cd1" })]);
    // El doble de `gestion_orden` SI devuelve la relacion `orden` VIVA (como haria un JOIN
    // real si alguien reintrodujera WITH_DETALLE), y dice cosas DISTINTAS del snapshot: la
    // orden fue re-apuntada de tienda/zona y re-guiada despues de cerrar. Un lector que
    // vuelva a mirar datos vivos pone este test rojo con "Tienda HOY"; el codigo correcto
    // ignora esta rama porque ni siquiera la pide en el select.
    prisma.gestionOrden.findMany.mockResolvedValue([
      gestionDbRow({
        orden: {
          numGuia: 999,
          numRemision: "REM-HOY",
          destinatario: "Otro Destinatario",
          direccion: "Direccion NUEVA",
          producto: "Producto NUEVO",
          tienda: { nombre: "Tienda HOY" },
          zona: { nombre: "Zona HOY" },
          provincia: { nombre: "Provincia HOY" },
          canton: { nombre: "Canton HOY" },
          distrito: { nombre: "Distrito HOY" },
        },
      }),
    ]);
    // La fila congelada dice "Tienda ORIGINAL"/"Cartago ORIGINAL". Si esta vista leyera la
    // orden VIVA mostraria lo que la orden diga HOY -> dos pantallas de admin, dos detalles
    // distintos del MISMO cierre cerrado. Eso es lo que este test impide.
    prisma.cierreDetail.findMany.mockResolvedValue([
      detalleDbRow({ tiendaNombre: "Tienda ORIGINAL", zonaNombre: "Cartago ORIGINAL", numGuia: 77 }),
    ]);
    const repo = new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);

    const r = await repo.findCierreBodegaConDetalle("cb1");

    expect(r?.cierresDia[0].gestiones[0]).toMatchObject({
      numGuia: 77,
      numRemision: "REM-1",
      destinatario: "Ana",
      direccion: "Av 1",
      producto: "Caja",
      tiendaNombre: "Tienda ORIGINAL",
      zonaNombre: "Cartago ORIGINAL",
      provinciaNombre: "Cartago",
      cantonNombre: "Central",
      distritoNombre: "Oriental",
    });
    // El select de la gestion ya no navega la relacion `orden` (adios WITH_DETALLE).
    expect(prisma.gestionOrden.findMany.mock.calls[0][0].select).not.toHaveProperty("orden");
    expect(prisma.gestionOrden.findMany.mock.calls[0][0]).not.toHaveProperty("include");
    // Y nada del camino VIVO se consulta en toda la operacion.
    expect(prisma.orden.findMany).not.toHaveBeenCalled();
    expect(prisma.orden.findUnique).not.toHaveBeenCalled();
    expect(prisma.orden.findFirst).not.toHaveBeenCalled();
    expect(prisma.zona.findMany).not.toHaveBeenCalled();
    expect(prisma.zona.findUnique).not.toHaveBeenCalled();
    expect(prisma.zona.findFirst).not.toHaveBeenCalled();
    expect(prisma.tarifas.findMany).not.toHaveBeenCalled();
    expect(prisma.tarifas.findFirst).not.toHaveBeenCalled();
  });

  it("69/R14: falta la fila congelada de una orden -> error duro (sin fallback a datos vivos)", async () => {
    const prisma = buildPrisma();
    prisma.cierreBodega.findUnique.mockResolvedValue(bodegaDbRow());
    prisma.cierreDia.findMany.mockResolvedValue([detalleCierreDbRow({ id: "cd1" })]);
    prisma.gestionOrden.findMany.mockResolvedValue([gestionDbRow()]);
    prisma.cierreDetail.findMany.mockResolvedValue([]); // sin snapshot
    const repo = new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);

    await expect(repo.findCierreBodegaConDetalle("cb1")).rejects.toThrow(CierreDetalleFaltanteError);
  });
});

describe("CierresBodegaAdminRepository.resolverCierreBodega (R16/R18/R19/R20/R21/R22)", () => {
  it("R16/R20/R21/R22: count=1 -> updated; WHERE guarda estado=solicitado; data lleva audit; NO toca cierre_dia/gestion", async () => {
    const prisma = buildPrisma();
    prisma.cierreBodega.updateMany.mockResolvedValue({ count: 1 });
    const repo = new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);

    const r = await repo.resolverCierreBodega({
      id: "cb1",
      nuevoEstado: "rechazado",
      resueltoPor: "adm-maestro",
      motivoRechazo: "cuadre erroneo",
    });

    expect(r).toBe("updated");
    const arg = prisma.cierreBodega.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "cb1", estado: "solicitado" }); // R18: guardia de estado
    expect(arg.data).toMatchObject({
      estado: "rechazado",
      resueltoPor: "adm-maestro", // R20
      motivoRechazo: "cuadre erroneo",
    });
    expect(arg.data.resueltoAt).toBeInstanceOf(Date); // R20
    // R21/R22: un solo UPDATE de estado; no toca cierre_dia ni gestion_orden ni cuenta.
    expect(prisma.cierreDia.findMany).not.toHaveBeenCalled();
    expect(prisma.gestionOrden.findMany).not.toHaveBeenCalled();
    expect(prisma.cierreBodega.count).not.toHaveBeenCalled();
  });

  it("R20: aprobar pasa motivoRechazo null en el data", async () => {
    const prisma = buildPrisma();
    prisma.cierreBodega.updateMany.mockResolvedValue({ count: 1 });
    const repo = new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);

    await repo.resolverCierreBodega({
      id: "cb1",
      nuevoEstado: "aprobado",
      resueltoPor: "adm-maestro",
      motivoRechazo: null,
    });

    const arg = prisma.cierreBodega.updateMany.mock.calls[0][0];
    expect(arg.data.estado).toBe("aprobado");
    expect(arg.data.motivoRechazo).toBeNull();
  });

  it("R18: count=0 pero existe -> conflict, sin efectos", async () => {
    const prisma = buildPrisma();
    prisma.cierreBodega.updateMany.mockResolvedValue({ count: 0 });
    prisma.cierreBodega.count.mockResolvedValue(1);
    const repo = new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);

    const r = await repo.resolverCierreBodega({
      id: "cb1",
      nuevoEstado: "aprobado",
      resueltoPor: "adm-maestro",
      motivoRechazo: null,
    });

    expect(r).toBe("conflict");
    expect(prisma.cierreBodega.count.mock.calls[0][0].where).toEqual({ id: "cb1" });
  });

  it("R19: count=0 y no existe -> fuera_de_alcance", async () => {
    const prisma = buildPrisma();
    prisma.cierreBodega.updateMany.mockResolvedValue({ count: 0 });
    prisma.cierreBodega.count.mockResolvedValue(0);
    const repo = new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);

    const r = await repo.resolverCierreBodega({
      id: "cb-x",
      nuevoEstado: "aprobado",
      resueltoPor: "adm-maestro",
      motivoRechazo: null,
    });

    expect(r).toBe("fuera_de_alcance");
  });
});
