import { RESULTADO_FILA_LABEL } from "@/app/(app)/cierres-admin/_components/cierre-labels";
import type { CierreResultado } from "@/lib/interfaces/services/ICierreDiaService";
import type { MotivoSinReparto } from "@/lib/types/detalle-movimiento";

/**
 * Ficha 344 (T7.1, design §5.2) — textos del DETALLE de una fila del libro de movimientos de LA
 * PROPIA TIENDA (`/mi-wallet`): de qué cierre sale su importe y qué órdenes lo componen.
 *
 * Módulo PURO (sin React), i18n-ready: los textos de UI viven fuera del JSX y los nombres
 * accesibles son funciones, no literales concatenados dentro del render.
 *
 * DOS MÓDULOS DE TEXTOS Y NO UNO COMPARTIDO (design §5.2/§11-A5). Este panel no pinta la columna
 * «Tienda» —todas sus órdenes son de la misma— y, sobre todo, NO NOMBRA AL MENSAJERO (R15): la
 * ficha 335 decidió expresamente que a la tienda no se le revela quién movió su dinero, y el
 * servidor manda `mensajeroNombre: null` en este libro. Lo único que de verdad no puede divergir
 * —el criterio, la consulta y la derivación del aporte— ya está compartido, en el servidor.
 *
 * ⚠️ NINGUNA constante de este archivo se llama `PAGINACION_*_LABEL` (design §7.3): ese prefijo
 * es el ancla de `tests/components/paginacion/paginacion-transversal.test.tsx`, un censo ajeno
 * que exige una igualdad exacta de TRECE listados del Anexo III. Este desplegable no es uno de
 * ellos, y bautizar así la constante lo pondría rojo por un motivo falso.
 */

/**
 * Las CUATRO columnas del detalle en escritorio, en orden, más la cabecera con la que las tres
 * primeras viajan JUNTAS en un teléfono (`orden`).
 *
 * Sin «Tienda» (R14): en el libro de una tienda esa columna diría lo mismo en todas las filas.
 */
export const DETALLE_MI_MOVIMIENTO_COLUMNAS = {
  guia: "Guía",
  destinatario: "Destinatario",
  resultado: "Resultado",
  aporte: "Aporte",
  orden: "Orden",
} as const;

/** R8: un detalle sin órdenes lo dice; no se deja una tabla muda. */
export const DETALLE_MI_MOVIMIENTO_VACIO =
  "Ninguna orden tuya de este cierre aporta a este concepto.";

/** R7: el fallo se cuenta DENTRO de la fila, y el resto del libro sigue en pie. */
export const DETALLE_MI_MOVIMIENTO_ERROR =
  "No se pudo cargar el detalle de este movimiento. Volvé a abrir la fila en un momento.";

/**
 * R48/R49 — DE DÓNDE SALE el importe de un movimiento que no se reparte por orden, contado desde
 * la tienda.
 *
 * `Record` TOTAL sobre `MotivoSinReparto`: un motivo nuevo sin frase **rompe el build** en vez de
 * dejar la fila muda.
 *
 * Hoy el libro de la tienda sólo puede llegar a `no_nace_de_un_cierre` —sus otros ocho conceptos
 * o se reparten o son el recaudo (`FUENTE_TIENDA`)—, pero las cuatro entradas se escriben igual:
 * el catálogo del servidor puede mover una fuente mañana, y el día que lo haga esta pantalla
 * tiene que tener ya la frase, no un `undefined`.
 */
export const DETALLE_MI_MOVIMIENTO_SIN_REPARTO: Record<MotivoSinReparto, string> = {
  no_nace_de_un_cierre:
    "Este movimiento no nace del cierre del día, así que no hay órdenes que lo compongan. " +
    "Su origen está en la columna «Origen» de la fila.",
  snapshot_del_cierre:
    "Este importe es un total que el cierre del día dejó anotado, no una acumulación orden por " +
    "orden, así que no se puede repartir entre tus órdenes.",
  suma_del_libro_por_tienda:
    "Este importe se arma sumando lo que el cierre acreditó a cada tienda, no orden por orden.",
  otro_productor:
    "Este importe sale de la indemnización anotada en cada gestión del cierre, que la escribe " +
    "un productor distinto del que reparte el resto de conceptos. Todavía no se desglosa acá.",
};

