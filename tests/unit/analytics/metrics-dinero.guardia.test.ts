import { describe, it, expect } from "vitest";
import { METRICAS, listarMetricas } from "@/lib/analytics/metrics";
import { ROLES_ANALITICA } from "@/lib/analytics/types";
import type { AlcanceMetrica, Metrica, RolAnalitica, TablaAnalitica } from "@/lib/analytics/types";
import { esAccesoTotal } from "@/lib/auth/acceso-total";

// Feature 135 / T3.3 — GUARDA de la frontera del dinero (R6 + R32).
//
// Dos invariantes que no se pueden dejar a la buena voluntad de quien anada la
// metrica 24:
//   (R6)  el dinero NUNCA se recalcula desde ordenes: una metrica `financiera` solo
//         puede citar los tres ledgers append-only y los dos snapshots de cierre.
//   (R32) el dinero es de DOS roles — los que `esAccesoTotal()` reconoce (`maestro` y
//         `admin`, D7 rectificada el 2026-07-30). Los otros tres van a `prohibido`,
//         nunca a `acotado`: no existe vista financiera recortada (aviso a la 132/133).
//
// El guard no se limita a mirar el catalogo actual: aplica el MISMO criterio a dos
// metricas falsas que violan cada regla, para demostrar que detectaria la infraccion
// el dia que alguien la escriba de verdad.

const TABLAS_DEL_DINERO: readonly TablaAnalitica[] = [
  "wallet_movimiento",
  "wallet_tienda_movimiento",
  "pago_mensajero_movimiento",
  "cierre_dia",
  "cierre_bodega",
];

/** Lo que el dinero NO puede tocar: la operativa y el rollup operativo. */
const TABLAS_PROHIBIDAS_AL_DINERO: readonly TablaAnalitica[] = [
  "orden",
  "gestion_orden",
  "orden_historial_estado",
  "analytics_daily",
];

const ROLES_SIN_DINERO = ROLES_ANALITICA.filter((rol) => !esAccesoTotal(rol));

function tablasDe(metrica: Metrica): readonly string[] {
  return metrica.fuente.tablas;
}

/** R6: toda tabla citada esta en el universo del dinero. */
function citaSoloFuentesDeDinero(metrica: Metrica): boolean {
  return tablasDe(metrica).every((tabla) =>
    (TABLAS_DEL_DINERO as readonly string[]).includes(tabla),
  );
}

/** R32: `total` para los dos roles de acceso total, `prohibido` para los otros tres. */
function alcanceCerradoAlDinero(metrica: Metrica): boolean {
  return ROLES_ANALITICA.every((rol: RolAnalitica) => {
    const esperado: AlcanceMetrica = esAccesoTotal(rol) ? "total" : "prohibido";
    return metrica.alcance[rol] === esperado;
  });
}

const FINANCIERAS = METRICAS.filter((m) => m.dominio === "financiera");

describe("R6 · frontera del dinero: fuentes", () => {
  it("declara metricas financieras en el catalogo", () => {
    expect(FINANCIERAS.length).toBe(8);
  });

  it("toda metrica financiera cita solo ledgers append-only y snapshots de cierre", () => {
    for (const metrica of FINANCIERAS) {
      expect(citaSoloFuentesDeDinero(metrica), `metrica ${metrica.id}: ${tablasDe(metrica)}`).toBe(
        true,
      );
      expect(["ledger", "snapshot_cierre"], `metrica ${metrica.id}`).toContain(metrica.fuente.tipo);
    }
  });

  it("ninguna metrica financiera lee orden, gestion_orden, historial ni el rollup", () => {
    for (const metrica of FINANCIERAS) {
      const interseccion = tablasDe(metrica).filter((tabla) =>
        (TABLAS_PROHIBIDAS_AL_DINERO as readonly string[]).includes(tabla),
      );
      expect(interseccion, `metrica ${metrica.id}`).toEqual([]);
    }
  });

  it("ninguna metrica financiera es snapshot del rollup operativo", () => {
    for (const metrica of FINANCIERAS) {
      expect(metrica.clase, `metrica ${metrica.id}`).not.toBe("snapshot");
    }
  });

  it("rechaza una metrica financiera que pretenda recalcular el dinero desde orden", () => {
    const infractora: Metrica = {
      id: "cod_recaudado_desde_orden",
      etiqueta: "COD recaudado (mal)",
      descripcion: "Suma orden.monto_cobrar: exactamente lo que R6 prohibe.",
      dominio: "financiera",
      clase: "live",
      unidad: "moneda",
      unidadDeConteo: "moneda",
      estadoProduccion: "declarada",
      granos: ["fecha"],
      fuente: { tipo: "tabla_viva", tablas: ["orden"] },
      alcance: {
        maestro: "total",
        admin: "total",
        adminSatelite: "prohibido",
        adminTienda: "prohibido",
        mensajero: "prohibido",
      },
      definicion: {},
    };
    expect(citaSoloFuentesDeDinero(infractora)).toBe(false);
  });
});

describe("R32 · frontera de rol del dominio financiera", () => {
  it("solo los roles de acceso total ven metricas financieras", () => {
    for (const metrica of FINANCIERAS) {
      expect(alcanceCerradoAlDinero(metrica), `metrica ${metrica.id}`).toBe(true);
    }
  });

  it("no declara ninguna metrica financiera con alcance acotado", () => {
    for (const metrica of FINANCIERAS) {
      expect(Object.values(metrica.alcance), `metrica ${metrica.id}`).not.toContain("acotado");
    }
  });

  it("listarMetricas devuelve cero financieras a adminSatelite, adminTienda y mensajero", () => {
    expect([...ROLES_SIN_DINERO].sort()).toEqual(["adminSatelite", "adminTienda", "mensajero"]);
    for (const rol of ROLES_SIN_DINERO) {
      const visibles = listarMetricas({ rol });
      expect(
        visibles.filter((m) => m.dominio === "financiera"),
        `el rol ${rol} no debe ver dinero`,
      ).toEqual([]);
      // Y sigue viendo la operativa: el recorte es del dinero, no del tablero entero.
      expect(visibles.length).toBe(15);
    }
  });

  it("listarMetricas devuelve el catalogo entero a maestro y a admin", () => {
    for (const rol of ROLES_ANALITICA.filter((r) => esAccesoTotal(r))) {
      expect(listarMetricas({ rol }).length).toBe(METRICAS.length);
    }
  });

  it("rechaza que se le abra el dinero a un cuarto rol", () => {
    const infractora: Metrica = {
      id: "cuenta_por_pagar_tienda_para_la_tienda",
      etiqueta: "Cuenta por pagar (mal)",
      descripcion: "Le abre el dinero al adminTienda: exactamente lo que R32 prohibe.",
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
    expect(alcanceCerradoAlDinero(infractora)).toBe(false);
    expect(Object.values(infractora.alcance)).toContain("acotado");
  });
});
