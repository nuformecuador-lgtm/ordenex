import { describe, it, expect } from "vitest";
import { listarMetricas } from "@/lib/analytics/metrics";
import {
  POLITICA_CACHE_FINANCIERA,
  esMetricaFinancieraCacheable,
  politicaDeCacheFinanciera,
} from "@/lib/analytics/cache-politica-financiera";

// Feature 179 / T1.5 — GUARDIA DE R28 (D3): LA POLITICA CUADRA CON EL CATALOGO, POR EXCESO Y
// POR DEFECTO.
//
// ⚠ ESTE GUARDIA **SOBREVIVE AL MERGE**: no mide el diff contra `dev`, compara la declaracion
// con el catalogo. Sigue vigente para siempre y no es un impuesto sobre features ajenas.
//
// LO QUE COMPRA, dicho como se descubre el fallo que impide:
//
//   - con una LISTA DE EXCLUSIONES, una metrica financiera nueva se cacharia POR DEFECTO y nadie
//     se entera; si fuera —como `conciliacion_cierres`— una cuya razon de ser es la ALERTA,
//     cachearla la apagaria en silencio;
//   - con un ALLOWLIST a secas, la metrica nueva NO se cachearia y tampoco se entera nadie:
//     «excluida a proposito» y «se me olvido meterla» serian el mismo estado del archivo.
//
// Con la politica exhaustiva las dos omisiones son imposibles: **la ausencia de decision es
// roja** y la exclusion deliberada es un valor escrito CON SU CAUSA.
//
// LIMITE DECLARADO: esto obliga a DECLARAR, no a ACERTAR. Que la exclusion de hoy sea la
// correcta lo mide `cache-financiera-conciliacion.test.ts` sobre el COMPORTAMIENTO (la base se
// consulta las dos veces y el aviso se emite las dos), no sobre la declaracion.

const IDS_DEL_CATALOGO = listarMetricas({ dominio: "financiera" }).map((m) => m.id);
const IDS_DECLARADOS = Object.keys(POLITICA_CACHE_FINANCIERA);

describe("R28 · toda metrica financiera del catalogo tiene politica de cache declarada", () => {
  it("por DEFECTO: ninguna metrica del catalogo se queda sin decision", () => {
    const sinDecision = IDS_DEL_CATALOGO.filter((id) => politicaDeCacheFinanciera(id) === undefined);

    expect(
      sinDecision,
      "hay metricas del dominio `financiera` sin politica de cache declarada en " +
        "`lib/analytics/cache-politica-financiera.ts`. NO se puede dejar sin decidir: sin " +
        "entrada, el decorador NO la cachea (default cerrado hacia el lado seguro) y eso seria " +
        "indistinguible de una exclusion deliberada. Hay que escribir `{ cacheable: true }` o " +
        "`{ cacheable: false, causa: <causa del dominio cerrado> }` para: " +
        sinDecision.join(", "),
    ).toEqual([]);
  });

  it("por EXCESO: ninguna entrada declarada sobrevive a la metrica que describia", () => {
    const huerfanas = IDS_DECLARADOS.filter((id) => !IDS_DEL_CATALOGO.includes(id));

    expect(
      huerfanas,
      "la politica declara metricas que `listarMetricas({ dominio: \"financiera\" })` ya no " +
        "sirve. Una declaracion que acumula entradas muertas deja de leerse, y con ella se " +
        "pierde la senal de la que si importa. Entradas huerfanas: " + huerfanas.join(", "),
    ).toEqual([]);
  });

  it("el guardia mira metricas de verdad: si el catalogo estuviera vacio seria verde por vacio", () => {
    expect(IDS_DEL_CATALOGO.length).toBeGreaterThanOrEqual(10);
    expect(IDS_DECLARADOS.length).toBe(IDS_DEL_CATALOGO.length);
  });
});

describe("R28 (D3) · `conciliacion_cierres` esta excluida, y con su causa escrita", () => {
  it("no es cacheable y la causa es del dominio cerrado", () => {
    const politica = politicaDeCacheFinanciera("conciliacion_cierres");
    expect(politica).toBeDefined();
    expect(politica?.cacheable).toBe(false);
    // `causa` solo existe en la rama no cacheable: leerla sin estrechar no compila.
    if (politica !== undefined && politica.cacheable === false) {
      expect(politica.causa).toBe("alerta_por_consulta");
    }
    expect(esMetricaFinancieraCacheable("conciliacion_cierres")).toBe(false);
  });

  it("y es la UNICA excluida: las demas del catalogo son cacheables", () => {
    const excluidas = IDS_DEL_CATALOGO.filter((id) => !esMetricaFinancieraCacheable(id));
    expect(excluidas).toEqual(["conciliacion_cierres"]);
  });
});

describe("R28 · el default de la funcion es CERRADO", () => {
  it("una metrica sin decision escrita NO se cachea", () => {
    // Las dos direcciones del error no cuestan lo mismo: cachear una metrica que nadie declaro
    // puede apagar una alerta de dinero en silencio; no cachearla solo cuesta recomputo. Por eso
    // el default no es simetrico — y por eso ademas es ROJO arriba, que es donde ese fallo se
    // descubre barato.
    expect(esMetricaFinancieraCacheable("metrica_que_no_existe")).toBe(false);
    // Y una metrica de OTRO dominio tampoco: el decorador financiero las recibe igual.
    expect(esMetricaFinancieraCacheable("entregas")).toBe(false);
  });
});
