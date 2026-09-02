// FICHA 345 (T8.1, design §7.4) — LAS COLUMNAS DEL ARCHIVO del analisis de productos y la
// proyeccion de UNA fila.
// FICHA 347 (G1) — mas la composicion de «Otros resultados» y, CONDICIONADAS a la concesion,
// las nueve celdas de dinero.
//
// POR QUE ESTE ARCHIVO SE LLAMA ASI, y no es decorativo: la guardia perenne de la 170
// (`tests/unit/descarga/columnas-sensibles.guardia.test.ts`) descubre POR CONVENCION DE NOMBRE
// (`*-descarga-columnas.ts`) todas las declaraciones de columnas de export del arbol —no hay
// lista fija— y ademas EJECUTA esta proyeccion con una sonda que delata que campo lee cada
// celda. Declarar estas columnas en un archivo con otro nombre las dejaria fuera de ese censo.
//
// Modulo PURO: sin React, sin DOM, sin servicio, sin repositorio y sin Prisma. Toma lo que la
// Server Action YA devolvio y lo pone en filas.
//
// ─── LO QUE ESTE ARCHIVO NO HACE, Y ES DELIBERADO ──────────────────────────────────────────
//
//  - **No consulta nada** (R52 de la 345, R71 de la 347). Proyecta el DTO que la pantalla esta
//    pintando, asi que el archivo NO PUEDE discrepar de la tabla. Una segunda lectura —aunque
//    preguntara lo mismo— podria resolverse con un corte distinto (basta una gestion registrada
//    entre las dos) y dejar al usuario con un fichero que no cuadra con lo que acaba de ver.
//  - **No escribe ningun uuid** (R49/R69). `FilaProductoDTO.tiendaId` existe y NO se lee: es la
//    clave de fila de la pantalla, no un dato del negocio. La tienda viaja por su NOMBRE.
//  - **No calcula una segunda efectividad** (R28). Llama a `calcularEfectividad`, la misma
//    funcion que pinta la fila de KPIs y la misma que usa la tabla. Si algun dia el
//    denominador cambia, cambia en los tres sitios a la vez o en ninguno.
//  - **No convierte ningun importe a numero** (R22). Los importes salen como el STRING que
//    llego del servidor, TAL CUAL. `Number(`, `parseFloat(`, `parseInt(` y `.toFixed(` estan
//    prohibidos sobre ellos, y hay tres guardias vivas persiguiendo esas cuatro llamadas.
//
// ─── LAS DOS DECISIONES DE LA 347 QUE HAY QUE LEER ANTES DE TOCAR ESTO ─────────────────────
//
// **(1) LA MARCA DE NO-SUMABLE VA EN EL ENCABEZADO** (R49). El parrafo de la pantalla no viaja
// con el `.xlsx`: quien abre el archivo tres semanas despues no tiene delante ninguna
// advertencia, y una hoja de calculo INVITA a arrastrar la columna hasta el pie. La marca se
// escribe entera en el encabezado —no abreviada— porque ahi es lo unico que queda.
//
// **(2) LA COMPOSICION DE «Otros resultados» ES **UNA SOLA** COLUMNA DE TEXTO** (R58), y no una
// columna por desenlace. El motivo es el mismo que descarto enumerar en la etiqueta: con una
// columna por desenlace, el dia que el catalogo gane uno el archivo CAMBIA de numero y de orden
// de columnas, y toda hoja o macro que lo consuma se rompe en silencio. Con una columna de
// texto, un desenlace nuevo entra dentro de la celda y el contrato del archivo no se mueve.

import type { FilaProductoDTO } from "@/lib/types/conteo-productos";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";

import { calcularEfectividad } from "./efectividad";
import { textoComposicionOtrosResultados } from "./otros-resultados";

/**
 * FICHA 347 (R49) — la marca que llevan los encabezados de dinero del ARCHIVO.
 *
 * Es mas larga que la de la pantalla (`MARCA_NO_SUMABLE`) a proposito: en la pantalla la marca
 * corta se lee junto al parrafo que la explica, y aqui no hay parrafo ninguno.
 */
export const MARCA_NO_SUMABLE_ARCHIVO = "(no sumar: importe de la orden completa)";

/**
 * Las ONCE columnas base del archivo, en su orden. Todas salen de `FilaProductoDTO` o de
 * `calcularEfectividad` sobre su `porStatus`: no hay ni una que exija consultar nada mas.
 *
 * FICHA 346 — la decima es `otros_resultados`, y no es una columna «de mas»: sin ella el
 * archivo repetia el defecto de la pantalla —`entregadas + rechazadas + en_proceso` se quedaba
 * corto frente a `ordenes`— y ahi es peor, porque una hoja de calculo INVITA a sumar la fila.
 * Con las cuatro, la suma cuadra siempre.
 *
 * FICHA 347 — la undecima es `otros_resultados_detalle`: DE QUE se compone ese cubo, como texto
 * (R58). Va PEGADA a su conteo, que es donde se lee.
 *
 * **La tienda va SIEMPRE** (R50), aunque la pantalla haya escondido esa columna por tener una
 * sola tienda en la respuesta. Un fichero que circula tiene que decir de quien es cada fila:
 * quien lo reciba por correo no sabe con que filtro se genero.
 */