/**
 * R9/R12 — la cabecera del panel: de qué cierre sale el importe y cuántas órdenes lo componen.
 *
 * NO HAY `mensajero` AQUÍ, y su ausencia es el requisito (R15): el servidor manda `null` y esta
 * pantalla no tiene ni la frase con la que pintarlo. Que el dato no llegue Y que no exista el
 * texto son dos cierres distintos del mismo hueco; con los dos, revelar el mensajero en la
 * pantalla de la tienda deja de ser un descuido posible.
 *
 * `cardinales` cuenta las órdenes DE ESTA TIENDA en ese cierre, porque el servidor acota los dos
 * cardinales con el mismo `tienda_id`: si no, diría «14 de 23» contando órdenes ajenas.
 */
export const DETALLE_MI_MOVIMIENTO_CABECERA = {
  cierre: (fecha: string) => `Cierre del día ${fecha}`,
  cardinales: (aportan: number, delCierre: number) =>
    `${aportan} de ${delCierre} órdenes tuyas del cierre aportan a este concepto`,
  importe: (monto: string) => `Importe del movimiento: ${monto}`,
} as const;

/**
 * R5 — nombres accesibles del desplegable de UNA fila, TODOS con el concepto y la fecha de SU
 * fila dentro. El botón que antepone la primitiva `DataTable` no lleva texto visible, así que
 * aquí vive el único nombre que tiene.
 */
export const DETALLE_MI_MOVIMIENTO_NOMBRE = {
  abrir: (concepto: string, fecha: string) =>
    `Ver las órdenes que componen ${concepto} del ${fecha}`,
  region: (concepto: string, fecha: string) =>
    `Órdenes que componen ${concepto} del ${fecha}`,
  tabla: (concepto: string, fecha: string) =>
    `Órdenes que componen ${concepto} del ${fecha}`,
  paginacion: (concepto: string, fecha: string) =>
    `Paginación de las órdenes que componen ${concepto} del ${fecha}`,
  descarga: (concepto: string, fecha: string) =>
    `Órdenes que componen ${concepto} del ${fecha}`,
} as const;

/**
 * R11 — el rótulo del enlace a `/ordenes`. Dice a dónde va Y con qué, nunca «ver».
 *
 * `/ordenes` es visible para `adminTienda`, así que el enlace no lleva a una puerta cerrada; lo
 * que esa pantalla le deja ver a una tienda lo acota ella, no este enlace.
 */
export const DETALLE_MI_MOVIMIENTO_VER_ORDEN = "Ver en órdenes la guía";

export function etiquetaVerMiOrden(guia: string): string {
  return `${DETALLE_MI_MOVIMIENTO_VER_ORDEN} ${guia}`;
}

/** Separador entre los resultados de las gestiones de UNA orden en el mismo cierre (R20). */
const SEPARADOR_RESULTADOS = " · ";

/**
 * R13/R20 — el resultado de las gestiones de una orden EN ESE CIERRE, con su etiqueta legible y
 * NUNCA con el valor del enum.
 *
 * El catálogo es el que ya existe (`RESULTADO_FILA_LABEL`) y **no se declara una segunda copia**
 * (design §9): dos catálogos del mismo enum acaban diciendo cosas distintas de la misma gestión.
 * Lo local es sólo el pegamento —el separador—, que es presentación y no contrato; por eso vive
 * aquí y no se importa del panel de la caja, del que esta pantalla no depende.
 *
 * El `?? String(r)` no es defensivo por costumbre: la guardia de columnas sensibles ejecuta la
 * proyección de la descarga con una SONDA cuyos elementos de lista no son valores del enum, y
 * sin la cola la celda perdería su origen rastreado.
 */
export function resultadosTexto(resultados: readonly CierreResultado[]): string {
  return resultados
    .map((r) => RESULTADO_FILA_LABEL[r] ?? String(r))
    .join(SEPARADOR_RESULTADOS);
}
