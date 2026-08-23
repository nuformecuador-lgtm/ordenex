import { describe, it, expect } from "vitest";
import { METRICAS, getMetrica } from "@/lib/analytics/metrics";
import type { Metrica } from "@/lib/analytics/types";
import {
  METRICAS_API_KEY,
  esMetricaPublicableApiKey,
} from "@/lib/analytics/publicacion-api-key";

// Feature 267 / T1 — la lista blanca de metricas del canal por API key (R15, R17-R21, R34).
//
// Los asertos se DERIVAN del catalogo (`lib/analytics/metrics.ts`), no de una copia a mano de
// la lista: si manana alguien mete una financiera, una metrica sin productor o una que la
// tienda duena no puede ver, este archivo se pone rojo sin que nadie tenga que acordarse.

/** Lo que el catalogo dice de los ids que la lista blanca publica. */
const PUBLICADAS: readonly Metrica[] = METRICAS.filter((m) => esMetricaPublicableApiKey(m.id));

describe("R15 · la lista blanca es explicita, unica y resuelve contra el catalogo", () => {
  it("todo id de METRICAS_API_KEY existe en el catalogo", () => {
    expect(METRICAS_API_KEY.length).toBeGreaterThan(0);
    for (const id of METRICAS_API_KEY) {
      expect(getMetrica(id), id).toBeDefined();
    }
  });

  it("el predicado concede exactamente los ids de la lista y niega todo lo demas", () => {
    const publicados = METRICAS.filter((m) => esMetricaPublicableApiKey(m.id)).map((m) => m.id);
    expect(publicados.slice().sort()).toEqual([...METRICAS_API_KEY].slice().sort());

    for (const m of METRICAS) {
      const enLista = (METRICAS_API_KEY as readonly string[]).includes(m.id);
      expect(esMetricaPublicableApiKey(m.id), m.id).toBe(enLista);
    }
  });

  it("es total: una cadena basura no lanza y no se publica", () => {
    for (const basura of ["", "no_existe", "ordenes_creadas ", "ORDENES_CREADAS", "__proto__"]) {
      expect(() => esMetricaPublicableApiKey(basura), basura).not.toThrow();
      expect(esMetricaPublicableApiKey(basura), basura).toBe(false);
    }
  });

  it("la lista no tiene duplicados", () => {
    expect(new Set(METRICAS_API_KEY).size).toBe(METRICAS_API_KEY.length);
  });
});

describe("R17/R18/R19/R34 · la lista blanca esta atada al catalogo, no a la confianza", () => {
  it("el censo no pasa por vacio: hay metricas publicadas y el catalogo sigue teniendo 25", () => {
    expect(METRICAS.length).toBe(25);
    expect(PUBLICADAS.length).toBe(METRICAS_API_KEY.length);
    expect(PUBLICADAS.length).toBeGreaterThan(0);
  });

  it("R17 · ninguna metrica publicable es de dominio financiera", () => {
    for (const m of PUBLICADAS) expect(m.dominio, m.id).not.toBe("financiera");
  });

  it("R34 · ninguna metrica publicable lleva importes (unidad moneda)", () => {
    for (const m of PUBLICADAS) {
      expect(m.unidad, m.id).not.toBe("moneda");
      expect(m.unidadDeConteo, m.id).not.toBe("moneda");
    }
  });

  it("R18 · ninguna metrica publicable esta prohibida para adminTienda", () => {
    for (const m of PUBLICADAS) expect(m.alcance.adminTienda, m.id).not.toBe("prohibido");
  });

  it("R19 · ninguna metrica publicable esta solo declarada", () => {
    for (const m of PUBLICADAS) expect(m.estadoProduccion, m.id).not.toBe("declarada");
  });

  it("toda metrica publicable declara el grano tienda: sin el no hay por donde recortar", () => {
    for (const m of PUBLICADAS) expect(m.granos, m.id).toContain("tienda");
  });

  it("autocomprobacion: los cuatro criterios reconocen a una infractora del propio catalogo", () => {
    const financieras = METRICAS.filter((m) => m.dominio === "financiera");
    expect(financieras.length).toBe(10);
    for (const m of financieras) {
      expect(esMetricaPublicableApiKey(m.id), m.id).toBe(false);
      expect(m.alcance.adminTienda, m.id).toBe("prohibido");
    }
  });
});

describe("R20 · una metrica nueva del catalogo NO se publica sola", () => {
  const sintetica: Metrica = {
    id: "metrica_sintetica_de_la_267",
    etiqueta: "Metrica sintetica",
    descripcion: "Fixture del test: simula un alta futura en el catalogo.",
    dominio: "operativa",
    clase: "snapshot",
    unidad: "conteo",
    unidadDeConteo: "orden",
    estadoProduccion: "producida",
    granos: ["fecha", "zona", "tienda"],
    fuente: { tipo: "rollup", tablas: ["analytics_daily"] },
    alcance: {
      maestro: "total",
      admin: "total",
      adminSatelite: "acotado",
      adminTienda: "acotado",
      mensajero: "acotado",
    },
    definicion: {},
  };

  it("una metrica anadida al catalogo que cumple TODOS los criterios sigue sin publicarse", () => {
    const catalogoAmpliado: readonly Metrica[] = [...METRICAS, sintetica];

    // Cumple los cuatro criterios duros: si la lista fuera de EXCLUSION, se publicaria sola.
    expect(sintetica.dominio).not.toBe("financiera");
    expect(sintetica.alcance.adminTienda).not.toBe("prohibido");
    expect(sintetica.estadoProduccion).not.toBe("declarada");
    expect(sintetica.unidad).not.toBe("moneda");

    expect(esMetricaPublicableApiKey(sintetica.id)).toBe(false);
    expect(catalogoAmpliado.filter((m) => esMetricaPublicableApiKey(m.id)).map((m) => m.id)).toEqual(
      PUBLICADAS.map((m) => m.id),
    );
  });
});
