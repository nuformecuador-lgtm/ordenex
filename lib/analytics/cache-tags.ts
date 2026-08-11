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

/* -------------------------------------------------------------------------- */
/* Feature 179 (T1.1, D1) — el dominio del DINERO                              */
/* -------------------------------------------------------------------------- */
//
// D1 (humano, 2026-08-10) = (a): **un solo tag de dominio** tambien para la financiera. Al
// invalidar se vacia la cache financiera ENTERA —un egreso manual de ₡5.000 tira tambien la
// conciliacion del trimestre— y eso se asume: invalidar de mas cuesta RECOMPUTO, no
// correccion. A cambio hace IMPOSIBLE que la invalidacion se desalinee de la lectura.
//
// El dato propio que lo decide, ademas del de la 128: el mapa «que escritura afecta a que
// metrica» no es evidente ni estable — **un cierre aprobado toca los tres ledgers y seis de
// las diez metricas financieras**. Un mapa ledger→metrica escrito a mano, cuando se
// equivocara, NO fallaria: serviria la cifra vieja de la metrica olvidada.
//
// SE AÑADE AQUI Y NO EN UN MODULO NUEVO (R6/R20 de la 128): una sola lista la consumen el que
// escribe la entrada y el que la invalida. Dos modulos de tags es exactamente como se
// desalinean.

/** El unico tag del dominio financiera. Derivado del catalogo, nunca escrito a mano (R6). */
export const TAG_FINANCIERA: string = tagDeDominio("financiera");

/**
 * Los tags con los que se escribe y se invalida TODA entrada del dominio financiera.
 *
 * Misma propiedad que `TAGS_OPERATIVA`: los escritores de ledger no componen este array — lo
 * consumen a traves de `invalidarAnaliticaFinanciera` (`lib/analytics/invalidacion-financiera.ts`),
 * y el decorador de lectura escribe con el mismo. Un escritor no puede invalidar «casi bien».
 */
export const TAGS_FINANCIERA: readonly string[] = [TAG_FINANCIERA];
