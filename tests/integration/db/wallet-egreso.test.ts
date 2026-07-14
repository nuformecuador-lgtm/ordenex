import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { derivarBalance } from "@/lib/utils/wallet-balance";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";

// Feature 45 (R8/R14/R15/R16) — egresos administrativos en el libro (caja principal). Simula
// el constraint unico parcial (origen_tipo, origen_id, categoria) WHERE origen_id IS NOT NULL
// con una tienda en memoria (ESPEJO de wallet-idempotencia.test.ts, feature 42), mas un
// groupBy(tipo) para el balance derivado. Demuestra: el egreso RESTA del balance (R8); la
// reversa (ingreso_ajuste, origen_id=egreso) da net CERO (R16) sin tocar el original (R14); una
// DOBLE reversa produce UNA sola fila (idempotencia por el indice parcial, R15); los egresos
// manuales (origen_id NULL) NO se deduplican.

type Row = Omit<CrearMovimientoInput, "monto"> & { id: string; monto: Prisma.Decimal };

function makeWalletStore() {
  const rows: Row[] = [];
  const key = (r: { origenTipo: string; origenId: string | null; categoria: string }) =>
    `${r.origenTipo}|${r.origenId}|${r.categoria}`;
  const seen = new Set<string>();
  let seq = 0;

  const walletMovimiento = {
    createMany: vi.fn(
      async ({ data, skipDuplicates }: { data: Array<Omit<CrearMovimientoInput, "monto"> & { monto: Prisma.Decimal }>; skipDuplicates?: boolean }) => {
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
          rows.push({ ...d, id: `w${++seq}`, monto: new Prisma.Decimal(d.monto) });
          count += 1;
        }
        return { count };
      },
    ),
    // groupBy(tipo) con _sum.monto (superficie que usa agregarBalance).
    groupBy: vi.fn(async ({ by }: { by: string[] }) => {
      if (by[0] !== "tipo") throw new Error("solo se prueba groupBy por tipo");
      const acc = new Map<string, Prisma.Decimal>();
      for (const r of rows) {
        const prev = acc.get(r.tipo) ?? new Prisma.Decimal(0);
        acc.set(r.tipo, prev.add(r.monto));
      }
      return [...acc.entries()].map(([tipo, monto]) => ({ tipo, _sum: { monto } }));
    }),
  };
  return { rows, walletMovimiento };
}

function repoFor(store: ReturnType<typeof makeWalletStore>) {
  return new WalletMovimientoRepository({ walletMovimiento: store.walletMovimiento } as unknown as PrismaClient);
}

const tx = (store: ReturnType<typeof makeWalletStore>) =>
  ({ walletMovimiento: store.walletMovimiento }) as never;

describe("egreso administrativo en el libro (R8/R14/R15/R16)", () => {
  it("R8: un egreso RESTA del balance derivado por su monto, exactamente una vez", async () => {
    const store = makeWalletStore();
    const repo = repoFor(store);
    await repo.crearMovimientos(tx(store), [
      { tipo: "ingreso", categoria: "ingreso_flete", monto: "1000.00", origenTipo: "cierre_dia", origenId: "c1" },
      { tipo: "egreso", categoria: "egreso_gasto_variable", monto: "300.00", origenTipo: "gasto", origenId: null, descripcion: "Papeleria", registradoPor: "u-maestro" },
    ]);
    const { ingresos, egresos } = await repo.agregarBalance({});
    const bal = derivarBalance(ingresos, egresos);
    expect(bal.egresos).toBe("300.00");
    expect(bal.balance).toBe("700.00");
  });

  it("R14/R16: reversa (ingreso_ajuste, origen_id=egreso) -> net CERO; el egreso original queda intacto", async () => {
    const store = makeWalletStore();
    const repo = repoFor(store);
    // egreso original.
    await repo.crearMovimientos(tx(store), [
      { tipo: "egreso", categoria: "egreso_gasto_variable", monto: "500.00", origenTipo: "gasto", origenId: null, descripcion: "Error", registradoPor: "u-maestro" },
    ]);
    const egreso = store.rows[0];
    // reversa: ingreso_ajuste de igual monto referenciando el egreso.
    await repo.crearMovimientos(tx(store), [
      { tipo: "ingreso", categoria: "ingreso_ajuste", monto: "500.00", origenTipo: "gasto", origenId: egreso.id, descripcion: `Reverso de: ${egreso.id}`, registradoPor: "u-maestro" },
    ]);
    const { ingresos, egresos } = await repo.agregarBalance({});
    const bal = derivarBalance(ingresos, egresos);
    expect(bal.balance).toBe("0.00"); // R16: net cero
    expect(bal.signo).toBe("cero");
    // R14: append-only — el egreso original sigue existiendo, sin mutar.
    expect(store.rows).toHaveLength(2);
    expect(store.rows[0]).toMatchObject({ tipo: "egreso", monto: expect.anything() });
    expect(store.rows[0].monto.toFixed(2)).toBe("500.00");
  });

  it("R15: DOBLE reversa del mismo egreso -> UNA sola fila (indice unico parcial), balance sigue en cero", async () => {
    const store = makeWalletStore();
    const repo = repoFor(store);
    await repo.crearMovimientos(tx(store), [
      { tipo: "egreso", categoria: "egreso_sueldo", monto: "1000.00", origenTipo: "gasto", origenId: null, descripcion: "Sueldo Juan", registradoPor: "u-maestro" },
    ]);
    const egreso = store.rows[0];
    const reverso: CrearMovimientoInput = {
      tipo: "ingreso",
      categoria: "ingreso_ajuste",
      monto: "1000.00",
      origenTipo: "gasto",
      origenId: egreso.id,
      descripcion: `Reverso de: ${egreso.id}`,
      registradoPor: "u-maestro",
    };
    const n1 = await repo.crearMovimientos(tx(store), [reverso]);
    const n2 = await repo.crearMovimientos(tx(store), [reverso]); // segundo intento: no-op
    expect(n1).toBe(1);
    expect(n2).toBe(0);
    expect(store.rows).toHaveLength(2); // egreso + 1 reverso (no 2)
    const bal = derivarBalance(...(Object.values(await repo.agregarBalance({})) as [string, string]));
    expect(bal.balance).toBe("0.00");
  });

  it("egresos manuales con origen_id NULL NO se deduplican: dos egresos iguales -> dos filas", async () => {
    const store = makeWalletStore();
    const repo = repoFor(store);
    const manual: CrearMovimientoInput = {
      tipo: "egreso",
      categoria: "egreso_gasto_variable",
      monto: "50.00",
      origenTipo: "gasto",
      origenId: null,
      descripcion: "Taxi",
      registradoPor: "u-maestro",
    };
    await repo.crearMovimientos(tx(store), [manual]);
    await repo.crearMovimientos(tx(store), [manual]);
    expect(store.rows).toHaveLength(2);
  });
});
