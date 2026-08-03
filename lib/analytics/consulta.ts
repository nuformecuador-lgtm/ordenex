// Feature 122 (T4.1) — EL UNICO PUNTO DE ENTRADA. Aqui vive la garantia.
//
// El objetivo de diseno de esta feature no es "que el recorte se aplique", sino que
// OLVIDARLO NO COMPILE. Cuatro piezas que se sostienen entre si:
//
//  1. El orden no se puede invertir porque no hay dos llamadas que ordenar: hay UNA.
//     `prepararConsultaAnalitica` parsea el filtro, resuelve el rango y resuelve el
//     alcance, en ese orden, dentro de una sola funcion. Si el parseo falla, ni siquiera
//     se pregunta por el alcance (R19): una entrada invalida no puede usarse para sondear
//     que metricas existen ni que ve un rol.
//  2. El recorte no se puede omitir porque el unico valor que sale de aqui ya lo lleva
//     dentro. NO existe funcion publica que devuelva "filtro parseado sin alcance".
//  3. El valor no se puede falsificar: `ConsultaAnalitica` lleva una propiedad cuyo
//     nombre es un `unique symbol` NO EXPORTADO. Un literal
//     `{ metrica, filtro, rango, alcance }` no es asignable a `ConsultaAnalitica` desde
//     ningun otro modulo (R16, probado con `@ts-expect-error`).
//  4. El tipo se propaga hacia abajo: las firmas de 126/127 reciben `ConsultaAnalitica`,
//     no `AnaliticaFiltroInput`. Un repositorio que "se olvide" del recorte no tiene de
//     donde sacar el filtro: falla el BUILD, no los datos (R17).
//
// La quinta pieza, para lo que los tipos no alcanzan (SQL crudo, `$queryRaw`, un servicio
// que reconstruya el filtro a mano), es el guardia estructural
// `alcance-obligatorio.guardia.test.ts` (R18).

import { parseAnaliticaFiltro } from "@/lib/analytics/filters";
import type { AnaliticaFiltroInput } from "@/lib/analytics/filters";
import { resolverRango } from "@/lib/analytics/ranges";
import { getMetrica } from "@/lib/analytics/metrics";
import type { MetricaCatalogo } from "@/lib/analytics/metrics";
import { esRolAnalitica, resolverAlcance } from "@/lib/analytics/alcance";
import type { ActorAnalitica, AlcanceDatos, MotivoDenegacion } from "@/lib/analytics/alcance";
import { politicaIdentidadMensajero } from "@/lib/analytics/identidad";
import type { PoliticaIdentidad } from "@/lib/analytics/identidad";
import type { EntradaRango, RangoResuelto } from "@/lib/analytics/types";

/**
 * La marca. NO se exporta y no hay forma de nombrarla desde fuera de este archivo, que es
 * justo lo que impide construir una `ConsultaAnalitica` a mano.
 */
declare const marcaConsulta: unique symbol;

/**
 * Todo lo que un repositorio de analitica necesita para consultar, YA validado y YA
 * recortado. Es opaco: se recibe, se lee y se usa; no se fabrica.
 */
export interface ConsultaAnalitica {
  readonly [marcaConsulta]: true;
  readonly metrica: MetricaCatalogo;
  /**
   * El filtro del cliente YA INTERSECADO con el alcance (R20). Cinturon y tirantes:
   * aunque un servicio ignorase `alcance`, el filtro que lleva dentro ya esta recortado.
   */
  readonly filtro: AnaliticaFiltroInput;
  readonly rango: RangoResuelto;
  /** Nunca "denegado": si lo fuera, no habria objeto que devolver. */
  readonly alcance: AlcanceDatos;
  /** D5/R38 — `seudonima` obliga a la 126/134 a sustituir ids antes de serializar. */
  readonly politicaIdentidad: PoliticaIdentidad;
}

/**
 * Resultado del punto de entrada. `forbidden` es un estado de primera clase (patron del
 * repo, `IOrdenService.ts:31`): el borde lo traduce a 403 y NUNCA a `ok` con ceros, a
 * lista vacia ni a 200 con `data: []` (D7/R41), para que la 133 pueda distinguir
 * "prohibido" de "sin datos".
 */
export type PreparacionAnalitica =
  | { readonly status: "ok"; readonly consulta: ConsultaAnalitica }
  | { readonly status: "validation_error"; readonly fieldErrors: Record<string, string[]> }
  | { readonly status: "forbidden"; readonly motivo: MotivoDenegacion };

/**
 * Parsea, resuelve el rango, resuelve el alcance e interseca el filtro. En ese orden y
 * sin vias alternativas.
 *
 * `now` es inyectable (patron de `resolverRango`) y no hay ningun `Date.now()` escondido:
 * misma entrada, mismo resultado (R32).
 */
