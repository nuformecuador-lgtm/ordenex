import { describe, it, expect } from "vitest";

import {
  CASILLAS_CAJA,
  OPCIONES_DIRECCION_CAJA,
  casillasConValor,
  declaracionesCaja,
  deSeleccion,
  periodoDeSeleccion,
  seleccionDeCaja,
  seleccionDePeriodo,
} from "@/app/(app)/wallet/_components/libro-caja-filtros";
import {
  FILTROS_LIBRO_INICIALES,
  FILTROS_WALLET_VACIOS,
  type FiltrosLibro,
  type FiltrosWallet,
} from "@/app/(app)/wallet/_components/wallet-filtros-input";

// FICHA 467 (T4, design §3.1; R6, R19, R27) — las declaraciones de la barra única de la caja. Las
// casillas y las opciones de Entra/Sale son CONTRATO y se afirman como literal escrito a mano.

describe("467 R6 — las casillas de la caja", () => {
  it("son exactamente Periodo, A quién, Entra/Sale y Concepto, en ese orden", () => {
    expect(CASILLAS_CAJA.map((c) => c.label)).toEqual(["Periodo", "A quién", "Entra/Sale", "Concepto"]);
    expect(CASILLAS_CAJA.map((c) => c.key)).toEqual(["periodo", "aQuien", "tipo", "categoria"]);
  });
});

describe("467 R19 — Entra/Sale ofrece «Entra» y «Sale», sin «Todo»", () => {
  it("dos opciones con el `tipo` del borde de siempre", () => {
    expect(OPCIONES_DIRECCION_CAJA).toEqual([
      { value: "ingreso", label: "Entra" },
      { value: "egreso", label: "Sale" },
    ]);
  });

  it("la declaración del `single` dice «Todo» sin elección, y Concepto dice «Todos»", () => {
    const [periodo, direccion, concepto] = declaracionesCaja([{ value: "egreso_sueldo", label: "Sueldo (1)" }]);
    expect(periodo).toMatchObject({ key: "periodo", label: "Periodo", kind: "dateRange" });
    expect(direccion).toMatchObject({ key: "tipo", label: "Entra/Sale", kind: "single", placeholder: "Todo" });
    expect(direccion.options?.map((o) => o.label)).toEqual(["Entra", "Sale"]);
    expect(concepto).toMatchObject({ key: "categoria", label: "Concepto", kind: "single", placeholder: "Todos" });
    expect(concepto.options).toEqual([{ value: "egreso_sueldo", label: "Sueldo (1)" }]);
  });
});

describe("467 — ida y vuelta entre la caja y el orquestador", () => {
  const fw: FiltrosWallet = { desde: "2026-09-01", hasta: "2026-09-30" };
  const fl: FiltrosLibro = { ...FILTROS_LIBRO_INICIALES, tipo: "egreso", categoria: "egreso_sueldo" };

  it("seleccionDeCaja → deSeleccion devuelve lo mismo", () => {
    const sel = seleccionDeCaja(fw, fl);
    expect(sel).toEqual({
      periodo: ["", "2026-09-01", "2026-09-30"],
      tipo: ["egreso"],
      categoria: ["egreso_sueldo"],
    });
    expect(deSeleccion(sel)).toEqual({ desde: "2026-09-01", hasta: "2026-09-30", tipo: "egreso", categoria: "egreso_sueldo" });
  });

  it("sin nada puesto, la selección es `{}` y vuelve vacía", () => {
    expect(seleccionDeCaja(FILTROS_WALLET_VACIOS, FILTROS_LIBRO_INICIALES)).toEqual({});
    expect(deSeleccion({})).toEqual({ desde: "", hasta: "", tipo: "", categoria: "" });
  });

  it("R17: un rango de un solo día es un periodo válido", () => {
    expect(seleccionDePeriodo("2026-09-12", "2026-09-12")).toEqual({ periodo: ["", "2026-09-12", "2026-09-12"] });
    expect(periodoDeSeleccion({ periodo: ["", "2026-09-12", "2026-09-12"] })).toEqual({
      desde: "2026-09-12",
      hasta: "2026-09-12",
    });
  });
});

describe("467 R27 — las casillas con valor", () => {
  it("en el orden de las casillas, incluida «A quién»", () => {
    expect(
      casillasConValor(
        { desde: "", hasta: "2026-09-30", aQuien: { nombre: "Tania" } },
        { ...FILTROS_LIBRO_INICIALES, categoria: "egreso_sueldo" },
      ),
    ).toEqual(["periodo", "aQuien", "categoria"]);
    expect(casillasConValor(FILTROS_WALLET_VACIOS, { ...FILTROS_LIBRO_INICIALES, termino: "tania", sortDir: "asc" })).toEqual([]);
  });
});
