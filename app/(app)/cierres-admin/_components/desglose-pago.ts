/**
 * Feature 213 (T6) — el ÚNICO formateador del desglose de pago de una entrega.
 *
 * Desde 2026-08-19 tiene DOS clientelas. Las dos funciones de FORMATO de aquí abajo
 * (`desglosePantalla` / `desgloseDescarga`) concatenan el desglose en UNA celda, y las siguen
 * usando el cierre del día del mensajero (tabla y descarga) y el comprobante de factura. El
 * detalle de cierres del admin y sus dos descargas pasaron a UNA COLUMNA POR MEDIO, que se
 * arma con `montoPorMetodo` (ver el bloque del final del archivo).
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

// ---------------------------------------------------------------------------
// Una COLUMNA POR MEDIO DE PAGO (2026-08-19)
// ---------------------------------------------------------------------------
//
// Las dos tablas del detalle de un cierre y los dos modulos de descarga de gestiones ya no
// pintan la celda unica «Metodo» con el desglose concatenado: pintan una columna POR MEDIO,
// con el monto de ese medio y nada mas. El dato es el mismo `pagos` del DTO; lo que cambia es
// que la hoja de calculo puede sumar la columna «Efectivo» sin parsear "Efectivo 100 + SINPE 50".
//
// NO se suma nada aqui, y no hace falta: `gestion_orden_pago` tiene
// `@@unique([gestionId, metodo])` (D2/R2 de la 212), asi que un medio aparece COMO MUCHO una
// vez y su monto ya viene sumado del servidor. Money-safe por construccion: se devuelve el
// STRING del snapshot tal cual, sin `parseFloat` ni aritmetica.
//
// `desglosePantalla` / `desgloseDescarga` siguen VIVAS y no se retiran: las consume el cierre
// del dia del mensajero (tabla y descarga) y el comprobante de factura, que siguen con la celda
// unica.

/**
 * Los medios de pago, EN EL ORDEN de declaracion del enum (`efectivo`, `SINPE`,
 * `transferencia`), que es el mismo que el servidor garantiza en `pagos` (R24).
 *
 * Se derivan de `METODO_LABEL` y no se teclean: ese mapa es `Record<MetodoPagoValue, string>`,
 * asi que un medio nuevo en el enum ROMPE el build alli y aparece aqui como columna sin que
 * nadie tenga que acordarse de una segunda lista.
 */
export const MEDIOS_PAGO = Object.keys(METODO_LABEL) as MetodoPagoValue[];

/**
 * Clave de descarga de la columna de cada medio. Lleva prefijo porque las claves de una fila de
 * export comparten espacio de nombres con las demas columnas (`motivo`, `recibido`...) y
 * `efectivo` suelto es un nombre que otro concepto podria querer manana.
 *
 * Es un mapa CONSTANTE y no una plantilla (`pago_${metodo}`) porque la hoja fundida declara sus
 * claves especificas como tuplas literales: con `as const` estas claves conservan su tipo
 * literal y el compilador cruza la declaracion de columnas con la proyeccion de la fila. El
 * `satisfies` obliga a que el mapa sea exhaustivo sobre el enum.
 */
export const CLAVE_MEDIO_PAGO = {
  efectivo: "pago_efectivo",
  SINPE: "pago_SINPE",
  transferencia: "pago_transferencia",
} as const satisfies Record<MetodoPagoValue, string>;

/**
 * El monto de CADA medio para una entrega: el STRING del snapshot, o `null` si ese medio no
 * tiene linea. `null` NO es cero: es «por ahi no entro dinero», y quien pinta decide si eso se
 * ve como celda vacia (archivo, R30) o como "—" (pantalla, R22).
 */
export function montoPorMetodo(
  pagos: readonly LineaPagoDTO[],
): Record<MetodoPagoValue, string | null> {
  const porMetodo = {} as Record<MetodoPagoValue, string | null>;
  for (const metodo of MEDIOS_PAGO) porMetodo[metodo] = null;
  for (const pago of pagos) porMetodo[pago.metodo] = pago.monto;
  return porMetodo;
}
