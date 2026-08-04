"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import { describirDenegado } from "@/lib/analytics/auditoria";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import type { DimensionAnalitica } from "@/lib/analytics/types";
import { defaultLogger, type ErrorLogger } from "@/lib/errors/logger";
import { AnaliticaOperativaRollupRepository } from "@/lib/repositories/AnaliticaOperativaRollupRepository";
import { AnaliticaOperativaVivaRepository } from "@/lib/repositories/AnaliticaOperativaVivaRepository";
import { decorarRollupConCache } from "@/lib/repositories/CachedAnaliticaOperativaRollupRepository";
import { crearAnaliticaCacheDeNext } from "@/lib/cache/next-analitica-cache";
import { AnaliticaOperativaService } from "@/lib/services/AnaliticaOperativaService";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import type { IAnaliticaOperativaService } from "@/lib/interfaces/services/IAnaliticaOperativaService";
import {
  ERROR_UNIDAD_NO_AGREGABLE,
  esUnidadAgregable,
  type GranoAgregado,
  type ResultadoAgregado,
  type ResultadoOperativo,
} from "@/lib/types/analitica-operativa";
import { sondeaIdentidadDeMensajero } from "@/lib/analytics/oraculo-mensajero";

// Feature 126 (T9, design §5.3) — EL BORDE de la analitica operativa.
//
// R1 — TODA lectura de analitica operativa entra por aqui, como Server Action. NO hay ni
// habra una ruta bajo `app/api/` para esto (`docs/architecture.md`: las lecturas internas del
// mismo proyecto van por Server Action; los route handlers son para webhooks y API publica).
//
// R3 — el nombre del archivo es `analitica-operativa.ts` y NO `analitica.ts`: el generico
// esta PROHIBIDO para la 126 y para la 127, porque las dos escribirian en el.
//
// EL ORDEN DE LOS CUATRO PASOS ES EL CONTRATO (`design.md §5.3`), y no es intercambiable:
//   1. actor de la sesion;
//   2. `prepararConsultaAnalitica` — parsea, resuelve rango y resuelve alcance, en UNA
//      llamada: si el parseo falla no se pregunta por el alcance y NO se toca la base (R6);
//   3. `forbidden` -> `logger.logError(describirDenegado(...))` **y DESPUES** responder;
//   4. `ok` -> servicio.
//
// ⚠ TRAMPA VERIFICADA (R5, escrita en `lib/analytics/auditoria.ts`): `normalizeError`
// devuelve la shape del `AppError` en su PRIMERA linea (`lib/errors/normalize.ts:22`) y solo
// llama a `logger.logError` en la rama del error DESCONOCIDO (`:45`). Lanzar un
// `ForbiddenError` y confiar en `withErrorHandler` produce un 403 MUDO. Por eso la llamada al
// logger es EXPLICITA y el test de R5 espia el logger, no el status.

/** Lo que el cliente envia. `raw` es el filtro de la 135; se valida en el paso 2. */
export interface EntradaOperativa {
  readonly metricaId: string;
  readonly raw: unknown;
  /** Desglose pedido. NO es un canal de alcance: el recorte va dentro de la consulta. */
  readonly desagregacion?: DimensionAnalitica;
}

/**
 * Inyeccion para los tests del borde (patron del repo: `CierreDiaDeps`). En produccion no se
 * pasa ninguna: el composition root de abajo cablea los repositorios reales.
 */
export interface AnaliticaOperativaDeps {
  readonly service?: IAnaliticaOperativaService;
  readonly getActor?: () => Promise<ActorAnalitica | null>;
  readonly logger?: ErrorLogger;
  /** R31 — reloj inyectable: misma entrada y mismo `now` => misma salida. */
  readonly now?: () => Date;
}

