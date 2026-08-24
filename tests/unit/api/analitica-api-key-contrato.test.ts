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
// ⚠ ENMIENDA DEL 2026-08-24 — AQUI SE AFIRMABA LO CONTRARIO DE LO QUE HOY ES CIERTO. Este
// archivo exigia que `cobertura` viajara SIEMPRE (R29), que la serie publicara `unidadDeConteo` y
// que el punto del dia en curso saliera marcado `parcial: true` con su `corteAt`. Nada de eso se
// publica ya. Los tests no se borraron: cada uno tenia un motivo, y el motivo SIGUE VIVO con otra
// forma. `cobertura` y `parcial` se siguen LEYENDO, y lo que hacen ahora es DECIDIR QUE PUNTOS NO
// SE PUBLICAN: un dia bajo el horizonte del historial y el dia en curso se OMITEN de `data` en
// vez de salir como un numero indistinguible de un dia flojo. La ausencia es el unico signo
// honesto que queda cuando no hay marcas. Los describe de abajo comprueban esa omision con la
// misma insistencia con la que antes comprobaban la marca.

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
 * Las claves que el contrato publico DEJO DE EMITIR el 2026-08-24. Ninguna puede aparecer en la
 * cadena serializada, en ningun nivel. `puntos` esta en la lista porque el array se llama `data`:
 * publicar los dos nombres a la vez seria dos contratos para lo mismo.
 */
const CLAVES_RETIRADAS = [
  "cobertura",
  "penumbra",
  "fechasNoComparables",
  "unidadDeConteo",
  "parcial",
  "corteAt",
  "puntos",
] as const;

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
  it("proyecta exactamente las TRES claves de nivel superior de una serie, ni una mas", () => {
    // P4-bis: `rango` no esta aqui, es de la RESPUESTA. Enmienda 2026-08-24: tampoco estan
    // `unidadDeConteo` (hecho del catalogo, documentado en el endpoint) ni `cobertura` (su
    // informacion la lleva la omision de puntos).
    const dto = proyectarSerieApiKey(serieBase());

    expect(Object.keys(dto).sort()).toEqual(["data", "metrica", "unidad"]);
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
    expect(Object.keys(dto).sort()).toEqual(["data", "metrica", "unidad"]);
  });
});

/* -------------------------------------------------------------------------------------------- */
/* ENMIENDA 2026-08-24 (en sustitucion de R29) — LA OMISION ES EL SIGNO                          */
/*                                                                                                */
/* Antes, `cobertura` y `parcial` viajaban para que el integrador supiera que dias no eran        */
/* legibles. Ahora no viajan, asi que esos dias NO SE PUBLICAN: un cero silencioso se leeria como */
/* una caida de la operacion que no ocurrio.                                                      */
/* -------------------------------------------------------------------------------------------- */

