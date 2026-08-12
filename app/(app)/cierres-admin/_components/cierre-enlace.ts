/**
 * Feature 205 (T6.1/T6.2, design §4.1, R39/R43/R44) — la DIRECCIÓN de un cierre concreto.
 *
 * Módulo PURO (sin React, sin DOM): lo comparten quien construye el enlace —el desglose y la
 * previsualización de `/wallet/mensajeros`— y quien lo lee —`CierresAdminModule`—. Vive en un
 * archivo propio, y no dentro del módulo, por dos motivos concretos:
 *
 *  1. **el nombre del parámetro se escribe UNA vez.** Si el emisor y el lector lo declararan
 *     cada uno por su lado, renombrarlo dejaría el enlace apuntando a un parámetro que ya nadie
 *     lee: la pantalla abriría sin el detalle y ningún test de una de las dos mitades lo vería;
 *  2. **la wallet no arrastra el módulo de cierres.** Importar `CierresAdminModule` solo para
 *     leer una constante metería esa pantalla entera —tablas, modales y sus acciones— en el
 *     paquete de `/wallet/mensajeros`.
 *
 * NO es una ruta nueva: `/cierres-admin` sigue siendo UNA página y el detalle sigue siendo
 * estado de cliente (design §4.2 descartó la ruta propia). Esto es el parámetro de búsqueda que
 * la hace direccionable.
 */

/** El parámetro de búsqueda que abre el detalle de un cierre: `/cierres-admin?cierre=<uuid>`. */
export const PARAM_CIERRE = "cierre";

/** La ruta de la pantalla que sabe abrir ese detalle. */
export const RUTA_CIERRES_ADMIN = "/cierres-admin";

/**
 * El enlace al detalle de UN cierre (R39): estable, compartible y recargable.
 *
 * El id se codifica aunque hoy sea un uuid: quien construye una URL con un valor que no controla
 * y no lo codifica escribe la próxima inyección de parámetros de esta pantalla.
 */
export function hrefDetalleCierre(cierreId: string): string {
  return `${RUTA_CIERRES_ADMIN}?${PARAM_CIERRE}=${encodeURIComponent(cierreId)}`;
}
