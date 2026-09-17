// FICHA 360 — CÓMO SE ESCRIBE LA BASE DE UN KPI, en un solo sitio.
//
// «Base» es el DENOMINADOR de la cifra: sobre cuántas órdenes se calculó. Un 29,5 % sobre 877
// órdenes y un 29,5 % sobre 17 no son la misma afirmación, y el porcentaje solo no las
// distingue — es el defecto que reportó el humano el 2026-08-29 sobre la fila de «Detalle ·
// Movimiento de las órdenes» y el mismo argumento que ya había obligado al KPI de ciclo de
// vida a escribir su `n`.
//
// ⚠ POR QUÉ ESTE MÓDULO EXISTE Y NO ES UN `${}` EN CADA TARJETA. Las tarjetas con base viven en
// la MISMA FILA de la misma pantalla, y las pintan tres componentes distintos (`EfectividadHeroe`
// y la de gestión desde `KpisEfectividad`, y `CicloVidaKpi`). Con el texto escrito a mano
// en cada archivo, la fila acabaría con dos convenciones para el mismo hecho —un paréntesis
// aquí, una coma allá, «1 órdenes» en la que nadie releyó— y esa divergencia es invisible en
// código: hay que tener las dos tarjetas delante para verla. Aquí hay UNA forma y se comparte.
//
// LAS TRES REGLAS QUE ESTE MÓDULO IMPONE, y ninguna es cosmética:
//
//  1. LA CIFRA VA FORMATEADA POR `formatearValor(_, "conteo")`, que es lo que hace el resto de
//     la analítica cuando escribe un conteo en prosa (`ProductosTabla.textoUniverso`,
//     `textoAcompanadas`). Sin él, la misma fila enseñaría «1.234» en la tarjeta «En proceso»
//     —que sí pasa por el formateador— y «(1234 órdenes)» en la de al lado.
//  2. EL SUSTANTIVO CONCUERDA con su cifra. El rótulo de un KPI se lee entero como una frase, y
//     «(1 órdenes cerradas)» delata que nadie la leyó.
//  3. LA BASE VA JUNTO AL RÓTULO, en fuente menor. En un `KpiCard` eso significa DENTRO del
//     rótulo y entre paréntesis, porque la tarjeta no tiene ranura de subtítulo: una línea
//     suelta debajo ya se probó y se retiró (2026-08-19) porque quedaba flotando entre dos
//     tarjetas sin decir de cuál de las dos hablaba.
//
//     ⚠ FICHA 441 — EL HÉROE ES LA EXCEPCIÓN, y sólo en la FORMA. Es una tarjeta del doble de
//     ancho que sí tiene sitio, así que escribe su base en un `<span>` al lado del rótulo
//     («Efectividad de entrega · de 790 órdenes cargadas») en vez de meterla entre paréntesis.
//     La regla no cambia —la base se escribe SIEMPRE, sale de la misma cuenta que el porcentaje
//     y no se escribe mientras la consulta está en vuelo—; lo que cambia es que ahí cabe.
//
// ⚠ LO QUE ESTE MÓDULO NO DECIDE, y es deliberado: CUÁNDO se escribe la base. Eso lo resuelve
// cada tarjeta con su propio estado, porque solo ella sabe si su consulta está en vuelo o si
// falló. La regla, igual en las cuatro: con la consulta EN VUELO o en ERROR no se escribe
// ninguna base (un «(0 órdenes)» ahí es una afirmación de negocio que nadie ha hecho); con
// `n = 0` SÍ se escribe, porque es justo lo que explica el guion de la cifra.

import { formatearValor } from "@/components/private/analytics/formato";

/** El sustantivo que acompaña a la cifra, en sus dos números. */
export interface SustantivoContado {
  readonly singular: string;
  readonly plural: string;
}

/** El universo del recorte, sin más adjetivos: todas las órdenes que entraron. */
export const ORDENES: SustantivoContado = { singular: "orden", plural: "órdenes" };

/**
 * Las que además CERRARON. `CicloVidaKpi` no mide sobre el universo entero sino sobre las que
 * llegaron a un estado terminal, y el adjetivo es la mitad del dato: sin él, su promedio se
 * leería como si hablara de todas.
 */
export const ORDENES_CERRADAS: SustantivoContado = {
  singular: "orden cerrada",
  plural: "órdenes cerradas",
};

