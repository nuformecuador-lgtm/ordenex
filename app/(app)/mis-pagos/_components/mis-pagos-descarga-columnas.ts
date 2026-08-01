/**
 * Feature 170 (T C.3, design §3/§7) — columnas de EXPORT del desglose de pagos del
 * MENSAJERO (su propia vista, `/mis-pagos`).
 *
 * Módulo PURO: sin React ni DOM. Se declaran APARTE de las `Column<…>` de `DesglosePagos`,
 * cuyo `render` devuelve una insignia de tipo (R7).
 *
 * MONEY-SAFE: el monto se emite como el STRING que llega del servidor, TAL CUAL. Sin
 * `parseFloat`/`Number` y sin el símbolo de colón (presentación).
 *
 * Es la MISMA forma de fila que el desglose del admin (`desglose-mensajero-descarga-columnas`)
 * porque es el MISMO DTO y la misma tabla; se declara aparte —y no se comparte— porque son
 * dos superficies con alcances distintos: ésta está acotada al `mensajero_id` del actor y
 * aquélla al mensajero que el admin elige. Compartir el módulo ahorraría 20 líneas y ataría
 * dos decisiones de columnas que pueden divergir (por ejemplo, si mañana la vista del admin
 * añade una columna que el mensajero no debe ver).
 *
 * Lo que NO sale: `id`, `origenId` y `mensajeroId` (uuid internos, R23) ni `registradoPor`.
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { PagoMensajeroMovimientoDTO } from "@/lib/types/wallet-mensajero";
import { fechaDiaISO } from "@/lib/utils/fecha-dia-iso";

import { CATEGORIA_PAGO_LABEL, ORIGEN_PAGO_LABEL, TIPO_PAGO_LABEL } from "./mis-pagos-labels";

/** Columnas emitidas por la descarga de «mis pagos», en su orden de pantalla. */
export const COLUMNAS_DESCARGA_MIS_PAGOS: DescargaColumna[] = [
  { clave: "fecha", encabezado: "Fecha" },
  { clave: "tipo", encabezado: "Tipo" },
  { clave: "concepto", encabezado: "Concepto" },
  { clave: "monto", encabezado: "Monto" },
  { clave: "origen", encabezado: "Origen" },
];

/** Origen legible: la MISMA composición que pinta la tabla (etiqueta · descripción). */
function origen(movimiento: PagoMensajeroMovimientoDTO): string {
  const base = ORIGEN_PAGO_LABEL[movimiento.origenTipo] ?? movimiento.origenTipo;
  return movimiento.descripcion ? `${base} · ${movimiento.descripcion}` : base;
}

/**
 * Proyecta un movimiento propio del mensajero a una fila de export con valores CRUDOS (R7).
 * Tipo y concepto salen como su ETIQUETA LEGIBLE (R8), la misma de pantalla.
 */
export function filaDescargaMiPago(movimiento: PagoMensajeroMovimientoDTO): DescargaFila {
  return {
    fecha: fechaDiaISO(movimiento.fechaMovimiento),
    tipo: TIPO_PAGO_LABEL[movimiento.tipo] ?? movimiento.tipo,
    concepto: CATEGORIA_PAGO_LABEL[movimiento.categoria] ?? movimiento.categoria,
    monto: movimiento.monto, // STRING tal cual (money-safe)
    origen: origen(movimiento),
  };
}
