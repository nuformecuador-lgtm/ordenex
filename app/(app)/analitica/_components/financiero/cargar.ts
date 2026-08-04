// Feature 132 (T3.1) — el CARGADOR del tablero financiero. Modulo de SERVIDOR.
//
// Es el unico sitio de la feature que habla con el borde de la 127. Su trabajo
// es pedir las ocho metricas a la vez y traducir las cuatro respuestas posibles
// del Server Action a los tres estados que la pantalla sabe pintar. Ninguna
// decision de presentacion vive aqui, y ninguna decision de permiso tampoco.
//
// Tres reglas que este archivo materializa y que conviene leer juntas:
//
//  1. NO SE PASA `deps` (R9). El tercer argumento de `consultarMetricaFinanciera`
//     es el punto de inyeccion PARA TESTS y contiene funciones (`getActor`,
//     `logger`). Usarlo desde produccion convertiria a este llamador en una
//     segunda autoridad sobre "quien eres", que es justo lo que el borde de la
//     127 prohibe; ademas una funcion no cruza la frontera RSC.
//
//  2. NO SE PRE-PARSEA EL FILTRO. `FILTRO_FINANCIERO_POR_DEFECTO` viaja como
//     `unknown` y lo valida entero el esquema `.strict()` de la 135. Validar dos
//     veces, en dos sitios, es como se acaban aceptando dos formas distintas de
//     la misma entrada.
//
//  3. NO SE CAPTURA Y SE SILENCIA (R12, R23). Un fallo o una denegacion de UNA
//     metrica se convierte en el estado de SU panel; las otras siete se
//     renderizan igualmente. Y un panel que no trajo dato no se pinta en cero ni
//     con una serie vacia: `denegado` no se renderiza (R4) y `error` se renderiza
//     como error, nunca como cifra.
//
// La lista de metricas no se escribe aqui (R27): se recorre
// `IDS_FINANCIERAS_SERVIDAS`, que es la misma constante que el guardia de
// correspondencia de la 127 compara contra el catalogo.

import { consultarMetricaFinanciera } from "@/lib/actions/analitica-financiera";
import {
  IDS_FINANCIERAS_SERVIDAS,
  type RespuestaFinanciera,
  type ResultadoFinanciero,
} from "@/lib/types/analitica-financiera";

import { FILTRO_FINANCIERO_POR_DEFECTO } from "./rango";

/**
 * Lo que el tablero recibe por metrica.
 *
 * `denegado` NO lleva motivo, igual que el `forbidden` del borde: con un motivo
 * el usuario podria enumerar el catalogo y los permisos de cada rol preguntando.
 */
export type PanelFinanciero =
  | { readonly estado: "ok"; readonly id: string; readonly datos: ResultadoFinanciero }
  | { readonly estado: "error"; readonly id: string; readonly mensaje: string }
  | { readonly estado: "denegado"; readonly id: string };

/**
 * Texto del fallo de validacion, construido AQUI y a partir de las claves que el
 * borde reporta.
 *
 * El `validation_error` del borde no trae `mensaje` (solo `fieldErrors`), asi que
 * o se redacta uno o el panel quedaria en blanco — y un panel en blanco donde
 * deberia haber dinero se lee como "no hubo movimiento". Se nombran las CLAVES,
 * no sus textos: los mensajes de campo del esquema no estan pensados para
 * cruzar a una pantalla de solo lectura.
 */
function mensajeDeValidacion(fieldErrors: Record<string, string[]>): string {
  const claves = Object.keys(fieldErrors).sort();
  if (claves.length === 0) return "No se pudo consultar la métrica: el filtro no es válido.";
  return `No se pudo consultar la métrica: el filtro no es válido (${claves.join(", ")}).`;
}

/** Las cuatro respuestas del borde -> los tres estados de panel. Sin rama por defecto. */
function normalizar(id: string, respuesta: RespuestaFinanciera): PanelFinanciero {
  switch (respuesta.status) {
    case "ok":
      return { estado: "ok", id, datos: respuesta.datos };
    case "forbidden":
      return { estado: "denegado", id };
    case "error":
      // El mensaje ya viene saneado por el borde (id de metrica + fechas, sin PII
      // y sin el texto del error original): se transporta tal cual.
      return { estado: "error", id, mensaje: respuesta.mensaje };
    case "validation_error":
      return { estado: "error", id, mensaje: mensajeDeValidacion(respuesta.fieldErrors) };
  }
}

/**
 * Pide las ocho metricas financieras EN PARALELO y devuelve un panel por cada una.
 *
 * La concurrencia es real y no cosmetica (R12): el `.map` emite las ocho llamadas
 * antes de que se resuelva la primera. Con un `for ... await` el tablero tardaria
 * la suma de las ocho consultas en vez del maximo.
 *
 * El orden del resultado es el de `IDS_FINANCIERAS_SERVIDAS` — el que garantiza
 * `Promise.all` —, de modo que la pantalla no depende de cual respondio antes.
 */
export async function cargarTableroFinanciero(): Promise<readonly PanelFinanciero[]> {
  const pendientes = IDS_FINANCIERAS_SERVIDAS.map((id) =>
    consultarMetricaFinanciera(id, FILTRO_FINANCIERO_POR_DEFECTO).then((respuesta) =>
      normalizar(id, respuesta),
    ),
  );

  return Promise.all(pendientes);
}
