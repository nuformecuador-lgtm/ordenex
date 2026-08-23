import { getPrismaClient } from "@/lib/db/prisma-client";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import { describirDenegado } from "@/lib/analytics/auditoria";
import { sondeaIdentidadDeMensajero } from "@/lib/analytics/oraculo-mensajero";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import { defaultLogger, type ErrorLogger } from "@/lib/errors/logger";
import { AnaliticaOperativaRollupRepository } from "@/lib/repositories/AnaliticaOperativaRollupRepository";
import { AnaliticaOperativaVivaRepository } from "@/lib/repositories/AnaliticaOperativaVivaRepository";
import { decorarRollupConCache } from "@/lib/repositories/CachedAnaliticaOperativaRollupRepository";
import { crearAnaliticaCacheDeNext } from "@/lib/cache/next-analitica-cache";
import { AnaliticaOperativaService } from "@/lib/services/AnaliticaOperativaService";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenDiaRepartoCambioRepository } from "@/lib/repositories/OrdenDiaRepartoCambioRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import type { IAnaliticaOperativaService } from "@/lib/interfaces/services/IAnaliticaOperativaService";
import type { ResultadoOperativo } from "@/lib/types/analitica-operativa";

// Feature 267 (T5, design §4.4) — EL BORDE DEL CANAL INTEGRADOR.
//
// Es el HERMANO de `lib/actions/analitica-operativa.ts` para el canal publico por API key, y
// recorre LOS MISMOS CUATRO PASOS, EN EL MISMO ORDEN, porque ese orden es el contrato de la
// 126 y no es intercambiable:
//
//   1. actor — aqui el de `ApiKeyAuthResult.ok` (la cuenta dedicada 1:1 de la key), NO el de
//      la sesion: este modulo no lee cookies y no sabe que existe `next/headers`;
//   2. `prepararConsultaAnalitica(raw, actor, metricaId, now, "api_key")` — UNA sola llamada
//      (267/R14). El QUINTO argumento explicito es la unica diferencia de invocacion frente a
//      la Server Action, y es la pieza que activa la rama de concesion de `resolverAlcance`
//      (267/R1). Sin el, el default `"interno"` denegaria por 267/R6, que es exactamente lo
//      que debe pasar si alguien copia esta llamada a otro sitio sin pensar;
//   3. `forbidden` => `logger.logError(describirDenegado(...))` **y DESPUES** responder;
//   4. `ok` => `AnaliticaOperativaService.consultar`. EL MISMO servicio, EL MISMO repositorio
//      y LA MISMA cache que el canal de sesion (267/R43). No hay repositorio nuevo, no hay
//      consulta nueva, no hay `$queryRaw` (267/R13).
//
// ⚠ TRAMPA VERIFICADA, la misma que documenta `lib/analytics/auditoria.ts`: `normalizeError`
// devuelve la shape del `AppError` en su PRIMERA linea (`lib/errors/normalize.ts:22`) y solo
// llama a `logger.logError` en la rama del error DESCONOCIDO (`:45`). Lanzar un
// `ForbiddenError` y confiar en `withErrorHandler` produce un **403 MUDO**: el intento de un
// tercero contra un canal publico no dejaria rastro ninguno. Por eso la llamada al logger es
// EXPLICITA y su test espia el LOGGER, no el status (267/R32).
//
// Lo que este modulo NO hace, a proposito:
//   - no toca HTTP: ni `Request`, ni `Response`, ni status, ni JSON. Eso es del cascaron
//     (`app/api/ordenes/api-key/analitica/route.ts`), que asi no necesita nombrar ni el
//     servicio ni el repositorio y deja verde de VERDAD la guardia de frontera de 126/R1;
//   - no acepta `desagregacion`. Decision P2 de la puerta del 2026-08-23: la dimension
//     `mensajero` se PROHIBE ENTERA en este canal —ni desagregacion ni filtro—, y en v1 no se
//     publica ninguna otra dimension (design §4.3). No es un parametro que se dejo sin
//     cablear: es una superficie que no existe;
//   - no autentica. La key, su hash y el header `Authorization` no entran aqui y por tanto no
//     pueden salir en ningun log (267/R33): lo unico que este modulo recibe del integrador es
//     un actor ya resuelto y un filtro.

/** Lo que el cascaron HTTP le entrega al borde, ya autenticado. */
export interface EntradaIntegrador {
  /** El actor de `ApiKeyAuthResult.ok`: la cuenta dedicada de la key, con su `usuarioId`. */
  readonly actor: ActorAnalitica;
  readonly metricaId: string;
  /**
   * El filtro interno de la 135, que CONSTRUYE el cascaron a partir de `desde`/`hasta`
   * (design §4.2). Se recibe como `unknown` porque quien valida es el paso 2 y no este borde:
   * duplicar la validacion aqui seria una segunda puerta que mantener.
   */
  readonly raw: unknown;
}

/**
 * Inyeccion para los tests del borde. Mismo patron que `AnaliticaOperativaDeps`
 * (`lib/actions/analitica-operativa.ts`). En produccion no se pasa ninguna: el composition
 * root de abajo cablea los repositorios reales.
 *
 * No hay `getActor`: en este canal el actor no se resuelve, se recibe (lo produjo
 * `ApiKeyAuthService` en el cascaron).
 */
export interface AnaliticaIntegradorDeps {
  readonly service?: IAnaliticaOperativaService;
  readonly logger?: ErrorLogger;
  /** Reloj inyectable: mismo `now` => misma salida, sin `new Date()` escondido. */
  readonly now?: () => Date;
}

