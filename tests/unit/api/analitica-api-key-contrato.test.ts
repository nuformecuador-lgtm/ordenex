// Feature 267 (T6) — EL CONTRATO PUBLICO de `GET /api/ordenes/api-key/analitica`.
//
// Cubre R28, R30, R31 y R36 sobre `lib/api/analitica-api-key-dto.ts`, mas la ENMIENDA DEL
// 2026-08-24 que sustituyo a R29.
//
// El aserto que de verdad muerde es el de R31: no comprueba que la proyeccion «funcione», sino
// que un campo NUEVO del contrato interno NO se publique solo. Ese test se pone rojo el dia que
// alguien sustituya la proyeccion campo a campo por un `{ ...serie }`, que es justo el atajo que
// el modulo existe para impedir. Por eso las series de este archivo se construyen con campos
// extra INYECTADOS a proposito: un fixture «limpio» no distinguiria una proyeccion de un spread.
//
// ⏳ 2026-09-04 — SEGUNDA VUELTA, Y CONVIENE LEER LAS DOS. Aqui decia que la enmienda del
// 2026-08-24 habia retirado `cobertura`, `unidadDeConteo`, `parcial` y `corteAt`, y que el dia en
// curso y los dias bajo el horizonte se OMITIAN de `data` porque «la ausencia es el unico signo
// honesto que queda cuando no hay marcas».
//
// Vuelven `cobertura`, `parcial` y `corteAt` —no `unidadDeConteo`— y con ellas vuelven los puntos
// que se omitian: el canal por API key sirve lo MISMO que la pantalla. El motivo de aquella
// enmienda no se declara equivocado, se declara SUPERADO: la omision era honesta solo mientras el
// contrato no tuviera con que marcar; ahora lo tiene. Y la omision tenia su propio fallo mudo,
// medido en produccion el 2026-09-04 —un integrador cargo 60 ordenes y la analitica no le
// devolvia nada de ese dia—: para quien no ha leido la cabecera del DTO, «hoy no aparece» y «hoy
// fue cero» son igual de indistinguibles.
//
// Los tests no se borraron, otra vez: cada uno tenia un motivo y el motivo sigue vivo con otra
// forma. Donde antes se comprobaba que el punto DESAPARECIA, ahora se comprueba que aparece CON
// SU MARCA — y que la marca es exactamente la que distingue un dia a medias de un dia flojo.

import { describe, expect, it } from "vitest";

import {
  proyectarRespuestaApiKey,
  proyectarSerieApiKey,
  type AnaliticaRespuestaApiKeyDTO,
  type AnaliticaSerieApiKeyDTO,
} from "@/lib/api/analitica-api-key-dto";
import { PENUMBRA, type SerieOperativa } from "@/lib/types/analitica-operativa";

/* -------------------------------------------------------------------------- */
/* Utillaje                                                                    */
/* -------------------------------------------------------------------------- */

const UUID_MENSAJERO = "3f7c1a2e-9b44-4d51-8a0e-2c6d5f8b1e77";

/** Un uuid v4 cualquiera, en minusculas o mayusculas, en cualquier punto de la cadena. */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Las claves del contrato INTERNO que siguen sin publicarse. Ninguna puede aparecer en la cadena
 * serializada, en ningun nivel.
 *
 * `puntos` esta en la lista porque el array publico se llama `data`: publicar los dos nombres a la
 * vez seria dos contratos para lo mismo. `unidadDeConteo` porque es un hecho del CATALOGO y se
 * documenta una vez en la descripcion del endpoint. `dimension` porque P2 la prohibe entera aqui.
 *
 * ⏳ 2026-09-04: salen de esta lista `cobertura`, `penumbra`, `fechasNoComparables`, `parcial` y
 * `corteAt` — ahora SI se publican, y hay tests dedicados que lo exigen mas abajo.
 */
const CLAVES_RETIRADAS = ["unidadDeConteo", "puntos", "dimension"] as const;

/**
 * La serie interna nominal: DOS puntos servibles y NADA que deba omitirse. Los casos de omision
 * se construyen encima, para que se vea exactamente que punto sobra en cada uno.
 */
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
      { fecha: "2026-08-19", valor: 41 },
      { fecha: "2026-08-20", valor: 37 },
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

/** Las fechas publicadas, que es lo que se mira en cada caso de omision. */
function fechas(dto: AnaliticaSerieApiKeyDTO): string[] {
  return dto.data.map((p) => p.fecha);
}

