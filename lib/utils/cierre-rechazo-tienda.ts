import type { Prisma } from "@prisma/client";

import type { CierreRechazoDeTienda } from "@/lib/interfaces/services/ICierreDiaService";

/**
 * FICHA 425 (B11, R14) — LA LECTURA DEL VINCULO DE REVISION, DECLARADA UNA SOLA VEZ.
 *
 * Dos superficies leen esta lista con las MISMAS reglas: el detalle del admin
 * (`CierresAdminRepository.findCierreByIdEnAlcance`) y el detalle propio del mensajero
 * (`CierreDiaRepository.findCierrePropioConGestiones`). Las dos acaban en el mismo componente de
 * pantalla, asi que si las consultas divergieran —en la proyeccion o en el orden— el mismo cierre se
 * leeria distinto segun quien lo abra. Molde exacto: `lib/utils/cierre-sin-gestion.ts` (264).
 */

/**
 * Los diez campos que viajan, y NI UNO de dinero: la tabla no tiene columna de importe de la que
 * leerlo (R21). `createdAt` NO entra: es cuando se INCORPORO al cierre, no cuando la tienda rechazo,
 * y confundir las dos fechas es justo lo que haria parecer nuevo un paquete de tres semanas (D3).
 */
export const RECHAZO_DE_TIENDA_SELECT = {
  gestionId: true,
  ordenId: true,
  numGuia: true,
  numRemision: true,
  destinatario: true,
  producto: true,
  tiendaNombre: true,
  zonaNombre: true,
  rechazadoAt: true,
  motivo: true,
} as const;

/**
 * Del rechazo MAS VIEJO al mas reciente (design §5.1-c): lo mas antiguo es lo primero que hay que ir
 * a buscar a la estanteria. `gestion_id` desempata porque es UNICO en la tabla, asi que el orden es
 * total y la lista no baila entre dos recargas de la misma pantalla.
 */
export const ORDEN_RECHAZOS_DE_TIENDA: Prisma.CierreRechazoTiendaOrderByWithRelationInput[] = [
  { rechazadoAt: "asc" },
  { gestionId: "asc" },
];

type RechazoDeTiendaSelectRow = Prisma.CierreRechazoTiendaGetPayload<{
  select: typeof RECHAZO_DE_TIENDA_SELECT;
}>;

/**
 * Passthrough de la fila congelada: lo que se devuelve es EXACTAMENTE lo que el cierre guardo al
 * incorporarla, no lo que la orden tenga hoy. La unica traduccion es la fecha a ISO.
 */
export function toRechazoDeTienda(r: RechazoDeTiendaSelectRow): CierreRechazoDeTienda {
  return {
    gestionId: r.gestionId,
    ordenId: r.ordenId,
    numGuia: r.numGuia,
    numRemision: r.numRemision,
    destinatario: r.destinatario,
    producto: r.producto,
    tiendaNombre: r.tiendaNombre,
    zonaNombre: r.zonaNombre,
    rechazadoAt: r.rechazadoAt.toISOString(),
    motivo: r.motivo,
  };
}
