// Feature 267 (T6, design §4.3) — EL CONTRATO PUBLICO de la analitica por el canal de API key.
//
// Este archivo es la frontera entre lo que la analitica SABE (`SerieOperativa`, contrato interno
// de la 126) y lo que un integrador VE. Son dos cosas distintas a proposito, y por eso hay una
// proyeccion en medio en vez de un `JSON.stringify` del objeto interno.
//
// POR QUE VIVE AQUI Y NO EN `lib/types/` (design §2, y no es una preferencia de estilo):
// `lib/types/**` es uno de los caminos que hacen que el gate rapido SE NIEGUE SOLO y obliguen a
// correr `./init.sh` completo (cimientos). El DTO publico de UNA feature no es un cimiento del
// repo: es el contrato de un endpoint. Colocarlo en `lib/types/analitica-operativa.ts` habria
// arrastrado a toda la ficha al gate largo sin comprar nada. No lo muevas alli «porque es un
// tipo».
//
// ⚠ ENMIENDA DEL 2026-08-24 — EL CONTRATO PUBLICO SE SIMPLIFICO ANTES DE LA RELEASE.
// Aqui decia, y YA NO ES CIERTO: que la serie publicaba `unidadDeConteo`, que `cobertura`
// (`fechasNoComparables` + `penumbra`) era OBLIGATORIA en cada serie, y que el punto publicaba
// `parcial`/`corteAt`. Nada de eso viaja ya. Lo que se publica de una serie es `metrica`,
// `unidad` y `data`; lo que se publica de un punto es `fecha` y `valor`. Los tres campos que
// desaparecieron NO se borraron del contrato interno de la 126: siguen existiendo dentro, y esta
// proyeccion los LEE —ver la regla 2— para decidir que puntos son publicables.
//
// LAS CUATRO REGLAS QUE ESTE MODULO HACE ESTRUCTURALES
//
//  1. **Proyeccion campo a campo, JAMAS un spread** (R31). Un `{ ...serie }` publicaria solo,
//     y en silencio, cualquier campo que la 126 (o la 176, o la 215) anada manana al contrato
//     interno. El contrato publico se rompe hacia afuera; el interno se cambia cuando haga
//     falta. Solo una proyeccion explicita mantiene esa asimetria. Hay test que inyecta un campo
//     extra en la serie interna y falla si aparece en la salida.
//
//  2. **`data` OMITE los dias que no se saben; no los pone en cero** (enmienda 2026-08-24, en
//     sustitucion de la antigua R29). Este es el corazon del contrato nuevo y la razon de que
//     quitar `cobertura` y `parcial` no haya sido una perdida de informacion:
//       - un dia de `cobertura.fechasNoComparables` vale cero porque NO HAY DATOS bajo el
//         horizonte del historial, no porque no hubiera operacion;
//       - el dia en curso (`punto.parcial === true`) no esta cerrado en el rollup, asi que
//         siempre se lee mas bajo que el anterior.
//     Publicarlos sin marca convertiria dos «no se sabe» en ceros silenciosos y el integrador
//     leeria una caida de la operacion que no existe. Sin las marcas, LA AUSENCIA es el unico
//     signo honesto que queda: un dia sin dato no aparece en `data`, y nadie ve un cero que no
//     ocurrio. Es la misma negativa de la 126/R34 («cero» y «no se sabe» no son el mismo numero),
//     expresada con la forma en vez de con un campo aparte.
//     `data` PUEDE quedar VACIO, y eso es un `200` legitimo: no es un error ni un estado
//     imposible. No anadas un throw ahi (el unico throw de este modulo cubre otra cosa: una
//     respuesta sin NINGUNA serie, que si es un bug nuestro).
//
//  3. **Ni `BigInt` ni `Date` en la salida** (R30). `JSON.stringify` de un `BigInt` LANZA
//     `TypeError` (`lib/types/analitica-operativa.ts:8-11`), y un `Date` crudo serializa a una
//     cadena que depende de quien lo serialice. Aqui todo valor es `number | null` y toda fecha
//     es una cadena `YYYY-MM-DD`. `normalizarValor` es defensa en profundidad: el tipo ya lo
//     promete, pero un tipo no detiene a un productor que mienta.
//     `valor: null` SIGUE SIGNIFICANDO «no se sabe» (denominador 0) y NUNCA se sustituye por `0`:
//     eso no cambio con la enmienda. La omision de la regla 2 es para el dia que no tiene dato
//     COMPARABLE; el `null` es para el dia que si tiene dato y ese dato es indefinido.
//
//  4. **Ni un identificador de mensajero** (R36). La decision P2 (puerta del 2026-08-23)
//     PROHIBE ENTERA la dimension `mensajero` en este canal —ni desagregacion ni filtro—, asi
//     que `PuntoSerie.dimension` NO se proyecta: sin desagregacion no hay dimension que emitir,
//     y publicar el campo solo abriria preguntas. Es la razon por la que la cadena serializada
//     no puede contener un uuid.
//
// EL `rango` ES EL ECO DE LO QUE SE PIDIO, Y NO SE RECORTA (decision del 2026-08-24, escrita
// aqui para que nadie la «arregle»). Con la regla 2, es normal que el ultimo dia del rango no
// aparezca en `data`. La tentacion es recortar `hasta` al ultimo dia servible; no se hace, y por
// una razon concreta: quien pida `desde=hoy&hasta=hoy` —el patron exacto de un integrador que
// consulta a diario— recibiria un rango INVERTIDO, o un 422, por haber preguntado algo
// perfectamente legitimo. Con el eco intacto ese caso responde `200` con `data: []` en cada
// metrica, que es la verdad: «pediste hoy, y hoy todavia no esta cerrado».
//
// El `rango` se publica como `desdeFecha`/`hastaFecha` (`YYYY-MM-DD` calendario de Costa Rica,
// `hasta` INCLUSIVO), nunca como los `Date` de `RangoResuelto`: asi el eco del rango habla el
// MISMO idioma que la entrada del endpoint, que es el que publico la 257 en el listado por API
// key (decision P3). Dos convenciones de fecha en el mismo canal son una trampa.
//
// P4-bis (2026-08-23) — LA RESPUESTA ES UN LOTE. El endpoint sirve N metricas de una vez, asi que
// la unidad publicada ya no es la serie suelta sino el SOBRE `AnaliticaRespuestaApiKeyDTO`: el
// `rango` UNA vez en la raiz y las series en `metricas[]`. La forma es la misma se pida una
// metrica o diez: un contrato que cambiara de forma segun cuantas se pidieron obligaria a
// escribir dos parsers para el mismo endpoint.
//
// DONDE QUEDO LA INFORMACION QUE YA NO VIAJA: `unidadDeConteo` sigue en el catalogo y en el
// contrato interno, y su contenido se documenta UNA vez en la descripcion del endpoint
// (`lib/api/openapi-spec.ts` y su espejo `.yaml`): `entregas`, `devoluciones`, `rechazos` y las
// tres tasas cuentan GESTIONES, no ordenes, y dos metricas de unidad de conteo distinta no son
// sumables. Es un hecho del catalogo, no de la respuesta: repetirlo en cada payload no lo hacia
// mas cierto.
//
// Modulo puro: sin `next/*`, sin Prisma, sin `process.env`, sin efectos al importarse.

