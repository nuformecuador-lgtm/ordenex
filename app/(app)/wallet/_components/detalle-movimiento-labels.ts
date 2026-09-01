import { RESULTADO_FILA_LABEL } from "@/app/(app)/cierres-admin/_components/cierre-labels";
import type { CierreResultado } from "@/lib/interfaces/services/ICierreDiaService";
import type { MotivoSinReparto } from "@/lib/types/detalle-movimiento";

/**
 * Ficha 344 (T6.1, design §5.2/§5.3/§5.4) — textos del DETALLE de una fila del libro de
 * movimientos de la CAJA PRINCIPAL: de qué cierre sale su importe y qué órdenes lo componen.
 *
 * Módulo PURO (sin React): `docs/conventions` manda los textos de UI fuera del componente, e
 * i18n-ready — nada de literales incrustados en el JSX. Los nombres accesibles son FUNCIONES y
 * no literales para que el concepto y la fecha de la fila sigan siendo parámetros el día que
 * haya i18n, en vez de una concatenación suelta dentro del render.
 *
 * ⚠️ NINGUNA constante de este archivo se llama `PAGINACION_*_LABEL`, y no es capricho de
 * estilo (design §7.3): `tests/components/paginacion/paginacion-transversal.test.tsx` barre
 * `app/` buscando `export const PAGINACION_[A-Z0-9_]*LABEL`, exige que todo archivo que declare
 * una esté en el censo de los TRECE listados del Anexo III de la ficha 170 y cierra con un
 * `toHaveLength(13)`. Este desplegable NO es un listado del Anexo III —es el detalle de UNA
 * fila, igual que el de la ficha 343—, así que bautizar aquí esa constante pondría una guardia
 * ajena en rojo con «14 recibido / 13 esperado» por un motivo falso.
 */

/**
 * Las CINCO columnas del detalle en escritorio, en orden (design §5.3), más la cabecera con la
 * que las cuatro primeras viajan JUNTAS en un teléfono (`orden`).
 *
 * `orden` no es una sexta columna: es el nombre de la MISMA información cuando la pantalla no
 * da para repartirla en cuatro. Por qué existe, medido en Chromium por la ficha 343 a 390x844:
 * con cuatro columnas la tabla pedía 309 px en un hueco de 284 y el IMPORTE, que es la última,
 * se quedaba fuera del área visible: «₡1.700» se leía «₡1.70». Aquí las columnas son CINCO, así
 * que el riesgo es mayor por construcción. Dinero cortado no se ve roto: se ve como OTRO número.
 */
export const DETALLE_MOVIMIENTO_COLUMNAS = {
  guia: "Guía",
  destinatario: "Destinatario",
  tienda: "Tienda",
  resultado: "Resultado",
  aporte: "Aporte",
  orden: "Orden",
} as const;

/** R8: un detalle sin órdenes lo dice; no se deja una tabla muda. */
export const DETALLE_MOVIMIENTO_VACIO =
  "Ninguna orden de este cierre aporta a este concepto.";

/** R7: el fallo se cuenta DENTRO de la fila, y el resto del libro sigue en pie. */
export const DETALLE_MOVIMIENTO_ERROR =
  "No se pudo cargar el detalle de este movimiento. Volvé a abrir la fila en un momento.";

/**
 * R48/R49 — DE DÓNDE SALE el importe de un movimiento de cierre que no se reparte por orden.
 *
 * `Record` TOTAL sobre `MotivoSinReparto`: un motivo nuevo sin frase **rompe el build** en vez
 * de dejar la fila muda. Esa es la mitad de compilación de R49 en la pantalla; la otra mitad
 * —los dos catálogos de fuente— vive en el servidor.
 *
 * La fila SE ABRE IGUAL (R48). El hueco de alcance se VE, no se esconde: quien mire el libro
 * tiene que poder leer por qué ese importe no tiene desglose, en vez de encontrarse un panel en
 * blanco y concluir que la pantalla está rota.
 */
