// FICHA 347 (F1, entrega B) — DE QUE SE COMPONE «Otros resultados».
//
// El pedido del humano, textual y viendo la tabla ya desplegada: «falta claridad en que es la
// columna de otros resultados». La columna dice CUANTAS y no QUE SON.
//
// ─── COMO **NO** SE ARREGLA, Y ESTA DECIDIDO ────────────────────────────────────────────────
//
// NO se enumera en la etiqueta («Devueltas y reprogramadas»). Esa alternativa esta descartada
// desde la ficha 346 y no se reabre: la etiqueta MENTIRIA el dia que el catalogo gane un
// desenlace, que es EXACTAMENTE el defecto que la 346 acaba de reparar —escondia 105 ordenes en
// 37 de 86 filas de produccion—. Una etiqueta es una promesa escrita a mano sobre un catalogo
// que se mueve.
//
// Se resuelve mostrando la COMPOSICION REAL de cada fila, que el payload YA trae en `porStatus`:
// «3 devueltas · 2 reprogramadas». Es DATO, no lista escrita, y crece solo con el catalogo.
//
// ─── LA REGLA, Y DE DONDE SALE CADA MITAD ───────────────────────────────────────────────────
//
//  - «esta en `DESENLACES`» — el catalogo, importado. Un desenlace nuevo entra SOLO (R52).
//  - «y no es de los que ya tienen columna propia» — `DESENLACES_CON_COLUMNA_PROPIA`, que se
//    declara UNA vez en `efectividad.ts`, junto a los dos literales que la tabla ya pinta como
//    columnas. Sin ese reuso habria dos reglas para la misma particion (R53).
//
// Es la MISMA regla —y por el mismo motivo— con la que la 346 derivo el cubo `otrosDesenlaces`,
// asi que la composicion de una fila SUMA su cubo por construccion y no por coincidencia. Lo
// afirma `tests/unit/analytics/otros-resultados.test.ts` recorriendo `DESENLACES` de verdad y,
// sobre todo, con el caso del SEXTO DESENLACE INYECTADO: una lista escrita a mano pasa todos los
// demas casos y cae en ese. Es lo unico que distingue derivar de escribir.
//
// Modulo PURO: sin React, sin DOM, sin SWR, sin acciones. Lo consumen la pantalla y el archivo
// descargable, y por eso no puede vivir dentro de ninguno de los dos.

import { DESENLACES } from "@/lib/types/conteo-entregas";
import type { ConteoDeStatus } from "@/lib/types/conteo-por-status";

import { DESENLACES_CON_COLUMNA_PROPIA } from "./efectividad";
import { etiquetaDeDesenlace } from "./etiqueta-desenlace";

/** Los cinco desenlaces como conjunto, para clasificar en O(1). Derivado, nunca reescrito. */
const CON_DESENLACE: ReadonlySet<string> = new Set<string>(DESENLACES);

/** El separador entre los trozos de la composicion. Uno solo, para pantalla y archivo. */
export const SEPARADOR_COMPOSICION = " · ";

/** Un trozo de la composicion: un desenlace del catalogo y cuantas ordenes lo tienen. */
export interface TrozoDeComposicion {
  /** El `value` del catalogo. NUNCA se pinta crudo: ver `textoComposicionOtrosResultados`. */
  readonly status: string;
  readonly conteo: number;
}

/**
 * DE QUE se compone el «Otros resultados» de UNA fila (R50/R51/R53/R56).
 *
 * Entra el `porStatus` que la respuesta ya trae y sale la lista de desenlaces que forman ese
 * cubo, con su cantidad. Tres exclusiones, y cada una por su motivo:
 *
 *  - los desenlaces que YA tienen columna propia, porque estarian dos veces en la misma fila;
 *  - los status que NO son desenlace, porque esas ordenes son «En proceso» y no un resultado
 *    (R53). Se decide por NEGACION sobre el catalogo, igual que `calcularEfectividad`;
 *  - los conteos que no son positivos, porque «devueltas: 0» no es composicion, es ruido — y
 *    ademas ninguna fila del payload trae ceros.
 *
 * ⚠ EL ORDEN ES DETERMINISTA Y NO USA `localeCompare` (R56): el desempate va por UNIDADES DE
 * CODIGO (`<`), que es la unica comparacion de cadenas que no depende del ICU del entorno. Con
 * `localeCompare`, la misma fila podria producir dos textos distintos en dos maquinas — y el
 * texto viaja al archivo descargable, donde la diferencia es invisible y permanente.
 *
 * Primero por cantidad descendente (lo que mas pesa se lee antes) y despues por `status`
 * ascendente.
 */
export function composicionOtrosResultados(
  porStatus: readonly ConteoDeStatus[],
): readonly TrozoDeComposicion[] {
  const trozos = porStatus
    .filter(
      (fila) =>
        CON_DESENLACE.has(fila.status) &&
        !DESENLACES_CON_COLUMNA_PROPIA.includes(fila.status) &&
        fila.conteo > 0,
    )
    .map<TrozoDeComposicion>((fila) => ({ status: fila.status, conteo: fila.conteo }));

  return [...trozos].sort((a, b) => {
    if (a.conteo !== b.conteo) return b.conteo - a.conteo;
    if (a.status < b.status) return -1;
    if (a.status > b.status) return 1;
    return 0;
  });
}

/**
 * La composicion como TEXTO: «3 devueltas · 2 reprogramadas».
 *
 * Cadena VACIA cuando no hay composicion (R54): la pantalla no pinta nada y la celda del
 * archivo queda vacia. No se escribe «ninguno» ni «0», que serian afirmaciones sobre una fila
 * que simplemente no tiene otros resultados.
 *
 * ⚠ EL NUMERO SE INTERPOLA CRUDO, sin `Intl`: este texto viaja al archivo descargable y tiene
 * que ser el MISMO byte a byte en cualquier maquina (R56). Un separador de miles dependiente
 * del locale rompe esa igualdad.
 *
 * La etiqueta sale de `etiquetaDeDesenlace` —el mecanismo que YA existe (R55)— y se pone en
 * minusculas porque va en medio de una frase, detras de su cantidad. No hay ninguna tabla de
 * etiquetas escrita aqui: `order_status` no tiene columna `label` y una tabla propia se
 * desincronizaria en el proximo renombre.
 *
 * @param etiquetar como nombrar un desenlace. Se INYECTA en vez de importarse para que este
 *                  modulo siga sin depender de nada de UI; el valor por defecto es el mecanismo
 *                  vivo, asi que ningun consumidor tiene que pasarlo.
 */
export function textoComposicionOtrosResultados(
  porStatus: readonly ConteoDeStatus[],
  etiquetar: (status: string) => string = etiquetaPorDefecto,
): string {
  return composicionOtrosResultados(porStatus)
    .map((trozo) => `${trozo.conteo} ${etiquetar(trozo.status).toLowerCase()}`)
    .join(SEPARADOR_COMPOSICION);
}

/**
 * El mecanismo de etiquetas VIVO (R55), envuelto en una funcion nombrada para que sea el valor
 * por defecto del parametro de arriba y quede claro que `composicionOtrosResultados` —el
 * calculo— no sabe nada de etiquetas.
 */
function etiquetaPorDefecto(status: string): string {
  return etiquetaDeDesenlace(status);
}
