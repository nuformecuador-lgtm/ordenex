// FICHA 444 — LO QUE ESCRIBE EL CONTADOR DE HOY CUANDO NO TIENE NADA QUE CONTAR, y la nota que
// lo acompaña siempre.
//
// Modulo PURO: sin React, sin DOM, sin red. Se invoca y se comprueba.
//
// ─── QUE ESTABA MAL, Y POR QUE ERA UN TEXTO Y NO UNA CONSULTA ───────────────────────────────
//
// El panel se titula «Cargadas hoy (2026-09-17)» —la fecha la resuelve el SERVIDOR— y su cuerpo
// vacio decia, palabra por palabra:
//
//     «Sin datos en el rango · Esta metrica no registro ningun movimiento con el filtro
//      seleccionado.»
//
// Ese texto es `VACIO_PANEL`, el vacio COMPARTIDO de los paneles que SI tienen ventana. Aqui
// afirmaba dos cosas falsas a la vez: que la ventana es «el rango» —esta lectura no acepta
// ninguno: su dia lo pone el reloj del servidor— y que el resultado depende «del filtro
// seleccionado», cuando de las siete facetas de la barra esta ignora justamente las dos que el
// lector acaba de tocar (la fecha y el mensajero). Un encabezado que promete HOY respondido con
// una frase sobre EL RANGO es la contradiccion que pedia la ficha.
//
// SE MIDIO ANTES DE ELEGIR, porque las dos salidas posibles eran opuestas. La consulta NO
// pregunta por el rango del filtro, y eso esta comprobado en las tres capas:
// `consultarConteoHoyGestion` no toca `consulta.rango`; `ConteoHoyGestionService.consultar`
// resuelve el dia con `resolverRango({ preset: "dia" }, this.now())`; y `condicionesDeHoy`
// acota `o."created_at"` con ESE dia y no con el del filtro. O sea: el panel ya habla de hoy de
// verdad, y la cifra que enseña es correcta. Lo unico que mentia eran las palabras.
//
// Por eso la eleccion es la primera de las dos que planteaba la ficha —«ignora el filtro y de
// verdad habla de hoy»— y no la otra: mover la lectura al rango habria cambiado una cifra
// correcta para que encajara con un texto prestado.

import type { TextoVacio } from "@/components/private/analytics/tipos";

/**
 * LA NOTA, que se pinta SIEMPRE (haya cifras o no).
 *
 * `ConteoHoyGestionDTO` declara por escrito que esta lectura ignora dos facetas de la barra y
 * que «la pantalla tiene que decirlo porque la barra es una sola». Hasta la 444 no lo decia en
 * ningun sitio: el unico texto que hablaba del filtro era el del vacio, y hablaba al reves.
 *
 * Enumera las cinco facetas que SI recortan en vez de decir «algunos filtros»: sin la lista, un
 * lector que ve el panel cambiar al elegir una zona concluye que tambien le hizo caso a la
 * fecha.
 *
 * El ALCANCE (la frontera multi-tenant) no se nombra: no es una faceta que nadie elija en la
 * barra y decirlo aqui sugeriria que se puede quitar.
 */
export const NOTA_NO_SIGUE_LA_FECHA =
  "No sigue al filtro de fechas: siempre cuenta el día en curso de Costa Rica. " +
  "Sí responde a los de zona, provincia, cantón, distrito y tienda.";

/** Nombre accesible de la nota. Va aparte del texto para que el dia de i18n viajen juntos. */
export const ETIQUETA_NOTA = "Qué cuenta este panel";

/** Lo que se escribe cuando hoy todavia no ha entrado ninguna orden y SI sabemos que dia es. */
export function tituloVacioDeHoy(fecha: string | null): string {
  return fecha === null
    ? "Hoy todavía no ha entrado ninguna orden"
    : `Hoy (${fecha}) todavía no ha entrado ninguna orden`;
}

/**
 * La descripcion del vacio. NO repite la nota —que ya esta en pantalla— y no menciona ni el
 * rango ni «el filtro seleccionado»: dice lo unico que falta por decir, que el dia sigue
 * abierto.
 */
export const DESCRIPCION_VACIO_DE_HOY =
  "El día sigue en curso: en cuanto se cargue la primera orden aparecerá aquí.";

/**
 * EL VACIO DE ESTE PANEL, con la fecha que devolvio el SERVIDOR.
 *
 * La fecha no se calcula aqui con `new Date()`, por el mismo motivo que el titulo: el dia lo
 * decide el servidor en hora de Costa Rica y un navegador en otro huso escribiria otro. Sin
 * fecha todavia, la frase va desnuda en vez de inventar un dia que nadie ha medido.
 *
 * Punto de mutacion de la ficha: devolver aqui `VACIO_PANEL` deja el panel prometiendo «hoy» en
 * el titulo y hablando «del rango» en el cuerpo, que es exactamente el defecto reportado.
 */
export function vacioDeHoy(fecha: string | null): TextoVacio {
  return { titulo: tituloVacioDeHoy(fecha), descripcion: DESCRIPCION_VACIO_DE_HOY };
}