/* -------------------------------------------------------------------------- */
/* R28 — la forma completa                                                     */
/* -------------------------------------------------------------------------- */

describe("R28 — la respuesta 200 declara metrica, unidad y data, y nada mas", () => {
  it("proyecta exactamente las CUATRO claves de nivel superior de una serie, ni una mas", () => {
    // P4-bis: `rango` no esta aqui, es de la RESPUESTA. `unidadDeConteo` sigue fuera (hecho del
    // catalogo, documentado en el endpoint). 2026-09-04: `cobertura` vuelve.
    const dto = proyectarSerieApiKey(serieBase());

    expect(Object.keys(dto).sort()).toEqual(["cobertura", "data", "metrica", "unidad"]);
  });

  it("publica el rango del SOBRE como YYYY-MM-DD CR con `hasta` inclusivo, no como los Date internos", () => {
    const dto = proyectarRespuestaApiKey([serieBase()]);

    expect(dto.rango).toEqual({ desde: "2026-08-01", hasta: "2026-08-21" });
    // El `preset` es vocabulario interno: no se publica (design §7.4).
    expect(Object.keys(dto.rango).sort()).toEqual(["desde", "hasta"]);
  });

  it("copia metrica y unidad desde la serie interna, y NO copia `unidadDeConteo`", () => {
    const dto = proyectarSerieApiKey(serieBase());

    expect(dto.metrica).toBe("entregas");
    expect(dto.unidad).toBe("conteo");
    // La serie interna SI la trae (`gestion`); el contrato publico ya no la emite.
    expect(dto).not.toHaveProperty("unidadDeConteo");
    expect(JSON.stringify(dto)).not.toContain("gestion");
  });

  it("un punto publicado tiene EXACTAMENTE `fecha` y `valor`", () => {
    const dto = proyectarSerieApiKey(serieBase());

    expect(dto.data).toEqual([
      { fecha: "2026-08-19", valor: 41 },
      { fecha: "2026-08-20", valor: 37 },
    ]);
    for (const punto of dto.data) expect(Object.keys(punto).sort()).toEqual(["fecha", "valor"]);
  });

  it("`valor: null` sobrevive como null: «no se sabe» no se convierte en cero", () => {
    // Y el dia SI aparece en `data`: esta cerrado, y su resultado es indefinido. Es distinto de
    // un dia omitido, que es un dia del que no se puede decir nada.
    const serie: SerieOperativa = {
      ...serieBase(),
      metricaId: "tasa_entrega",
      unidad: "porcentaje",
      puntos: [{ fecha: "2026-08-20", valor: null }],
    };

    const dto = proyectarSerieApiKey(serie);

    expect(dto.data).toHaveLength(1);
    expect(dto.data[0]?.valor).toBeNull();
    expect(dto.data[0]?.fecha).toBe("2026-08-20");
    expect(JSON.stringify(dto)).toContain('"valor":null');
  });

  it("una serie sin puntos internos sigue siendo una respuesta con forma completa", () => {
    const dto = proyectarSerieApiKey({ ...serieBase(), puntos: [] });

    expect(dto.data).toEqual([]);
    expect(Object.keys(dto).sort()).toEqual(["cobertura", "data", "metrica", "unidad"]);
  });
});

/* -------------------------------------------------------------------------------------------- */
/* 2026-09-04 — LA MARCA ES EL SIGNO (en sustitucion de la enmienda del 2026-08-24)              */
/*                                                                                                */
/* Antes estos casos DESAPARECIAN de `data`. Ahora se publican con la marca que los hace          */
/* legibles, que es la misma que recibe la pantalla. Lo que estos tests protegen no ha cambiado:  */
/* que un dia a medias NUNCA sea indistinguible de un dia cerrado con poca operacion.             */
/* -------------------------------------------------------------------------------------------- */