import type { MetricaUnidad } from "@/lib/analytics/types";
import type { SerieOperativa } from "@/lib/types/analitica-operativa";

/* -------------------------------------------------------------------------- */
/* La forma publica                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Eco del rango efectivo, en el mismo formato que la entrada (P3, R24/R28).
 *
 * P4-bis (2026-08-23) — VIVE EN LA RAIZ DE LA RESPUESTA, NO DENTRO DE CADA SERIE. Con el lote,
 * las N series se resuelven con EL MISMO `raw` y EL MISMO instante, asi que su rango es el MISMO
 * por construccion (R48). Repetirlo N veces invitaria a leerlo como si pudiera diferir entre
 * metricas, que es justo la pregunta que este contrato no quiere abrir.
 *
 * 2026-08-24 — ES EL ECO DE LO PEDIDO, SIN RECORTAR, aunque `data` no llegue hasta `hasta`. Ver
 * la cabecera: recortarlo romperia `desde=hoy&hasta=hoy`.
 */
export interface RangoApiKeyDTO {
  /** `YYYY-MM-DD` calendario CR, inclusivo. */
  readonly desde: string;
  /** `YYYY-MM-DD` calendario CR, INCLUSIVO. */
  readonly hasta: string;
}

/**
 * Un punto de la serie diaria. EXACTAMENTE dos campos (enmienda 2026-08-24).
 *
 * Sin `dimension`: P2 la prohibe entera en este canal. Sin `parcial` ni `corteAt`: el dia en
 * curso ya no se marca porque ya no se publica — se OMITE de `data` (regla 2 de la cabecera).
 */