export const DETALLE_MOVIMIENTO_SIN_REPARTO: Record<MotivoSinReparto, string> = {
  no_nace_de_un_cierre:
    "Este movimiento no nace del cierre del día, así que no hay órdenes que lo compongan. " +
    "Su origen está en la columna «Origen» de la fila.",
  snapshot_del_cierre:
    "Este importe es el total que el cierre del día dejó anotado para pagarle al mensajero. " +
    "No se acumula orden por orden, así que no se puede repartir entre ellas: para verlo en " +
    "detalle, abrí el cierre en la pantalla de cierres.",
  suma_del_libro_por_tienda:
    "Este importe es la suma de lo que ese mismo cierre le acreditó a cada tienda por el " +
    "efectivo recaudado. Se arma tienda por tienda y no orden por orden: cada tienda lo ve " +
    "desglosado en su propio libro.",
  otro_productor:
    "Este importe sale de la indemnización anotada en cada gestión del cierre, que la escribe " +
    "un productor distinto del que reparte el resto de conceptos. Todavía no se desglosa acá.",
};

/**
 * R9/R12 — la cabecera del panel: de qué cierre sale el importe y cuántas órdenes lo componen.
 *
 * `cardinales` es la frase que el humano fue a buscar y no encontró: **«14 de 23»**. Son dos
 * CARDINALES, no dinero, y los dos los cuenta la BASE (R28): la pantalla no cuenta nada.
 */
export const DETALLE_MOVIMIENTO_CABECERA = {
  cierre: (fecha: string) => `Cierre del día ${fecha}`,
  /** R15 — sólo la caja principal nombra al mensajero. `/mi-wallet` NO lo pinta. */
  mensajero: (nombre: string) => `Mensajero: ${nombre}`,
  cardinales: (aportan: number, delCierre: number) =>
    `${aportan} de ${delCierre} órdenes del cierre aportan a este concepto`,
  importe: (monto: string) => `Importe del movimiento: ${monto}`,
} as const;

/**
 * R5 — nombres accesibles del desplegable de UNA fila, TODOS con el concepto y la fecha de SU
 * fila dentro.
 *
 * No es adorno: el libro tiene decenas de filas que se abren y pueden estar varias abiertas a
 * la vez; decenas de botones llamados «Ver detalle» y decenas de paginaciones llamadas
 * «Paginación» no identificarían nada para quien navega con lector de pantalla.
 *
 * `abrir` es el nombre del control que antepone la primitiva `DataTable`, que no lleva texto
 * visible (sólo el chevron), así que aquí vive el ÚNICO nombre que ese botón tiene.
 */
export const DETALLE_MOVIMIENTO_NOMBRE = {
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
 * Se exporta el prefijo para que el test no repita el literal, igual que hizo la ficha 341 con
 * `ETIQUETA_VER_ORDEN`.
 */
export const DETALLE_MOVIMIENTO_VER_ORDEN = "Ver en órdenes la guía";

export function etiquetaVerOrden(guia: string): string {
  return `${DETALLE_MOVIMIENTO_VER_ORDEN} ${guia}`;
}

/** Separador entre los resultados de las gestiones de UNA orden en el mismo cierre (R20). */
const SEPARADOR_RESULTADOS = " · ";

/**
 * R13/R20 — el resultado de las gestiones de una orden EN ESE CIERRE, con su etiqueta legible
 * y NUNCA con el valor del enum.
 *
 * El catálogo es el que ya existe (`RESULTADO_FILA_LABEL`, en singular porque una fila es una
 * gestión) y **no se declara una segunda copia**: dos catálogos del mismo enum acaban diciendo
 * cosas distintas de la misma gestión (design §9). Lo único local es el pegamento —el
 * separador—, que es presentación y no contrato.
 *
 * `resultados` trae UN valor POR GESTIÓN: una orden con dos gestiones en el mismo cierre sale
 * en UNA fila (R20) y aquí se leen las dos, para que la fila no esconda que detrás hay dos.
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