/**
 * FICHA 441 — el universo del héroe: las órdenes que ENTRARON en el período.
 *
 * Desde que la ventana cayó sobre la fecha de carga (`lib/repositories/ventana-de-carga.ts`),
 * el recorte del KPI ya no es «las que se movieron»: es «las que se cargaron». El adjetivo lo
 * dice, y sin él «790 órdenes» junto a un porcentaje de cohorte vuelve a ser ambiguo — que es
 * exactamente el defecto que la ficha vino a reparar.
 */
export const ORDENES_CARGADAS: SustantivoContado = {
  singular: "orden cargada",
  plural: "órdenes cargadas",
};

/* -------------------------------------------------------------------------- */
/* FICHA 441 — «CERRADA» SIGNIFICA TRES COSAS EN ESTA PANTALLA                 */
/* -------------------------------------------------------------------------- */

/**
 * Las órdenes que YA TIENEN DESENLACE DE GESTIÓN: `entregada`, `rechazada`, `devuelta`,
 * `reprogramada` o `incidente`. Es la definición del HÉROE, la que produce
 * `calcularEfectividad` y sobre la que `evaluarMadurezDeCohorte` calcula su segunda cifra.
 *
 * ⚠ ESTE SUSTANTIVO EXISTE PARA NO DECIR «CERRADAS», y no es un capricho de estilo. Sobre
 * `/analitica` conviven TRES lecturas distintas de «ya no está en curso», medidas al
 * implementar la mitad de datos de esta ficha (`progress/impl_441.md` › «Deuda abierta»):
 *
 *   | lectura                         | qué cuenta                                   | sustantivo          |
 *   | ------------------------------- | -------------------------------------------- | ------------------- |
 *   | héroe (`calcularEfectividad`)   | tiene DESENLACE DE GESTIÓN                   | `órdenes con desenlace` |
 *   | `CicloVidaKpi`                  | llegó a estado TERMINAL, fechado en el cierre| `órdenes cerradas`  |
 *   | `CohorteCargaTabla`             | llegó a estado TERMINAL, dentro de la cohorte| `órdenes cerradas`  |
 *
 * Las tres son preguntas legítimas y **no se unifican**: el héroe necesita separar «rechazada»
 * de «devuelta» (el motor de cohortes las cuenta a las dos como vivas) y el ciclo de vida
 * necesita fechar por el cierre para no decir que el mes en curso es artificialmente rápido.
 * Lo que no pueden es COMPARTIR LA PALABRA: las dos primeras se leen en la MISMA FILA de KPIs
 * y sus `n` no coinciden, así que con un solo sustantivo la pantalla diría «de las 525 que ya
 * cerraron» y, tres centímetros más allá, «(300 órdenes cerradas)».
 *
 * Que eso no vuelva a pasar no depende de que alguien lo recuerde: lo mide
 * `tests/components/FilaKpisVocabulario.test.tsx`, que renderiza la fila entera y falla si un
 * mismo sustantivo aparece pegado a dos cifras distintas.
 */
export const ORDENES_CON_DESENLACE: SustantivoContado = {
  singular: "orden con desenlace",
  plural: "órdenes con desenlace",
};

/**
 * Todos los sustantivos contados de la fila de KPIs, para que el guardia de vocabulario pueda
 * recorrerlos sin escribir una segunda lista. Un sustantivo nuevo entra aquí y el test lo
 * vigila solo; escrito a mano en el test, el que se olvidara quedaría sin vigilar.
 */
export const SUSTANTIVOS_DE_LA_FILA: readonly SustantivoContado[] = [
  ORDENES,
  ORDENES_CERRADAS,
  ORDENES_CARGADAS,
  ORDENES_CON_DESENLACE,
];

/**
 * «877 órdenes», «1 orden cerrada». La cifra pasa por el formateador de la analítica, así que
 * lleva el separador de miles del locale configurado igual que las cifras de las tarjetas.
 */
export function contarOrdenes(n: number, sustantivo: SustantivoContado): string {
  return `${formatearValor(n, "conteo")} ${n === 1 ? sustantivo.singular : sustantivo.plural}`;
}

/**
 * El rótulo con su base DENTRO, que es la única forma que esta fila admite.
 *
 * `base` es texto ya compuesto y no un número a propósito: «Efectividad de la gestión» necesita
 * decir además cuál es su NUMERADOR («entregadas y rechazadas de 877 órdenes»), porque con la
 * base a la vista cualquiera puede multiplicar y preguntarse 339 de qué. Dejar que el llamador
 * componga esa frase evita que este módulo acumule un parámetro por cada matiz de cada tarjeta.
 */
export function rotuloConBase(rotulo: string, base: string): string {
  return `${rotulo} (${base})`;
}
