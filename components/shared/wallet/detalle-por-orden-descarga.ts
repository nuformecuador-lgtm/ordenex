/**
 * Ficha 464 (design §5.2) — lo COMÚN de la hoja «Detalle por orden» de las tres superficies que la
 * ofrecen (la caja, el estado de cuenta de una tienda en la oficina y `/mi-wallet`): sus textos, sus dos
 * columnas fijas y el texto de la columna «Detalle por orden» de cada movimiento.
 *
 * Módulo PURO (sin React). Lo propio de cada superficie —su catálogo, su ámbito, el diccionario del
 * motivo sin reparto que ya pinta su panel— vive en su `*-descarga-columnas.ts`.
 *
 * Textos en español claro y sin siglas (R44). Montos: el STRING del servidor, tal cual (R31).
 */
import type { DataTableDescargaDetalle } from "@/components/shared/DataTable";
import type { DescargaColumna } from "@/lib/types/descarga";
import type { MotivoSinReparto } from "@/lib/types/detalle-movimiento";
import type { DetalleDeMovimientoLoteDTO } from "@/lib/types/detalle-en-lote";

/** Textos de la hoja y de las dos opciones del selector (R6: cada opción dice cuántas hojas lleva). */
export const DETALLE_POR_ORDEN_TEXTO = {
  hoja: "Detalle por orden",
  opcion: "Movimientos y detalle por orden · dos hojas",
  sinDetalle: "Solo los movimientos · una hoja",
} as const;

/** R15/R19 — primera columna de las DOS hojas: el número del movimiento en este archivo. FIJA (R17). */
export const COLUMNA_NUMERO_MOVIMIENTO: DescargaColumna = { clave: "numero", encabezado: "N.º" };

/** R16 — última columna de la hoja de movimientos: qué detalle tiene cada uno. FIJA (R17). */
export const COLUMNA_DETALLE_POR_ORDEN: DescargaColumna = {
  clave: "detallePorOrden",
  encabezado: "Detalle por orden",
};

/** Lo común de la configuración de la hoja de detalle; cada superficie añade catálogo y ámbito. */
export const DETALLE_POR_ORDEN_COMUN: Omit<DataTableDescargaDetalle, "ambitoColumnas" | "columnas"> = {
  titulo: DETALLE_POR_ORDEN_TEXTO.hoja,
  etiquetaOpcion: DETALLE_POR_ORDEN_TEXTO.opcion,
  etiquetaSinDetalle: DETALLE_POR_ORDEN_TEXTO.sinDetalle,
  columnaEnlace: COLUMNA_NUMERO_MOVIMIENTO,
  columnaEstado: COLUMNA_DETALLE_POR_ORDEN,
};

/** «1 orden» / «3 órdenes»: un cardinal de la base, nunca dinero. */
function ordenesTexto(n: number): string {
  return n === 1 ? "1 orden" : `${n} órdenes`;
}

/**
 * R16/R23 — el texto de «Detalle por orden» de UN movimiento:
 *  - con reparto y cuadrando: cuántas órdenes lo componen;
 *  - con reparto y SIN cuadrar (lo decide el servidor con Decimal): lo dice, con la suma de las órdenes;
 *  - sin reparto: el motivo, con el MISMO texto que da hoy el detalle de esa fila en pantalla
 *    (`sinReparto` es el diccionario del panel de la superficie, no una copia).
 */
export function textoDetallePorOrden(
  detalle: DetalleDeMovimientoLoteDTO,
  sinReparto: Readonly<Record<MotivoSinReparto, string>>,
): string {
  if (detalle.modo === "sin_reparto") return sinReparto[detalle.motivo];
  const cuantas = ordenesTexto(detalle.ordenes.length);
  if (detalle.cuadra) return cuantas;
  return `${cuantas}. La suma de las órdenes es ${detalle.suma} y no coincide con el monto del movimiento.`;
}
