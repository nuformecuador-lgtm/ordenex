// Feature 267 (T6) — EL CONTRATO PUBLICO de `GET /api/ordenes/api-key/analitica`.
//
// Cubre R28, R29, R30, R31 y R36 sobre `lib/api/analitica-api-key-dto.ts`.
//
// El aserto que de verdad muerde es el de R31: no comprueba que la proyeccion «funcione», sino
// que un campo NUEVO del contrato interno NO se publique solo. Ese test se pone rojo el dia que
// alguien sustituya la proyeccion campo a campo por un `{ ...serie }`, que es justo el atajo que
// el modulo existe para impedir. Por eso las series de este archivo se construyen con campos
// extra INYECTADOS a proposito: un fixture «limpio» no distinguiria una proyeccion de un spread.

import { describe, expect, it } from "vitest";

import {
  proyectarSerieApiKey,
  type AnaliticaSerieApiKeyDTO,
} from "@/lib/api/analitica-api-key-dto";
import { PENUMBRA, type SerieOperativa } from "@/lib/types/analitica-operativa";

/* -------------------------------------------------------------------------- */
/* Utillaje                                                                    */
/* -------------------------------------------------------------------------- */

const UUID_MENSAJERO = "3f7c1a2e-9b44-4d51-8a0e-2c6d5f8b1e77";

/** Un uuid v4 cualquiera, en minusculas o mayusculas, en cualquier punto de la cadena. */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function serieBase(): SerieOperativa {
  return {
    metricaId: "entregas",
    unidad: "conteo",
    unidadDeConteo: "gestion",
    rango: {
      preset: "personalizado",
      // Los `Date` internos existen y NO deben cruzar al contrato publico (R30).
      desde: new Date("2026-08-01T06:00:00.000Z"),
      hasta: new Date("2026-08-22T06:00:00.000Z"),
      desdeFecha: "2026-08-01",
      hastaFecha: "2026-08-21",
    },
    puntos: [
      { fecha: "2026-08-20", valor: 37 },
      { fecha: "2026-08-21", valor: 12, parcial: true, corteAt: "2026-08-21T18:40:00.000Z" },
    ],
    cobertura: { fechasNoComparables: [], penumbra: PENUMBRA },
  };
}

/**
 * Recorre el resultado YA proyectado buscando lo que R30 prohibe. Se hace sobre el objeto y no
 * sobre la cadena porque `JSON.stringify` de un `Date` no lanza: lo convierte en silencio, y
 * mirar solo la cadena dejaria pasar exactamente el caso que se quiere impedir.
 */
function recolectarTipos(valor: unknown, ruta = "$", acc: string[] = []): string[] {
  if (valor instanceof Date) acc.push(`${ruta}: Date`);
  else if (typeof valor === "bigint") acc.push(`${ruta}: bigint`);
  else if (Array.isArray(valor)) {
    valor.forEach((v, i) => recolectarTipos(v, `${ruta}[${i}]`, acc));
  } else if (valor !== null && typeof valor === "object") {
    for (const [k, v] of Object.entries(valor)) recolectarTipos(v, `${ruta}.${k}`, acc);
  }
  return acc;
}

/** Todas las claves que aparecen en cualquier nivel del objeto proyectado. */
function clavesProfundas(valor: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(valor)) {
    for (const v of valor) clavesProfundas(v, acc);
  } else if (valor !== null && typeof valor === "object") {
    for (const [k, v] of Object.entries(valor)) {
      acc.add(k);
      clavesProfundas(v, acc);
    }
  }
  return acc;
}

/* -------------------------------------------------------------------------- */
/* R28 — la forma completa                                                     */
/* -------------------------------------------------------------------------- */

