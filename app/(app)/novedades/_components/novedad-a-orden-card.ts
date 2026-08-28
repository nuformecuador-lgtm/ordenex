import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";
import type { NovedadDTO } from "@/lib/types/novedad";

import type { PosSecciones } from "@/app/(app)/mis-asignaciones/_components/pos-card/pos-secciones";

// 2026-08-12 (pedido humano) — ADAPTADOR de `NovedadDTO` a la orden que consumen las cards
// POS (`PosOrderCardMosaico` y `PosOrderCardDetalle`), para que `/novedades` deje de tener
// su propia fila a mano y use las MISMAS cards que las órdenes del mensajero.
//
// 2026-08-13 (pedido humano) — POR QUÉ YA CASI NO HAY ADAPTADOR. Aquí decía justo lo
// contrario: que `RecoleccionOrdenDTO` podía pasarse directo porque EXTIENDE
// `MiAsignacionDTO` y que `NovedadDTO` no podía, porque traía ocho campos de los diecinueve
// que la card pide. Eso dejó de ser cierto: `NovedadDTO extends MiAsignacionDTO` siguiendo
// ESE MISMO precedente (ver la cabecera de `lib/types/novedad.ts`). Los campos salen de la
// fila de `orden` que el repositorio ya leía, así que no hubo lectura nueva, sólo un
// `select` más ancho — y con ellos se fueron los DIEZ rellenos que vivían aquí abajo
// (dirección, coordenadas, monto, notas y los cuatro nombres de tienda/zona/provincia/
// cantón/distrito) junto con las tres secciones que había que apagar para taparlos.
//
// Queda derogado el criterio que justificaba el recorte («el DTO sólo crece cuando la
// pantalla PINTA el dato»): la pantalla los pinta todos. Lo pedido fue explícito — las
// cards de `/novedades` muestran EXACTAMENTE lo mismo que las de «En reparto»/«Entregas»:
// los datos del pedido, los de la entrega, los del cobro y el desplegable «Ver detalle
// completo».
//
// LA REGLA QUE SE RESPETÓ AL DESHACERLO, que es lo único delicado de este archivo.
// `pos-secciones` avisa: «apagar una sección NO es cosmético, es lo que permite pasar una
// orden que no tiene esos datos». Su recíproca es la que manda hoy: encender una sección sin
// traer su dato haría que la card pintara el relleno («Sin dirección», un «Valor a cobrar» en
// cero). Por eso los rellenos y el mapa de secciones se mueven JUNTOS, en el mismo cambio, y
// por eso el mapa sigue viviendo en ESTE archivo y no suelto en el JSX del módulo: traer los
// datos sin encender las secciones no habría servido de nada, y encenderlas sin los datos
// habría pintado relleno.
//
// NULABILIDAD HONESTA. Un dato ausente viaja como `null`, NUNCA como `""` ni como `0`: la
// card ya sabe pintar el hueco (`formatMonto`/`formatPeso` dan la raya larga, la línea de
// ubicación omite lo que falta, `AsignacionDetalle` pinta "—"). Un cero de relleno no se
// distingue de un cero real; una raya sí se distingue de un monto.

/**
 * Qué secciones de la card tienen dato en `/novedades`: LAS CUATRO, desde el 2026-08-13
 * (pedido humano). Cada una se encendió en el mismo cambio que trajo su dato:
 *
 * - `navegacion` SÍ: `direccion`, `latitud`/`longitud` y los nombres de cantón/distrito ya
 *   viajan. En la card de DETALLE esta compuerta hace un trabajo extra que conviene no
 *   perder de vista: gobierna la LÍNEA de ubicación entera, no sólo el botón de navegar
 *   (decisión de la feature 199). Encenderla enciende las dos, y con dato real: su fallback
 *   «Sin dirección» no es alcanzable en la práctica porque `cantonNombre` es NOT NULL.
 * - `cobro` SÍ. La justificación vieja («una orden devuelta no cobra; un "₡0" sería una
 *   cifra inventada») era cierta MIENTRAS el monto fuera un relleno. Ya no lo es: llega el
 *   `montoCobrar` REAL de la orden, que es lo que se IBA a cobrar en la entrega que no se
 *   completó, y esa cifra es justamente la que la tienda necesita ver junto a la devolución.
 *   No es un cero inventado, es el dato. Y cuando la orden no tiene monto, `montoCobrar` es
 *   `null` y la card pinta la raya larga: el hueco tampoco se rellena con `0`.
 * - `detalle` SÍ: el desplegable «Ver detalle completo» monta `AsignacionDetalle` (Pedido /
 *   Entrega / Cobro) con datos de verdad en sus tres secciones. Ya no hay "seis campos que
 *   siguen siendo rellenos": dirección, provincia, cantón, distrito, notas y monto llegan
 *   del DTO. Ojo con el alcance: la compuerta es load-bearing SÓLO en la mosaico; la card de
 *   detalle es una fila y nunca tuvo desplegable, así que ahí es INERTE (verificado en
 *   `PosOrderCardDetalle`, que ni siquiera desestructura `detalle`).
 * - `intentos` SÍ, como desde la feature 160 (R18).
 */
export const SECCIONES_NOVEDAD: PosSecciones = {
  navegacion: true,
  cobro: true,
  detalle: true,
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
 * La orden que las cards consumen. Casi todo es un spread: `NovedadDTO` YA ES un
 * `MiAsignacionDTO`, así que no hay nada que traducir.
 *
 * Sobreviven exactamente tres gestos, y los tres son decisiones de PRESENTACIÓN de esta
 * pantalla, no del contrato:
 *
 *  1. `numRemision` se sobreescribe con `etiquetaGuia(numGuia)`. El DTO trae la remisión
 *     REAL, pero el identificador de `/novedades` es la guía (F1.4 #1 + R9). Ver el docstring
 *     de `etiquetaGuia`: es el POR QUÉ de que el número visible sea el otro.
 *  2. `causa` se queda fuera. Es el campo propio de `NovedadDTO` y la card no sabe qué es:
 *     lo consume el MÓDULO, que lo traduce a etiqueta ES y lo baja por la prop `estado`
 *     (el badge). Pasárselo a la card sería ruido que nadie lee.
 *  3. FICHA 296 — `mensajeroNombre` se queda fuera POR EL MISMO MOTIVO, y no por uno nuevo: la
 *     card NO lo lee de `orden`, porque `orden` es un `MiAsignacionDTO` y ese contrato es el del
 *     PORTAL DEL MENSAJERO, donde el mensajero es quien mira y su nombre no informa de nada. Lo
 *     baja el MÓDULO por la prop `mensajero` de la card —la misma vía por la que ya bajan
 *     `estado`, `acciones` y `mostrarRuta`, que también son datos que sólo tiene esta pantalla—.
 *     Dejarlo colarse en el spread lo metería en el objeto como un polizón que nadie lee y haría
 *     creer que la card lo recibe por ahí.
 */
export function novedadAOrdenCard({
  causa: _causa,
  mensajeroNombre: _mensajeroNombre,
  ...orden
}: NovedadDTO): MiAsignacionDTO {
  return {
    ...orden,
    numRemision: etiquetaGuia(orden.numGuia),
  };
}
