import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { WalletFeedService } from "@/lib/services/WalletFeedService";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { ITarifaVigentePorZonaRepository } from "@/lib/interfaces/repositories/ITarifaVigentePorZonaRepository";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";

// Feature 42/T9 — idempotencia + no-doble-conteo (R6/R13). Simula el constraint unico
// parcial (origen_tipo, origen_id, categoria) WHERE origen_id IS NOT NULL con una tienda
// en memoria: createMany({ skipDuplicates: true }) NO reinserta pares ya presentes. Con eso
// demostramos que una DOBLE aprobacion del mismo cierre produce UN SOLO set de movimientos y
// que un reintento por par existente es un no-op (sin error, sin segundo movimiento).

// Store en memoria con la semantica del indice unico parcial (solo pares con origen_id).
function makeWalletStore() {
  const rows: Array<CrearMovimientoInput & { id: string }> = [];
  const key = (r: { origenTipo: string; origenId: string | null; categoria: string }) =>
    `${r.origenTipo}|${r.origenId}|${r.categoria}`;
  const seen = new Set<string>();
  let seq = 0;

  const walletMovimiento = {
    createMany: vi.fn(async ({ data, skipDuplicates }: { data: CrearMovimientoInput[]; skipDuplicates?: boolean }) => {
      let count = 0;
      for (const d of data) {
        // El indice unico parcial solo aplica cuando origen_id IS NOT NULL.
        if (d.origenId !== null) {
          const k = key(d);
          if (seen.has(k)) {
            if (skipDuplicates) continue; // ON CONFLICT DO NOTHING
            throw new Error(`unique violation ${k}`);
          }
          seen.add(k);
        }
        rows.push({ ...d, id: `w${++seq}` });
        count += 1;
      }
      return { count };
    }),
  };
  return { rows, walletMovimiento };
}

const TARIFA = {
  valorFlete: "1000.00",
  valorFleteGam: "1500.00",
  valorFleteDevuelto: "400.00",
  valorFleteDevueltoGam: "600.00",
  comisionCod: "5.00",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
};

function buildTarifaRepo(): ITarifaVigentePorZonaRepository {
  return { resolveTarifaPorZona: vi.fn().mockResolvedValue(TARIFA) };
}

// Prisma doble: gestiones del cierre + la tienda de wallet + $transaction (tx === prisma).
function buildPrisma(store: ReturnType<typeof makeWalletStore>) {
  const gestiones = [
    { resultado: "entregada", orden: { zonaId: "z1", montoCobrar: new Prisma.Decimal("10000.00"), cobraComision: true, zona: { esCentral: false } } },
    { resultado: "devuelta", orden: { zonaId: "z1", montoCobrar: null, cobraComision: true, zona: { esCentral: false } } },
  ];
  const prisma = {
    cierreDia: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(1) },
    gestionOrden: { findMany: vi.fn().mockResolvedValue(gestiones) },
    walletMovimiento: store.walletMovimiento,
  };
  return {
    ...prisma,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
  };
}

const ALCANCE: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };

describe("wallet idempotencia (R6/R13)", () => {
  it("R6: doble aprobacion del mismo cierre -> UN SOLO set de movimientos (skipDuplicates)", async () => {
    const store = makeWalletStore();
    const prisma = buildPrisma(store);
    const repo = new CierresAdminRepository(
      prisma as unknown as PrismaClient,
      new WalletMovimientoRepository(prisma as unknown as PrismaClient),
      new WalletFeedService(buildTarifaRepo()),
      // Feature 43: dobles no-op del ledger por tienda (este test cubre SOLO la idempotencia
      // de la caja principal 42; el ledger por tienda tiene su propio test de idempotencia).
      { crearMovimientos: vi.fn().mockResolvedValue(0), listarPorTienda: vi.fn(), agregarSaldoPorTienda: vi.fn(), listarSaldosTodasTiendas: vi.fn() },
      { construirMovimientosPorTienda: vi.fn().mockResolvedValue([]) },
      // Feature 44: dobles no-op del libro del pago por mensajero (feed devuelve libro/egreso
      // vacios; el pago por mensajero tiene su propio test de idempotencia).
      { crearMovimientos: vi.fn().mockResolvedValue(0), listarPorMensajero: vi.fn(), agregarCuentaPorPagar: vi.fn(), listarCuentasPorPagarTodos: vi.fn(), obtenerNombreMensajero: vi.fn() },
      { construirMovimientosDePago: vi.fn().mockResolvedValue({ libro: [], egresoCaja: [] }) },
    );

    const aprobar = () =>
      repo.resolverCierre({
        cierreId: "c1",
        alcance: ALCANCE,
        nuevoEstado: "aprobado",
        resueltoPor: "adm",
        motivoRechazo: null,
      });

    await aprobar();
    const trasPrimera = store.rows.length;
    await aprobar(); // segunda aprobacion: el constraint deduplica todos los pares.

    // El set de movimientos es EXACTAMENTE el mismo (no se duplico ningun concepto).
    expect(store.rows.length).toBe(trasPrimera);
    // Cada par (cierre_dia, c1, categoria) aparece una sola vez.
    const claves = store.rows.map((r) => `${r.origenTipo}|${r.origenId}|${r.categoria}`);
    expect(new Set(claves).size).toBe(claves.length);
    // El cierre solo-entregada+devuelta produce: flete, iva_flete, comision, iva_comision,
    // flete_devolucion, iva_flete_devolucion (6 conceptos, ninguno duplicado).
    expect(store.rows.length).toBe(6);
  });

  it("R13: reintento por par existente = no-op (sin error propagado, sin segundo movimiento)", async () => {
    const store = makeWalletStore();
    const repo = new WalletMovimientoRepository({ walletMovimiento: store.walletMovimiento } as unknown as PrismaClient);
    const mov: CrearMovimientoInput = {
      tipo: "ingreso",
      categoria: "ingreso_flete",
      monto: "1000.00",
      origenTipo: "cierre_dia",
      origenId: "c1",
    };

    const n1 = await repo.crearMovimientos({ walletMovimiento: store.walletMovimiento } as never, [mov]);
    // Reintento del MISMO par: no lanza, no inserta.
    const n2 = await repo.crearMovimientos({ walletMovimiento: store.walletMovimiento } as never, [mov]);

    expect(n1).toBe(1);
    expect(n2).toBe(0); // no-op
    expect(store.rows.length).toBe(1);
  });

  it("manuales (origen_id NULL) NO se deduplican: cada ajuste es una fila nueva", async () => {
    const store = makeWalletStore();
    const repo = new WalletMovimientoRepository({ walletMovimiento: store.walletMovimiento } as unknown as PrismaClient);
    const manual: CrearMovimientoInput = {
      tipo: "egreso",
      categoria: "egreso_ajuste",
      monto: "50.00",
      origenTipo: "manual",
      origenId: null,
      descripcion: "ajuste",
      registradoPor: "u-maestro",
    };
    await repo.crearMovimientos({ walletMovimiento: store.walletMovimiento } as never, [manual]);
    await repo.crearMovimientos({ walletMovimiento: store.walletMovimiento } as never, [manual]);
    // Dos ajustes iguales -> DOS filas (fuera del indice unico parcial).
    expect(store.rows.length).toBe(2);
  });
});