export const COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS: DescargaColumna[] = [
  { clave: "tienda", encabezado: "Tienda" },
  { clave: "producto", encabezado: "Producto" },
  { clave: "unidades", encabezado: "Unidades" },
  { clave: "ordenes", encabezado: "Órdenes" },
  { clave: "entregadas", encabezado: "Entregadas" },
  { clave: "rechazadas", encabezado: "Rechazadas" },
  // FICHA 346 — el resto de los desenlaces. Mismo rotulo que la pantalla, a proposito: el
  // archivo se abre al lado de la tabla y dos nombres para la misma cifra se leen como dos
  // cifras distintas.
  { clave: "otros_resultados", encabezado: "Otros resultados" },
  // FICHA 347 (R58) — DE QUE se compone la anterior, en UNA celda de texto.
  { clave: "otros_resultados_detalle", encabezado: "Otros resultados (detalle)" },
  { clave: "en_proceso", encabezado: "En proceso" },
  // La UNIDAD va en el encabezado porque la celda lleva PUNTOS porcentuales (37.5), no la
  // fraccion cruda (0.375): sin decirlo, un 37.5 se lee como cualquier cosa. ⟨Q7⟩ del spec
  // pregunta si se prefiere lo contrario; mientras no se responda, el archivo se parece a la
  // pantalla, que es lo que espera quien acaba de pulsar el boton.
  { clave: "efectividad", encabezado: "Efectividad de entrega (%)" },
  { clave: "rechazo", encabezado: "Rechazo (%)" },
];

/**
 * FICHA 347 (R66/R68) — las MISMAS once, mas las NUEVE de dinero, para el actor que lo tiene
 * concedido.
 *
 * Se declara como una constante PROPIA y no se compone con un `if` dentro de la funcion, y no
 * es un capricho: `columnas-asercion-de-orden.guardia` exige que toda `COLUMNAS_DESCARGA_*`
 * tenga en `tests/` una asercion de orden que la NOMBRE. Dos contratos declarados son dos
 * contratos afirmados a mano; uno construido al vuelo no se puede afirmar sin compararlo
 * consigo mismo, que es la asercion que siempre esta verde.
 *
 * LAS NUEVE, y por que cada una:
 *  - `recaudado`: la cifra del pedido. Marcada como NO SUMABLE.
 *  - `ordenes_con_otro_producto`: cuantas de sus ordenes llevan otro producto (R13). Es el
 *    numero que hace legible la marca anterior — y este SI es aditivo.
 *  - `liquidado_recaudado` y `liquidado_ordenes`: la parte de lo recaudado que ya esta en un
 *    cierre aprobado, y sobre cuantas ordenes.
 *  - `ordenex` y `para_la_tienda`: el reparto, SOLO de lo liquidado (R29). Su suma es
 *    exactamente `liquidado_recaudado` (R20), y por eso se leen los tres juntos.
 *  - `pendiente_recaudado` y `pendiente_ordenes`: lo cobrado y aun sin liquidar (R28). No se
 *    reparte y no se proyecta (R31).
 *  - `retorno`: el flete por rechazo + IVA de las rechazadas liquidadas (R19). Se llama asi
 *    «Flete por rechazo» y no de otra forma: la ficha 338 lo renombro en toda la app porque
 *    solo un RECHAZO lo cobra, y lo vigila una guardia de censo. Va en el
 *    archivo —y no como columna de la pantalla— justamente porque FUERA del reparto: como
 *    columna de la tabla se sumaria mentalmente al reparto de al lado.
 */
export const COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS_DINERO: DescargaColumna[] = [
  ...COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS,
  { clave: "recaudado", encabezado: `Recaudado ${MARCA_NO_SUMABLE_ARCHIVO}` },
  { clave: "ordenes_con_otro_producto", encabezado: "Órdenes con otro producto" },
  {
    clave: "liquidado_recaudado",
    encabezado: `Recaudado liquidado ${MARCA_NO_SUMABLE_ARCHIVO}`,
  },
  { clave: "liquidado_ordenes", encabezado: "Órdenes liquidadas" },
  { clave: "ordenex", encabezado: `Cobró Ordenex ${MARCA_NO_SUMABLE_ARCHIVO}` },
  { clave: "para_la_tienda", encabezado: `Para la tienda ${MARCA_NO_SUMABLE_ARCHIVO}` },
  {
    clave: "pendiente_recaudado",
    encabezado: `Pendiente de cierre ${MARCA_NO_SUMABLE_ARCHIVO}`,
  },
  { clave: "pendiente_ordenes", encabezado: "Órdenes pendientes de cierre" },
  { clave: "retorno", encabezado: `Flete por rechazo ${MARCA_NO_SUMABLE_ARCHIVO}` },
];

