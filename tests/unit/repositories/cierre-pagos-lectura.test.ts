import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  CierreDiaRepository,
  WITH_DETALLE,
  toPendienteRow,
} from "@/lib/repositories/CierreDiaRepository";
import {
  CierresAdminRepository,
  GESTION_ADMIN_SELECT,
  toPendienteRowDesdeSnapshot,
} from "@/lib/repositories/CierresAdminRepository";
import { CierresBodegaAdminRepository } from "@/lib/repositories/CierresBodegaAdminRepository";
import type { ITarifaVigentePorTiendaRepository } from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";

/**
 * Feature 212 (T10, R21/R22/R23) — el DESGLOSE del recaudo llega por los TRES caminos de
 * lectura que producen un `CierreGestionPendienteRow`.
 *
 * Por qué los tres, y no «uno representativo»: `pagos` es obligatorio y SIN fallback al par
 * escalar (design §3.1). Un camino que se olvidara de seleccionarlo no daría un total
 * ligeramente raro, daría CERO — y `cierre_dia.total_efectivo` es la `E` del `min(P, E)` con el
 * que se le paga al mensajero (feature 44). Que dos de los tres caminos compartan proyección y
 * mapper es un hecho de HOY: este archivo lo fija como comportamiento observable, para que
 * separarlos mañana tenga que romper algo aquí.
 *
 * La entrega de referencia es la MIXTA del design §4: ₡8.000 = 5.000 efectivo + 3.000
 * transferencia, que es exactamente el caso que el modelo escalar no sabía representar.
 */

/** Las dos líneas tal como salen de la base: `Decimal`, en el orden del `orderBy`. */
function lineasMixtas() {
  return [
    { metodo: "efectivo", monto: new Prisma.Decimal("5000") },
    { metodo: "transferencia", monto: new Prisma.Decimal("3000.005") },
  ];
}

/** Fila de `gestion_orden` como la lee `WITH_DETALLE` (vista EN VIVO del mensajero). */
function filaEnVivo(overrides: Record<string, unknown> = {}) {
  return {
    id: "g1",
    ordenId: "o1",
    resultado: "entregada",
    montoRecibido: new Prisma.Decimal("8000.00"),
    metodoPago: null, // R19: dos líneas -> la columna deprecada queda NULL
    pagos: lineasMixtas(),
    motivo: null,
    fechaReprogramacion: null,
    evidenciaStoragePath: null,
    pagoMensajero: null,
    ingresoBodegaRechazo: null,
    causaIncidente: null,
    orden: {
      numGuia: 10,
      numRemision: "REM-1",
      destinatario: "Ana",
      direccion: "Av 1",
      producto: "Caja",
      tienda: { nombre: "Tienda X" },
      zona: { nombre: "Cartago" },
      provincia: { nombre: "Cartago" },
      canton: { nombre: "Central" },
      distrito: { nombre: "Oriental" },
    },
    ...overrides,
  };
}

/** Fila de `gestion_orden` como la lee `GESTION_ADMIN_SELECT` (detalles de admin y bodega). */
function filaAdmin(overrides: Record<string, unknown> = {}) {
  return {
    id: "g1",
    ordenId: "o1",
    resultado: "entregada",
    montoRecibido: new Prisma.Decimal("8000.00"),
    metodoPago: null,
    pagos: lineasMixtas(),
    motivo: null,
    fechaReprogramacion: null,
    evidenciaStoragePath: null,
    pagoMensajero: new Prisma.Decimal("5.00"),
    ingresoBodegaRechazo: new Prisma.Decimal("0.00"),
    causaIncidente: null,
    indemnizacion: null,
    historialEstados: [],
    ...overrides,
  };
}

