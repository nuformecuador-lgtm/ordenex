// Feature 267 (T1) — LISTA BLANCA DE METRICAS PUBLICABLES POR EL CANAL DE API KEY.
//
// Que es y que NO es:
//   - Es una lista de IDS: dice QUE SE PUBLICA por el canal integrador.
//   - NO es una tabla de alcance por rol (R21 / R8 de la 122). No dice QUE VE nadie:
//     eso lo sigue diciendo, en exclusiva, `metrica.alcance` en `lib/analytics/metrics.ts`.
//     Por eso aqui no hay ni un literal `{ maestro: "...", adminTienda: "..." }` y el censo
//     de `alcance-fuente-unica.guardia.test.ts` no encuentra una segunda tabla.
//
// Por que INCLUSION y no exclusion (R20): con una lista de exclusion, una metrica nueva del
// catalogo se publicaria SOLA el dia que alguien la anada. Con inclusion, lo peor que pasa es
// que un integrador no vea algo que podria ver, y eso se arregla con un alta. Al reves se
// arregla con un incidente.
//
// Por que la lista es CORTA (P1, decidido el 2026-08-23): retirar una metrica ya publicada
// ROMPE el contrato de un integrador; anadirla, no. Se empieza corto y se amplia por peticion.
//
// R1 (modulo puro, heredado de la 135 y vigilado por `modulo-puro.guardia.test.ts`): sin
// `'use server'`, sin `next/*`, sin Prisma, sin `process.env`, sin efectos al importarse.

/**
 * Los ids que se publican HOY por `GET /api/ordenes/api-key/analitica`.
 *
 * La eleccion sale de comprobar UNO A UNO los 25 ids del catalogo (2026-08-23), no de copiar
 * una recomendacion. Criterios DUROS, atados por test en `publicacion-api-key.test.ts` contra
 * el catalogo y no contra esta lista:
 *
 *   - `dominio !== "financiera"`            (R17) — deja fuera las 10 financieras;
 *   - `unidad !== "moneda"`                 (R34) — corolario: no hay importes en este canal;
 *   - `alcance.adminTienda !== "prohibido"` (R18) — el integrador nunca ve mas que la tienda
 *                                                   duena de sus ordenes;
 *   - `estadoProduccion !== "declarada"`    (R19) — una metrica sin productor devolveria ceros
 *                                                   que el integrador leeria como datos;
 *   - declara el grano `tienda`                    — sin esa dimension no hay por donde recortar
 *                                                   por `orden.tienda_id`, y publicar una cifra
 *                                                   que no se puede acotar al inquilino es
 *                                                   exactamente el fallo que esta ficha evita.
 *
 * Las cinco operativas que cumplen los cuatro primeros criterios y AUN ASI quedan fuera, con su
 * motivo escrito para que la exclusion sea auditable y no un olvido:
 *
 *   - `sin_gestionar`      — sus granos son `fecha|zona|mensajero`: NO tiene grano `tienda`.
 *   - `primer_intento_ok`  — idem, granos `fecha|zona|mensajero`, sin grano `tienda`; ademas
 *                            arrastra la deriva declarada de la 215 (escalon historico asumido
 *                            y efecto intradia permanente), que un integrador leeria como bug.
 *   - `aging_por_estado`   — es la unica `clase: "live"` operativa: mide antiguedad AL INSTANTE,
 *                            no una serie del rango pedido. Servirla bajo `desde`/`hasta` seria
 *                            publicar una semantica que el contrato no puede expresar.
 *   - `incidentes`         — detalle de nuestra operacion (danado / perdido / robado). Publicable
 *                            tecnicamente; se deja para alta por peticion, no por defecto.
 *   - `motivos_devolucion` — desagregacion por causa tipificada, no una de las medidas base ni
 *                            una tasa/tiempo. Misma razon: alta por peticion.
 *
 * Anadir un id aqui es una decision de CONTRATO PUBLICO. Quitarlo, una rotura.
 */
export const METRICAS_API_KEY = [
  // Las seis medidas base del embudo operativo.
  "ordenes_creadas",
  "ordenes_por_estado",
  "entregas",
  "devoluciones",
  "rechazos",
  "reprogramaciones",
  // Las tasas equivalentes (mismo denominador de gestiones vigentes).
  "tasa_entrega",
  "tasa_devolucion",
  "tasa_rechazo",
  // El tiempo equivalente.
  "tiempo_ciclo",
] as const;

/** Union literal de los ids publicables. Util para estrechar el tipo en el borde y el OpenAPI. */
export type MetricaPublicableApiKey = (typeof METRICAS_API_KEY)[number];

/**
 * R15 — el unico predicado de publicacion. Total: no lanza con cualquier cadena, y una metrica
 * ausente de la lista NO se publica, exista o no en el catalogo.
 */
export function esMetricaPublicableApiKey(id: string): id is MetricaPublicableApiKey {
  return (METRICAS_API_KEY as readonly string[]).includes(id);
}

/**
 * P4-bis (2026-08-23) — EL CENTINELA que pide TODO lo publicable en una sola llamada:
 * `?metricas=all`.
 *
 * Vive AQUI y no en el cascaron HTTP por una razon concreta: `all` significa «exactamente
 * `METRICAS_API_KEY`», asi que el centinela y la lista que expande tienen que poder leerse de un
 * vistazo. Si vivieran en archivos distintos, un alta en la lista y el significado de `all`
 * podrian divergir sin que nadie lo notara.
 *
 * ⚠ NO PUEDE COLISIONAR CON UN ID DEL CATALOGO, y no se confia en que nadie llame `all` a una
 * metrica: `publicacion-api-key.test.ts` lo comprueba contra el catalogo entero. Si algun dia
 * naciera una metrica con este id, el centinela la eclipsaria en silencio.
 */
export const METRICAS_TODAS = "all";
