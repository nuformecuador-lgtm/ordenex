import { describe, it, expect, vi } from "vitest";
import { type PrismaClient } from "@prisma/client";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import type { CrearMovimientoTiendaInput } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";

// Feature 43/T7 — idempotencia del ledger por tienda (R6/R13). Simula el constraint unico
// parcial (origen_tipo, origen_id, tienda_id, categoria) WHERE origen_id IS NOT NULL con una
// tienda en memoria: createMany({ skipDuplicates: true }) NO reinserta pares ya presentes.
// La DIMENSION tienda_id forma parte de la clave: el mismo (cierre, categoria) para DOS
// tiendas distintas produce DOS filas (no colisionan). Espejo de wallet-idempotencia (42).

// Store con la semantica del indice unico parcial: la clave incluye tienda_id, y solo aplica
// cuando origen_id IS NOT NULL (los manuales no se deduplican).
function makeStore() {
  const rows: Array<CrearMovimientoTiendaInput & { id: string }> = [];
  const key = (r: { origenTipo: string; origenId: string | null; tiendaId: string; categoria: string }) =>
    `${r.origenTipo}|${r.origenId}|${r.tiendaId}|${r.categoria}`;
  const seen = new Set<string>();
  let seq = 0;

  const walletTiendaMovimiento = {
    createMany: vi.fn(async ({ data, skipDuplicates }: { data: CrearMovimientoTiendaInput[]; skipDuplicates?: boolean }) => {
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
        rows.push({ ...d, id: `w${++seq}` });
        count += 1;
      }
      return { count };
    }),
  };
  return { rows, walletTiendaMovimiento };
}

function mov(overrides: Partial<CrearMovimientoTiendaInput> = {}): CrearMovimientoTiendaInput {
  return {
    tiendaId: "t1",
    tipo: "debito",
    categoria: "flete",
    monto: "1000.00",
    origenTipo: "cierre_dia",
    origenId: "c1",
    ...overrides,
  };
}

describe("wallet-tienda idempotencia (R6/R13)", () => {
  it("R6/R13: reinserta el MISMO (origen_tipo,origen_id,tienda_id,categoria) = no-op (un solo movimiento)", async () => {
    const store = makeStore();
    const repo = new WalletTiendaMovimientoRepository({ walletTiendaMovimiento: store.walletTiendaMovimiento } as unknown as PrismaClient);

    const n1 = await repo.crearMovimientos({ walletTiendaMovimiento: store.walletTiendaMovimiento } as never, [mov()]);
    const n2 = await repo.crearMovimientos({ walletTiendaMovimiento: store.walletTiendaMovimiento } as never, [mov()]);

    expect(n1).toBe(1);
    expect(n2).toBe(0); // no-op, sin error
    expect(store.rows.length).toBe(1);
  });

  it("R6: la dimension tienda_id es parte de la clave: mismo (cierre, categoria) para 2 tiendas -> 2 filas", async () => {
    const store = makeStore();
    const repo = new WalletTiendaMovimientoRepository({ walletTiendaMovimiento: store.walletTiendaMovimiento } as unknown as PrismaClient);

    const n = await repo.crearMovimientos({ walletTiendaMovimiento: store.walletTiendaMovimiento } as never, [
      mov({ tiendaId: "t1" }),
      mov({ tiendaId: "t2" }),
    ]);

    expect(n).toBe(2); // no colisionan: distinta tienda
    expect(store.rows.length).toBe(2);
  });

  it("R13: doble alimentacion del mismo cierre (varios conceptos por tienda) = un solo set", async () => {
    const store = makeStore();
    const repo = new WalletTiendaMovimientoRepository({ walletTiendaMovimiento: store.walletTiendaMovimiento } as unknown as PrismaClient);
    const set: CrearMovimientoTiendaInput[] = [
      mov({ tiendaId: "t1", tipo: "credito", categoria: "cod_recaudado", monto: "10000.00" }),
      mov({ tiendaId: "t1", categoria: "flete", monto: "1000.00" }),
      mov({ tiendaId: "t1", categoria: "iva_flete", monto: "130.00" }),
    ];

    await repo.crearMovimientos({ walletTiendaMovimiento: store.walletTiendaMovimiento } as never, set);
    const tras1 = store.rows.length;
    await repo.crearMovimientos({ walletTiendaMovimiento: store.walletTiendaMovimiento } as never, set); // re-aprobacion

    expect(tras1).toBe(3);
    expect(store.rows.length).toBe(3); // sin duplicar
    const claves = store.rows.map((r) => `${r.origenTipo}|${r.origenId}|${r.tiendaId}|${r.categoria}`);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it("manuales (origen_id NULL) NO se deduplican: cada ajuste compensatorio es una fila nueva (R29)", async () => {
    const store = makeStore();
    const repo = new WalletTiendaMovimientoRepository({ walletTiendaMovimiento: store.walletTiendaMovimiento } as unknown as PrismaClient);
    const ajuste = mov({ tipo: "credito", categoria: "ajuste_credito", monto: "50.00", origenTipo: "manual", origenId: null, descripcion: "reversa", registradoPor: "u-maestro" });

    await repo.crearMovimientos({ walletTiendaMovimiento: store.walletTiendaMovimiento } as never, [ajuste]);
    await repo.crearMovimientos({ walletTiendaMovimiento: store.walletTiendaMovimiento } as never, [ajuste]);

    expect(store.rows.length).toBe(2); // fuera del indice unico parcial
  });
});
