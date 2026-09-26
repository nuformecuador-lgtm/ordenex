/**
 * Feature 205 (T6.1/T6.2, R39/R43/R44) — la DIRECCIÓN de un cierre concreto.
 *
 * El módulo vive en `lib/utils/cierre-enlace.ts` desde la 458-A (revisión m2): lo lee también
 * `OrigenLegibleService`, y un servicio de `lib/` no importa de `app/**\/_components`. Se re-exporta
 * aquí para sus consumidores de siempre (`CierresAdminModule`, la wallet de mensajeros, órdenes):
 * el parámetro sigue escrito UNA sola vez.
 */
export { PARAM_CIERRE, RUTA_CIERRES_ADMIN, hrefDetalleCierre } from "@/lib/utils/cierre-enlace";