describe("R28 — la respuesta 200 declara metrica, unidad, unidadDeConteo, rango, puntos y cobertura", () => {
  it("proyecta exactamente las seis claves de nivel superior, ni una mas", () => {
    const dto = proyectarSerieApiKey(serieBase());

    expect(Object.keys(dto).sort()).toEqual(
      ["cobertura", "metrica", "puntos", "rango", "unidad", "unidadDeConteo"].sort(),
    );
  });

  it("publica el rango como YYYY-MM-DD CR con `hasta` inclusivo, no como los Date internos", () => {
    const dto = proyectarSerieApiKey(serieBase());

    expect(dto.rango).toEqual({ desde: "2026-08-01", hasta: "2026-08-21" });
    // El `preset` es vocabulario interno: no se publica (design §7.4).
    expect(Object.keys(dto.rango).sort()).toEqual(["desde", "hasta"]);
  });

  it("copia metrica, unidad y unidadDeConteo desde la serie interna", () => {
    const dto = proyectarSerieApiKey(serieBase());

    expect(dto.metrica).toBe("entregas");
    expect(dto.unidad).toBe("conteo");
    expect(dto.unidadDeConteo).toBe("gestion");
  });

  it("P5 — publica `parcial: true` con su `corteAt` ISO en el dia en curso, y solo ahi", () => {
    const dto = proyectarSerieApiKey(serieBase());

    expect(dto.puntos).toEqual([
      { fecha: "2026-08-20", valor: 37 },
      { fecha: "2026-08-21", valor: 12, parcial: true, corteAt: "2026-08-21T18:40:00.000Z" },
    ]);
    expect(dto.puntos[0]).not.toHaveProperty("parcial");
    expect(dto.puntos[0]).not.toHaveProperty("corteAt");
  });

  it("`valor: null` sobrevive como null: «no se sabe» no se convierte en cero", () => {
    const serie: SerieOperativa = {
      ...serieBase(),
      metricaId: "tasa_entrega",
      unidad: "porcentaje",
      puntos: [{ fecha: "2026-08-20", valor: null }],
    };

    expect(proyectarSerieApiKey(serie).puntos[0]?.valor).toBeNull();
  });

  it("una serie sin puntos sigue siendo una respuesta con forma completa", () => {
    const dto = proyectarSerieApiKey({ ...serieBase(), puntos: [] });

    expect(dto.puntos).toEqual([]);
    expect(Object.keys(dto).sort()).toEqual(
      ["cobertura", "metrica", "puntos", "rango", "unidad", "unidadDeConteo"].sort(),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* R29 — cobertura siempre presente                                            */
/* -------------------------------------------------------------------------- */

describe("R29 — `cobertura` esta presente SIEMPRE", () => {
  it("con el rango entero comparable, publica la lista vacia (una afirmacion, no una ausencia)", () => {
    const dto = proyectarSerieApiKey(serieBase());

    expect(dto.cobertura).toEqual({ fechasNoComparables: [], penumbra: PENUMBRA });
  });

  it("con fechas no comparables, las publica una a una", () => {
    const serie: SerieOperativa = {
      ...serieBase(),
      cobertura: {
        fechasNoComparables: ["2026-07-11", "2026-07-12"],
        penumbra: PENUMBRA,
      },
    };

    expect(proyectarSerieApiKey(serie).cobertura.fechasNoComparables).toEqual([
      "2026-07-11",
      "2026-07-12",
    ]);
  });

  it("sigue presente cuando la serie no tiene ni un punto: «cero» y «no se sabe» no son lo mismo", () => {
    const dto = proyectarSerieApiKey({ ...serieBase(), puntos: [] });

    expect(dto).toHaveProperty("cobertura");
    expect(dto.cobertura.penumbra).toBe(PENUMBRA);
  });

  it("no comparte referencia con la serie interna: mutar la salida no toca el contrato interno", () => {
    const serie = serieBase();
    const dto = proyectarSerieApiKey(serie);

    expect(dto.cobertura.fechasNoComparables).not.toBe(serie.cobertura.fechasNoComparables);
  });
});

/* -------------------------------------------------------------------------- */
/* R30 — nada de Date ni de BigInt                                             */
/* -------------------------------------------------------------------------- */

describe("R30 — todo numero es `number | null` y todo instante es ISO", () => {
  it("`JSON.stringify` no lanza y el objeto proyectado no contiene ningun Date ni bigint", () => {
    const dto = proyectarSerieApiKey(serieBase());

    expect(recolectarTipos(dto)).toEqual([]);
    expect(() => JSON.stringify(dto)).not.toThrow();
  });

  it("un `BigInt` colado en la serie interna NO llega a la salida: se publica null, no un 500", () => {
    // `seg_ciclo_acum` es BigInt en el rollup y `JSON.stringify` de un BigInt LANZA. El tipo ya
    // promete `number | null`, pero un tipo no detiene a un productor que mienta.
    const serie = {
      ...serieBase(),
      metricaId: "tiempo_ciclo",
      unidad: "segundos",
      puntos: [{ fecha: "2026-08-20", valor: BigInt(900) as unknown as number }],
    } as unknown as SerieOperativa;

    const dto = proyectarSerieApiKey(serie);

    expect(dto.puntos[0]?.valor).toBeNull();
    expect(recolectarTipos(dto)).toEqual([]);
    expect(() => JSON.stringify(dto)).not.toThrow();
  });

  it("un `Date` colado como `corteAt` sale como cadena ISO, nunca como Date crudo", () => {
    const serie = {
      ...serieBase(),
      puntos: [
        {
          fecha: "2026-08-21",
          valor: 12,
          parcial: true,
          corteAt: new Date("2026-08-21T18:40:00.000Z") as unknown as string,
        },
      ],
    } as unknown as SerieOperativa;

    const dto = proyectarSerieApiKey(serie);

    expect(dto.puntos[0]?.corteAt).toBe("2026-08-21T18:40:00.000Z");
    expect(recolectarTipos(dto)).toEqual([]);
  });

  it("los `Date` del RangoResuelto se quedan dentro: el rango publico son dos cadenas", () => {
    const dto = proyectarSerieApiKey(serieBase());

    expect(typeof dto.rango.desde).toBe("string");
    expect(typeof dto.rango.hasta).toBe("string");
    expect(recolectarTipos(dto.rango)).toEqual([]);
  });

  it("un `NaN` no se publica como numero: JSON no sabe expresarlo", () => {
    const serie: SerieOperativa = {
      ...serieBase(),
      puntos: [{ fecha: "2026-08-20", valor: Number.NaN }],
    };

    expect(proyectarSerieApiKey(serie).puntos[0]?.valor).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* R31 — proyeccion explicita: el campo nuevo NO se publica solo               */
/* -------------------------------------------------------------------------- */

describe("R31 — un campo nuevo del contrato interno NO aparece en la respuesta", () => {
  it("un campo extra inyectado en la raiz de la serie no cruza (este test cae con un spread)", () => {
    const serie = {
      ...serieBase(),
      // Simula lo que hara la proxima feature que amplie `SerieOperativa`.
      costoTotalCentimos: 123_456,
      diagnosticoInterno: { sqlMs: 42, cacheHit: true },
    } as unknown as SerieOperativa;

    const dto = proyectarSerieApiKey(serie);

    expect(dto).not.toHaveProperty("costoTotalCentimos");
    expect(dto).not.toHaveProperty("diagnosticoInterno");
    expect(Object.keys(dto).sort()).toEqual(
      ["cobertura", "metrica", "puntos", "rango", "unidad", "unidadDeConteo"].sort(),
    );
  });

  it("un campo extra inyectado en un PUNTO tampoco cruza", () => {
    const serie = {
      ...serieBase(),
      puntos: [
        { fecha: "2026-08-20", valor: 37, mensajeroId: UUID_MENSAJERO, importeCentimos: 9_900 },
      ],
    } as unknown as SerieOperativa;

    const dto = proyectarSerieApiKey(serie);

    expect(Object.keys(dto.puntos[0] ?? {}).sort()).toEqual(["fecha", "valor"]);
  });

  it("un campo extra inyectado en `cobertura` tampoco cruza", () => {
    const serie = {
      ...serieBase(),
      cobertura: {
        fechasNoComparables: ["2026-07-12"],
        penumbra: PENUMBRA,
        horizonteInterno: "2026-07-13",
      },
    } as unknown as SerieOperativa;

    const dto = proyectarSerieApiKey(serie);

    expect(Object.keys(dto.cobertura).sort()).toEqual(["fechasNoComparables", "penumbra"]);
  });

  it("`nota` (R35 de la 126) no se publica: `sin_gestionar` no esta en la lista blanca de P1", () => {
    const serie = {
      ...serieBase(),
      nota: "sin_gestionar_es_del_dia_universo_b2",
    } as unknown as SerieOperativa;

    expect(proyectarSerieApiKey(serie)).not.toHaveProperty("nota");
  });

  it("el censo de claves profundas es exactamente el contrato publicado", () => {
    const serie = {
      ...serieBase(),
      nota: "sin_gestionar_es_del_dia_universo_b2",
      puntos: [
        { fecha: "2026-08-20", valor: 37, dimension: "ENTREGADO", campoFuturo: 1 },
        { fecha: "2026-08-21", valor: 12, parcial: true, corteAt: "2026-08-21T18:40:00.000Z" },
      ],
    } as unknown as SerieOperativa;

    expect([...clavesProfundas(proyectarSerieApiKey(serie))].sort()).toEqual(
      [
        "cobertura",
        "corteAt",
        "fecha",
        "fechasNoComparables",
        "metrica",
        "parcial",
        "penumbra",
        "puntos",
        "rango",
        "unidad",
        "unidadDeConteo",
        "valor",
        "desde",
        "hasta",
      ].sort(),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* R36 — ni un identificador de mensajero en la respuesta serializada          */
/* -------------------------------------------------------------------------- */

describe("R36 — la cadena serializada no contiene ningun uuid", () => {
  it("la respuesta nominal no trae uuid alguno", () => {
    const serializada = JSON.stringify(proyectarSerieApiKey(serieBase()));

    expect(serializada).not.toMatch(UUID_RE);
  });

  it("P2 — una `dimension` con el uuid real del mensajero se descarta entera", () => {
    // Aunque la maquinaria interna llegara a desagregar por mensajero (P2 lo prohibe en este
    // canal, pero el contrato interno lo admite), la dimension NO se proyecta.
    const serie = {
      ...serieBase(),
      puntos: [
        { fecha: "2026-08-20", valor: 37, dimension: UUID_MENSAJERO },
        { fecha: "2026-08-21", valor: 12, dimension: `Mensajero 1 (${UUID_MENSAJERO})` },
      ],
    } as unknown as SerieOperativa;

    const serializada = JSON.stringify(proyectarSerieApiKey(serie));

    expect(serializada).not.toMatch(UUID_RE);
    expect(serializada).not.toContain(UUID_MENSAJERO);
    expect(serializada).not.toContain("dimension");
  });

  it("un uuid escondido en un campo extra de la serie tampoco se filtra", () => {
    const serie = {
      ...serieBase(),
      mensajeroDestacadoId: UUID_MENSAJERO,
      cobertura: {
        fechasNoComparables: [],
        penumbra: PENUMBRA,
        auditoriaId: UUID_MENSAJERO.toUpperCase(),
      },
    } as unknown as SerieOperativa;

    expect(JSON.stringify(proyectarSerieApiKey(serie))).not.toMatch(UUID_RE);
  });

  it("el tipo publicado no declara ningun campo de identidad", () => {
    // Aserto de tipo, no de valor: si alguien anade `mensajeroId` al DTO, esto deja de compilar
    // por el `Exclude` vacio y el typecheck cae antes que el test.
    type ClavesPublicas = keyof AnaliticaSerieApiKeyDTO;
    const claves: ClavesPublicas[] = [
      "metrica",
      "unidad",
      "unidadDeConteo",
      "rango",
      "puntos",
      "cobertura",
    ];

    expect(claves).toHaveLength(6);
  });
});
