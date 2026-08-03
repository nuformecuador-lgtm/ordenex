// Feature 128 (T1.1, design §6) — LOS TAGS DE CACHE DE LA ANALITICA.
//
// D3 (humano, 2026-08-03) = (a): **UN tag por dominio**. No por fecha y no por mes.
//
// El dato que lo decide, con su ruta, porque es el tipo de cosa que el siguiente redescubre a
// base de golpes: Next admite **128 tags como maximo por entrada** y **256 caracteres por tag**
// (`node_modules/next/dist/lib/constants.js:280-281`), y el filtro de la 135 permite rangos de
// hasta `RANGO_TOPE_DIAS = 366` dias. Un tag por fecha del rango revienta el limite en
// cualquier consulta de mas de cuatro meses y lo hace **en silencio**: no hay excepcion, se
// pierden tags y la invalidacion deja de alcanzar entradas que cree alcanzar.
//
// Consecuencia asumida de la granularidad por dominio: el job diario vacia toda la cache
// operativa una vez al dia (00:30 CR) y el backfill la vacia una vez por corrida. Eso cuesta
// **recomputo**, no correccion.
//
// R20 — NINGUN literal de tag se escribe aqui. Las cadenas viven en `ANALITICA_TAGS`
// (`lib/analytics/metrics.ts`, feature 135, escritas explicitamente «consumidas por la 128») y
// esta feature NO toca ese archivo. Un tag escrito a mano en dos sitios es exactamente como la
// invalidacion deja de coincidir con la lectura, en silencio.
//
// Modulo PURO: sin Next, sin Prisma, sin `process.env`, sin efectos al importarse.

import { tagDeDominio } from "@/lib/analytics/metrics";

/** El unico tag del dominio operativa. Derivado del catalogo, nunca escrito a mano (R20). */
export const TAG_OPERATIVA: string = tagDeDominio("operativa");

/**
 * Los tags con los que se escribe y se invalida TODA entrada del dominio operativa.
 *
 * Es UNA sola lista consumida por los dos lados —el decorador que escribe y los invalidadores
 * que borran—, para que no exista la posibilidad de que uno escriba con un tag y el otro
 * invalide con otro.
 */
export const TAGS_OPERATIVA: readonly string[] = [TAG_OPERATIVA];
