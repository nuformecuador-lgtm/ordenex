// FICHA 345 (T8.1, design §7.4) — LAS COLUMNAS DEL ARCHIVO del analisis de productos y la
// proyeccion de UNA fila.
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
//  - **No consulta nada** (R52). Proyecta el DTO que la pantalla esta pintando, asi que el
//    archivo NO PUEDE discrepar de la tabla. Una segunda lectura —aunque preguntara lo mismo—
//    podria resolverse con un corte distinto (basta una gestion registrada entre las dos) y
//    dejar al usuario con un fichero que no cuadra con lo que acaba de ver.
//  - **No escribe ningun uuid** (R49). `FilaProductoDTO.tiendaId` existe y NO se lee: es la
//    clave de fila de la pantalla, no un dato del negocio. La tienda viaja por su NOMBRE.
//  - **No calcula una segunda efectividad** (R28). Llama a `calcularEfectividad`, la misma
//    funcion que pinta la fila de KPIs y la misma que usa la tabla. Si algun dia el
//    denominador cambia, cambia en los tres sitios a la vez o en ninguno.
//  - **No emite ninguna cifra de dinero.** Es el limite innegociable de la ficha, y aqui se
//    nota en lo que falta: no hay columna de flete, ni de ingreso, ni de ticket medio.

import type { FilaProductoDTO } from "@/lib/types/conteo-productos";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";

import { calcularEfectividad } from "./efectividad";

/**
 * Las DIEZ columnas del archivo, en su orden. Todas salen de `FilaProductoDTO` o de
 * `calcularEfectividad` sobre su `porStatus`: no hay ni una que exija consultar nada mas.
 *
 * FICHA 346 — la decima es `otros_resultados`, y no es una columna «de mas»: sin ella el
 * archivo repetia el defecto de la pantalla —`entregadas + rechazadas + en_proceso` se quedaba
 * corto frente a `ordenes`— y ahi es peor, porque una hoja de calculo INVITA a sumar la fila.
 * Con las cuatro, la suma cuadra siempre.
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
  { clave: "en_proceso", encabezado: "En proceso" },
  // La UNIDAD va en el encabezado porque la celda lleva PUNTOS porcentuales (37.5), no la
  // fraccion cruda (0.375): sin decirlo, un 37.5 se lee como cualquier cosa. ⟨Q7⟩ del spec
  // pregunta si se prefiere lo contrario; mientras no se responda, el archivo se parece a la
  // pantalla, que es lo que espera quien acaba de pulsar el boton.
  { clave: "efectividad", encabezado: "Efectividad de entrega (%)" },
  { clave: "rechazo", encabezado: "Rechazo (%)" },
];

/**
 * Una fraccion (0,375) en PUNTOS porcentuales con un decimal (37.5).
 *
 * `Math.round(f * 1000) / 10` y no `toFixed(1)`: aquel devuelve un NUMERO y este una cadena, y
 * una hoja de calculo con la columna en texto no suma, no ordena y no promedia. El redondeo es
 * determinista y va al medio punto mas cercano.
 *
 * `null` entra y `null` sale (R51): la celda queda VACIA, nunca `0`. Un cero es una afirmacion
 * —«no rechazaron ninguna»— y `null` es «no habia ordenes que medir». En un archivo que se abre
 * seis meses despues nadie tiene forma de distinguirlos si los escribimos igual.
 */
function puntosPorcentuales(fraccion: number | null): number | null {
  if (fraccion === null || !Number.isFinite(fraccion)) return null;
  return Math.round(fraccion * 1000) / 10;
}

/**
 * Proyecta UNA fila del DTO a UNA fila del archivo.
 *
 * Lo que se lee, y nada mas: `fila.tienda`, `fila.producto`, `fila.unidades`, `fila.ordenes` y
 * `fila.porStatus`. Ni un id, ni un correo, ni un telefono, ni una ruta.
 */
export function filaDescargaAnaliticaProductos(fila: FilaProductoDTO): DescargaFila {
  const efectividad = calcularEfectividad(fila.porStatus);
  return {
    tienda: fila.tienda,
    producto: fila.producto,
    unidades: fila.unidades,
    ordenes: fila.ordenes,
    entregadas: efectividad.entregadas,
    rechazadas: efectividad.rechazadas,
    otros_resultados: efectividad.otrosDesenlaces,
    en_proceso: efectividad.enProceso,
    efectividad: puntosPorcentuales(efectividad.efectividad),
    rechazo: puntosPorcentuales(efectividad.tasaRechazo),
  };
}
