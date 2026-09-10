"use server";

// EL BORDE de la COHORTE DE CARGA.
//
// Server Action y no ruta bajo `app/api/`, por el mismo motivo que sus siete hermanas: es una
// lectura INTERNA de esta aplicacion, y `docs/architecture.md` reserva los route handlers para
// webhooks y API publica.
//
// LOS CUATRO PASOS DE LA PREPARACION SON LOS MISMOS Y EN EL MISMO ORDEN, y no por parecido: se
// REUSA `prepararConteoEntregas` tal cual. Las ocho lecturas de la pantalla comparten filtro,
// alcance y ventana porque las mueve la MISMA barra; duplicar aqui el parseo o —peor— el
// resolutor de alcance seria abrir una octava puerta a la misma frontera multi-tenant.
//
// ─── EL PASO PROPIO: `sin_rango`, Y VA DESPUES DE LA DENEGACION ─────────────────────────
//
//   parsear (zod)  ->  ¿alcance?  ->  ¿hay rango?  ->  consultar
//      | falla         | deniega      | no hay
//   validation_error   forbidden /    sin_rango
//                      unauthenticated
//
// Esta lectura EXIGE rango (las otras siete lo aceptan opcional y «sin filtrar significa TODO»):
// sin techo, la tabla crece hasta una fila por cada dia que alguna vez tuvo carga y deja de ser
// una herramienta. Pero faltar el rango NO es un error del usuario ni un filtro invalido —el
// filtro es valido, las otras siete lo aceptan tal cual—, asi que sale por un estado propio que
// la pantalla traduce a una invitacion.
//
// Y LA DENEGACION PRECEDE A LA INVITACION (R5): un `mensajero` no recibe «elige un periodo»,
// recibe `forbidden`. Al reves, la respuesta seria una sonda de permisos: quien no puede leer
// esto averiguaria, por el texto, que existe y que solo le falta un filtro. Por el mismo motivo
// una entrada malformada ni siquiera llega a preguntar por el alcance.
//
// `sin_rango` NO TOCA LA BASE NI LA CACHE. El servicio no se construye siquiera.

import { describirDenegado } from "@/lib/analytics/auditoria";
import { prepararConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type { ActorAnalitica, MotivoDenegacion } from "@/lib/analytics/alcance";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { crearConteoEntregasCacheDeNext } from "@/lib/cache/next-analitica-cache";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { defaultLogger, type ErrorLogger } from "@/lib/errors/logger";
import { CohorteCargaRepository } from "@/lib/repositories/CohorteCargaRepository";
import { CohorteCargaService } from "@/lib/services/CohorteCargaService";
import type { ResultadoCohorteCarga } from "@/lib/types/cohorte-carga";

/**
 * Con que nombre aparece esta lectura en la auditoria. NO es un `metricaId` del catalogo —esta
 * cifra no vive ahi— pero `describirDenegado` exige uno para que la linea del log diga QUE se
 * intento leer. Distinto al de las otras siete acciones a proposito: si compartieran nombre, una
 * denegacion no diria cual de las ocho puertas se toco.
 */
const ID_AUDITORIA = "cohorte_carga";

export interface CohorteCargaDeps {
  readonly service?: Pick<CohorteCargaService, "consultar">;
  readonly getActor?: () => Promise<ActorAnalitica | null>;
  readonly logger?: ErrorLogger;
  /** Reloj inyectable: misma entrada y mismo `now` => mismo resultado, sello incluido. */
  readonly now?: () => Date;
}

function construirServicio(now: () => Date): CohorteCargaService {
  return new CohorteCargaService(
    new CohorteCargaRepository(getPrismaClient()),
    // La MISMA cache que las otras siete lecturas: mismo TTL de 15 min y mismo kill-switch. Las
    // entradas no se pisan porque la clave lleva prefijo propio (`claveDeCohorteCarga`).
    crearConteoEntregasCacheDeNext(),
    { now },
  );
}

/**
 * La UNICA lectura de las cohortes de carga.
 *
 * `raw` es el filtro sin validar tal cual lo manda el cliente — el MISMO contrato que el resto de
 * la vertical, incluidas las seis facetas y el rango. Ningun parametro propio de esta ficha: que
 * la barra mueva las ocho lecturas a la vez es la razon de que compartan filtro.
 *
 * SU SUPERFICIE (retirado el `@sin-superficie` el 2026-09-10, B7): la consume
 * `app/(app)/analitica/_components/entregas/CohorteCargaTabla.tsx`, que monta
 * `app/(app)/analitica/page.tsx` dentro de `FiltroEntregasProvider`. La anotacion vivio
 * exactamente lo que tardo en existir la tabla — una excepcion que sobrevive a su motivo deja de
 * significar nada, y `superficie-de-uso.guardia` la exige retirada en cuanto esto es alcanzable.
 */
export async function consultarCohorteCarga(
  raw: unknown,
  deps: CohorteCargaDeps = {},
): Promise<ResultadoCohorteCarga> {
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

  // El paso propio de esta lectura, y va DESPUES de la denegacion a proposito (ver la cabecera).
  // No es un error: es que aun no se ha elegido periodo. Ni base, ni cache, ni servicio.
  if (preparada.consulta.rango === null) {
    return { status: "sin_rango" };
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
 * (R25) — al cliente seria una pista sobre el modelo de permisos.
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
