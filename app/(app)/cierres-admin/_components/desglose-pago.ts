/**
 * Feature 213 (T6) — el ÚNICO formateador del desglose de pago de una entrega, para los
 * cinco consumidores que lo pintan: las dos tablas del detalle, el comprobante de factura y
 * los dos módulos de descarga.
 *
 * Módulo PURO: sin React y sin runtime de `@prisma/client` (solo `import type`), igual que
 * su vecino `cierre-labels.ts`, porque lo importan módulos de descarga que se declaran puros.
 *
 * Hay DOS funciones y no una con un flag (design §2): la pantalla formatea con `money()`
 * —moneda de configuración, nunca un símbolo incrustado— y el archivo NO puede hacerlo
 * (R31: money-safe, el STRING del servidor tal cual, sin `parseFloat`/`Number`/`toFixed`).
 * Un solo formateador con un flag sería una invitación permanente a colar el flag
 * equivocado en el camino equivocado.
 *
 * Reglas comunes (R20/R21/R24/R25/R29/R30):
 *   0 líneas -> `null` (el llamador pinta su propio marcador de ausencia o deja la celda vacía)
 *   1 línea  -> SOLO la etiqueta, idéntico a lo que se pintaba antes del desglose ([Q2])
 *   2+       -> etiqueta + monto por línea, EN EL ORDEN RECIBIDO
 *
 * NINGUNA función de aquí ordena la lista (R24): el orden es el que el servidor garantiza
 * determinista (orden de declaración del enum). Reordenar aquí sería inventar un orden
 * distinto del que dice el DTO.
 */
import type { MetodoPagoValue } from "@prisma/client";

import { money } from "@/lib/config/moneda";

import { METODO_LABEL } from "./cierre-labels";

/** Una línea del desglose tal como viaja en el DTO: `monto` es STRING money-safe. */
export type LineaPagoDTO = { metodo: MetodoPagoValue; monto: string };

/** Separador entre líneas dentro de la MISMA celda (texto separado, i18n-ready). */
export const SEPARADOR_DESGLOSE = " + ";

/**
 * Texto de PANTALLA. `null` si no hay líneas -> el llamador pinta su propio "—" (R22),
 * que es lo que ya hacía con el campo escalar.
 */
export function desglosePantalla(pagos: readonly LineaPagoDTO[]): string | null {
  if (pagos.length === 0) return null;
  if (pagos.length === 1) return METODO_LABEL[pagos[0].metodo];
  return pagos
    .map((p) => `${METODO_LABEL[p.metodo]} ${money(p.monto)}`)
    .join(SEPARADOR_DESGLOSE);
}

/**
 * Texto de ARCHIVO. `null` si no hay líneas -> celda VACÍA (R30), nunca el "—" de pantalla.
 *
 * MONEY-SAFE (R31): el monto es el STRING del servidor TAL CUAL. Aquí no hay `money()`, ni
 * símbolo, ni separador de miles: el archivo lo consume una hoja de cálculo, no una persona
 * ([Q1] cerrada en la puerta del 2026-08-13).
 */
export function desgloseDescarga(pagos: readonly LineaPagoDTO[]): string | null {
  if (pagos.length === 0) return null;
  if (pagos.length === 1) return METODO_LABEL[pagos[0].metodo];
  return pagos
    .map((p) => `${METODO_LABEL[p.metodo]} ${p.monto}`)
    .join(SEPARADOR_DESGLOSE);
}
