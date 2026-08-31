import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { WalletEgresoService } from "@/lib/services/WalletEgresoService";
import { esEgresoAdministrativo } from "@/app/(app)/wallet/_components/wallet-labels";
import type {
  IWalletMovimientoRepository,
  WalletTxClient,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 158 (T1.17, R30) — la indemnizacion NO es reversable por el flujo de reversa de
// egresos ADMINISTRATIVOS (45). Esto se cumple SIN tocar `WalletEgresoService`: la reversa
// exige `origen_tipo = "gasto"` y la indemnizacion nace con `origen_tipo = "cierre_dia"`.
//
// Que se cumpla "solo" es exactamente la razon de este archivo: es un invariante que hoy sale
// de una condicion escrita para otra feature. Sin test, alguien que relaje esa condicion
// —por ejemplo para poder reversar el pago al mensajero— abriria de paso la reversa de la
// indemnizacion, que es dinero ya liquidado por una aprobacion.

const MAESTRO: Actor = { usuarioId: "adm", rol: "maestro" };

function movimiento(over: Partial<WalletMovimientoDTO> = {}): WalletMovimientoDTO {
  return {
    // Feature 231 (R31): todas las categorias de este fixture son dinero de Ordenex.
    dueno: "propio",
    id: "w1",
    tipo: "egreso",
    categoria: "egreso_indemnizacion",
    monto: "12500.75",
    origenTipo: "cierre_dia", // el egreso del camino del mensajero
    origenId: "c1",
    descripcion: null,
    registradoPor: null,
    fechaMovimiento: "2026-07-30T10:00:00.000Z",
    ...over,
  };
}

function buildRepo(original: WalletMovimientoDTO | null): IWalletMovimientoRepository {
  return {
    crearMovimientos: vi.fn(async () => 1),
    listar: vi.fn(async () => ({ movimientos: [], total: 0 })),
    agregarPorCategoriaYTipo: vi.fn(async () => []),
    obtenerPorId: vi.fn(async () => original),
    agregarPorCategoria: vi.fn(async () => ({
      gastoFijo: "0.00",
      gastoVariable: "0.00",
      sueldo: "0.00",
      indemnizacion: "0.00",
    })),
    obtenerPorOrigen: vi.fn(), // ficha 333: lectura por la clave del libro; este camino no la usa
  };
}

const writeClient = {} as WalletTxClient;

describe("R30 — la reversa de egresos administrativos RECHAZA la indemnizacion", () => {
  it("reversar un `egreso_indemnizacion` (origen cierre_dia) -> not_found, sin escribir nada", async () => {
    const repo = buildRepo(movimiento());
    const svc = new WalletEgresoService(repo, writeClient);

    const r = await svc.reversarEgreso({ movimientoId: "w1" }, MAESTRO);

    expect(r).toEqual({ status: "not_found" });
    // Lo importante: NO se emitio el `ingreso_ajuste` compensatorio.
    expect(repo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("R30: el filtro que lo rechaza es el ORIGEN (`gasto`), no la categoria", async () => {
    // Control de discriminacion: el MISMO service SI reversa un egreso administrativo real.
    const repo = buildRepo(
      movimiento({ categoria: "egreso_gasto_variable", origenTipo: "gasto", origenId: null }),
    );
    const svc = new WalletEgresoService(repo, writeClient);

    const r = await svc.reversarEgreso({ movimientoId: "w1" }, MAESTRO);

    expect(r).toEqual({ status: "ok" });
    expect(repo.crearMovimientos).toHaveBeenCalledTimes(1);
  });

  it("R30: tampoco se reversa si alguien le pusiera la categoria a un origen de cierre", async () => {
    for (const origenTipo of ["cierre_dia", "pago_mensajero", "manual"] as const) {
      const repo = buildRepo(movimiento({ origenTipo }));
      const svc = new WalletEgresoService(repo, writeClient);
      const r = await svc.reversarEgreso({ movimientoId: "w1" }, MAESTRO);
      expect(r, `origen ${origenTipo} no deberia ser reversable`).toEqual({ status: "not_found" });
    }
  });
});

describe("R30 — la UI tampoco ofrece la reversa", () => {
  it("`esEgresoAdministrativo` es false para la indemnizacion del cierre", () => {
    expect(esEgresoAdministrativo(movimiento())).toBe(false);
    // Control: un gasto variable manual SI lo es.
    expect(
      esEgresoAdministrativo(
        movimiento({ categoria: "egreso_gasto_variable", origenTipo: "gasto", origenId: null }),
      ),
    ).toBe(true);
  });
});

describe("R30 — el invariante no depende de haber tocado WalletEgresoService", () => {
  it("el service de la 45 NO menciona la categoria de indemnizacion (no se le anadio una rama)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "lib", "services", "WalletEgresoService.ts"),
      "utf8",
    );
    // Si un dia hubiera que tratarla de forma especial ahi, seria una decision explicita — y
    // este caso obligaria a tomarla mirandolo.
    expect(src).not.toMatch(/egreso_indemnizacion/);
    // Y la condicion de la que depende R30 sigue siendo la del ORIGEN.
    expect(src).toMatch(/origenTipo !== "gasto"/);
  });
});