describe("2026-08-24 — `data` OMITE el dia en curso y los dias bajo el horizonte del historial", () => {
  it("un punto con `parcial: true` NO aparece en `data`", () => {
    const serie: SerieOperativa = {
      ...serieBase(),
      puntos: [
        { fecha: "2026-08-20", valor: 37 },
        { fecha: "2026-08-21", valor: 12, parcial: true, corteAt: "2026-08-21T18:40:00.000Z" },
      ],
    };

    const dto = proyectarSerieApiKey(serie);

    // El dia en curso no esta cerrado en el rollup: siempre se veria mas bajo que el anterior.
    expect(fechas(dto)).toEqual(["2026-08-20"]);
    expect(JSON.stringify(dto)).not.toContain("2026-08-21");
  });

  it("un punto cuya fecha esta en `fechasNoComparables` NO aparece en `data`", () => {
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

    // Bajo el horizonte del historial la cifra vale poco por falta de DATOS, no por falta de
    // operacion. Publicarla seria enseniar una caida que no ocurrio.
    expect(fechas(dto)).toEqual(["2026-08-19", "2026-08-20"]);
    expect(JSON.stringify(dto)).not.toContain("2026-08-18");
  });

  it("un punto normal SI aparece, y el orden de los que quedan se conserva", () => {
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

    // Se van el no comparable (18) y el parcial (21); los demas quedan EN SU ORDEN, no
    // reordenados ni renumerados.
    expect(dto.data).toEqual([
      { fecha: "2026-08-17", valor: 1 },
      { fecha: "2026-08-19", valor: 3 },
      { fecha: "2026-08-20", valor: 4 },
    ]);
  });

  it("los dias omitidos no se rellenan con `0` ni con `null`: desaparecen", () => {
    // El fallo que este test existe para cazar es «marcar el hueco» en vez de quitarlo: un punto
    // con valor 0 (o null) en la fecha omitida seria indistinguible de un dia real sin actividad.
    const serie: SerieOperativa = {
      ...serieBase(),
      puntos: [
        { fecha: "2026-08-19", valor: 41 },
        { fecha: "2026-08-20", valor: 37, parcial: true },
      ],
    };

    const dto = proyectarSerieApiKey(serie);

    expect(dto.data).toHaveLength(1);
    expect(dto.data.some((p) => p.fecha === "2026-08-20")).toBe(false);
  });

  it("una serie en la que TODOS los puntos se omiten produce `data: []`, sin lanzar", () => {
    // Es el caso `desde=hoy&hasta=hoy`: se pidio un dia y ese dia todavia no esta cerrado. Es un
    // 200 legitimo, no un error ni un estado imposible. El unico throw del modulo cubre otra
    // cosa (cero SERIES), y no debe dispararse aqui.
    const serie: SerieOperativa = {
      ...serieBase(),
      puntos: [
        { fecha: "2026-08-20", valor: 9 },
        { fecha: "2026-08-21", valor: 12, parcial: true },
      ],
      cobertura: { fechasNoComparables: ["2026-08-20"], penumbra: PENUMBRA },
    };

    let dto: AnaliticaRespuestaApiKeyDTO | undefined;
    expect(() => {
      dto = proyectarRespuestaApiKey([serie]);
    }).not.toThrow();

    expect(dto?.metricas).toHaveLength(1);
    expect(dto?.metricas[0]?.data).toEqual([]);
    // Y el sobre sigue completo: la serie existe, con su metrica y su unidad.
    expect(dto?.metricas[0]?.metrica).toBe("entregas");
  });

  it("el `rango` es el ECO DE LO PEDIDO y NO se recorta al ultimo dia servible", () => {
    // Recortar `hasta` devolveria un rango invertido —o un 422— a quien pida `desde=hoy&hasta=hoy`,
    // que es el patron de un integrador que consulta a diario. El eco intacto responde 200 con
    // `data: []`, que es la verdad: «pediste hoy, hoy todavia no esta cerrado».
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
    expect(dto.metricas[0]?.data).toEqual([]);
  });

  it("la lectura de `fechasNoComparables` no depende del orden ni del tamanio de la lista", () => {
    const serie: SerieOperativa = {
      ...serieBase(),
      puntos: [
        { fecha: "2026-08-17", valor: 1 },
        { fecha: "2026-08-18", valor: 2 },
        { fecha: "2026-08-19", valor: 3 },
      ],
      cobertura: { fechasNoComparables: ["2026-08-19", "2026-08-17"], penumbra: PENUMBRA },
    };

    expect(fechas(proyectarSerieApiKey(serie))).toEqual(["2026-08-18"]);
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

  it("un `Date` colado como `corteAt` no se convierte ni se publica: el punto entero se omite", () => {
    // Antes se normalizaba a ISO porque `corteAt` viajaba. Ya no viaja, y el punto que lo traia
    // es justamente el parcial: no hay `Date` que normalizar porque no hay campo que emitir.
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

    expect(fechas(dto)).toEqual(["2026-08-20"]);
    expect(recolectarTipos(dto)).toEqual([]);
    expect(JSON.stringify(dto)).not.toContain("corteAt");
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
    expect(Object.keys(dto).sort()).toEqual(["data", "metrica", "unidad"]);
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

  it("un campo extra inyectado en `cobertura` no cruza: `cobertura` entera se queda dentro", () => {
    const serie = {
      ...serieBase(),
      cobertura: {
        fechasNoComparables: ["2026-07-12"],
        penumbra: PENUMBRA,
        horizonteInterno: "2026-07-13",
      },
    } as unknown as SerieOperativa;

    const serializada = JSON.stringify(proyectarSerieApiKey(serie));

    expect(serializada).not.toContain("horizonteInterno");
    expect(serializada).not.toContain("cobertura");
    expect(serializada).not.toContain("penumbra");
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
      ["data", "desde", "fecha", "hasta", "metrica", "metricas", "rango", "unidad", "valor"].sort(),
    );
  });

  it("la cadena serializada no contiene NINGUNA de las claves retiradas el 2026-08-24", () => {
    // Barato y contundente: un `JSON.stringify` de la respuesta completa, con una serie que trae
    // internamente TODO lo que se dejo de publicar (unidadDeConteo, cobertura con penumbra y
    // fechas no comparables, un punto parcial con corteAt).
    const serie: SerieOperativa = {
      ...serieBase(),
      puntos: [
        { fecha: "2026-08-19", valor: 41 },
        { fecha: "2026-08-20", valor: 37 },
        { fecha: "2026-08-21", valor: 12, parcial: true, corteAt: "2026-08-21T18:40:00.000Z" },
      ],
      cobertura: { fechasNoComparables: ["2026-08-19"], penumbra: PENUMBRA },
    };

    const serializada = JSON.stringify(proyectarRespuestaApiKey([serie]));

    for (const clave of CLAVES_RETIRADAS) expect(serializada).not.toContain(clave);
    // Y lo que SI queda, queda: el array se llama `data` y trae el unico dia servible.
    expect(JSON.parse(serializada).metricas[0].data).toEqual([{ fecha: "2026-08-20", valor: 37 }]);
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

  it("cada serie del lote se omite SEGUN SU PROPIA cobertura, no segun la de la primera", () => {
    // `fechasNoComparables` depende del historial que cada metrica necesita, asi que dos
    // metricas del mismo rango pueden no ser legibles en los mismos dias. Aplicar la cobertura de
    // una a todas borraria dias buenos de unas y publicaria dias malos de otras. Antes esto se
    // comprobaba mirando la `cobertura` publicada; ahora se comprueba en lo unico que queda: QUE
    // DIAS SOBREVIVEN en cada serie.
    const dto = proyectarRespuestaApiKey([
      { ...serieBase(), metricaId: "entregas" },
      {
        ...serieBase(),
        metricaId: "tiempo_ciclo",
        cobertura: { fechasNoComparables: ["2026-08-19"], penumbra: PENUMBRA },
      },
    ]);

    expect(fechas(dto.metricas[0]!)).toEqual(["2026-08-19", "2026-08-20"]);
    expect(fechas(dto.metricas[1]!)).toEqual(["2026-08-20"]);
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
