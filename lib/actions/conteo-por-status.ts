"use server";

// EL BORDE del desglose por status.
//
// Server Action y no ruta bajo `app/api/`, por el mismo motivo que su gemela
// (`lib/actions/conteo-entregas.ts`): es una lectura INTERNA de esta aplicacion, y
// `docs/architecture.md` reserva los route handlers para webhooks y API publica.
//
// LOS CUATRO PASOS SON LOS MISMOS Y EN EL MISMO ORDEN, y no por parecido: se REUSA
// `prepararConteoEntregas` tal cual. El filtro, el alcance y la ventana de las dos lecturas
// son identicos por decision del humano («soporta los mismos filtros que el anterior»), asi
// que duplicar aqui el parseo o —peor— el resolutor de alcance seria abrir una segunda puerta
// a la misma frontera multi-tenant. Lo unico propio de este archivo es a QUE servicio llama.

import { describirDenegado } from "@/lib/analytics/auditoria";
import { prepararConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type { ActorAnalitica, MotivoDenegacion } from "@/lib/analytics/alcance";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { crearConteoEntregasCacheDeNext } from "@/lib/cache/next-analitica-cache";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { defaultLogger, type ErrorLogger } from "@/lib/errors/logger";
import { ConteoPorStatusRepository } from "@/lib/repositories/ConteoPorStatusRepository";
import { ConteoPorStatusService } from "@/lib/services/ConteoPorStatusService";
import type { ResultadoConteoPorStatus } from "@/lib/types/conteo-por-status";

/**
 * Con que nombre aparece esta lectura en la auditoria. NO es un `metricaId` del catalogo
 * —esta cifra no vive ahi— pero `describirDenegado` exige uno para que la linea del log diga
 * QUE se intento leer. Distinto al de la otra accion a proposito: si compartieran nombre, una
 * denegacion no diria cual de las dos puertas se toco.
 */
const ID_AUDITORIA = "conteo_por_status";

export interface ConteoPorStatusDeps {
  readonly service?: Pick<ConteoPorStatusService, "consultar">;
  readonly getActor?: () => Promise<ActorAnalitica | null>;
  readonly logger?: ErrorLogger;
  /** Reloj inyectable: misma entrada y mismo `now` => mismo resultado, sello incluido. */
  readonly now?: () => Date;
}

function construirServicio(now: () => Date): ConteoPorStatusService {
  return new ConteoPorStatusService(
    new ConteoPorStatusRepository(getPrismaClient()),
    // La MISMA cache que el otro conteo: mismo TTL de 15 min y mismo kill-switch. Las entradas
    // no se pisan porque la clave lleva prefijo propio (`claveDeConteoPorStatus`).
    crearConteoEntregasCacheDeNext(),
    { now },
  );
}

/**
 * La UNICA lectura del desglose por status.
 *
 * `raw` es el filtro sin validar tal cual lo manda el cliente — el MISMO contrato que
 * `consultarConteoEntregas`, incluidas las siete facetas y el rango opcional.
 */
export async function consultarConteoPorStatus(
  raw: unknown,
  deps: ConteoPorStatusDeps = {},
): Promise<ResultadoConteoPorStatus> {
  const logger = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => new Date());
  const actor = await (deps.getActor ?? resolveActorFromSession)();

  const preparada = prepararConteoEntregas(raw, actor, now());

  if (preparada.status === "validation_error") {
    // Sin consultar y sin auditar: no hay denegado que registrar, y una entrada malformada
    // tampoco puede servir para sondear permisos.
    return { status: "validation_error", fieldErrors: preparada.fieldErrors };
  }

  if (preparada.status === "forbidden") {
    return denegar(logger, preparada.motivo, actor, raw);
  }

  const service = deps.service ?? construirServicio(now);
  const datos = await service.consultar(preparada.consulta);
  return { status: "ok", datos };
}

/**
 * Registra el denegado y responde. Punto UNICO de respuesta negativa.
 *
 * `sin_sesion` sale como `unauthenticated` y todo lo demas como `forbidden`: «no sabemos quien
 * eres» se arregla volviendo a entrar y «no puedes» no. El MOTIVO concreto se queda en el log
 * — al cliente seria una pista sobre el modelo de permisos.
 */
function denegar(
  logger: ErrorLogger,
  motivo: MotivoDenegacion,
  actor: ActorAnalitica | null,
  raw: unknown,
): { readonly status: "unauthenticated" } | { readonly status: "forbidden" } {
  logger.logError(describirDenegado({ motivo, actor, metricaId: ID_AUDITORIA, filtro: raw }));
  return motivo === "sin_sesion" ? { status: "unauthenticated" } : { status: "forbidden" };
}
