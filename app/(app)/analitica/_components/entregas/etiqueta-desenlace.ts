// El `value` del catalogo de desenlaces puesto en algo que se lee en una pantalla.
//
// ─── POR QUE ESTA FUNCION SE MUDO AQUI (ficha 347, F1) ──────────────────────────────────────
//
// Vivia en `ConteoEntregasAnillo.tsx`, que es un componente de cliente y arrastra `recharts`.
// La ficha 347 necesita LA MISMA funcion en dos sitios mas y uno de ellos es
// `analitica-productos-descarga-columnas.ts`, que es un modulo PURO por contrato (sin React,
// sin DOM) y lo EJECUTA la guardia de columnas sensibles en un entorno de node. Importar el
// anillo desde alli habria metido una grafica en un barrido de columnas.
//
// Es una MUDANZA, no un cambio de comportamiento: `ConteoEntregasAnillo` la RE-EXPORTA con su
// nombre de siempre, asi que ninguno de sus consumidores —ni el anillo, ni
// `tests/unit/analytics/conteo-entregas-pliegue.test.ts`— cambia un import. Mismo patron con el
// que `money()` se mudo a `lib/config/moneda.ts`.

/**
 * El `value` del catalogo (`entregada`, `reprogramada`) puesto en algo que se lee en una
 * leyenda. En plural, porque cada segmento cuenta ORDENES y no una sola.
 *
 * Sin tabla de etiquetas escrita a mano: `order_status` no tiene columna `label` —la etiqueta
 * ES el value— y una tabla propia se desincronizaria en silencio el proximo renombre del
 * catalogo. Los cinco desenlaces terminan en «a», asi que el plural es una «s».
 *
 * ⚠ LO QUE YA ESTA EN PLURAL NO SE VUELVE A PLURALIZAR. El bucket «otros» lo esta, y sin esta
 * guarda salia «Otross» en la leyenda. La regla se escribe sobre la FORMA de la palabra y no
 * como un caso especial para «otros»: cualquier value futuro acabado en «s» queda cubierto.
 */
export function etiquetaDeDesenlace(valor: string): string {
  return capitalizar(valor.endsWith("s") ? valor : `${valor}s`);
}

/**
 * FICHA 442 — el MISMO nombre, concordando con su cantidad: «4 devueltas» y «1 devuelta».
 *
 * ⚠ EL SINGULAR NO SE CALCULA, YA EXISTE: es el `value` del catalogo tal cual. `order_status`
 * guarda `devuelta`, `rechazada`, `reprogramada` — todos en singular—, y lo que `etiquetaDeDesenlace`
 * hace es pluralizarlos. Con cantidad 1 basta con NO pluralizar.
 *
 * Por eso aqui no hay ninguna regla de morfologia del español: no se quita una «s», no se busca
 * una terminacion y no hay tabla de excepciones. Un desenlace nuevo del catalogo —con la forma
 * que tenga— entra solo por los dos caminos, exactamente igual que en la funcion de arriba.
 *
 * ⚠ SE USA EN LOS DOS SITIOS QUE NOMBRAN UN DESENLACE CON SU CANTIDAD: la frase de «En qué
 * terminaron» (pantalla) y la composicion de «Otros resultados» (pantalla Y archivo descargable).
 * Si solo lo usara uno, la misma fila diria «1 devuelta» en la tabla y «1 devueltas» en el
 * `.xlsx` que se abre al lado.
 */
export function etiquetaDeDesenlaceContada(valor: string, conteo: number): string {
  return conteo === 1 ? capitalizar(valor) : etiquetaDeDesenlace(valor);
}

/** La primera letra en mayuscula. Escrito una vez para las dos funciones de arriba. */
function capitalizar(palabra: string): string {
  return palabra.charAt(0).toUpperCase() + palabra.slice(1);
}
