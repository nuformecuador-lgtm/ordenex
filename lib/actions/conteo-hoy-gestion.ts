"use server";

// EL BORDE del contador de HOY: cargadas del dia en curso, gestionadas vs sin gestionar.
//
// Server Action y no ruta bajo `app/api/`, por el mismo motivo que sus tres gemelas: es una
// lectura INTERNA de esta aplicacion, y `docs/architecture.md` reserva los route handlers para
// webhooks y API publica.
//
// LOS CUATRO PASOS SON LOS MISMOS Y EN EL MISMO ORDEN, y se REUSA `prepararConteoEntregas` tal
// cual. Las cuatro lecturas de la pantalla comparten filtro, alcance y validacion porque las
// mueve la MISMA barra; duplicar aqui el parseo o —peor— el resolutor de alcance seria abrir
// una cuarta puerta a la misma frontera multi-tenant.
//
// ⚠ ESTA LECTURA IGNORA PARTE DEL FILTRO, y no es un descuido: la VENTANA y el MENSAJERO no se
// aplican (ver `ConteoHoyGestionDTO`). Un contador «de hoy» que obedeciera al selector de
// fechas dejaria de ser el contador de hoy sin cambiar de rotulo. Quien decide eso es el
// SERVICIO —que resuelve el dia CR con su propio reloj— y el repositorio, que solo lee del
// filtro el alcance y las cinco facetas de recorte. Aqui no se recorta nada a mano: se pasa la
// consulta entera y cada capa toma lo suyo.

import { describirDenegado } from "@/lib/analytics/auditoria";
import { prepararConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type { ActorAnalitica, MotivoDenegacion } from "@/lib/analytics/alcance";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { crearConteoEntregasCacheDeNext } from "@/lib/cache/next-analitica-cache";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { defaultLogger, type ErrorLogger } from "@/lib/errors/logger";
import { ConteoHoyGestionRepository } from "@/lib/repositories/ConteoHoyGestionRepository";
import { ConteoHoyGestionService } from "@/lib/services/ConteoHoyGestionService";
import type { ResultadoConteoHoyGestion } from "@/lib/types/conteo-hoy-gestion";

/**
 * Con que nombre aparece esta lectura en la auditoria. NO es un `metricaId` del catalogo, pero
 * `describirDenegado` exige uno para que la linea del log diga QUE se intento leer. Distinto al
 * de las otras tres acciones: si compartieran nombre, una denegacion no diria cual de las
 * cuatro puertas se toco.
 */
const ID_AUDITORIA = "conteo_hoy_gestion";

export interface ConteoHoyGestionDeps {
  readonly service?: Pick<ConteoHoyGestionService, "consultar">;
  readonly getActor?: () => Promise<ActorAnalitica | null>;
  readonly logger?: ErrorLogger;
  /**
   * Reloj inyectable. Aqui pesa mas que en las otras tres: el DIA que se cuenta lo decide este
   * reloj (`resolverRango({ preset: "dia" }, now)`), asi que sin inyeccion no habria forma de
   * probar el contador sin esperar a manana.
   */
  readonly now?: () => Date;
}

function construirServicio(now: () => Date): ConteoHoyGestionService {
  return new ConteoHoyGestionService(
    new ConteoHoyGestionRepository(getPrismaClient()),
    // La MISMA cache que las otras tres lecturas: mismo TTL de 15 min y mismo kill-switch. Las
    // entradas no se pisan porque la clave lleva prefijo propio (`claveDeConteoHoyGestion`), y
    // ademas esa clave incluye el DIA — asi la entrada de ayer no puede servirse hoy.
    crearConteoEntregasCacheDeNext(),
    { now },
  );
}

/**
 * La UNICA lectura del contador de hoy.
 *
 * `raw` es el filtro sin validar tal cual lo manda el cliente — el MISMO contrato que las otras
 * tres lecturas, aunque de el solo se apliquen el alcance y las cinco facetas de recorte.
 */
export async function consultarConteoHoyGestion(
  raw: unknown,
  deps: ConteoHoyGestionDeps = {},
): Promise<ResultadoConteoHoyGestion> {
  const logger = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => new Date());
  const actor = await (deps.getActor ?? resolveActorFromSession)();

  const preparada = prepararConteoEntregas(raw, actor, now());

  if (preparada.status === "validation_error") {
    // Se valida el filtro ENTERO aunque parte de el no se use, y a proposito: aceptar aqui un
    // `rango` malformado que las otras tres rechazan haria que la misma barra diera error en
    // tres graficas y no en la cuarta, que es un sintoma imposible de diagnosticar.
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
