// Ficha 458-A (TA.7, R62) — el panel MENSUAL de `/analitica` rotula la cifra de la caja como lo que
// es: la de un periodo. «Movimiento neto del periodo», con la MISMA función de rótulo que la tarjeta
// de `/wallet` (`rotuloCifraPrincipal`) diciéndole que hay periodo; nunca «Dinero en caja» ni «Flujo
// de dinero registrado» sobre una cifra recortada (menor m3 de la revisión de la 459).
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { RespuestaFinanciera, ResultadoFinanciero } from "@/lib/types/analitica-financiera";
import { importeConNeto } from "@/tests/fixtures/importe-analitico";

const consultar = vi.hoisted(() => vi.fn<(metricaId: string, filtro: unknown) => Promise<RespuestaFinanciera>>());
vi.mock("@/lib/actions/analitica-financiera", () => ({ consultarMetricaFinanciera: consultar }));
const resumenCaja = vi.hoisted(() => vi.fn<(input: unknown) => Promise<unknown>>());
vi.mock("@/lib/actions/wallet", () => ({ verResumenCajaAction: resumenCaja }));

import { cargarTableroFinanciero } from "@/app/(app)/analitica/_components/financiero/cargar";
import { rotuloCifraPrincipal } from "@/app/(app)/wallet/_components/wallet-labels";

function dto(metricaId: string): ResultadoFinanciero {
  return {
    tipo: "vistas",
    metricaId,
    etiqueta: `Etiqueta de ${metricaId}`,
    unidad: "moneda",
    rango: { desdeFecha: "2026-08-28", hastaFecha: "2026-09-26" },
    esAcumulado: false,
    vistas: [
      {
        id: `${metricaId}__v`,
        grano: "fecha",
        fuente: "wallet_movimiento",
        sumableCon: [],
        granularidad: "dia",
        filas: [],
        total: importeConNeto("100.00", "90.00"),
      },
    ],
  };
}

async function rotuloDelPanel(): Promise<string | undefined> {
  const paneles = await cargarTableroFinanciero();
  const panel = paneles.find((p) => p.id === "dinero_en_caja");
  return panel?.estado === "ok" ? panel.datos.etiqueta : undefined;
}

beforeEach(() => {
  consultar.mockReset();
  resumenCaja.mockReset();
  consultar.mockImplementation((id) => Promise.resolve({ status: "ok", datos: dto(id) }));
});

describe("458-A R62 — el panel mensual dice «Movimiento neto del periodo»", () => {
  it.each(["flujo", "saldo"] as const)("con la caja en estado «%s»", async (estado) => {
    resumenCaja.mockResolvedValue({ status: "ok", resumen: { estado, periodoFiltrado: false } });
    const rotulo = await rotuloDelPanel();
    expect(rotulo).toBe("Movimiento neto del periodo");
    expect(rotulo).not.toBe("Dinero en caja");
    expect(rotulo).not.toBe("Flujo de dinero registrado");
  });

  it("es la misma función que la tarjeta, con periodo (no un literal aparte)", async () => {
    resumenCaja.mockResolvedValue({ status: "ok", resumen: { estado: "saldo", periodoFiltrado: false } });
    expect(await rotuloDelPanel()).toBe(rotuloCifraPrincipal({ periodoFiltrado: true, estado: "saldo" }));
    // Y la tarjeta de /wallet SIN filtros sigue diciendo otra cosa: el panel no la ha cambiado.
    expect(rotuloCifraPrincipal({ periodoFiltrado: false, estado: "saldo" })).toBe("Dinero en caja");
  });

  it("si la lectura del estado falla, sigue siendo el nombre del periodo", async () => {
    resumenCaja.mockRejectedValue(new Error("caida"));
    expect(await rotuloDelPanel()).toBe("Movimiento neto del periodo");
  });

  // Revision 458-A (m5): con periodo el estado de la caja no decide el nombre, así que la carga del
  // panel no pide el resumen de la caja (antes lo pedía en cada carga y descartaba lo que decía).
  it("m5: cargar el panel NO pide el resumen de la caja", async () => {
    resumenCaja.mockResolvedValue({ status: "ok", resumen: { estado: "saldo", periodoFiltrado: false } });
    await rotuloDelPanel();
    expect(resumenCaja).not.toHaveBeenCalled();
  });
});