/**
 * El composition root del canal integrador.
 *
 * Es un CALCO del `construirServicio` de `lib/actions/analitica-operativa.ts`, y la
 * duplicacion es forzada, no un descuido: aquel archivo lleva `"use server"`, que obliga a que
 * TODO export suyo sea una funcion `async`, asi que su factory no se puede exportar ni
 * reutilizar desde aqui. Extraer un modulo comun es una mejora legitima, pero tocaria un
 * archivo fuera del alcance de esta ficha y cambiaria el cableado del canal de sesion, que
 * 267/R43 exige dejar intacto.
 *
 * ⚠ EL REPOSITORIO VIVO NO SE DECORA, igual que en el canal de sesion (128/R3): el punto del
 * dia en curso —el que la 126 marca `parcial: true` con su `corteAt`— se sirve desde las
 * tablas vivas y NO puede entrar en cache por construccion, no por una politica que alguien
 * pueda olvidar.
 */
function construirServicio(now: () => Date): IAnaliticaOperativaService {
  const prisma = getPrismaClient();
  return new AnaliticaOperativaService(
    decorarRollupConCache(
      new AnaliticaOperativaRollupRepository(prisma),
      crearAnaliticaCacheDeNext(),
    ),
    new AnaliticaOperativaVivaRepository(prisma),
    new OrdenHistorialService(
      new OrdenRepository(prisma),
      new OrdenHistorialRepository(prisma),
      new OrdenDiaRepartoCambioRepository(prisma),
    ),
    { now },
  );
}

/**
 * La UNICA lectura de analitica del canal por API key.
 *
 * Devuelve un resultado de DOMINIO discriminado (patron del repo), nunca lanza para decir
 * «prohibido» y nunca responde `ok` con ceros ante un denegado: el cascaron traduce
 * `forbidden` a 403 mudo y `validation_error` a 422, y un integrador tiene que poder
 * distinguir «prohibido» de «sin datos».
 *
 * `unauthenticated` no se produce aqui: es del autenticador, antes de llegar a este borde.
 */
export async function consultarAnaliticaIntegrador(
  entrada: EntradaIntegrador,
  deps: AnaliticaIntegradorDeps = {},
): Promise<ResultadoOperativo> {
  const logger = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => new Date());

  // (2) UNA sola llamada, con el canal EXPLICITO (267/R14, 267/R1).
  const preparada = prepararConsultaAnalitica(
    entrada.raw,
    entrada.actor,
    entrada.metricaId,
    now(),
    "api_key",
  );

  if (preparada.status === "validation_error") {
    // Se devuelve SIN consultar: el repositorio recibe CERO llamadas. Y NO se audita, porque
    // no hay denegado que registrar: un filtro malformado tampoco puede servir para sondear
    // el catalogo ni los permisos de nadie.
    return { status: "validation_error", fieldErrors: preparada.fieldErrors };
  }

  // (3) El denegado del resolutor: metrica inexistente, metrica no publicable, actor sin id
  // util, tienda ajena... Todos salen por la MISMA puerta, auditados y mudos, de modo que
  // desde fuera son indistinguibles (267/R16).
  if (preparada.status === "forbidden") {
    return denegar(logger, preparada.motivo, entrada);
  }

  // EL ORACULO (126/R24, 267/R37), REUTILIZADO Y NO REIMPLEMENTADO. Con politica `seudonima`
  // —que en este canal es SIEMPRE (267/R35)— un filtro que nombre `mensajero_id` permitiria
  // confirmar POR EL CONTEO si ese mensajero trabajo para el integrador, pese a la
  // seudonimizacion de la salida. Como el cascaron nunca escribe `mensajero_id`, esto es
  // defensa en profundidad y no una via viva; duplicar el predicado aqui reabriria por esta
  // puerta el agujero que la 126 cerro, que es literalmente lo que aquella feature advirtio
  // para el CSV de la 134.
  if (sondeaIdentidadDeMensajero(preparada.consulta.filtro, preparada.consulta.politicaIdentidad)) {
    return denegar(logger, "filtro_fuera_de_alcance", entrada);
  }

  // (4) El servicio se construye AQUI y no antes: en todos los caminos denegados no llega a
  // existir, asi que el repositorio no recibe ni una llamada.
  const service = deps.service ?? construirServicio(now);
  const datos = await service.consultar(preparada.consulta);
  return { status: "ok", datos };
}

/**
 * Auditar y DESPUES responder. Se aisla en una funcion para que las DOS vias de denegado (la
 * del resolutor y la del oraculo) dejen EXACTAMENTE el mismo rastro: una segunda forma de
 * responder 403 seria una que alguien puede olvidar auditar.
 *
 * El registro lo construye `describirDenegado`, el MISMO que usa el canal de sesion, que ya
 * saneia el filtro y solo deja pasar las tres listas de ids conocidas. Ni la key, ni su hash,
 * ni el header `Authorization` llegan hasta aqui (267/R33).
 */
function denegar(
  logger: ErrorLogger,
  motivo: Parameters<typeof describirDenegado>[0]["motivo"],
  entrada: EntradaIntegrador,
): { readonly status: "forbidden" } {
  logger.logError(
    describirDenegado({
      motivo,
      actor: entrada.actor,
      metricaId: entrada.metricaId,
      filtro: entrada.raw,
    }),
  );
  // Sin motivo hacia el cliente: el motivo va al log. Y sin datos: nunca `ok` con ceros.
  return { status: "forbidden" };
}
