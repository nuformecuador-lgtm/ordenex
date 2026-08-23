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
// LAS CUATRO REGLAS QUE ESTE MODULO HACE ESTRUCTURALES
//
//  1. **Proyeccion campo a campo, JAMAS un spread** (R31). Un `{ ...serie }` publicaria solo,
//     y en silencio, cualquier campo que la 126 (o la 176, o la 215) anada manana al contrato
//     interno. El contrato publico se rompe hacia afuera; el interno se cambia cuando haga
//     falta. Solo una proyeccion explicita mantiene esa asimetria. Hay test que inyecta un campo
//     extra en la serie interna y falla si aparece en la salida.
//  2. **`cobertura` es OBLIGATORIA** (R29), heredado de R34 de la 126
//     (`lib/types/analitica-operativa.ts:12-17`): «cero» y «no se sabe» no pueden ser el mismo
//     numero para el integrador. Declararla opcional permitiria a un consumidor ignorarla por
//     omision, que es exactamente lo que la 126 se nego a permitir.
//  3. **Ni `BigInt` ni `Date` en la salida** (R30). `JSON.stringify` de un `BigInt` LANZA
//     `TypeError` (`lib/types/analitica-operativa.ts:8-11`), y un `Date` crudo serializa a una
//     cadena que depende de quien lo serialice. Aqui todo valor es `number | null` y todo
//     instante es una cadena ISO. Las normalizaciones de abajo son defensa en profundidad: el
//     tipo ya lo promete, pero un tipo no detiene a un productor que mienta.
//  4. **Ni un identificador de mensajero** (R36). La decision P2 (puerta del 2026-08-23)
//     PROHIBE ENTERA la dimension `mensajero` en este canal —ni desagregacion ni filtro—, asi
//     que `PuntoSerie.dimension` NO se proyecta: sin desagregacion no hay dimension que emitir,
//     y publicar el campo solo abriria preguntas. Es la razon por la que la cadena serializada
//     no puede contener un uuid.
//
// El `rango` se publica como `desdeFecha`/`hastaFecha` (`YYYY-MM-DD` calendario de Costa Rica,
// `hasta` INCLUSIVO), nunca como los `Date` de `RangoResuelto`: asi el eco del rango habla el
// MISMO idioma que la entrada del endpoint, que es el que publico la 257 en el listado por API
// key (decision P3). Dos convenciones de fecha en el mismo canal son una trampa.
//
// Modulo puro: sin `next/*`, sin Prisma, sin `process.env`, sin efectos al importarse.

import type { MetricaUnidad, UnidadDeConteo } from "@/lib/analytics/types";
import type { Penumbra, SerieOperativa } from "@/lib/types/analitica-operativa";

/* -------------------------------------------------------------------------- */
/* La forma publica                                                            */
/* -------------------------------------------------------------------------- */

/** Eco del rango efectivo, en el mismo formato que la entrada (P3, R24/R28). */
export interface RangoApiKeyDTO {
  /** `YYYY-MM-DD` calendario CR, inclusivo. */
  readonly desde: string;
  /** `YYYY-MM-DD` calendario CR, INCLUSIVO. */
  readonly hasta: string;
}

/** Un punto de la serie diaria. Sin `dimension`: P2 la prohibe entera en este canal. */
export interface PuntoApiKeyDTO {
  /** `YYYY-MM-DD` calendario CR. */
  readonly fecha: string;
  /** `null` = «no se sabe» (denominador 0). NUNCA `0` como sustituto (R30). */
  readonly valor: number | null;
  /** P5/R28 — el dia en curso, que por construccion no esta cerrado en el rollup. */
  readonly parcial?: true;
  /** ISO del instante usado como cota superior. Solo acompana a `parcial: true`. */
  readonly corteAt?: string;
}

/** Que sabe la respuesta sobre su propia cobertura. OBLIGATORIO (R29). */
export interface CoberturaApiKeyDTO {
  /** Fechas CR del rango que caen bajo el horizonte del historial: no comparables. */
  readonly fechasNoComparables: readonly string[];
  /** Limitacion permanente y declarada, nunca estimada. */
  readonly penumbra: Penumbra;
}

/**
 * R28 — la respuesta `200` de `GET /api/ordenes/api-key/analitica`.
 *
 * Cualquier campo que no este declarado AQUI no se publica, aunque exista en el contrato
 * interno. Anadir uno es una decision de contrato publico; quitarlo, una rotura.
 */
export interface AnaliticaSerieApiKeyDTO {
  /** Id de la metrica, de la lista blanca de `lib/analytics/publicacion-api-key.ts`. */
  readonly metrica: string;
  readonly unidad: MetricaUnidad;
  readonly unidadDeConteo: UnidadDeConteo;
  readonly rango: RangoApiKeyDTO;
  readonly puntos: readonly PuntoApiKeyDTO[];
  /** R29 — OBLIGATORIO. Nunca `cobertura?`. */
  readonly cobertura: CoberturaApiKeyDTO;
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

/**
 * R30 — todo instante sale como cadena ISO. Un `Date` crudo nunca se serializa: se convierte.
 * Lo que no sea `Date` ni cadena no vacia, no se publica.
 */
function normalizarInstante(valor: unknown): string | undefined {
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? undefined : valor.toISOString();
  if (typeof valor === "string" && valor.length > 0) return valor;
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* La proyeccion (R31)                                                         */
/* -------------------------------------------------------------------------- */

/** Proyecta UN punto. Campo a campo; `dimension` se descarta por P2/R36. */
function proyectarPunto(punto: SerieOperativa["puntos"][number]): PuntoApiKeyDTO {
  const base: PuntoApiKeyDTO = {
    fecha: punto.fecha,
    valor: normalizarValor(punto.valor),
  };
  // P5 — `parcial`/`corteAt` son aditivos y OPCIONALES: quien los ignore no se rompe, pero sin
  // ellos el dia en curso se lee como un dia cerrado y el integrador ve una caida que no existe.
  if (punto.parcial !== true) return base;
  const corteAt = normalizarInstante(punto.corteAt);
  return corteAt === undefined
    ? { ...base, parcial: true }
    : { ...base, parcial: true, corteAt };
}

/**
 * R31 — la proyeccion. **Campo a campo, sin `...serie` en ningun sitio.**
 *
 * Si manana `SerieOperativa` gana un campo (la 176 ya le anadio el modo agregado al lado), esta
 * funcion NO lo publica: hay que venir aqui, escribirlo y decidirlo. Ese es el punto entero de
 * que exista.
 */
export function proyectarSerieApiKey(serie: SerieOperativa): AnaliticaSerieApiKeyDTO {
  return {
    metrica: serie.metricaId,
    unidad: serie.unidad,
    unidadDeConteo: serie.unidadDeConteo,
    // Del `RangoResuelto` salen SOLO las dos fechas calendario: los `Date` (`desde`/`hasta`) y el
    // `preset` interno se quedan dentro (R30 y §7.4: el vocabulario interno no se publica).
    rango: {
      desde: serie.rango.desdeFecha,
      hasta: serie.rango.hastaFecha,
    },
    puntos: serie.puntos.map(proyectarPunto),
    // R29 — se construye SIEMPRE, tambien cuando no hay fechas no comparables: la lista vacia es
    // una afirmacion («todo el rango es comparable»), no una ausencia de dato.
    cobertura: {
      fechasNoComparables: [...serie.cobertura.fechasNoComparables],
      penumbra: serie.cobertura.penumbra,
    },
  };
}
