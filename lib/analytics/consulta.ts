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
import {
  esRolAnalitica,
  esRolAnaliticaIntegracion,
  resolverAlcance,
} from "@/lib/analytics/alcance";
import type {
  ActorAnalitica,
  AlcanceDatos,
  CanalAnalitica,
  MotivoDenegacion,
} from "@/lib/analytics/alcance";
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
  canal: CanalAnalitica = "interno",
): PreparacionAnalitica {
  // (1) PARSEAR. R19: si falla, se devuelve `validation_error` y NO se resuelve alcance;
  // el motivo de denegacion no se revela, porque una entrada malformada no puede servir
  // para sondear el catalogo ni los permisos de un rol.
  //
  // 2026-08-31 — EL TOPE DE VENTANA (`RANGO_TOPE_DIAS`) NO SE APLICA AL CANAL `api_key`, y es
  // la UNICA diferencia de validacion entre los dos canales. Motivo: ese canal responde el
  // HISTORICO COMPLETO cuando el integrador no manda fechas, y un historico deja de caber en
  // 366 dias en cuanto la operacion pasa del anio. El canal interno lo conserva porque su
  // consumidor es una grafica con techo de puntos (`TOPE_PUNTOS_SERIE`), no un integrador.
  // La decision se escribe AQUI —el unico sitio que ya conoce el canal— y no dentro de
  // `filters.ts`, que sigue sin saber que canales existen.
  const parseado = parseAnaliticaFiltro(raw, { aplicarTopeVentana: canal !== "api_key" });
  if (parseado.status !== "ok") {
    return { status: "validation_error", fieldErrors: parseado.fieldErrors };
  }

  // (2) RANGO.
  const rango = resolverRango(entradaDeRango(parseado.filtro), now);

  // (3) ALCANCE. Feature 267 — `canal` se REENVIA tal cual, sin interpretarlo aqui: el
  // unico sitio que decide que puede ver un canal es `resolverAlcance`. Su default
  // `"interno"` deja intacto al unico llamador que existia (`lib/actions/analitica-operativa.ts`,
  // `lib/actions/analitica-financiera.ts`), que sigue llamando con la aridad de siempre (267/R43).
  const resolucion = resolverAlcance(actor, metricaId, canal);
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
 * R38 (122) — la politica sale del rol del actor: los CINCO roles lectores la resuelven en
 * `politicaIdentidadMensajero`, que es un `switch` exhaustivo, y por eso su comportamiento no
 * cambia aqui (267/R43).
 *
 * Feature 267 (2026-08-23) — EL FALLBACK SE INVIERTE: de `"real"` a `"seudonima"` (267/R38).
 *
 * Lo que decia el comentario anterior, y por que ya no vale: «si el rol no fuera de analitica
 * no habria llegado hasta aqui (`resolverAlcance` lo denego antes); el `real` de este fallback
 * es inalcanzable». Eso era cierto MIENTRAS el unico camino hasta aqui fuese el de los cinco
 * roles lectores. Desde esta feature `resolverAlcance` CONCEDE al rol de integracion (`apiKey`)
 * por el canal `"api_key"`, asi que el fallback deja de ser inalcanzable y pasa a decidir la
 * politica de un canal EXTERNO.
 *
 * Un fallback en `"real"` falla ABIERTO: el camino que no sabe decir que politica corresponde
 * acaba concediendo la identidad real del mensajero. Para un tercero al que ni siquiera
 * conocemos como empleador, ese es exactamente el error que no se puede permitir — el mismo
 * argumento de D5 de la 122 («un adminTienda no es empleador de esos mensajeros»), con mas
 * fuerza todavia. Se invierte a fallar CERRADO: quien no se sepa clasificar, se seudonimiza.
 *
 * Es estrictamente MAS restrictivo: nadie que hoy vea identidades reales deja de verlas,
 * porque los cinco roles se resuelven ANTES de llegar al fallback (267/R43).
 */
function politicaIdentidadDe(actor: ActorAnalitica | null): PoliticaIdentidad {
  if (actor && esRolAnalitica(actor.rol)) return politicaIdentidadMensajero(actor.rol);
  // 267/R35 — el rol de integracion, escrito EXPLICITO y no dejado al fallback: que se lea
  // como una decision y no como un efecto colateral de la inversion de abajo.
  if (actor && esRolAnaliticaIntegracion(actor.rol)) return "seudonima";
  // 267/R38 — fallo CERRADO. Ver la cabecera de esta funcion.
  return "seudonima";
}
