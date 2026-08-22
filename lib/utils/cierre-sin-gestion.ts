import { Prisma } from "@prisma/client";

import type { CierreSinGestionRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import { esOrderStatusValue } from "@/lib/types/order-status-transiciones";

/**
 * Feature 264 — LA LECTURA DEL VINCULO, DECLARADA UNA SOLA VEZ.
 *
 * Dos superficies leen esta lista con las MISMAS reglas: el detalle del admin
 * (`CierresAdminRepository.findCierreByIdEnAlcance`) y el detalle propio del mensajero
 * (`CierreDiaRepository.findCierrePropioConGestiones`). Son el mismo componente de pantalla
 * (`CierreFacturaDetalle`), asi que si las dos consultas divergieran —en la proyeccion o en el
 * orden— el mismo cierre se leeria distinto segun quien lo abra. Es el error a medias que la 263
 * corrigio, y aqui se hace imposible: hay UN select y UN orden, no dos literales.
 */

/**
 * R9 — los ocho campos que viajan, y NI UNO de dinero. `created_at` NO entra: en las filas del
 * backfill valdria la fecha de la migracion, asi que es un dato que mentiria en el 100 % de las
 * filas viejas, y un dato que miente es peor que un dato ausente (design §2.1).
 */
export const SIN_GESTION_SELECT = {
  ordenId: true,
  numGuia: true,
  numRemision: true,
  destinatario: true,
  producto: true,
  tiendaNombre: true,
  zonaNombre: true,
  // R4: el estatus del que SALIO la orden, resuelto a su `value` de catalogo (los ids son
  // distintos en cada base). La relacion es opcional: `null` = no consta (R32/R33).
  estatusOrigen: { select: { value: true } },
} as const;

/**
 * R12 — ORDEN ESTABLE Y DETERMINISTA entre dos lecturas del mismo cierre.
 *
 * Por guia y, a igualdad, por remision. `num_guia` es nullable (una orden puede no tener guia) y
 * Postgres coloca los `NULL` al final en un `ASC`, siempre en el mismo sitio: no hay empate que
 * el motor pueda romper de dos maneras. La remision desempata porque es unica por orden, asi que
 * el par (guia, remision) es unico dentro de un cierre. Sin un orden explicito, Postgres es libre
 * de devolver las filas como le convenga y la lista bailaria entre dos recargas de la misma
 * pantalla sin que nadie tocara nada.
 */
export const ORDEN_SIN_GESTION: Prisma.CierreSinGestionOrderByWithRelationInput[] = [
  { numGuia: "asc" },
  { numRemision: "asc" },
];

type SinGestionSelectRow = Prisma.CierreSinGestionGetPayload<{
  select: typeof SIN_GESTION_SELECT;
}>;

/**
 * Mapper de la fila congelada. Passthrough puro: lo que se devuelve es EXACTAMENTE lo que el
 * corte guardo (R11), no lo que la orden tenga hoy. La unica traduccion es el `value` del
 * estatus de origen.
 */
export function toSinGestionRow(r: SinGestionSelectRow): CierreSinGestionRow {
  const value = r.estatusOrigen?.value;
  return {
    ordenId: r.ordenId,
    numGuia: r.numGuia,
    numRemision: r.numRemision,
    destinatario: r.destinatario,
    producto: r.producto,
    tiendaNombre: r.tiendaNombre,
    zonaNombre: r.zonaNombre,
    // El guard y no un `as`: un value que no este en el catalogo no es un estatus que la pantalla
    // pueda traducir, y R32 ya dice que hacer con lo que no consta —OMITIR la pieza—. Un cast
    // dejaria colar una cadena cruda hasta el rotulo.
    estatusOrigen: value !== undefined && esOrderStatusValue(value) ? value : null,
  };
}
