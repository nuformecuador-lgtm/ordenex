import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { GeneracionGastosFijosService } from "@/lib/services/GeneracionGastosFijosService";
import { derivarCaja } from "@/lib/utils/caja-tesoreria";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IGastoFijoPlantillaRepository } from "@/lib/interfaces/repositories/IGastoFijoPlantillaRepository";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";

// Feature 45 (R28/R31) — idempotencia del cron por (plantilla, periodo). Simula el indice
// unico parcial (origen_tipo, origen_id, categoria) WHERE origen_id IS NOT NULL con una tienda
// en memoria (ESPEJO de wallet-idempotencia.test.ts). Reejecutar el cron el MISMO periodo
// inserta 0 filas y el balance NO cambia; dos periodos distintos generan dos egresos por
// plantilla (uno por mes). El egreso del cron cae bajo el mismo constraint que la reversa/44 sin
// colisionar (clave "<plantillaId>:<YYYY-MM>").

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
          if (d.origenId !== null) {
            const k = key(d);
            if (seen.has(k)) {
              if (skipDuplicates) continue;
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
    // Feature 173 (T D.1): groupBy(categoria, tipo) con _sum.monto — la superficie que usa
    // `agregarPorCategoriaYTipo`. Antes agrupaba solo por `tipo`; sin la categoria en el
    // `by` no se puede decir de QUIEN es el dinero, que es lo que la 173 necesita saber.
    groupBy: vi.fn(async ({ by }: { by: string[] }) => {
      if (by.join(",") !== "categoria,tipo") {
        throw new Error("solo se prueba groupBy(categoria, tipo)");
      }
      const acc = new Map<string, Prisma.Decimal>();
      for (const r of rows) {
        const k = `${r.categoria}|${r.tipo}`;
        acc.set(k, (acc.get(k) ?? new Prisma.Decimal(0)).add(r.monto));
      }
      return [...acc.entries()].map(([k, monto]) => {
        const [categoria, tipo] = k.split("|");
        return { categoria, tipo, _sum: { monto } };
      });
    }),
  };
  return { rows, walletMovimiento };
}

function plantilla(overrides: Partial<GastoFijoPlantillaDTO> = {}): GastoFijoPlantillaDTO {
  return {
    id: "p-alquiler",
    concepto: "Alquiler",
    monto: "80000.00",
    activa: true,
    // Feature 84: mensual con ancla dia 15 -> aplica el 15 de julio y el 15 de agosto (JULIO/AGOSTO).
    periodicidadUnidad: "meses",
    periodicidadCantidad: 1,
    fechaCobro: "2026-07-15",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    ...overrides,
  };
}

function fakePlantillaRepo(activas: GastoFijoPlantillaDTO[]): IGastoFijoPlantillaRepository {
  return {
    crear: vi.fn(),
    actualizar: vi.fn(),
    setActiva: vi.fn(),
    listar: vi.fn(),
    listarActivas: vi.fn().mockResolvedValue(activas),
    // Feature 170 (T I.1): listado paginado; el cron no lo usa.
    listarPaginado: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    obtenerPorId: vi.fn(),
  };
}

const JULIO = new Date("2026-07-15T18:00:00.000Z"); // periodo "2026-07"
const AGOSTO = new Date("2026-08-15T18:00:00.000Z"); // periodo "2026-08"

function serviceFor(store: ReturnType<typeof makeWalletStore>, activas: GastoFijoPlantillaDTO[]) {
  const client = { walletMovimiento: store.walletMovimiento } as unknown as PrismaClient;
  return {
    svc: new GeneracionGastosFijosService(
      fakePlantillaRepo(activas),
      new WalletMovimientoRepository(client),
      client,
    ),
    repo: new WalletMovimientoRepository(client),
  };
}

describe("cron gastos fijos — idempotencia por periodo (R28/R31)", () => {
  it("R28: reejecutar el MISMO periodo inserta 0 filas y el balance NO cambia", async () => {
    const store = makeWalletStore();
    const { svc, repo } = serviceFor(store, [
      plantilla(),
      plantilla({ id: "p-internet", concepto: "Internet", monto: "25000.00" }),
    ]);

    const primera = await svc.ejecutarGeneracion(JULIO);
    expect(primera).toEqual({
      fecha: "2026-07-15",
      plantillasActivas: 2,
      plantillasQueAplicanHoy: 2,
      egresosGenerados: 2,
    });
    expect(store.rows).toHaveLength(2);
    // Feature 173 (T D.1): mismo numero, otro camino — el agregado viene por (categoria, tipo)
    // y la derivacion la hace `derivarCaja`.
    const caja1 = derivarCaja(await repo.agregarPorCategoriaYTipo({}));
    expect(caja1.salidas).toBe("105000.00");
    expect(caja1.enCaja).toBe("-105000.00");

    // Segunda corrida del MISMO periodo: no-op (ON CONFLICT DO NOTHING).
    const segunda = await svc.ejecutarGeneracion(JULIO);
    expect(segunda.egresosGenerados).toBe(0); // R28: nada nuevo
    expect(store.rows).toHaveLength(2); // sigue habiendo 2 filas, no 4
    const caja2 = derivarCaja(await repo.agregarPorCategoriaYTipo({}));
    expect(caja2.enCaja).toBe(caja1.enCaja); // R31: sin cambio en la reejecucion
  });

  it("R28: dos periodos DISTINTOS generan dos egresos por plantilla (uno por mes)", async () => {
    const store = makeWalletStore();
    const { svc } = serviceFor(store, [plantilla()]);

    const julio = await svc.ejecutarGeneracion(JULIO);
    const agosto = await svc.ejecutarGeneracion(AGOSTO);

    expect(julio.egresosGenerados).toBe(1);
    expect(agosto.egresosGenerados).toBe(1);
    expect(store.rows).toHaveLength(2);
    const claves = store.rows.map((r) => r.origenId).sort();
    expect(claves).toEqual(["p-alquiler:2026-07", "p-alquiler:2026-08"]);
  });

  it("un egreso del cron NO colisiona con su reversa (ingreso_ajuste, otra categoria)", async () => {
    const store = makeWalletStore();
    const { svc, repo } = serviceFor(store, [plantilla()]);
    await svc.ejecutarGeneracion(JULIO);
    const egreso = store.rows[0];
    // La reversa referencia el ID del egreso (uuid) con categoria distinta -> tupla distinta.
    const n = await repo.crearMovimientos({ walletMovimiento: store.walletMovimiento } as never, [
      {
        tipo: "ingreso",
        categoria: "ingreso_ajuste",
        monto: egreso.monto.toFixed(2),
        origenTipo: "gasto",
        origenId: egreso.id,
        descripcion: `Reverso de: ${egreso.descripcion}`,
        registradoPor: "u-maestro",
      },
    ]);
    expect(n).toBe(1); // no colisiona con el egreso del cron
    const caja = derivarCaja(await repo.agregarPorCategoriaYTipo({}));
    expect(caja.enCaja).toBe("0.00"); // egreso + reverso = net cero
  });
});