/**
 * Feature 128 (T4.2) — UNICO cambio de este archivo: el cableado del decorador de cache.
 *
 * `consultarAnaliticaOperativa` no cambia de firma ni de tipo de retorno (R18: la 131 y la 132
 * la consumen), y las cifras son identicas (R1). Lo unico que cambia es DE DONDE salen los
 * cubos de dias cerrados.
 *
 * ⚠ EL REPOSITORIO VIVO NO SE DECORA, Y ESO ES EL REQUISITO R3. El punto del dia en curso —el
 * que la 126 marca `parcial: true` con su `corteAt`— se sirve desde
 * `AnaliticaOperativaVivaRepository`, que lee las tablas VIVAS (`orden`, `gestion_orden`,
 * `orden_historial_estado`) y aqui pasa DESNUDO. El dia en curso no queda fuera de la cache
 * por una politica que alguien pueda olvidar: no hay camino por el que pueda entrar.
 */
function construirServicio(now: () => Date): IAnaliticaOperativaService {
  const prisma = getPrismaClient();
  return new AnaliticaOperativaService(
    decorarRollupConCache(
      new AnaliticaOperativaRollupRepository(prisma),
      crearAnaliticaCacheDeNext(),
    ),
    new AnaliticaOperativaVivaRepository(prisma),
    // Punto UNICO de «intentos» del repo (feature 160). No se reimplementa el criterio.
    new OrdenHistorialService(new OrdenRepository(prisma), new OrdenHistorialRepository(prisma)),
    { now },
  );
}

/**
 * La UNICA lectura de analitica operativa. Devuelve un resultado de DOMINIO discriminado
 * (patron del repo), nunca lanza para decir «prohibido» y nunca responde `ok` con ceros ante
 * un denegado (R5/D7 de la 122): la 133 tiene que poder distinguir «prohibido» de «sin datos».
 */
export async function consultarAnaliticaOperativa(
  entrada: EntradaOperativa,
  deps: AnaliticaOperativaDeps = {},
): Promise<ResultadoOperativo> {
  const logger = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => new Date());
  const actor = await (deps.getActor ?? resolveActorFromSession)();

  const preparada = prepararConsultaAnalitica(entrada.raw, actor, entrada.metricaId, now());

  if (preparada.status === "validation_error") {
    // R6 — se devuelve SIN consultar: el repositorio recibe CERO llamadas. Un filtro
    // malformado tampoco puede servir para sondear el catalogo ni los permisos de un rol, y
    // por eso aqui NO se audita (no hay denegado que registrar).
    return { status: "validation_error", fieldErrors: preparada.fieldErrors };
  }

  if (preparada.status === "forbidden") {
    return denegar(logger, preparada.motivo, actor, entrada);
  }

  // R24/R36/D12 — EL ORACULO. Con politica seudonima, un filtro que nombre `mensajero_id`
  // permitiria a un `adminTienda` confirmar POR EL CONTEO si ese mensajero trabajo para el,
  // pese a la seudonimizacion. Se responde `forbidden` + auditoria por el MISMO camino que
  // R5. El predicado vive en un helper exportado UNICO (`sondeaIdentidadDeMensajero`) que la
  // 134 (export CSV) consume: duplicarlo alli reabriria el agujero por la puerta del CSV.
  //
  // Lo que el `adminTienda` pierde es el FILTRO por mensajero, no la VISTA: sigue pudiendo
  // pedir `desagregacion: "mensajero"` y recibe la serie seudonimizada que D5 de la 122 le
  // concedio.
  if (sondeaIdentidadDeMensajero(preparada.consulta.filtro, preparada.consulta.politicaIdentidad)) {
    return denegar(logger, "filtro_fuera_de_alcance", actor, entrada);
  }

  const service = deps.service ?? construirServicio(now);
  const datos = await service.consultar(preparada.consulta, entrada.desagregacion);
  return { status: "ok", datos };
}

