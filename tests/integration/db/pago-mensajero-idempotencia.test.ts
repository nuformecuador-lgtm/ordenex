import { describe, it, expect, vi } from "vitest";
import { type PrismaClient } from "@prisma/client";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import type { CrearPagoMensajeroInput } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";

// Feature 44/T7 — idempotencia del libro del pago por mensajero (R6/R12). Simula el constraint
// unico parcial (origen_tipo, origen_id, mensajero_id, categoria) WHERE origen_id IS NOT NULL con
// una tienda en memoria: createMany({ skipDuplicates: true }) NO reinserta pares ya presentes. La
// DIMENSION mensajero_id forma parte de la clave: el mismo (cierre, categoria) para DOS mensajeros
// distintos produce DOS filas (no colisionan). Espejo de wallet-tienda-idempotencia (43).

// Store con la semantica del indice unico parcial: la clave incluye mensajero_id, y solo aplica
// cuando origen_id IS NOT NULL (los manuales no se deduplican).
function makeStore() {
  const rows: Array<CrearPagoMensajeroInput & { id: string }> = [];
  const key = (r: { origenTipo: string; origenId: string | null; mensajeroId: string; categoria: string }) =>
    `${r.origenTipo}|${r.origenId}|${r.mensajeroId}|${r.categoria}`;
  const seen = new Set<string>();
  let seq = 0;

  const pagoMensajeroMovimiento = {
    createMany: vi.fn(async ({ data, skipDuplicates }: { data: CrearPagoMensajeroInput[]; skipDuplicates?: boolean }) => {
      let count = 0;
      for (const d of data) {
        if (d.origenId !== null) {
          const k = key(d);
          if (seen.has(k)) {
            if (skipDuplicates) continue; // ON CONFLICT DO NOTHING
            throw new Error(`unique violation ${k}`);
          }
          seen.add(k);
        }
        rows.push({ ...d, id: `p${++seq}` });
        count += 1;
      }
      return { count };
    }),
  };
  return { rows, pagoMensajeroMovimiento };
}

function mov(overrides: Partial<CrearPagoMensajeroInput> = {}): CrearPagoMensajeroInput {
  return {
    mensajeroId: "m1",
    tipo: "devengo",
    categoria: "pago_devengado",
    monto: "1000.00",
    origenTipo: "cierre_dia",
    origenId: "c1",
    ...overrides,
  };
}

describe("pago-mensajero idempotencia (R6/R12)", () => {
  it("R6/R12: reinserta el MISMO (origen_tipo,origen_id,mensajero_id,categoria) = no-op (un solo movimiento)", async () => {
    const store = makeStore();
    const repo = new PagoMensajeroMovimientoRepository({ pagoMensajeroMovimiento: store.pagoMensajeroMovimiento } as unknown as PrismaClient);

    const n1 = await repo.crearMovimientos({ pagoMensajeroMovimiento: store.pagoMensajeroMovimiento } as never, [mov()]);
    const n2 = await repo.crearMovimientos({ pagoMensajeroMovimiento: store.pagoMensajeroMovimiento } as never, [mov()]);

    expect(n1).toBe(1);
    expect(n2).toBe(0); // no-op, sin error
    expect(store.rows.length).toBe(1);
  });

  it("R6: la dimension mensajero_id es parte de la clave: mismo (cierre, categoria) para 2 mensajeros -> 2 filas", async () => {
    const store = makeStore();
    const repo = new PagoMensajeroMovimientoRepository({ pagoMensajeroMovimiento: store.pagoMensajeroMovimiento } as unknown as PrismaClient);

    const n = await repo.crearMovimientos({ pagoMensajeroMovimiento: store.pagoMensajeroMovimiento } as never, [
      mov({ mensajeroId: "m1" }),
      mov({ mensajeroId: "m2" }),
    ]);

    expect(n).toBe(2); // no colisionan: distinto mensajero
    expect(store.rows.length).toBe(2);
  });

  it("R12: doble alimentacion del mismo cierre (devengo + pago por mensajero) = un solo set", async () => {
    const store = makeStore();
    const repo = new PagoMensajeroMovimientoRepository({ pagoMensajeroMovimiento: store.pagoMensajeroMovimiento } as unknown as PrismaClient);
    const set: CrearPagoMensajeroInput[] = [
      mov({ mensajeroId: "m1", tipo: "devengo", categoria: "pago_devengado", monto: "1000.00" }),
      mov({ mensajeroId: "m1", tipo: "pago", categoria: "pago_efectivo", monto: "300.00" }),
    ];

    await repo.crearMovimientos({ pagoMensajeroMovimiento: store.pagoMensajeroMovimiento } as never, set);
    const tras1 = store.rows.length;
    await repo.crearMovimientos({ pagoMensajeroMovimiento: store.pagoMensajeroMovimiento } as never, set); // re-aprobacion / vencido->aprobado

    expect(tras1).toBe(2);
    expect(store.rows.length).toBe(2); // sin duplicar
    const claves = store.rows.map((r) => `${r.origenTipo}|${r.origenId}|${r.mensajeroId}|${r.categoria}`);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it("manuales (origen_id NULL) NO se deduplican: cada ajuste compensatorio es una fila nueva (R3)", async () => {
    const store = makeStore();
    const repo = new PagoMensajeroMovimientoRepository({ pagoMensajeroMovimiento: store.pagoMensajeroMovimiento } as unknown as PrismaClient);
    const ajuste = mov({ tipo: "pago", categoria: "ajuste_pago", monto: "50.00", origenTipo: "manual", origenId: null, descripcion: "reversa", registradoPor: "u-maestro" });

    await repo.crearMovimientos({ pagoMensajeroMovimiento: store.pagoMensajeroMovimiento } as never, [ajuste]);
    await repo.crearMovimientos({ pagoMensajeroMovimiento: store.pagoMensajeroMovimiento } as never, [ajuste]);

    expect(store.rows.length).toBe(2); // fuera del indice unico parcial
  });
});
