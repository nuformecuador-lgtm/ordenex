import { describe, it, expect } from "vitest";
import * as adaptadores from "@/lib/analytics/alcance-columnas";
import { METRICAS } from "@/lib/analytics/metrics";
import type { Metrica, TablaAnalitica } from "@/lib/analytics/types";
import { ROLES_ANALITICA } from "@/lib/analytics/types";
import { resolverAlcance } from "@/lib/analytics/alcance";

// Feature 122 / T3.3 — GUARDIA del DINERO SIN RECORTE (R25).
//
// La 122 NO ofrece adaptador de alcance para las cinco tablas de dinero, y eso no es un
// olvido: para toda metrica financiera el alcance es `total` o `prohibido`
// (`lib/analytics/metrics.ts`), nunca `acotado`. El guardia vigila LOS DOS LADOS de esa
// equivalencia, porque romper cualquiera de ellos abre un agujero distinto:
//   - si aparece un adaptador de dinero, alguien esta recortando ledgers con un criterio
//     que nadie diseno;
//   - si una metrica financiera pasa a `acotado`, existe un recorte de dinero SIN
//     adaptador que lo aplique, o sea un `where` que alguien escribira a mano.
//
// Si esto se pone rojo, la respuesta no es aflojar el guardia: es disenar el recorte del
// dinero ANTES de tocar la metrica (aviso dirigido a la 127).

const TABLAS_DEL_DINERO: readonly TablaAnalitica[] = [
  "wallet_movimiento",
  "wallet_tienda_movimiento",
  "pago_mensajero_movimiento",
  "cierre_dia",
  "cierre_bodega",
];

const FINANCIERAS = METRICAS.filter((m) => m.dominio === "financiera");

/** Nombre de adaptador que delataria un recorte de dinero: `whereWalletMovimiento`, etc. */
function nombreDeAdaptador(tabla: string): string {
  return "where" + tabla.split("_").map((p) => p[0].toUpperCase() + p.slice(1)).join("");
}

describe("R25 · no hay adaptador de alcance para las tablas de dinero", () => {
  it("el modulo de adaptadores exporta exactamente los tres de la operativa", () => {
    expect(Object.keys(adaptadores).sort()).toEqual([
      "whereGestionOrden",
      "whereOrden",
      "whereRollup",
    ]);
  });

  it("no exporta adaptador para wallet, pago al mensajero ni cierres", () => {
    const exportados = Object.keys(adaptadores);
    for (const tabla of TABLAS_DEL_DINERO) {
      expect(exportados, tabla).not.toContain(nombreDeAdaptador(tabla));
      expect(exportados.some((e) => e.toLowerCase().includes(tabla.replace(/_/g, "")))).toBe(false);
    }
  });

  it("autocomprobacion: el censo de nombres reconoceria un adaptador de dinero", () => {
    expect(nombreDeAdaptador("wallet_movimiento")).toBe("whereWalletMovimiento");
    expect(nombreDeAdaptador("cierre_dia")).toBe("whereCierreDia");
    const exportadosFalsos = ["whereOrden", "whereWalletMovimiento"];
    expect(exportadosFalsos).toContain(nombreDeAdaptador("wallet_movimiento"));
  });
});

describe("R25 · ninguna metrica financiera declara alcance acotado", () => {
  it("las 10 financieras solo declaran total o prohibido", () => {
    // 8 de la 135 + `dinero_en_caja` y `ganancia_ordenex` de la 173 (P4).
    expect(FINANCIERAS.length).toBe(10);
    for (const metrica of FINANCIERAS) {
      for (const rol of ROLES_ANALITICA) {
        expect(["total", "prohibido"], `${metrica.id}/${rol}`).toContain(metrica.alcance[rol]);
      }
    }
  });

  it("por eso el resolutor nunca emite un alcance recortado sobre una metrica financiera", () => {
    for (const metrica of FINANCIERAS) {
      for (const rol of ROLES_ANALITICA) {
        const r = resolverAlcance(
          { usuarioId: "u1", rol, zonaId: "z1" },
          metrica.id,
        );
        if (r.estado === "ok") expect(r.alcance.tipo, `${metrica.id}/${rol}`).toBe("global");
      }
    }
  });

  it("autocomprobacion: detecta una metrica financiera acotada inyectada a mano", () => {
    const infractora: Metrica = {
      id: "cuenta_por_pagar_para_la_tienda",
      etiqueta: "Cuenta por pagar (mal)",
      descripcion: "Fixture: abre el dinero recortado al adminTienda, que es lo que R25 prohibe.",
      dominio: "financiera",
      clase: "live",
      unidad: "moneda",
      unidadDeConteo: "moneda",
      estadoProduccion: "declarada",
      granos: ["fecha", "tienda"],
      fuente: { tipo: "ledger", tablas: ["wallet_tienda_movimiento"] },
      alcance: {
        maestro: "total",
        admin: "total",
        adminSatelite: "prohibido",
        adminTienda: "acotado",
        mensajero: "prohibido",
      },
      definicion: {},
    };

    const acotadas = ROLES_ANALITICA.filter((rol) => infractora.alcance[rol] === "acotado");
    expect(acotadas).toEqual(["adminTienda"]);
    // La misma afirmacion que protege el catalogo, aplicada al fixture, falla:
    expect(Object.values(infractora.alcance)).toContain("acotado");
  });
});
