"use server";

// EL BORDE del CICLO DE VIDA de una orden.
//
// Server Action y no ruta bajo `app/api/`, por el mismo motivo que sus cinco gemelas: es una
// lectura INTERNA de esta aplicacion, y `docs/architecture.md` reserva los route handlers para
// webhooks y API publica.
//
// LOS CUATRO PASOS SON LOS MISMOS Y EN EL MISMO ORDEN, y se REUSA `prepararConteoEntregas` tal
// cual. Las seis lecturas de la pantalla comparten filtro, alcance y validacion porque las
// mueve la MISMA barra; duplicar aqui el parseo o —peor— el resolutor de alcance seria abrir
// una sexta puerta a la misma frontera multi-tenant.
//
// ⚠ ESTA LECTURA MIDE TIEMPO, NO VOLUMEN, y su ventana cae sobre la TRANSICION TERMINAL, no
// sobre la fecha efectiva de la orden. Las dos cosas las decide el REPOSITORIO y estan
// declaradas alli; aqui no se recorta ni se reinterpreta nada del filtro: se pasa entero y cada
// capa toma lo suyo, que es lo que mantiene el contrato identico para las seis.

import { describirDenegado } from "@/lib/analytics/auditoria";
import { prepararConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type { ActorAnalitica, MotivoDenegacion } from "@/lib/analytics/alcance";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { crearConteoEntregasCacheDeNext } from "@/lib/cache/next-analitica-cache";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { defaultLogger, type ErrorLogger } from "@/lib/errors/logger";
import { CicloVidaRepository } from "@/lib/repositories/CicloVidaRepository";
import { CicloVidaService } from "@/lib/services/CicloVidaService";
import type { ResultadoCicloVida } from "@/lib/types/conteo-ciclo-vida";

/**
 * Con que nombre aparece esta lectura en la auditoria. NO es un `metricaId` del catalogo —hay
 * uno homonimo, `tiempo_ciclo`, y por eso este se llama distinto: confundirlos haria creer que
 * la denegacion vino del tablero del rollup— pero `describirDenegado` exige uno para que la
 * linea del log diga QUE se intento leer.
 */
const ID_AUDITORIA = "ciclo_vida";

export interface CicloVidaDeps {
  readonly service?: Pick<CicloVidaService, "consultar">;
  readonly getActor?: () => Promise<ActorAnalitica | null>;
  readonly logger?: ErrorLogger;
  /** Reloj inyectable: misma entrada y mismo `now` => mismo resultado, sello incluido. */
  readonly now?: () => Date;
}

function construirServicio(now: () => Date): CicloVidaService {
  return new CicloVidaService(
    new CicloVidaRepository(getPrismaClient()),
    // La MISMA cache que las otras cinco lecturas: mismo TTL de 15 min y mismo kill-switch.
    // Las entradas no se pisan porque la clave lleva prefijo propio (`claveDeCicloVida`).
    crearConteoEntregasCacheDeNext(),
    { now },
  );
}

/**
 * La UNICA lectura del ciclo de vida.
 *
 * `raw` es el filtro sin validar tal cual lo manda el cliente — el MISMO contrato que las
 * otras cinco lecturas, incluidas las siete facetas y el rango opcional.
 *
 * SUPERFICIE: `CicloVidaKpi` (seccion de entregas de `/analitica`), montado el 2026-08-18.
 * Hasta ese dia esta accion llevaba `@sin-superficie` porque el KPI no se habia pedido; la
 * anotacion se retira aqui, que es lo que la guardia de superficie exige en cuanto la accion
 * pasa a ser alcanzable desde una raiz de ruta — una excepcion que sobrevive a su motivo deja
 * de significar nada.
 */
export async function consultarCicloVida(
  raw: unknown,
  deps: CicloVidaDeps = {},
): Promise<ResultadoCicloVida> {
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
