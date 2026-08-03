import { describe, it, expect } from "vitest";

import {
  FILTRO_INICIAL,
  aRaw,
  aSearchParams,
  desdeSearchParams,
  serializarFiltro,
  type FiltroTablero,
} from "@/app/(app)/analitica/_components/operativo/filtro-tablero";
import { analiticaFiltroSchema } from "@/lib/analytics/filters";

// Feature 131 (T1.1) — R11, R13, R14.
//
// El caso de R11 NO comprueba el objeto contra una copia del esquema: lo pasa por
// `analiticaFiltroSchema.safeParse` REAL. Una copia se quedaria vieja el dia que la 135
// cambie el contrato y este test seguiria verde mientras el borde devuelve
// `validation_error` en produccion.

function con(parcial: Partial<FiltroTablero>): FiltroTablero {
  return { ...FILTRO_INICIAL, ...parcial };
}

describe("Feature 131 (R11) — el filtro emitido lo acepta el esquema de la 135", () => {
  it("el filtro emitido lo acepta `analiticaFiltroSchema` y no lleva claves extra", () => {
    const raw = aRaw(
      con({
        zonaIds: ["z1", "z2"],
        tiendaIds: ["t1"],
        mensajeroIds: ["m1"],
      }),
    );

    // (1) el esquema REAL lo acepta.
    const parsed = analiticaFiltroSchema.safeParse(raw);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

    // (2) y no lleva NI UNA clave fuera del contrato. El esquema es `.strict()`, asi que
    // `rol` o `usuario_id` serian un `validation_error` provocado por nosotros — y ademas
    // un filtro NO es un canal de alcance (R24 de la 135).
    expect(Object.keys(raw).sort()).toEqual(
      ["mensajero_id", "rango", "tienda_id", "zona_id"].sort(),
    );
    expect(raw).not.toHaveProperty("rol");
    expect(raw).not.toHaveProperty("usuario_id");
  });

  it("una lista vacia OMITE su clave en vez de viajar como `[]`", () => {
    // El esquema exige lista NO VACIA (`filters.ts:27`): mandar `[]` seria un
    // `validation_error` que nos hemos fabricado solos.
    const raw = aRaw(FILTRO_INICIAL);
    expect(raw).not.toHaveProperty("zona_id");
    expect(raw).not.toHaveProperty("tienda_id");
    expect(raw).not.toHaveProperty("mensajero_id");
    expect(analiticaFiltroSchema.safeParse(raw).success).toBe(true);
  });

  it("los cuatro presets producen un `raw` valido", () => {
    for (const rango of ["dia", "semana", "mes"] as const) {
      expect(analiticaFiltroSchema.safeParse(aRaw(con({ rango }))).success).toBe(true);
    }
    const personalizado = aRaw(
      con({ rango: "personalizado", desde: "2026-07-01", hasta: "2026-07-31" }),
    );
    expect(analiticaFiltroSchema.safeParse(personalizado).success).toBe(true);
  });
});

describe("Feature 131 (R13) — el estado inicial es el declarado y es estable", () => {
  it("sin seleccion del usuario el filtro inicial es el declarado", () => {
    const vacio = new URLSearchParams();
    expect(desdeSearchParams(vacio)).toEqual(FILTRO_INICIAL);
    // Y el declarado es `semana`, sin zona, sin tienda y sin mensajero (design §5.1).
    expect(FILTRO_INICIAL.rango).toBe("semana");
    expect(FILTRO_INICIAL.zonaIds).toEqual([]);
    expect(FILTRO_INICIAL.tiendaIds).toEqual([]);
    expect(FILTRO_INICIAL.mensajeroIds).toEqual([]);
  });

  it("dos cargas de la pagina con la misma URL dan el mismo filtro", () => {
    const url = "?rango=mes&zona=z1";
    expect(desdeSearchParams(new URLSearchParams(url))).toEqual(
      desdeSearchParams(new URLSearchParams(url)),
    );
  });

  it("un rango fuera del dominio cerrado cae al inicial, no viaja al borde", () => {
    const filtro = desdeSearchParams(new URLSearchParams("?rango=trimestre"));
    expect(filtro.rango).toBe(FILTRO_INICIAL.rango);
  });

  it("la URL por defecto no escribe nada: `/analitica` a secas es el estado inicial", () => {
    expect(aSearchParams(FILTRO_INICIAL).toString()).toBe("");
  });
});

describe("Feature 131 (R14) — `desde`/`hasta` si y solo si `personalizado`", () => {
  it("`desde`/`hasta` viajan si y solo si el preset es personalizado", () => {
    // Direccion 1: con un preset NO viajan. El esquema los PROHIBE ahi (refine 2 de
    // `filters.ts`), asi que emitirlos siempre seria un `validation_error` seguro.
    for (const rango of ["dia", "semana", "mes"] as const) {
      const raw = aRaw(con({ rango, desde: "2026-07-01", hasta: "2026-07-31" }));
      expect(raw, `preset ${rango}`).not.toHaveProperty("desde");
      expect(raw, `preset ${rango}`).not.toHaveProperty("hasta");
      expect(analiticaFiltroSchema.safeParse(raw).success, `preset ${rango}`).toBe(true);
    }

    // Direccion 2: con `personalizado` viajan SIEMPRE (el esquema los EXIGE, refine 1).
    const raw = aRaw(con({ rango: "personalizado", desde: "2026-07-01", hasta: "2026-07-31" }));
    expect(raw.desde).toBe("2026-07-01");
    expect(raw.hasta).toBe("2026-07-31");
  });

  it("la URL solo lleva `desde`/`hasta` con `personalizado`, y al leerla se descartan", () => {
    expect(aSearchParams(con({ rango: "mes", desde: "2026-07-01" })).has("desde")).toBe(false);
    // Un enlace manipulado con `?rango=mes&desde=…` no cuela la fecha.
    const filtro = desdeSearchParams(new URLSearchParams("?rango=mes&desde=2026-07-01"));
    expect(filtro.desde).toBe("");
  });
});

describe("Feature 131 (R12) — la clave de consulta cambia con el filtro", () => {
  it("cambiar la zona cambia la cadena serializada", () => {
    expect(serializarFiltro(FILTRO_INICIAL)).not.toBe(
      serializarFiltro(con({ zonaIds: ["z1"] })),
    );
  });

  it("ida y vuelta por la URL conserva el filtro", () => {
    const filtro = con({ rango: "personalizado", desde: "2026-07-01", hasta: "2026-07-05", zonaIds: ["z1", "z2"] });
    expect(desdeSearchParams(aSearchParams(filtro))).toEqual(filtro);
  });
});