export interface PuntoApiKeyDTO {
  /** `YYYY-MM-DD` calendario CR. */
  readonly fecha: string;
  /** `null` = «no se sabe» (denominador 0). NUNCA `0` como sustituto (R30). */
  readonly valor: number | null;
}

/**
 * R28 — UNA de las series de la respuesta `200`.
 *
 * Cualquier campo que no este declarado AQUI no se publica, aunque exista en el contrato
 * interno. Anadir uno es una decision de contrato publico; quitarlo, una rotura.
 *
 * P4-bis — SIN `rango`: el rango es de la RESPUESTA, no de cada serie (ver `RangoApiKeyDTO`).
 * 2026-08-24 — SIN `unidadDeConteo` (es del catalogo, se documenta en el endpoint) y SIN
 * `cobertura` (su informacion la lleva ahora la OMISION de puntos en `data`).
 */
export interface AnaliticaSerieApiKeyDTO {
  /** Id de la metrica, de la lista blanca de `lib/analytics/publicacion-api-key.ts`. */
  readonly metrica: string;
  readonly unidad: MetricaUnidad;
  /**
   * Los dias SERVIBLES del rango, en orden. Puede estar VACIO y eso es un `200` valido: se
   * omiten el dia en curso y los dias bajo el horizonte del historial (regla 2 de la cabecera).
   */
  readonly data: readonly PuntoApiKeyDTO[];
}

/**
 * R45/R28 — la respuesta `200` de `GET /api/ordenes/api-key/analitica`, SIEMPRE con esta forma.
 *
 * Tambien cuando se pide UNA sola metrica: una respuesta que cambiara de forma segun cuantas
 * metricas se pidieron obligaria al integrador a escribir dos parsers para el mismo endpoint.
 * El array conserva el ORDEN pedido (y el de la lista blanca cuando se pidio `all`), R47.
 */
export interface AnaliticaRespuestaApiKeyDTO {
  /** R48 — comun a todas las series: mismo `raw`, mismo instante, mismo rango resuelto. */
  readonly rango: RangoApiKeyDTO;
  /** Una entrada por metrica concedida, en el orden pedido. Nunca vacio. */
  readonly metricas: readonly AnaliticaSerieApiKeyDTO[];
}

/* -------------------------------------------------------------------------- */
/* Normalizaciones (defensa en profundidad de R30)                             */
/* -------------------------------------------------------------------------- */

/**
 * R30 — el unico valor numerico que sale de aqui es un `number` finito; todo lo demas es `null`.
 *
 * El tipo interno ya promete `number | null`, pero el rollup trabaja con `BigInt`
 * (`seg_ciclo_acum`) y un `BigInt` que se colase haria LANZAR a `JSON.stringify` en produccion,
 * convirtiendo un dato raro en un 500. `NaN` e `Infinity` tampoco son JSON validos: `stringify`
 * los emite como `null` de todos modos, asi que se declara aqui en vez de dejarlo al azar.
 */