/** Fila CONGELADA de `cierre_detail` (lo que aporta la orden en los detalles de admin). */
function filaSnapshot(overrides: Record<string, unknown> = {}) {
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

const DESGLOSE_ESPERADO = [
  { metodo: "efectivo", monto: "5000.00" },
  { metodo: "transferencia", monto: "3000.01" }, // Decimal.toFixed(2): escala 2 FIJA
];

const tarifaRepoStub = {
  findVigentePorTiendas: vi.fn(),
} as unknown as ITarifaVigentePorTiendaRepository;

// --- R23: las proyecciones PIDEN el desglose ---------------------------------------------

describe("R23 — las dos proyecciones que producen la fila seleccionan `pagos`", () => {
  it("`WITH_DETALLE` (vista en vivo del mensajero) lo pide, con el orden del enum", () => {
    expect(WITH_DETALLE.select.pagos).toEqual({
      select: { metodo: true, monto: true },
      orderBy: { metodo: "asc" },
    });
  });

  it("`GESTION_ADMIN_SELECT` (detalles de admin y de bodega) lo pide igual", () => {
    expect(GESTION_ADMIN_SELECT.pagos).toEqual({
      select: { metodo: true, monto: true },
      orderBy: { metodo: "asc" },
    });
  });

  it("R22: el orden es `asc` sobre el enum NATIVO = orden de declaración, no alfabético", () => {
    // Alfabéticamente sería SINPE < efectivo < transferencia. Sobre un enum nativo de
    // Postgres, `asc` es el orden de DECLARACIÓN: efectivo, SINPE, transferencia. Eso es lo
    // que hace determinista la concatenación de las descargas de la 213 sin columna de orden.
    expect(WITH_DETALLE.select.pagos.orderBy).toEqual({ metodo: "asc" });
    expect(GESTION_ADMIN_SELECT.pagos.orderBy).toEqual({ metodo: "asc" });
  });

  it("ninguna de las dos pide el desglose sin sus dos columnas", () => {
    expect(WITH_DETALLE.select.pagos.select).toEqual({ metodo: true, monto: true });
    expect(GESTION_ADMIN_SELECT.pagos.select).toEqual({ metodo: true, monto: true });
  });
});

// --- Camino 1: vista EN VIVO del mensajero -----------------------------------------------

describe("R21 — camino 1 (vivo): `CierreDiaRepository.findGestionesPendientes`", () => {
  function prismaDoble(filas: unknown[]) {
    return {
      gestionOrden: { findMany: vi.fn().mockResolvedValue(filas) },
      // Feature 237 (D6/R41): la lectura EN LOTE de «¿cual la registro la tienda?». Vacia: estos
      // casos miran el desglose de pagos, no de quien es la gestion.
      ordenHistorialEstado: { findMany: vi.fn().mockResolvedValue([]) },
      orden: { count: vi.fn() },
      cierreDia: { count: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
      cierreDetail: { findMany: vi.fn() },
      tarifa: { findMany: vi.fn() },
      $transaction: vi.fn(),
    };
  }

  it("la fila trae el desglose con los montos money-safe STRING de escala 2", async () => {
    const prisma = prismaDoble([filaEnVivo()]);
    const repo = new CierreDiaRepository(prisma as never, tarifaRepoStub);

    const rows = await repo.findGestionesPendientes("m1");

    expect(rows[0].pagos).toEqual(DESGLOSE_ESPERADO);
    for (const linea of rows[0].pagos) expect(typeof linea.monto).toBe("string");
  });

  it("la CONSULTA pide el desglose (sin `select`, la fila saldría con 0 líneas y el cierre en 0)", async () => {
    const prisma = prismaDoble([filaEnVivo()]);
    const repo = new CierreDiaRepository(prisma as never, tarifaRepoStub);

    await repo.findGestionesPendientes("m1");

    const arg = prisma.gestionOrden.findMany.mock.calls[0][0];
    expect(arg.select.pagos).toEqual({
      select: { metodo: true, monto: true },
      orderBy: { metodo: "asc" },
    });
  });

  it("R31: el par escalar sigue viajando al lado del desglose", async () => {
    const prisma = prismaDoble([
      filaEnVivo({
        metodoPago: "efectivo",
        montoRecibido: new Prisma.Decimal("5000.00"),
        pagos: [{ metodo: "efectivo", monto: new Prisma.Decimal("5000.00") }],
      }),
    ]);
    const repo = new CierreDiaRepository(prisma as never, tarifaRepoStub);

    const rows = await repo.findGestionesPendientes("m1");

    expect(rows[0].metodoPago).toBe("efectivo");
    expect(rows[0].montoRecibido).toBe("5000.00");
    expect(rows[0].pagos).toEqual([{ metodo: "efectivo", monto: "5000.00" }]);
  });

  it("una gestión SIN líneas llega con `[]`, nunca con `undefined`", () => {
    const row = toPendienteRow(
      filaEnVivo({ resultado: "reprogramada", montoRecibido: null, pagos: [] }) as never,
      false, // feature 237 (D6/R41): el flag lo resuelve el repo en lote; aqui no se ejercita
    );
    expect(row.pagos).toEqual([]);
  });
});

// --- Camino 2: detalle de cierres de ADMIN ------------------------------------------------

describe("R21 — camino 2 (admin): `CierresAdminRepository.findCierreByIdEnAlcance`", () => {
  function prismaDoble() {
    return {
      cierreDia: {
        findFirst: vi.fn().mockResolvedValue({
          id: "c1",
          mensajeroId: "m1",
          estado: "solicitado",
          destinoTipo: "bodega_central",
          destinoZonaId: "z1",
          totalEfectivo: new Prisma.Decimal("5000.00"),
          totalSimpe: new Prisma.Decimal("0.00"),
          totalTransferencia: new Prisma.Decimal("3000.00"),
          totalGeneral: new Prisma.Decimal("8000.00"),
          totalPagoMensajero: new Prisma.Decimal("5.00"),
          totalIngresoBodegaRechazos: new Prisma.Decimal("0.00"),
          solicitadoAt: new Date("2026-08-12T10:00:00.000Z"),
          resueltoAt: null,
          motivoRechazo: null,
          mensajero: { nombre: "Ana" },
          destinoZona: { nombre: "Cartago" },
        }),
      },
      gestionOrden: { findMany: vi.fn().mockResolvedValue([filaAdmin()]) },
      cierreDetail: { findMany: vi.fn().mockResolvedValue([filaSnapshot()]) },
      $transaction: vi.fn(),
    };
  }

  function repoDe(prisma: ReturnType<typeof prismaDoble>) {
    // `findCierreByIdEnAlcance` es solo lectura: las 7 dependencias de escritura (wallets,
    // feeds) no se tocan, y por eso entran como dobles vacíos en vez de arrastrar aquí el
    // arnés completo de la 42/43/44.
    const nada = {} as never;
    return new CierresAdminRepository(
      prisma as unknown as PrismaClient,
      nada,
      nada,
      nada,
      nada,
      nada,
      nada,
      nada,
    );
  }

  it("la gestión del detalle trae el desglose, money-safe y en orden de enum", async () => {
    const prisma = prismaDoble();
    const r = await repoDe(prisma).findCierreByIdEnAlcance("c1", { destinoTipo: "bodega_central", destinoZonaId: null });

    expect(r?.gestiones[0].pagos).toEqual(DESGLOSE_ESPERADO);
  });

  it("la CONSULTA de gestiones pide el desglose", async () => {
    const prisma = prismaDoble();
    await repoDe(prisma).findCierreByIdEnAlcance("c1", { destinoTipo: "bodega_central", destinoZonaId: null });

    const arg = prisma.gestionOrden.findMany.mock.calls[0][0];
    expect(arg.select).toBe(GESTION_ADMIN_SELECT); // la MISMA definición, no una copia
    expect(arg.select.pagos).toBeDefined();
  });
});

// --- Camino 3: detalle de cierres de BODEGA -----------------------------------------------

describe("R23 — camino 3 (bodega): `CierresBodegaAdminRepository.findCierreBodegaConDetalle`", () => {
  function prismaDoble() {
    return {
      cierreBodega: {
        findUnique: vi.fn().mockResolvedValue({
          id: "cb1",
          zonaId: "z1",
          solicitadoPor: "sat-1",
          estado: "solicitado",
          totalEfectivo: new Prisma.Decimal("5000.00"),
          totalSimpe: new Prisma.Decimal("0.00"),
          totalTransferencia: new Prisma.Decimal("3000.00"),
          totalGeneral: new Prisma.Decimal("8000.00"),
          totalPagoMensajero: new Prisma.Decimal("5.00"),
          totalIngresoBodegaRechazos: new Prisma.Decimal("0.00"),
          solicitadoAt: new Date("2026-08-12T10:00:00.000Z"),
          resueltoAt: null,
          motivoRechazo: null,
          zona: { nombre: "Cartago" },
          solicitadoPorUsuario: { nombre: "Sara" },
          _count: { cierresDia: 1 },
        }),
        findMany: vi.fn(),
        updateMany: vi.fn(),
        count: vi.fn(),
      },
      cierreDia: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "cd1",
            mensajeroId: "m1",
            totalEfectivo: new Prisma.Decimal("5000.00"),
            totalSimpe: new Prisma.Decimal("0.00"),
            totalTransferencia: new Prisma.Decimal("3000.00"),
            totalGeneral: new Prisma.Decimal("8000.00"),
            totalPagoMensajero: new Prisma.Decimal("5.00"),
            totalIngresoBodegaRechazos: new Prisma.Decimal("0.00"),
            mensajero: { nombre: "Ana" },
          },
        ]),
      },
      gestionOrden: { findMany: vi.fn().mockResolvedValue([filaAdmin()]) },
      cierreDetail: { findMany: vi.fn().mockResolvedValue([filaSnapshot()]) },
    };
  }

  it("el TERCER camino también trae el desglose (reusa la proyección y el mapper de admin)", async () => {
    const prisma = prismaDoble();
    const repo = new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);

    const r = await repo.findCierreBodegaConDetalle("cb1");

    expect(r?.cierresDia[0].gestiones[0].pagos).toEqual(DESGLOSE_ESPERADO);
  });

  it("y lo pide con la MISMA definición de proyección que el admin, no con una copia suya", async () => {
    // Esto es lo que sostiene que `CierresBodegaAdminRepository` no haya tenido que tocarse
    // (design §3.2): si alguien le diera un `select` propio, este caso lo obliga a declararlo.
    const prisma = prismaDoble();
    const repo = new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);

    await repo.findCierreBodegaConDetalle("cb1");

    expect(prisma.gestionOrden.findMany.mock.calls[0][0].select).toBe(GESTION_ADMIN_SELECT);
  });
});

