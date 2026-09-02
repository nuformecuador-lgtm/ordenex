// FICHA 360 — CÓMO SE ESCRIBE LA BASE DE UN KPI, en un solo sitio.
//
// «Base» es el DENOMINADOR de la cifra: sobre cuántas órdenes se calculó. Un 29,5 % sobre 877
// órdenes y un 29,5 % sobre 17 no son la misma afirmación, y el porcentaje solo no las
// distingue — es el defecto que reportó el humano el 2026-08-29 sobre la fila de «Detalle ·
// Movimiento de las órdenes» y el mismo argumento que ya había obligado al KPI de ciclo de
// vida a escribir su `n`.
//
// ⚠ POR QUÉ ESTE MÓDULO EXISTE Y NO ES UN `${}` EN CADA TARJETA. Las cuatro tarjetas con base
// viven en la MISMA FILA de la misma pantalla, y las pintan dos componentes distintos
// (`KpisEfectividad` las tres primeras, `CicloVidaKpi` la última). Con el texto escrito a mano
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
//  3. LA BASE VA DENTRO DEL RÓTULO, entre paréntesis y al final. El rótulo ya es la letra
//     pequeña de `KpiCard` (`text-sm`, frente al `text-2xl` de la cifra), así que la base sale
//     en fuente menor —que es lo que se pidió— sin inventar ningún hueco nuevo en la tarjeta.
//     Fuera del rótulo no cabe: `KpiCard` no tiene ranura de subtítulo, y una línea suelta
//     debajo ya se probó y se retiró (2026-08-19) porque quedaba flotando entre dos tarjetas
//     sin decir de cuál de las dos hablaba.
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
