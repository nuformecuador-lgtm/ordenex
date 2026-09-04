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
// ⚠ 2026-09-04 — `cobertura` Y `parcial` VUELVEN; `unidadDeConteo` NO.
// La enmienda del 2026-08-24 retiro los tres a la vez y aqui se decia que «nada de eso viaja
// ya». Hoy vuelven dos de los tres, y no por simetria: vuelven los que el front usa para MARCAR
// un dia que no esta cerrado (`cobertura` en la serie, `parcial`/`corteAt` en el punto), que es
// lo que hace posible publicar ese dia en vez de omitirlo (regla 2). `unidadDeConteo` se queda
// fuera: es un hecho del CATALOGO, no de la respuesta, y se documenta una vez en la descripcion
// del endpoint. Repetirlo en cada payload no lo hacia mas cierto, y eso no ha cambiado.
// Lo que publica una serie es `metrica`, `unidad`, `data` y `cobertura`; lo que publica un punto
// es `fecha`, `valor` y —solo el dia en curso— `parcial` y `corteAt`.
//
// LAS CUATRO REGLAS QUE ESTE MODULO HACE ESTRUCTURALES
//
//  1. **Proyeccion campo a campo, JAMAS un spread** (R31). Un `{ ...serie }` publicaria solo,
//     y en silencio, cualquier campo que la 126 (o la 176, o la 215) anada manana al contrato
//     interno. El contrato publico se rompe hacia afuera; el interno se cambia cuando haga
//     falta. Solo una proyeccion explicita mantiene esa asimetria. Hay test que inyecta un campo
//     extra en la serie interna y falla si aparece en la salida.
//
//  2. **`data` PUBLICA todos los dias del rango, MARCANDO los que no estan cerrados**
//     (2026-09-04, en sustitucion de la enmienda del 2026-08-24). El canal por API key y la
//     pantalla de analitica sirven ahora EXACTAMENTE lo mismo, que es lo que se pidio.
//
//     ⏳ AQUI DECIA, y ya no es cierto: «`data` OMITE los dias que no se saben; no los pone en
//     cero (...). Sin las marcas, LA AUSENCIA es el unico signo honesto que queda: un dia sin
//     dato no aparece en `data`, y nadie ve un cero que no ocurrio».
//
//     EL DIAGNOSTICO DE AQUELLA ENMIENDA SIGUE SIENDO CORRECTO y no se revierte: un dia bajo el
//     horizonte del historial vale cero por FALTA DE DATOS, y el dia en curso se lee mas bajo
//     porque no esta cerrado en el rollup. Publicar cualquiera de los dos SIN MARCA sigue siendo
//     inaceptable: el integrador leeria una caida de la operacion que no ocurrio. Lo que cambia
//     es el REMEDIO. La omision era el unico signo honesto disponible mientras el contrato no
//     tuviera marcas; ahora las tiene, y son las MISMAS que ya recibe el front:
//       - `parcial: true` + `corteAt` en el punto del dia en curso (`PuntoSerie`, 126/D6/R18);
//       - `cobertura.fechasNoComparables` en la serie (126/R34, feature 125).
//
//     POR QUE LA MARCA ES MEJOR QUE LA AUSENCIA, medido el 2026-09-04 contra produccion: un
//     integrador cargo 60 ordenes por la manana y la analitica no le devolvia NADA de ese dia.
//     La ausencia es honesta solo si quien lee sabe que existe; para quien no ha leido esta
//     cabecera, «hoy no aparece» y «hoy fue cero» son indistinguibles — el mismo fallo mudo que
//     la omision queria evitar, movido de sitio. La marca, en cambio, dice AMBAS cosas a la vez:
//     el numero y el hecho de que no esta cerrado. Y la pantalla lleva desde la 126 haciendo
//     exactamente eso, sin que a nadie le parezca deshonesto.
//
//     `data` PUEDE seguir quedando VACIO —un rango entero sin puntos—, y eso es un `200`
//     legitimo: no es un error ni un estado imposible. No anadas un throw ahi (el unico throw de
//     este modulo cubre otra cosa: una respuesta sin NINGUNA serie, que si es un bug nuestro).
//
//     ⚠️ ES UN CAMBIO DE CONTRATO PUBLICO OBSERVABLE, y aditivo solo a medias: `parcial`,
//     `corteAt` y `cobertura` son campos NUEVOS (nadie se rompe por recibirlos), pero `data`
//     pasa a traer dias que antes NO venian. Un integrador que sume `data` a ciegas para «el
//     total del periodo» empezara a incluir un dia a medias en esa suma. Hay que AVISAR A LOS
//     INTEGRADORES ANTES DE DESPLEGAR — misma obligacion que 239, 268 y el alta de
//     `en_preparacion`: bloquea el despliegue, no el codigo.
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
// aqui para que nadie la «arregle»). La tentacion es recortar `hasta` al ultimo dia cerrado; no
// se hace, y por una razon concreta: quien pida `desde=hoy&hasta=hoy` —el patron exacto de un
// integrador que consulta a diario— recibiria un rango INVERTIDO, o un 422, por haber preguntado
// algo perfectamente legitimo. Con el eco intacto ese caso responde `200` con el punto de hoy
// MARCADO `parcial` (2026-09-04), que es la verdad completa: «este es el numero de hoy, y hoy
// todavia no esta cerrado». Antes ese mismo caso respondia `data: []`, que era media verdad.
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
import type { Penumbra, SerieOperativa } from "@/lib/types/analitica-operativa";

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
 * Un punto de la serie diaria.
 *
 * Sin `dimension`: P2 la prohibe entera en este canal, y eso NO cambia.
 *
 * 2026-09-04 — CON `parcial` y `corteAt`, como los recibe el front: el dia en curso vuelve a
 * publicarse (regla 2 de la cabecera) y estas dos son las marcas que impiden leerlo como un dia
 * cerrado con poca operacion. Son OPCIONALES y solo aparecen en ese punto: un dia cerrado trae
 * `fecha` y `valor` y nada mas, exactamente igual que antes de este cambio.
 */
