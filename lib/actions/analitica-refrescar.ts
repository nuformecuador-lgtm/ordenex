"use server";

// EL REFRESCO FORZADO DE LA ANALITICA (pedido humano 2026-08-19).
//
// Qué resuelve, porque no es lo mismo que el botón «Actualizar» que ya existía en el tablero
// operativo (R23 de la 131): aquel sólo revalida las claves de SWR, es decir, vuelve a PEDIR
// las cifras. Pero todas las lecturas de analítica están detrás de una cache de servidor con
// TTL —15 min las seis verticales de entregas, 1 h el dominio operativa—, así que volver a
// pedirlas dentro de la ventana devuelve EXACTAMENTE el mismo valor cacheado, con su mismo
// sello `lastSync`. Un botón que promete traer lo último y devuelve lo mismo es peor que no
// tenerlo.
//
// Esta acción invalida los tags ANTES de que el cliente vuelva a pedir, de modo que la
// siguiente lectura falla en cache, toca la base y REESCRIBE la entrada con un `lastSync`
// nuevo. Ése es el «forzado» del nombre.
//
// ⚠ LO QUE CUESTA, dicho aquí para que nadie lo descubra en la factura: la invalidación es POR
// DOMINIO, no por filtro (`lib/analytics/cache-tags.ts` explica por qué: Next admite 128 tags
// por entrada y un tag por fecha revienta el límite en silencio). Un clic tira TODAS las
// entradas de las seis verticales de entregas y las del dominio operativa, las de este usuario
// y las de los demás. Se recomputan a medida que alguien las vuelva a pedir. Es un botón
// manual, no un job: si algún día se pulsa en bucle, lo que hay que poner es un mínimo entre
// pulsaciones (patrón de `route-optimization.ts`), no una invalidación más fina.
//
// NO devuelve cifras. Devuelve el instante de la invalidación y nada más: quién pinta qué sigue
// siendo asunto de cada panel, que releerá su propio `lastSync` del DTO recién producido.

import { TAGS_OPERATIVA } from "@/lib/analytics/cache-tags";
import {
  TAG_CICLO_VIDA,
  TAG_CONTEO_CARGADAS_POR_DIA,
  TAG_CONTEO_DEVOLUCIONES,
  TAG_CONTEO_ENTREGAS,
  TAG_CONTEO_HOY_GESTION,
  TAG_CONTEO_POR_STATUS,
} from "@/lib/analytics/entregas-conteo";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import { ROLES_ACCESO_ANALITICA } from "@/lib/auth/menu-visibility";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { crearAnaliticaCacheDeNext } from "@/lib/cache/next-analitica-cache";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import type { RefrescoAnaliticaResult } from "@/lib/types/analitica-refresco";

/**
 * TODOS los tags que cubre el botón: las seis verticales de entregas —cada una con espacio
 * propio, porque no salen del rollup— y el dominio operativa.
 *
 * Se escriben importando las constantes y NUNCA a mano: un literal repetido es exactamente
 * como la invalidación deja de coincidir con la lectura, en silencio (R20 de la 128).
 */
const TAGS_ANALITICA: readonly string[] = [
  TAG_CONTEO_ENTREGAS,
  TAG_CONTEO_POR_STATUS,
  TAG_CONTEO_CARGADAS_POR_DIA,
  TAG_CONTEO_HOY_GESTION,
  TAG_CONTEO_DEVOLUCIONES,
  TAG_CICLO_VIDA,
  ...TAGS_OPERATIVA,
];

export interface RefrescarAnaliticaDeps {
  readonly cache?: IAnaliticaCache;
  readonly getActor?: () => Promise<ActorAnalitica | null>;
  /** Reloj inyectable, como el resto de la vertical: ningún `Date.now()` escondido. */
  readonly now?: () => Date;
}

/**
 * Tira la cache de analítica para que la siguiente lectura vuelva a la base.
 *
 * El gate es el MISMO conjunto de roles que abre la pantalla (`ROLES_ACCESO_ANALITICA`), y no
 * uno propio: quien puede ver estas cifras puede pedir que se recalculen. Declarar aquí una
 * segunda lista sería la tercera constante con el mismo contenido y significados distintos.
 *
 * `unauthenticated` y `forbidden` se distinguen a propósito: «no sabemos quién eres» se
 * arregla volviendo a entrar y «no puedes» no, y la pantalla ya tiene dos textos para eso.
 */
export async function refrescarCacheAnalitica(
  deps: RefrescarAnaliticaDeps = {},
): Promise<RefrescoAnaliticaResult> {
  const now = deps.now ?? (() => new Date());
  const actor = await (deps.getActor ?? resolveActorFromSession)();

  if (actor === null) return { status: "unauthenticated" };
  if (!(ROLES_ACCESO_ANALITICA as readonly string[]).includes(actor.rol)) {
    return { status: "forbidden" };
  }

  // `manual` es justo lo que este origen significa en el dominio cerrado del puerto: una
  // invocación humana de mantenimiento. El registro de invalidación (R23 de la 128) deja la
  // línea con el origen y los tags, sin ids ni PII.
  //
  // Sin `try/catch`: si `revalidateTag` falla, sube. Una invalidación que falla en silencio
  // deja la cifra congelada Y la pantalla diciendo que la acaba de traer.
  const cache = deps.cache ?? crearAnaliticaCacheDeNext();
  await cache.invalidar("manual", TAGS_ANALITICA);

  // ISO-8601 UTC, como los `lastSync` de los DTO: cruza la frontera de la Server Action y una
  // cadena viaja igual la serialice quien la serialice.
  return { status: "ok", lastSyncAt: now().toISOString() };
}