// --- Los mappers, en corto ----------------------------------------------------------------

describe("R21/R22/R30 — los mappers serializan el desglose sin tocar el orden", () => {
  it("`toPendienteRow` respeta el orden que dio la consulta y no reordena", () => {
    // Si el mapper ordenara por su cuenta (p. ej. alfabéticamente), esto saldría al revés.
    const row = toPendienteRow(
      filaEnVivo({
        pagos: [
          { metodo: "efectivo", monto: new Prisma.Decimal("1.00") },
          { metodo: "SINPE", monto: new Prisma.Decimal("2.00") },
          { metodo: "transferencia", monto: new Prisma.Decimal("3.00") },
        ],
      }) as never,
      false, // feature 237 (D6/R41): irrelevante para el orden del desglose
    );
    expect(row.pagos.map((p) => p.metodo)).toEqual(["efectivo", "SINPE", "transferencia"]);
  });

  it("`toPendienteRowDesdeSnapshot` serializa a escala 2 fija, nunca a number", () => {
    const row = toPendienteRowDesdeSnapshot(
      filaAdmin({ pagos: [{ metodo: "efectivo", monto: new Prisma.Decimal("0.1") }] }) as never,
      filaSnapshot() as never,
    );
    expect(row.pagos).toEqual([{ metodo: "efectivo", monto: "0.10" }]);
    expect(typeof row.pagos[0].monto).toBe("string");
  });
});