export interface PuntoApiKeyDTO {
  /** `YYYY-MM-DD` calendario CR. */
  readonly fecha: string;
  /** `null` = «no se sabe» (denominador 0). NUNCA `0` como sustituto (R30). */
  readonly valor: number | null;
  /**
   * `true` SOLO en el dia en curso: no esta cerrado en el rollup, asi que se lee mas bajo que un
   * dia completo y NO es comparable con los demas puntos de la serie. Ausente en todo lo demas
   * (nunca `false`: el contrato interno de la 126 lo declara `parcial?: true`, y publicar un
   * `false` inventaria un tercer estado que dentro no existe).
   */
  readonly parcial?: true;
  /** ISO-8601 del instante usado como cota superior. Solo acompana a `parcial: true`. */
  readonly corteAt?: string;
}

/**
 * 2026-09-04 — lo que la serie sabe sobre su propia cobertura, igual que el contrato interno de
 * la 126 (R34) y que lo que ya recibe el front.
 *
 * Es la marca de los dias que valen cero por FALTA DE DATOS y no por falta de operacion, y su
 * vuelta es lo que permite publicarlos en vez de omitirlos. Se proyecta campo a campo como todo
 * lo demas: `Cobertura` interna no se reenvia con un spread.
 */
export interface CoberturaApiKeyDTO {
  /**
   * Fechas CR del rango que caen BAJO el horizonte del historial: ahi no hay filas de
   * `orden_historial_estado`, asi que su `valor` es cero por ausencia de dato. Suele estar vacio.
   */
  readonly fechasNoComparables: readonly string[];
  /**
   * Limitacion PERMANENTE del historico, nunca estimada: las ordenes vivas el dia en que nacio
   * el historial y que jamas volvieron a transicionar no entran en ningun cubo. Literal cerrado.
   */
  readonly penumbra: Penumbra;
}

/**
 * R28 — UNA de las series de la respuesta `200`.
 *
 * Cualquier campo que no este declarado AQUI no se publica, aunque exista en el contrato
 * interno. Anadir uno es una decision de contrato publico; quitarlo, una rotura.
 *
 * P4-bis — SIN `rango`: el rango es de la RESPUESTA, no de cada serie (ver `RangoApiKeyDTO`).
 * 2026-08-24 — SIN `unidadDeConteo`: es del catalogo, se documenta en el endpoint.
 * 2026-09-04 — CON `cobertura`, que vuelve para marcar los dias no comparables en vez de
 * omitirlos (regla 2). `unidadDeConteo` sigue fuera.
 */