/**
 * R66/R67 — que columnas lleva el archivo de ESTE actor.
 *
 * Sin la concesion, el archivo NO contiene NINGUNA columna de dinero: ni vacia, ni en cero.
 * Es la misma regla que la pantalla, y sale de la misma decision — la pantalla le pasa a esta
 * funcion exactamente el mismo `conDinero` con el que decide sus columnas, asi que el archivo y
 * la tabla no pueden discrepar sobre quien ve el dinero.
 */
export function columnasDescargaAnaliticaProductos(conDinero: boolean): DescargaColumna[] {
  return conDinero
    ? COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS_DINERO
    : COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS;
}

/**
 * Una fraccion (0,375) en PUNTOS porcentuales con un decimal (37.5).
 *
 * `Math.round(f * 1000) / 10` y no `toFixed(1)`: aquel devuelve un NUMERO y este una cadena, y
 * una hoja de calculo con la columna en texto no suma, no ordena y no promedia. El redondeo es
 * determinista y va al medio punto mas cercano.
 *
 * ⚠ ESTO NO ES DINERO y por eso puede ser aritmetica de coma flotante: es un PORCENTAJE
 * derivado de dos conteos enteros. Los importes de esta ficha no pasan por aqui ni por ninguna
 * otra operacion: salen tal cual como llegaron.
 *
 * `null` entra y `null` sale (R51/R70): la celda queda VACIA, nunca `0`. Un cero es una
 * afirmacion —«no rechazaron ninguna»— y `null` es «no habia ordenes que medir». En un archivo
 * que se abre seis meses despues nadie tiene forma de distinguirlos si los escribimos igual.
 */
function puntosPorcentuales(fraccion: number | null): number | null {
  if (fraccion === null || !Number.isFinite(fraccion)) return null;
  return Math.round(fraccion * 1000) / 10;
}

/**
 * Proyecta UNA fila del DTO a UNA fila del archivo.
 *
 * Lo que se lee, y nada mas: `fila.tienda`, `fila.producto`, `fila.unidades`, `fila.ordenes`,
 * `fila.porStatus` y —con el dinero concedido— `fila.ordenesAcompanadas` y `fila.dinero`. Ni un
 * id, ni un correo, ni un telefono, ni una ruta.
 *
 * ⚠ R70 — UN IMPORTE AUSENTE ES UNA CELDA VACIA, NUNCA `0`. `fila.dinero` puede ser `null` (esa
 * fila no tiene ninguna orden que aporte) y, aun teniendolo, `ordenex`, `tienda` y `retorno`
 * pueden ser `null` (no hay nada liquidado, R30). Los dos casos salen como `null` y ninguno se
 * rellena con un cero: un `0,00` en la columna «Cobró Ordenex» afirma que Ordenex no cobro
 * nada, cuando lo cierto es que todavia no se sabe.
 */
export function filaDescargaAnaliticaProductos(
  fila: FilaProductoDTO,
  conDinero: boolean = false,
): DescargaFila {
  const efectividad = calcularEfectividad(fila.porStatus);
  const base: DescargaFila = {
    tienda: fila.tienda,
    producto: fila.producto,
    unidades: fila.unidades,
    ordenes: fila.ordenes,
    entregadas: efectividad.entregadas,
    rechazadas: efectividad.rechazadas,
    otros_resultados: efectividad.otrosDesenlaces,
    // R58 — la composicion, en UNA celda de texto y derivada del `porStatus` que ya viaja.
    // Sin composicion queda VACIA, no «ninguno»: la fila no tiene otros resultados y punto.
    otros_resultados_detalle: textoComposicionOtrosResultados(fila.porStatus) || null,
    en_proceso: efectividad.enProceso,
    efectividad: puntosPorcentuales(efectividad.efectividad),
    rechazo: puntosPorcentuales(efectividad.tasaRechazo),
  };

  // R67 — sin concesion, ni una clave de dinero en la fila. No basta con no declarar la
  // columna: el generador comun emite EXACTAMENTE las columnas declaradas, pero una clave
  // sobrante en la fila seria dinero viajando en una estructura que alguien puede volcar.
  if (!conDinero) return base;

  const dinero = fila.dinero;
  return {
    ...base,
    // Money-safe: STRING tal cual, sin convertir y sin reformatear.
    recaudado: dinero?.recaudado ?? null,
    ordenes_con_otro_producto: fila.ordenesAcompanadas,
    liquidado_recaudado: dinero?.liquidado.recaudado ?? null,
    liquidado_ordenes: dinero?.liquidado.ordenes ?? null,
    ordenex: dinero?.liquidado.ordenex ?? null,
    para_la_tienda: dinero?.liquidado.tienda ?? null,
    pendiente_recaudado: dinero?.pendiente.recaudado ?? null,
    pendiente_ordenes: dinero?.pendiente.ordenes ?? null,
    retorno: dinero?.retorno ?? null,
  };
}