/**
 * Feature 176 (D1/T3.1) — LA LECTURA AGREGADA, por su propia Server Action.
 *
 * Recorre EXACTAMENTE los mismos cuatro pasos que `consultarAnaliticaOperativa` y reusa
 * `denegar()` y `sondeaIdentidadDeMensajero`: el modo agregado NO es una puerta trasera. Si
 * el oraculo se duplicara aqui, el agujero que R24/R36 de la 126 cerro para el filtro por
 * mensajero se reabriria por la puerta del agregado — literalmente lo que la 126 advirtio
 * para el CSV de la 134.
 *
 * `construirServicio` se reusa TAL CUAL (R17): el agregado consume `agregarCubos`, el mismo
 * metodo que decora la cache de la 128, con la misma clave; no hay superficie de cache
 * nueva, el codec de `bigint` no se toca y el dia en curso sigue fuera de la cache por
 * construccion (el repositorio vivo no se decora).
 */
export async function consultarAgregadoOperativo(
  entrada: EntradaOperativa & { readonly grano?: GranoAgregado },
  deps: AnaliticaOperativaDeps = {},
): Promise<ResultadoAgregado> {
  const logger = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => new Date());
  const actor = await (deps.getActor ?? resolveActorFromSession)();

  const preparada = prepararConsultaAnalitica(entrada.raw, actor, entrada.metricaId, now());

  if (preparada.status === "validation_error") {
    return { status: "validation_error", fieldErrors: preparada.fieldErrors };
  }

  if (preparada.status === "forbidden") {
    return denegar(logger, preparada.motivo, actor, entrada);
  }

  if (sondeaIdentidadDeMensajero(preparada.consulta.filtro, preparada.consulta.politicaIdentidad)) {
    return denegar(logger, "filtro_fuera_de_alcance", actor, entrada);
  }

  // R12 — DESPUES del alcance, nunca antes: quien no puede ver la metrica recibe `forbidden`
  // y no una pista sobre su unidad. Y antes del servicio: el repositorio recibe CERO
  // llamadas. Agregar una metrica de `conteo` sumaria un STOCK entre fechas.
  if (!esUnidadAgregable(preparada.consulta.metrica.unidad)) {
    return {
      status: "validation_error",
      fieldErrors: { metricaId: [ERROR_UNIDAD_NO_AGREGABLE] },
    };
  }

  const service = deps.service ?? construirServicio(now);
  const datos = await service.consultarAgregado(preparada.consulta, {
    ...(entrada.grano ? { grano: entrada.grano } : {}),
    ...(entrada.desagregacion ? { desagregacion: entrada.desagregacion } : {}),
  });
  return { status: "ok", datos };
}

/**
 * R5 — auditar y DESPUES responder. Se aisla en una funcion para que las dos vias de denegado
 * (la del resolutor y la del oraculo de R24) dejen EXACTAMENTE el mismo rastro y no haya una
 * segunda forma de responder 403 que alguien pueda olvidar auditar.
 *
 * El nombre lleva prefijo para no colisionar con el `use server` (que exige que todo export
 * de este archivo sea una funcion async): esta NO se exporta.
 */
function denegar(
  logger: ErrorLogger,
  motivo: Parameters<typeof describirDenegado>[0]["motivo"],
  actor: ActorAnalitica | null,
  entrada: EntradaOperativa,
  // El tipo de retorno es el `forbidden` DESNUDO —no `ResultadoOperativo`— para que las dos
  // lecturas (serie y agregado, feature 176) compartan esta misma funcion. Es el punto del
  // comentario de arriba: una segunda forma de responder 403 seria una que alguien puede
  // olvidar auditar.
): { readonly status: "forbidden" } {
  logger.logError(
    describirDenegado({ motivo, actor, metricaId: entrada.metricaId, filtro: entrada.raw }),
  );
  // Sin motivo hacia el cliente: el motivo va al log (R5). Y sin datos: nunca `ok` con ceros.
  return { status: "forbidden" };
}