export interface AnaliticaSerieApiKeyDTO {
  /** Id de la metrica, de la lista blanca de `lib/analytics/publicacion-api-key.ts`. */
  readonly metrica: string;
  readonly unidad: MetricaUnidad;
  /**
   * TODOS los dias del rango con dato, en orden, incluido el dia en curso (marcado `parcial`).
   * Puede estar VACIO y eso sigue siendo un `200` valido.
   */
  readonly data: readonly PuntoApiKeyDTO[];
  /** Que dias del rango no son comparables, y por que. OBLIGATORIA: nunca `cobertura?`. */
  readonly cobertura: CoberturaApiKeyDTO;
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

/**
 * R30 — `corteAt` sale SIEMPRE como cadena ISO-8601, o no sale.
 *
 * El servicio ya lo emite asi (`AnaliticaOperativaService` hace `.toISOString()` antes de
 * ponerlo en el punto), pero un tipo no detiene a un productor que mienta y un `Date` crudo
 * serializa distinto segun quien lo serialice — que es justo lo que R30 prohibe. Un valor que no
 * sea `string` ni `Date` se descarta: mejor un punto sin `corteAt` que un `corteAt` inventado.
 */
function normalizarCorteAt(corteAt: unknown): string | undefined {
  if (typeof corteAt === "string") return corteAt;
  if (corteAt instanceof Date) return corteAt.toISOString();
  return undefined;
}

/**
 * Proyecta UN punto. Campo a campo; `dimension` se descarta por P2/R36.
 *
 * 2026-09-04 — `parcial` y `corteAt` viajan, y viajan JUNTOS o no viajan: `corteAt` sin `parcial`
 * no significa nada (todo dia cerrado tiene un corte implicito, el fin del dia) y `parcial` es lo
 * que le da sentido. Se emiten solo cuando el punto trae `parcial === true`, exactamente la
 * condicion con la que el contrato interno de la 126 los emite.
 */
function proyectarPunto(punto: SerieOperativa["puntos"][number]): PuntoApiKeyDTO {
  const base = {
    fecha: punto.fecha,
    valor: normalizarValor(punto.valor),
  };
  if (punto.parcial !== true) return base;
  const corteAt = normalizarCorteAt(punto.corteAt);
  return { ...base, parcial: true, ...(corteAt !== undefined ? { corteAt } : {}) };
}

/**
 * Proyecta la cobertura. Campo a campo, por la MISMA razon que la serie (R31): `Cobertura` es
 * contrato interno y puede ganar campos.
 *
 * `fechasNoComparables` se copia a un array nuevo y se filtra a cadenas: es lo unico que este
 * canal publica de ella, y reenviar el array interno dejaria que un productor colase ahi
 * cualquier cosa.
 */
function proyectarCobertura(cobertura: SerieOperativa["cobertura"]): CoberturaApiKeyDTO {
  return {
    fechasNoComparables: cobertura.fechasNoComparables.filter((f) => typeof f === "string"),
    penumbra: cobertura.penumbra,
  };
}

/**
 * R31 — la proyeccion. **Campo a campo, sin `...serie` en ningun sitio.**
 *
 * Si manana `SerieOperativa` gana un campo (la 176 ya le anadio el modo agregado al lado), esta
 * funcion NO lo publica: hay que venir aqui, escribirlo y decidirlo. Ese es el punto entero de
 * que exista.
 *
 * Y aqui vive la regla 2 de la cabecera. ⏳ 2026-09-04 — ANTES DECIA: «`cobertura` y `parcial`
 * NO se publican, pero SI SE LEEN. Cada punto que cae en uno de los dos casos se DESCARTA de
 * `data`». Ya no se descarta ninguno: los dos casos se MARCAN y el integrador recibe lo mismo
 * que la pantalla. `unidadDeConteo` sigue sin publicarse, y `dimension` tampoco (P2/R36): el
 * hecho de que esta proyeccion vuelva a copiar mas campos no la convierte en un spread.
 *
 * El orden de los puntos se conserva tal cual venia, como siempre.
 */
export function proyectarSerieApiKey(serie: SerieOperativa): AnaliticaSerieApiKeyDTO {
  return {
    metrica: serie.metricaId,
    unidad: serie.unidad,
    // Puede quedar vacio si la serie no trajo puntos. Sigue siendo un 200 legitimo.
    data: serie.puntos.map(proyectarPunto),
    cobertura: proyectarCobertura(serie.cobertura),
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