function normalizarValor(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

/* -------------------------------------------------------------------------- */
/* La proyeccion (R31)                                                         */
/* -------------------------------------------------------------------------- */

/** Proyecta UN punto. Campo a campo; `dimension` se descarta por P2/R36. */
function proyectarPunto(punto: SerieOperativa["puntos"][number]): PuntoApiKeyDTO {
  return {
    fecha: punto.fecha,
    valor: normalizarValor(punto.valor),
  };
}

/**
 * R31 — la proyeccion. **Campo a campo, sin `...serie` en ningun sitio.**
 *
 * Si manana `SerieOperativa` gana un campo (la 176 ya le anadio el modo agregado al lado), esta
 * funcion NO lo publica: hay que venir aqui, escribirlo y decidirlo. Ese es el punto entero de
 * que exista.
 *
 * Y aqui vive la regla 2 de la cabecera: `cobertura` y `parcial` NO se publican, pero SI SE
 * LEEN. Cada punto que cae en uno de los dos casos se DESCARTA de `data` en vez de salir como un
 * numero indistinguible de un dia cerrado con poca operacion. El orden de los que quedan se
 * conserva tal cual venia.
 */
export function proyectarSerieApiKey(serie: SerieOperativa): AnaliticaSerieApiKeyDTO {
  const noComparables = new Set(serie.cobertura.fechasNoComparables);
  const data: PuntoApiKeyDTO[] = [];
  for (const punto of serie.puntos) {
    // El dia en curso no esta cerrado en el rollup: publicarlo sin marca seria publicar una
    // caida que no ocurrio.
    if (punto.parcial === true) continue;
    // Bajo el horizonte del historial la cifra vale cero por falta de datos, no por falta de
    // operacion. Tampoco se publica.
    if (noComparables.has(punto.fecha)) continue;
    data.push(proyectarPunto(punto));
  }
  return {
    metrica: serie.metricaId,
    unidad: serie.unidad,
    // Puede quedar vacio. Es un 200 legitimo, no un estado imposible: ver la cabecera.
    data,
  };
}

/**
 * P4-bis/R45 — el SOBRE de la respuesta: el rango una vez, y las N series en el orden pedido.
 *
 * Las dos invariantes que esta funcion NO da por supuestas, porque un 500 honesto es mejor que
 * una respuesta que miente:
 *
 *  1. **La lista de SERIES nunca esta vacia.** El cascaron ya rechaza `metricas` vacio con un
 *     422 y `all` expande a una lista no vacia, asi que llegar aqui sin series es un estado
 *     imposible: se lanza en vez de publicar `{ metricas: [] }`, que un integrador leeria como
 *     «no hay datos» cuando lo que hubo fue un bug nuestro.
 *     ⚠ NO CONFUNDIR con una serie cuyo `data` quede vacio: eso es normal y correcto (regla 2 de
 *     la cabecera). Cero SERIES es un bug; cero PUNTOS es una respuesta honesta.
 *  2. **Todas las series comparten rango** (R48). Lo garantiza el borde llamando UNA vez al
 *     reloj para todo el lote; si algun dia dejara de hacerlo, publicar el rango de la primera
 *     serie como si fuera el de todas seria una mentira silenciosa. Se comprueba, y se lanza.
 */
export function proyectarRespuestaApiKey(
  series: readonly SerieOperativa[],
): AnaliticaRespuestaApiKeyDTO {
  const primera = series[0];
  if (primera === undefined) {
    throw new Error("analitica api key: no se publica una respuesta sin ninguna serie");
  }
  const rango: RangoApiKeyDTO = {
    // Del `RangoResuelto` salen SOLO las dos fechas calendario: los `Date` (`desde`/`hasta`) y el
    // `preset` interno se quedan dentro (R30 y §7.4: el vocabulario interno no se publica). Y se
    // publican SIN RECORTAR, aunque `data` no llegue hasta `hasta` (ver cabecera).
    desde: primera.rango.desdeFecha,
    hasta: primera.rango.hastaFecha,
  };
  for (const serie of series) {
    if (serie.rango.desdeFecha !== rango.desde || serie.rango.hastaFecha !== rango.hasta) {
      throw new Error("analitica api key: las series del lote no comparten rango (R48)");
    }
  }
  return { rango, metricas: series.map(proyectarSerieApiKey) };
}
