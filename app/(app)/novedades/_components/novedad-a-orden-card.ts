import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";
import type { NovedadDTO } from "@/lib/types/novedad";

import type { PosSecciones } from "@/app/(app)/mis-asignaciones/_components/pos-card/pos-secciones";

// 2026-08-12 (pedido humano) — ADAPTADOR de `NovedadDTO` a la orden que consume la card
// POS en su vista DETALLE (`PosOrderCardDetalle`), para que `/novedades` deje de tener su
// propia fila a mano y use la MISMA card que las órdenes del mensajero.
//
// POR QUÉ HAY ADAPTADOR Y NO SE PASA EL DTO TAL CUAL. `RecoleccionOrdenDTO` puede pasarse
// directo porque EXTIENDE `MiAsignacionDTO` (mismos campos). `NovedadDTO` no: trae seis
// campos (id, guía, destinatario, teléfono, causa, intentos) y la card pide diecinueve.
// La alternativa —engordar `NovedadDTO` con dirección, coordenadas, producto, monto y
// nombres de tienda/zona/cantón— sería pedirle al servidor datos que esta pantalla no
// muestra y que son PII de la tienda: el borde de `/novedades` los sirve a un
// `adminTienda`, y ampliar el DTO amplía la superficie de datos, no la de UI.
//
// LA REGLA DE LOS RELLENOS, que es lo único delicado de este archivo. `pos-secciones`
// avisa: «apagar una sección NO es cosmético, es lo que permite pasar una orden que no
// tiene esos datos». Cada `null`/`""` de abajo corresponde a una sección APAGADA en
// `SECCIONES_NOVEDAD`, y las dos cosas tienen que moverse juntas: encender aquí una
// sección sin traer su dato haría que la card pintara el relleno (un "Sin dirección", un
// monto en cero). Por eso el mapa de secciones vive en ESTE archivo, al lado de los
// rellenos que lo justifican, y no suelto en el JSX del módulo.

/**
 * Qué secciones de la card tienen dato en `/novedades`. Sólo `intentos` sobrevive: es el
 * único campo que el DTO trae de los cuatro que las secciones pintan (feature 160, R18).
 *
 * - `navegacion` NO: no hay dirección ni coordenadas (y en la tienda no se navega a nada).
 * - `cobro` NO: una orden devuelta no cobra; un "₡0" sería una cifra inventada.
 * - `detalle` NO: la vista de fila no lo pinta nunca, pero se declara para que apagarlo sea
 *   una decisión escrita y no un efecto secundario de la vista elegida.
 */
export const SECCIONES_NOVEDAD: PosSecciones = {
  navegacion: false,
  cobro: false,
  detalle: false,
  intentos: true,
};

/**
 * Identificador visible de una novedad. Es la GUÍA y no la remisión: la decisión F1.4 #1
 * de la feature 87 la eligió como el identificador de esta pantalla, y R9 exige un
 * placeholder legible cuando todavía no hay guía asignada (la guía nace en "Generar guía",
 * feature 17).
 *
 * Ocupa el hueco que la card reserva a `numRemision` porque ése es su slot de
 * IDENTIFICADOR —el que va en mono, arriba a la izquierda—, no porque una guía sea una
 * remisión. El texto lleva la palabra «Guía» delante justamente para que en pantalla no
 * pueda leerse como el otro número.
 */
export function etiquetaGuia(numGuia: number | null): string {
  return numGuia !== null ? `Guía ${numGuia}` : "Guía sin asignar";
}

/**
 * Construye la orden que la card consume. Los campos de las secciones apagadas van a
 * `null`/`""` (ver la regla de los rellenos, arriba); los que la vista de fila lee de
 * verdad —identificador, destinatario, intentos— salen del DTO.
 */
export function novedadAOrdenCard(novedad: NovedadDTO): MiAsignacionDTO {
  return {
    id: novedad.id,
    numGuia: novedad.numGuia,
    numRemision: etiquetaGuia(novedad.numGuia),
    // La lista es, por definición, de órdenes en devolución (R6 de la 87). La card no pinta
    // este campo en su vista de fila —el badge lo alimenta la prop `estado`, que el módulo
    // usa para la CAUSA—, pero mentirlo sería peor que decirlo.
    estatusValue: "devuelta",
    destinatario: novedad.destinatario,
    telefonoDest: novedad.telefonoDest,
    intentosEntrega: novedad.intentosEntrega,

    // ── Rellenos: sección `navegacion` APAGADA ──
    direccion: null,
    latitud: null,
    longitud: null,
    cantonNombre: "",
    distritoNombre: null,
    provinciaNombre: "",
    zonaNombre: "",

    // ── Rellenos: sección `cobro` APAGADA ──
    montoCobrar: null,

    // ── Rellenos: campos que sólo lee la sección `detalle` (APAGADA) o la vista completa ──
    producto: "",
    peso: null,
    notas: null,
    tiendaNombre: "",

    // `mostrarRuta={false}` en el módulo: estas órdenes no son paradas de ninguna ruta
    // optimizada, así que no hay número de parada que pintar ni "Pendiente de optimizar".
    secuenciaRuta: null,
  };
}
