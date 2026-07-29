/**
 * Feature 151 (design §7, R35) — columnas de EXPORT del listado de órdenes.
 *
 * Módulo PURO: sin React ni DOM. Las columnas del export se declaran APARTE de
 * `ordenesColumns` (`Column<OrdenListItemDTO>`) porque el `render` de aquéllas devuelve
 * `ReactNode` (insignias, `PriceLabel`, iconos) y una hoja de cálculo solo admite valores
 * crudos (D5). Aquí cada celda es `string | number | null` y nada más.
 *
 * Las columnas se enumeran A MANO, igual que `COLUMNAS_MANIFIESTO`: si el DTO del listado
 * crece, el archivo NO publica el campo nuevo en silencio — hay que declararlo aquí. Por la
 * misma regla del manifiesto, NO se exponen identificadores internos (`id`, `tiendaId`,
 * `zonaId`, …), banderas de borrado ni datos ajenos a la orden: las relaciones se proyectan
 * a su NOMBRE legible.
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { estatusLabel } from "./estatus-label";

/**
 * Columnas emitidas por la descarga del listado de órdenes, en su orden. Los encabezados
 * son las etiquetas legibles que ve el usuario en la tabla; las claves indexan la fila que
 * devuelve `filaDescargaOrden`.
 *
 * Deliberadamente NO se exportan las columnas derivadas de la tarifa (flete, fulfillment,
 * comisión) ni "Tiempo": son cálculos de presentación, no datos de la orden.
 */
export const COLUMNAS_DESCARGA_ORDENES: DescargaColumna[] = [
  { clave: "numGuia", encabezado: "Nº Guía" },
  { clave: "numRemision", encabezado: "Nº Remisión" },
  { clave: "estatus", encabezado: "Estado" },
  { clave: "destinatario", encabezado: "Destinatario" },
  { clave: "producto", encabezado: "Producto" },
  { clave: "direccion", encabezado: "Dirección" },
  { clave: "tienda", encabezado: "Tienda" },
  { clave: "zona", encabezado: "Zona" },
  { clave: "provincia", encabezado: "Provincia" },
  { clave: "canton", encabezado: "Cantón" },
  { clave: "distrito", encabezado: "Distrito" },
  { clave: "montoCobrar", encabezado: "Monto a cobrar" },
  { clave: "mensajero", encabezado: "Mensajero" },
  { clave: "intentos", encabezado: "Intentos" },
  { clave: "fechaCreacion", encabezado: "Fecha de creación" },
];

/**
 * Fecha de creación como `YYYY-MM-DD` en el calendario de Costa Rica. El DTO tipa
 * `createdAt: Date`, pero según el borde de serialización puede llegar como string ISO
 * (misma coacción defensiva que `ordenes-columns`). Fecha inválida → celda vacía.
 *
 * NO se usa `toISOString().slice(0, 10)`: emitiría el día siguiente después de las 18:00
 * de CR (off-by-one documentado en `lib/utils/fecha-cr`).
 */
function fechaCreacion(value: Date | string): string | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : fechaCalendarioCR(d);
}

/** Etiqueta legible del estado; sin estatus resuelto → celda vacía (R6). */
function estado(orden: OrdenListItemDTO): string | null {
  const value = orden.relaciones?.estatus?.value ?? orden.estatusValue;
  return value ? estatusLabel(value) : null;
}

/**
 * Proyecta una orden del listado a una fila de export con valores CRUDOS (R35): texto,
 * número o `null` (celda vacía). Los ids se resuelven a nombre legible vía `relaciones` y,
 * cuando la relación opcional no resolvió, se cae a los escalares `tiendaNombre`/
 * `zonaNombre` y luego a `null` — nunca al placeholder "—", que es presentación.
 *
 * `intentosEntrega` usa `?? 0`: el 0 es un valor CONOCIDO, no un dato ausente (160/R14).
 */
export function filaDescargaOrden(orden: OrdenListItemDTO): DescargaFila {
  return {
    numGuia: orden.numGuia,
    numRemision: orden.numRemision,
    estatus: estado(orden),
    destinatario: orden.destinatario,
    producto: orden.producto,
    direccion: orden.direccion ?? null,
    tienda: orden.relaciones?.tienda?.nombre ?? orden.tiendaNombre ?? null,
    zona: orden.relaciones?.zona?.nombre ?? orden.zonaNombre ?? null,
    provincia: orden.relaciones?.provincia?.nombre ?? null,
    canton: orden.relaciones?.canton?.nombre ?? null,
    distrito: orden.relaciones?.distrito?.nombre ?? null,
    montoCobrar: orden.montoCobrar ?? null,
    mensajero: orden.relaciones?.mensajeroAsignado?.nombre ?? null,
    intentos: orden.intentosEntrega ?? 0,
    fechaCreacion: fechaCreacion(orden.createdAt),
  };
}