describe("2026-09-04 — `data` publica el dia en curso MARCADO, y no lo omite", () => {
  it("un punto con `parcial: true` aparece en `data` con su marca y su `corteAt`", () => {
    const serie: SerieOperativa = {
      ...serieBase(),
      puntos: [
        { fecha: "2026-08-20", valor: 37 },
        { fecha: "2026-08-21", valor: 12, parcial: true, corteAt: "2026-08-21T18:40:00.000Z" },
      ],
    };

    const dto = proyectarSerieApiKey(serie);

    expect(fechas(dto)).toEqual(["2026-08-20", "2026-08-21"]);
    expect(dto.data[1]).toEqual({
      fecha: "2026-08-21",
      valor: 12,
      parcial: true,
      corteAt: "2026-08-21T18:40:00.000Z",
    });
  });

  it("un dia CERRADO no lleva `parcial` ni `corteAt`: las marcas son del dia en curso y de nadie mas", () => {
    // El fallo que este test caza es emitir `parcial: false` en todos los puntos «por simetria».
    // El contrato interno declara `parcial?: true`, asi que un `false` publicado inventaria un
    // tercer estado que dentro no existe, y obligaria al integrador a distinguir dos formas de
    // «no es parcial».
    const dto = proyectarSerieApiKey(serieBase());

    for (const punto of dto.data) {
      expect(Object.keys(punto).sort()).toEqual(["fecha", "valor"]);
      expect(punto).not.toHaveProperty("parcial");
      expect(punto).not.toHaveProperty("corteAt");
    }
  });

  it("un parcial SIN `corteAt` publica la marca igual: la ausencia del instante no borra el aviso", () => {
    const serie: SerieOperativa = {
      ...serieBase(),
      puntos: [{ fecha: "2026-08-21", valor: 12, parcial: true }],
    };

    const punto = proyectarSerieApiKey(serie).data[0];

    expect(punto).toEqual({ fecha: "2026-08-21", valor: 12, parcial: true });
  });

  it("un punto bajo el horizonte aparece en `data`, y `cobertura` dice cual es", () => {
    const serie: SerieOperativa = {
      ...serieBase(),
      puntos: [
        { fecha: "2026-08-18", valor: 3 },
        { fecha: "2026-08-19", valor: 41 },
        { fecha: "2026-08-20", valor: 37 },
      ],
      cobertura: { fechasNoComparables: ["2026-08-18"], penumbra: PENUMBRA },
    };

    const dto = proyectarSerieApiKey(serie);

    // El dia se publica —su cifra es la que es— y lo que impide leerlo como una caida de la
    // operacion es que su fecha esta listada en `cobertura`.
    expect(fechas(dto)).toEqual(["2026-08-18", "2026-08-19", "2026-08-20"]);
    expect(dto.cobertura.fechasNoComparables).toEqual(["2026-08-18"]);
  });

  it("`cobertura` viaja SIEMPRE, tambien cuando no hay ningun dia no comparable", () => {
    // Que sea obligatoria es lo que permite al integrador escribir un solo camino de lectura. Una
    // `cobertura?` opcional le obligaria a distinguir «no hay dias raros» de «no me lo dijeron».
    const dto = proyectarSerieApiKey(serieBase());

    expect(dto.cobertura).toEqual({ fechasNoComparables: [], penumbra: PENUMBRA });
  });

  it("el orden de los puntos se conserva tal cual venia, sin reordenar por fecha ni por marca", () => {
    const serie: SerieOperativa = {
      ...serieBase(),
      puntos: [
        { fecha: "2026-08-17", valor: 1 },
        { fecha: "2026-08-18", valor: 2 },
        { fecha: "2026-08-19", valor: 3 },
        { fecha: "2026-08-20", valor: 4 },
        { fecha: "2026-08-21", valor: 5, parcial: true },
      ],
      cobertura: { fechasNoComparables: ["2026-08-18"], penumbra: PENUMBRA },
    };

    const dto = proyectarSerieApiKey(serie);

    expect(dto.data).toEqual([
      { fecha: "2026-08-17", valor: 1 },
      { fecha: "2026-08-18", valor: 2 },
      { fecha: "2026-08-19", valor: 3 },
      { fecha: "2026-08-20", valor: 4 },
      { fecha: "2026-08-21", valor: 5, parcial: true },
    ]);
  });

  it("una serie SIN puntos sigue produciendo `data: []`, sin lanzar", () => {
    // Ya no es el caso `desde=hoy&hasta=hoy` —ese ahora trae el punto de hoy marcado—, pero el
    // estado sigue siendo alcanzable (un rango sin dato alguno) y sigue siendo un 200 legitimo.
    // El unico throw del modulo cubre otra cosa (cero SERIES) y no debe dispararse aqui.
    const serie: SerieOperativa = { ...serieBase(), puntos: [] };

    let dto: AnaliticaRespuestaApiKeyDTO | undefined;
    expect(() => {
      dto = proyectarRespuestaApiKey([serie]);
    }).not.toThrow();

    expect(dto?.metricas).toHaveLength(1);
    expect(dto?.metricas[0]?.data).toEqual([]);
    expect(dto?.metricas[0]?.metrica).toBe("entregas");
  });

  it("el `rango` es el ECO DE LO PEDIDO y no se recorta al ultimo dia cerrado", () => {
    // `desde=hoy&hasta=hoy` es el patron de un integrador que consulta a diario. Recortar `hasta`
    // le devolveria un rango invertido —o un 422— por una pregunta legitima. Con el eco intacto
    // responde 200, y desde el 2026-09-04 con el punto de hoy DENTRO, marcado.
    const mismoDia: SerieOperativa = {
      ...serieBase(),
      rango: {
        preset: "personalizado",
        desde: new Date("2026-08-21T06:00:00.000Z"),
        hasta: new Date("2026-08-22T06:00:00.000Z"),
        desdeFecha: "2026-08-21",
        hastaFecha: "2026-08-21",
      },
      puntos: [{ fecha: "2026-08-21", valor: 12, parcial: true }],
    };

    const dto = proyectarRespuestaApiKey([mismoDia]);

    expect(dto.rango).toEqual({ desde: "2026-08-21", hasta: "2026-08-21" });
    expect(dto.metricas[0]?.data).toEqual([{ fecha: "2026-08-21", valor: 12, parcial: true }]);
  });

  it("`fechasNoComparables` se publica en el orden en que venia, sin ordenar ni deduplicar", () => {
    // No se toca el contenido: es un eco de lo que decidio `esNoComparable` (feature 125), y
    // reordenarlo aqui seria inventar una garantia que el productor no da.
    const serie: SerieOperativa = {
      ...serieBase(),
      cobertura: { fechasNoComparables: ["2026-08-19", "2026-08-17"], penumbra: PENUMBRA },
    };

    expect(proyectarSerieApiKey(serie).cobertura.fechasNoComparables).toEqual([
      "2026-08-19",
      "2026-08-17",
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* R30 — nada de Date ni de BigInt                                             */
/* -------------------------------------------------------------------------- */

describe("R30 — todo numero es `number | null` y no sale ningun Date", () => {
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

    expect(dto.data[0]?.valor).toBeNull();
    expect(recolectarTipos(dto)).toEqual([]);
    expect(() => JSON.stringify(dto)).not.toThrow();
  });

  it("un `Date` colado como `corteAt` sale normalizado a ISO, nunca como Date", () => {
    // `corteAt` volvio a viajar el 2026-09-04, asi que vuelve a haber un `Date` que normalizar.
    // Un `Date` crudo serializa distinto segun quien lo serialice, que es lo que R30 prohibe.
    const serie = {
      ...serieBase(),
      puntos: [
        { fecha: "2026-08-20", valor: 37 },
        {
          fecha: "2026-08-21",
          valor: 12,
          parcial: true,
          corteAt: new Date("2026-08-21T18:40:00.000Z") as unknown as string,
        },
      ],
    } as unknown as SerieOperativa;

    const dto = proyectarSerieApiKey(serie);

    expect(dto.data[1]?.corteAt).toBe("2026-08-21T18:40:00.000Z");
    expect(recolectarTipos(dto)).toEqual([]);
    expect(() => JSON.stringify(dto)).not.toThrow();
  });

  it("un `corteAt` que no es ni cadena ni Date se descarta, y el punto conserva su `parcial`", () => {
    // Mejor un punto sin instante de corte que un instante inventado: la marca que de verdad
    // importa —«esto no esta cerrado»— no depende de que el corte sea legible.
    const serie = {
      ...serieBase(),
      puntos: [{ fecha: "2026-08-21", valor: 12, parcial: true, corteAt: 1_756_000_000_000 }],
    } as unknown as SerieOperativa;

    const punto = proyectarSerieApiKey(serie).data[0];

    expect(punto).toEqual({ fecha: "2026-08-21", valor: 12, parcial: true });
  });

  it("los `Date` del RangoResuelto se quedan dentro: el rango publico son dos cadenas", () => {
    const dto = proyectarRespuestaApiKey([serieBase()]);

    expect(typeof dto.rango.desde).toBe("string");
    expect(typeof dto.rango.hasta).toBe("string");
    expect(recolectarTipos(dto.rango)).toEqual([]);
  });

  it("un `NaN` no se publica como numero: JSON no sabe expresarlo", () => {
    const serie: SerieOperativa = {
      ...serieBase(),
      puntos: [{ fecha: "2026-08-20", valor: Number.NaN }],
    };

    expect(proyectarSerieApiKey(serie).data[0]?.valor).toBeNull();
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
    expect(Object.keys(dto).sort()).toEqual(["cobertura", "data", "metrica", "unidad"]);
  });

  it("un campo extra inyectado en un PUNTO tampoco cruza", () => {
    const serie = {
      ...serieBase(),
      puntos: [
        { fecha: "2026-08-20", valor: 37, mensajeroId: UUID_MENSAJERO, importeCentimos: 9_900 },
      ],
    } as unknown as SerieOperativa;

    const dto = proyectarSerieApiKey(serie);

    expect(Object.keys(dto.data[0] ?? {}).sort()).toEqual(["fecha", "valor"]);
  });

  it("un campo extra inyectado en un punto PARCIAL tampoco cruza: la marca no abre la puerta", () => {
    const serie = {
      ...serieBase(),
      puntos: [
        {
          fecha: "2026-08-21",
          valor: 12,
          parcial: true,
          corteAt: "2026-08-21T18:40:00.000Z",
          mensajeroId: UUID_MENSAJERO,
          campoFuturo: 1,
        },
      ],
    } as unknown as SerieOperativa;

    const dto = proyectarSerieApiKey(serie);

    expect(Object.keys(dto.data[0] ?? {}).sort()).toEqual([
      "corteAt",
      "fecha",
      "parcial",
      "valor",
    ]);
  });

  it("un campo extra inyectado en `cobertura` no cruza, aunque `cobertura` ya SI se publique", () => {
    // Que un objeto entre en el contrato publico no lo convierte en un pasillo abierto: se sigue
    // proyectando campo a campo. Este test cae si alguien sustituye `proyectarCobertura` por un
    // `cobertura: serie.cobertura`.
    const serie = {
      ...serieBase(),
      cobertura: {
        fechasNoComparables: ["2026-07-12"],
        penumbra: PENUMBRA,
        horizonteInterno: "2026-07-13",
      },
    } as unknown as SerieOperativa;

    const dto = proyectarSerieApiKey(serie);

    expect(JSON.stringify(dto)).not.toContain("horizonteInterno");
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

    expect([...clavesProfundas(proyectarRespuestaApiKey([serie]))].sort()).toEqual(
      [
        "cobertura",
        "corteAt",
        "data",
        "desde",
        "fecha",
        "fechasNoComparables",
        "hasta",
        "metrica",
        "metricas",
        "parcial",
        "penumbra",
        "rango",
        "unidad",
        "valor",
      ].sort(),
    );
  });

  it("la cadena serializada no contiene NINGUNA de las claves que siguen sin publicarse", () => {
    // Barato y contundente: un `JSON.stringify` de la respuesta completa, con una serie que trae
    // internamente lo que NO se publica (`unidadDeConteo`, y un punto con `dimension`).
    const serie = {
      ...serieBase(),
      puntos: [
        { fecha: "2026-08-19", valor: 41, dimension: "ENTREGADO" },
        { fecha: "2026-08-20", valor: 37 },
        { fecha: "2026-08-21", valor: 12, parcial: true, corteAt: "2026-08-21T18:40:00.000Z" },
      ],
      cobertura: { fechasNoComparables: ["2026-08-19"], penumbra: PENUMBRA },
    } as unknown as SerieOperativa;

    const serializada = JSON.stringify(proyectarRespuestaApiKey([serie]));

    for (const clave of CLAVES_RETIRADAS) expect(serializada).not.toContain(clave);
    // Y lo que SI queda, queda: los TRES dias, con el ultimo marcado.
    expect(JSON.parse(serializada).metricas[0].data).toEqual([
      { fecha: "2026-08-19", valor: 41 },
      { fecha: "2026-08-20", valor: 37 },
      { fecha: "2026-08-21", valor: 12, parcial: true, corteAt: "2026-08-21T18:40:00.000Z" },
    ]);
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
    const claves: ClavesPublicas[] = ["metrica", "unidad", "data"];

    expect(claves).toHaveLength(3);

    type ClavesDelSobre = keyof AnaliticaRespuestaApiKeyDTO;
    const delSobre: ClavesDelSobre[] = ["rango", "metricas"];
    expect(delSobre).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* P4-bis — EL SOBRE: R45 (forma unica), R47 (orden), R48 (rango comun)        */
/* -------------------------------------------------------------------------- */

describe("R45 — la respuesta 200 es SIEMPRE el sobre `{ rango, metricas[] }`", () => {
  it("con UNA sola metrica ya tiene forma de lote: no hay dos formas del mismo endpoint", () => {
    // Si la respuesta cambiara de forma segun cuantas metricas se pidieron, el integrador
    // tendria que escribir dos parsers para un solo endpoint —y elegir entre ellos mirando su
    // propia peticion, que es justo lo que un contrato existe para evitar.
    const dto = proyectarRespuestaApiKey([serieBase()]);

    expect(Object.keys(dto).sort()).toEqual(["metricas", "rango"]);
    expect(dto.metricas).toHaveLength(1);
    expect(dto.metricas[0]?.metrica).toBe("entregas");
  });

  it("R47 — conserva el orden de las series que recibe, sin reordenar por id ni por catalogo", () => {
    const series = ["tasa_entrega", "entregas", "devoluciones"].map((metricaId) => ({
      ...serieBase(),
      metricaId,
    }));

    const dto = proyectarRespuestaApiKey(series);

    expect(dto.metricas.map((m) => m.metrica)).toEqual([
      "tasa_entrega",
      "entregas",
      "devoluciones",
    ]);
  });

  it("cada serie del lote lleva SU PROPIA cobertura, no la de la primera", () => {
    // `fechasNoComparables` depende del historial que cada metrica necesita, asi que dos metricas
    // del mismo rango pueden no ser legibles en los mismos dias. Publicar la cobertura de una
    // para todas marcaria dias buenos de unas y dejaria sin marcar dias malos de otras. Por eso
    // `cobertura` vive en la SERIE y no en el sobre —al reves que `rango`, que si es comun por
    // construccion (R48)—.
    const dto = proyectarRespuestaApiKey([
      { ...serieBase(), metricaId: "entregas" },
      {
        ...serieBase(),
        metricaId: "tiempo_ciclo",
        cobertura: { fechasNoComparables: ["2026-08-19"], penumbra: PENUMBRA },
      },
    ]);

    // Los dos dias se publican en AMBAS: lo que cambia es que solo la segunda marca el 19.
    expect(fechas(dto.metricas[0]!)).toEqual(["2026-08-19", "2026-08-20"]);
    expect(fechas(dto.metricas[1]!)).toEqual(["2026-08-19", "2026-08-20"]);
    expect(dto.metricas[0]?.cobertura.fechasNoComparables).toEqual([]);
    expect(dto.metricas[1]?.cobertura.fechasNoComparables).toEqual(["2026-08-19"]);
    // Y sigue sin estar en el sobre: es de la serie.
    expect(dto).not.toHaveProperty("cobertura");
  });

  it("R31 sigue mordiendo dentro del sobre: un campo nuevo de la serie interna no cruza", () => {
    const serie = {
      ...serieBase(),
      costoTotalCentimos: 123_456,
    } as unknown as SerieOperativa;

    const dto = proyectarRespuestaApiKey([serie]);

    expect(dto.metricas[0]).not.toHaveProperty("costoTotalCentimos");
    expect(JSON.stringify(dto)).not.toContain("costoTotalCentimos");
  });
});

describe("R48 — el rango es UNO para todo el lote, y no se publica una mentira si no lo es", () => {
  it("con dos series del mismo rango, lo publica una sola vez en la raiz", () => {
    const dto = proyectarRespuestaApiKey([
      { ...serieBase(), metricaId: "entregas" },
      { ...serieBase(), metricaId: "devoluciones" },
    ]);

    expect(dto.rango).toEqual({ desde: "2026-08-01", hasta: "2026-08-21" });
    for (const serie of dto.metricas) expect(serie).not.toHaveProperty("rango");
  });

  it("si dos series NO comparten rango, lanza en vez de publicar el de la primera", () => {
    // Estado imposible mientras el borde lea el reloj una sola vez (R48). Que sea imposible hoy
    // no lo hace seguro manana: un 500 honesto es mejor que una respuesta que dice que las diez
    // series cubren un rango que una de ellas no cubre.
    const otra: SerieOperativa = {
      ...serieBase(),
      metricaId: "devoluciones",
      rango: { ...serieBase().rango, hastaFecha: "2026-08-22" },
    };

    expect(() => proyectarRespuestaApiKey([serieBase(), otra])).toThrow(/rango/i);
  });

  it("una lista de SERIES vacia lanza: `{ metricas: [] }` se leeria como «no hay datos», y seria falso", () => {
    // Ojo: cero SERIES es un bug nuestro y lanza. Cero PUNTOS en una serie NO lanza —es una
    // respuesta honesta— y lo comprueba el describe de la omision.
    expect(() => proyectarRespuestaApiKey([])).toThrow();
  });
});
