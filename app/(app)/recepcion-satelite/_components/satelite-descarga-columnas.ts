/**
 * Feature 170 (T A.2) — columnas de EXPORT del listado de la bodega satélite.
 *
 * Módulo PURO: sin React ni DOM (precedente exacto: `ordenes-descarga-columnas.ts`). Las
 * columnas de export se declaran APARTE de `recibidasColumns`, cuyo `render` devuelve
 * `ReactNode` (`PriceLabel`, badge de intentos) y no cabe en una hoja de cálculo.
 *
 * Se enumeran A MANO (R5/R6): si `RecepcionSateliteDTO` gana un campo, el archivo NO lo
 * publica hasta que se declare aquí. Y no se exporta nada que la tabla no muestre (R24):
 * fuera quedan el `id` de la orden (identificador interno, R23) y el teléfono del
 * destinatario, que el listado de la bodega no pinta.
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";

/**
 * Columnas del archivo, en su orden. Espejan las columnas de datos de
 * `recibidasColumns` y sus encabezados, para que el archivo se lea como la pantalla.
 */
export const COLUMNAS_DESCARGA_SATELITE: DescargaColumna[] = [
  { clave: "numGuia", encabezado: "Nº Guía" },
  { clave: "numRemision", encabezado: "Nº Remisión" },
  { clave: "estatus", encabezado: "Estado" },
  { clave: "intentos", encabezado: "Intentos" },
  { clave: "destinatario", encabezado: "Destinatario" },
  { clave: "producto", encabezado: "Producto" },
  { clave: "direccion", encabezado: "Dirección" },
  { clave: "tienda", encabezado: "Tienda" },
  { clave: "zona", encabezado: "Zona" },
  { clave: "provincia", encabezado: "Provincia" },
  { clave: "canton", encabezado: "Cantón" },
  { clave: "distrito", encabezado: "Distrito" },
  { clave: "montoCobrar", encabezado: "Monto a cobrar" },
];

/**
 * Proyecta una orden de la bodega a una fila de export con valores CRUDOS (R7): texto,
 * número o `null` (celda vacía). Sin placeholders de presentación: la tabla pinta "—" o
 * "Pendiente" donde no hay dato, pero una celda vacía en la hoja es una celda vacía.
 *
 * El Estado va como ETIQUETA LEGIBLE (R8), sin el sufijo " de <zona>" que la tabla
 * compone: la zona ya viaja en su propia columna y repetirla en el estado convierte un
 * dato en dos. `intentosEntrega` usa `?? 0` porque el 0 es un valor CONOCIDO (160/R14).
 */
export function filaDescargaSatelite(orden: RecepcionSateliteDTO): DescargaFila {
  return {
    numGuia: orden.numGuia,
    numRemision: orden.numRemision,
    estatus: estatusLabel(orden.estatusValue),
    intentos: orden.intentosEntrega ?? 0,
    destinatario: orden.destinatario,
    producto: orden.producto,
    direccion: orden.direccion ?? null,
    tienda: orden.tiendaNombre ?? null,
    zona: orden.zonaNombre ?? null,
    provincia: orden.provinciaNombre ?? null,
    canton: orden.cantonNombre ?? null,
    distrito: orden.distritoNombre ?? null,
    montoCobrar: orden.montoCobrar ?? null,
  };
}
