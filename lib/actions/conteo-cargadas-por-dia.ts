"use server";

// EL BORDE de las ordenes cargadas por dia.
//
// Server Action y no ruta bajo `app/api/`, por el mismo motivo que sus dos gemelas
// (`conteo-entregas.ts`, `conteo-por-status.ts`): es una lectura INTERNA de esta aplicacion, y
// `docs/architecture.md` reserva los route handlers para webhooks y API publica.
//
// LOS CUATRO PASOS SON LOS MISMOS Y EN EL MISMO ORDEN, y no por parecido: se REUSA
// `prepararConteoEntregas` tal cual. Las tres lecturas de la pantalla comparten filtro,
// alcance y ventana porque las mueve la MISMA barra; duplicar aqui el parseo o —peor— el
// resolutor de alcance seria abrir una tercera puerta a la misma frontera multi-tenant.
// Lo unico propio de este archivo es a QUE servicio llama.

import { describirDenegado } from "@/lib/analytics/auditoria";
import { prepararConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type { ActorAnalitica, MotivoDenegacion } from "@/lib/analytics/alcance";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { crearConteoEntregasCacheDeNext } from "@/lib/cache/next-analitica-cache";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { defaultLogger, type ErrorLogger } from "@/lib/errors/logger";
import { ConteoCargadasPorDiaRepository } from "@/lib/repositories/ConteoCargadasPorDiaRepository";
import { ConteoCargadasPorDiaService } from "@/lib/services/ConteoCargadasPorDiaService";
import type { ResultadoConteoCargadasPorDia } from "@/lib/types/conteo-cargadas";

/**
 * Con que nombre aparece esta lectura en la auditoria. NO es un `metricaId` del catalogo
 * —esta cifra no vive ahi— pero `describirDenegado` exige uno para que la linea del log diga
 * QUE se intento leer. Distinto al de las otras dos acciones a proposito: si compartieran
 * nombre, una denegacion no diria cual de las tres puertas se toco.
 */
const ID_AUDITORIA = "conteo_cargadas_por_dia";

export interface ConteoCargadasPorDiaDeps {
  readonly service?: Pick<ConteoCargadasPorDiaService, "consultar">;
  readonly getActor?: () => Promise<ActorAnalitica | null>;
  readonly logger?: ErrorLogger;
  /** Reloj inyectable: misma entrada y mismo `now` => mismo resultado, sello incluido. */
  readonly now?: () => Date;
}

function construirServicio(now: () => Date): ConteoCargadasPorDiaService {
  return new ConteoCargadasPorDiaService(
    new ConteoCargadasPorDiaRepository(getPrismaClient()),
    // La MISMA cache que las otras dos lecturas: mismo TTL de 15 min y mismo kill-switch. Las
    // entradas no se pisan porque la clave lleva prefijo propio
    // (`claveDeConteoCargadasPorDia`).
    crearConteoEntregasCacheDeNext(),
    { now },
  );
}

/**
 * La UNICA lectura de las ordenes cargadas por dia.
 *
 * `raw` es el filtro sin validar tal cual lo manda el cliente — el MISMO contrato que
 * `consultarConteoEntregas` y `consultarConteoPorStatus`, incluidas las siete facetas y el
 * rango opcional.
 */
export async function consultarConteoCargadasPorDia(
  raw: unknown,
  deps: ConteoCargadasPorDiaDeps = {},
): Promise<ResultadoConteoCargadasPorDia> {
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