export function prepararConsultaAnalitica(
  raw: unknown,
  actor: ActorAnalitica | null,
  metricaId: string,
  now?: Date,
): PreparacionAnalitica {
  // (1) PARSEAR. R19: si falla, se devuelve `validation_error` y NO se resuelve alcance;
  // el motivo de denegacion no se revela, porque una entrada malformada no puede servir
  // para sondear el catalogo ni los permisos de un rol.
  const parseado = parseAnaliticaFiltro(raw);
  if (parseado.status !== "ok") {
    return { status: "validation_error", fieldErrors: parseado.fieldErrors };
  }

  // (2) RANGO.
  const rango = resolverRango(entradaDeRango(parseado.filtro), now);

  // (3) ALCANCE.
  const resolucion = resolverAlcance(actor, metricaId);
  if (resolucion.estado === "denegado") {
    return { status: "forbidden", motivo: resolucion.motivo };
  }

  // (4) PRECEDENCIA DEL RECORTE SOBRE EL FILTRO DEL CLIENTE (R20/R21, D1).
  const filtro = recortarFiltro(parseado.filtro, resolucion.alcance);
  if (filtro === null) {
    return { status: "forbidden", motivo: "filtro_fuera_de_alcance" };
  }

  // La metrica existe: `resolverAlcance` ya devolvio `metrica_desconocida` si no.
  const metrica = getMetrica(metricaId);
  if (!metrica) return { status: "forbidden", motivo: "metrica_desconocida" };

  return {
    status: "ok",
    consulta: {
      metrica,
      filtro,
      rango,
      alcance: resolucion.alcance,
      politicaIdentidad: politicaIdentidadDe(actor),
    } as ConsultaAnalitica,
  };
}

/** El filtro validado ya garantiza la coherencia preset/fechas (los 4 `refine` de la 135). */
function entradaDeRango(filtro: AnaliticaFiltroInput): EntradaRango {
  if (filtro.rango === "personalizado") {
    return { preset: "personalizado", desde: filtro.desde ?? "", hasta: filtro.hasta ?? "" };
  }
  return { preset: filtro.rango };
}

/**
 * Interseca el filtro del cliente con el alcance. El filtro NO puede ampliar el alcance
 * en ningun caso (R20).
 *
 * Devuelve `null` cuando la interseccion queda VACIA —el actor pidio explicitamente datos
 * ajenos—, y entonces se falla cerrado con 403 (D1). No se devuelve `ok` con conjunto
 * vacio ni se recorta en silencio: un tablero vacio se reporta como bug de datos y
 * esconde el intento, y el id lo aporto el propio solicitante.
 *
 * Cuando el cliente no nombra la dimension recortada, el recorte se ESCRIBE igualmente en
 * el filtro: el consumidor recibe el filtro ya acotado aunque ignore `alcance`.
 */
function recortarFiltro(
  filtro: AnaliticaFiltroInput,
  alcance: AlcanceDatos,
): AnaliticaFiltroInput | null {
  switch (alcance.tipo) {
    case "global":
      return filtro;
    case "zona":
      return interseca(filtro.zona_id, alcance.zonaId)
        ? { ...filtro, zona_id: [alcance.zonaId] }
        : null;
    case "tienda":
      return interseca(filtro.tienda_id, alcance.tiendaId)
        ? { ...filtro, tienda_id: [alcance.tiendaId] }
        : null;
    case "mensajero":
      // R28: el cubo `MENSAJERO_SIN_ASIGNAR` no sobrevive a esta interseccion, y es lo
      // correcto: las ordenes sin mensajero asignado NO son "propias" de nadie.
      return interseca(filtro.mensajero_id, alcance.mensajeroId)
        ? { ...filtro, mensajero_id: [alcance.mensajeroId] }
        : null;
  }
}

/**
 * La interseccion de la lista pedida con el alcance (un unico id) es no vacia solo si la
 * lista contiene ese id. Sin lista => no hay conflicto: el recorte simplemente se aplica.
 */
function interseca(pedidos: readonly string[] | undefined, permitido: string): boolean {
  return pedidos === undefined || pedidos.includes(permitido);
}

/**
 * R38 — la politica sale del rol del actor. Si el rol no fuera de analitica no habria
 * llegado hasta aqui (`resolverAlcance` lo denego antes); el `real` de este fallback es
 * inalcanzable y, en todo caso, no concede acceso a nada: solo dice como se etiqueta.
 */
function politicaIdentidadDe(actor: ActorAnalitica | null): PoliticaIdentidad {
  if (actor && esRolAnalitica(actor.rol)) return politicaIdentidadMensajero(actor.rol);
  return "real";
}
