import type { WalletMovimientoCategoria } from "@/lib/types/wallet";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-E (revision M2, R59) — DE QUE FILA es la anotacion («a quien» libre) de una fila de la
// caja con origen `gasto` o `manual`.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// El nombre libre (`wallet_anotacion.contraparte_nombre`) se escribe en la fila ORIGINAL de un sueldo,
// un gasto de Ordenex o una correccion. Su contra-asiento NO lleva anotacion propia:
//   · el de un egreso (`EgresoCajaAnulacionService`, y el reverso viejo de `WalletEgresoService`):
//     `ingreso_ajuste`, origen `gasto`, `origen_id` = id del egreso;
//   · el de una correccion (`AjusteCajaService.anular`): la correccion opuesta (`ingreso_ajuste` /
//     `egreso_ajuste`), origen `manual`, `origen_id` = id de la correccion (la original lleva
//     `origen_id` NULL).
// Sin esta regla, filtrar por «Pedro» con un sueldo anulado contaba la salida y no su vuelta: las
// tarjetas decian −₡100.000 cuando el efecto real es 0. Con ella, el contra-asiento es «de Pedro»
// igual que su original — en el filtro, en las opciones del selector y en la columna «A quién».
//
// Una sola definicion: la usa el SQL del filtro (`libro-caja-a-quien-sql.ts`) y la columna
// (`LibroCajaAutoriaService`), para que filtro y columna no puedan discrepar.

/** Las categorias de un contra-asiento de egreso o de correccion (con `origen_id` = la original). */
export const CATEGORIAS_CONTRA_ASIENTO_ANOTADO: readonly WalletMovimientoCategoria[] = ["ingreso_ajuste", "egreso_ajuste"];

/**
 * El id de la fila cuya anotacion vale para `m`: la ORIGINAL si `m` es su contra-asiento, `m` si no.
 * Solo tiene sentido para filas de origen `gasto` o `manual` (las unicas que se anotan).
 */
export function movimientoDeLaAnotacion(m: {
  id: string;
  categoria: WalletMovimientoCategoria;
  origenId: string | null;
}): string {
  return m.origenId !== null && CATEGORIAS_CONTRA_ASIENTO_ANOTADO.includes(m.categoria) ? m.origenId : m.id;
}
