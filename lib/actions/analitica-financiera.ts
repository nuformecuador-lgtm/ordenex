"use server";

import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import { describirDenegado } from "@/lib/analytics/auditoria";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { defaultLogger, type ErrorLogger } from "@/lib/errors/logger";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IAnaliticaFinancieraService } from "@/lib/interfaces/services/IAnaliticaFinancieraService";
import { ConciliacionCierresAnaliticaRepository } from "@/lib/repositories/ConciliacionCierresAnaliticaRepository";
import { CuentasPorPagarAnaliticaRepository } from "@/lib/repositories/CuentasPorPagarAnaliticaRepository";
import { IngresosAnaliticaRepository } from "@/lib/repositories/IngresosAnaliticaRepository";
import { RecaudoAnaliticaRepository } from "@/lib/repositories/RecaudoAnaliticaRepository";
import { AnaliticaFinancieraService } from "@/lib/services/AnaliticaFinancieraService";
import type { RespuestaFinanciera } from "@/lib/types/analitica-financiera";

// Feature 127 (T E.1-E.5) — EL BORDE de la analitica financiera. Server Action, no route
// handler: no hay consumidor externo, ni webhook, ni cron (design.md §7 alternativa 6).
//
// Aqui NO hay consultas (R30): el borde resuelve el actor, llama al UNICO punto de entrada de
// la 122 y traduce su resultado. Todo lo que sabe de dinero lo sabe el servicio.
//
// LOS TRES PASOS, EN ESTE ORDEN, Y NO SON INTERCAMBIABLES:
//
//  1. R13 — `validation_error` responde 400 con `fieldErrors` y **NO AUDITA**. Una entrada
//     malformada no es un intento de acceso: auditarla llenaria de ruido el canal de los
//     denegados y ahi es donde se pierde la señal del intento real. Ademas
//     `prepararConsultaAnalitica` ni siquiera resolvio el alcance en ese caso (R19 de la 122),
//     asi que no hay motivo que registrar.
//  2. R11 — `forbidden` AUDITA PRIMERO y responde despues, con una llamada EXPLICITA a
//     `logger.logError(describirDenegado(...))`.
//     ⚠ TRAMPA VERIFICADA (`lib/analytics/auditoria.ts:10-16`): lanzar un `ForbiddenError` y
//     confiar en `withErrorHandler` produce un 403 MUDO —`normalizeError` devuelve la shape del
//     `AppError` en su primera linea y solo registra en la rama del error desconocido—. El
//     status saldria bien y el intento no dejaria rastro.
//  3. R12 / R42 / ⟨D9(c)⟩ — el cuerpo del 403 es GENERICO: `{ code: "FORBIDDEN" }`, sin motivo.
//     El dominio cerrado de `MotivoDenegacion` viaja INTEGRO al registro del `ErrorLogger`, y
//     solo ahi. Con `metrica_desconocida` vs `metrica_prohibida` en la respuesta, un cliente
//     podria enumerar el catalogo y los permisos de cada rol preguntando. Y nunca es 200 con
//     ceros ni con lista vacia: la 133 tiene que poder distinguir "prohibido" de "sin datos".
//
// R15 — EL ACTOR SALE DE `resolveActorFromSession()` Y DE NINGUN OTRO SITIO. Este archivo no
// importa `next/headers` y no lee la cookie de sesion: leerla aqui crearia una segunda forma de
// autenticar, que es como se acaban divergiendo dos ideas de "quien eres".
//
// R32 / R14 — el fallo de la consulta se reporta CON CONTEXTO (que metrica, que rango) y SIN
// PII: el mensaje que cruza al cliente se construye con el `metricaId` que el propio actor envio
// y las dos fechas del rango, nunca con el texto del error original, que puede arrastrar una
// fila entera de la base. El error integro va al `ErrorLogger`, que es el canal del servidor.

/**
 * Inyeccion para los tests (patron `lib/actions/ranking.ts`). En produccion todo es `undefined`
 * y se usan las implementaciones reales; nada de esto viaja desde el cliente —una funcion no
 * cruza la frontera RSC— y ninguna de las tres concede acceso: el permiso lo decide siempre
 * `prepararConsultaAnalitica` con el actor que devuelve la sesion.
 */
export interface AnaliticaFinancieraActionDeps {
  readonly service?: IAnaliticaFinancieraService;
  readonly getActor?: () => Promise<Actor | null>;
  readonly logger?: ErrorLogger;
  /** `now` inyectable (patron de `resolverRango`): sin el, el rango dependeria del reloj. */
  readonly now?: Date;
}

function construirServicio(logger: ErrorLogger): IAnaliticaFinancieraService {
  const prisma = getPrismaClient();
  return new AnaliticaFinancieraService(
    new IngresosAnaliticaRepository(prisma),
    new RecaudoAnaliticaRepository(prisma),
    new CuentasPorPagarAnaliticaRepository(prisma),
    new ConciliacionCierresAnaliticaRepository(prisma),
    logger,
  );
}

/**
 * Consulta una de las ocho metricas financieras del catalogo.
 *
 * `filtroRaw` entra como `unknown` A PROPOSITO y no se pre-parsea aqui: el esquema de la 135 es
 * `.strict()` y validarlo dos veces, en dos sitios, es como se acaban aceptando dos formas
 * distintas de la misma entrada. Lo valida entero `prepararConsultaAnalitica`.
 */
export async function consultarMetricaFinanciera(
  metricaId: string,
  filtroRaw: unknown,
  deps: AnaliticaFinancieraActionDeps = {},
): Promise<RespuestaFinanciera> {
  const logger = deps.logger ?? defaultLogger;
  const actor = await (deps.getActor ?? resolveActorFromSession)();

  const preparacion = prepararConsultaAnalitica(filtroRaw, actor, metricaId, deps.now);

  // (1) R13 — 400 y NADA de auditoria.
  if (preparacion.status === "validation_error") {
    return { status: "validation_error", fieldErrors: preparacion.fieldErrors };
  }

  // (2) R11 — auditar ANTES de responder, con llamada explicita.
  if (preparacion.status === "forbidden") {
    logger.logError(
      describirDenegado({
        motivo: preparacion.motivo,
        actor,
        metricaId,
        filtro: filtroRaw,
      }),
    );
    // (3) R12 / R42 — cuerpo generico. El motivo se quedo arriba.
    return { status: "forbidden", code: "FORBIDDEN" };
  }

  const { consulta } = preparacion;
  // El servicio se construye DESPUES del 403: un intento denegado no abre ni una conexion (R10).
  const service = deps.service ?? construirServicio(logger);

  try {
    const resultado = await service.consultar(consulta);

    // R5 — el catalogo concede metricas que esta feature no sirve (`entregas` es total para
    // `maestro`). No es un 403: el permiso existia. Es un error explicito, y nunca ceros.
    if (resultado.status === "dominio_invalido") {
      return {
        status: "error",
        mensaje: `analitica financiera: la metrica "${resultado.metricaId}" no pertenece al dominio financiera`,
      };
    }

    return { status: "ok", datos: resultado.datos };
  } catch (error) {
    // R32 — no se silencia y no se devuelve un cero: se registra entero y se reporta el fallo
    // con el contexto que R32 pide, construido solo con lo que el actor envio.
    logger.logError(error);
    return {
      status: "error",
      mensaje: `analitica financiera: fallo la consulta de "${metricaId}" en el rango [${consulta.rango.desdeFecha}, ${consulta.rango.hastaFecha}]`,
    };
  }
}
