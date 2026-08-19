"use server";

// EL BORDE del conteo de entregas.
//
// ¿Por que una Server Action y NO una ruta bajo `app/api/`? Porque es una lectura INTERNA de
// esta misma aplicacion, y `docs/architecture.md` reserva los route handlers para webhooks y
// API publica. El arbol de analitica lo dice ademas con todas las letras
// (`lib/actions/analitica-operativa.ts`, R1): «NO hay ni habra una ruta bajo `app/api/` para
// esto». Decision confirmada por el humano el 2026-08-17: si algun dia se quiere consumir
// esta cifra desde fuera, sera un route handler DELGADO que envuelva esta accion —una sola
// logica, dos puertas—, no una segunda implementacion.
//
// EL ORDEN DE LOS PASOS ES EL CONTRATO y no es intercambiable:
//   1. actor de la sesion;
//   2. `prepararConteoEntregas` — parsea, resuelve rango, resuelve alcance e interseca, en
//      UNA llamada: si el parseo falla NO se pregunta por el alcance y NO se toca la base;
//   3. denegado -> `logger.logError(describirDenegado(...))` **y DESPUES** responder;
//   4. ok -> servicio (que decide cache y sello).
//
// ⚠ TRAMPA HEREDADA Y VERIFICADA (R5 de la 126, escrita en `lib/analytics/auditoria.ts`):
// `normalizeError` solo llama a `logger.logError` en la rama del error DESCONOCIDO, asi que
// lanzar un `ForbiddenError` y confiar en `withErrorHandler` produce un 403 MUDO. Por eso la
// llamada al logger es EXPLICITA aqui.

import { describirDenegado } from "@/lib/analytics/auditoria";
import { prepararConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type { ActorAnalitica, MotivoDenegacion } from "@/lib/analytics/alcance";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { crearConteoEntregasCacheDeNext } from "@/lib/cache/next-analitica-cache";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { defaultLogger, type ErrorLogger } from "@/lib/errors/logger";
import { ConteoEntregasRepository } from "@/lib/repositories/ConteoEntregasRepository";
import { ConteoPorStatusRepository } from "@/lib/repositories/ConteoPorStatusRepository";
import { ConteoEntregasService } from "@/lib/services/ConteoEntregasService";
import type { ResultadoConteoEntregas } from "@/lib/types/conteo-entregas";

/**
 * Identificador con el que esta lectura aparece en la auditoria. NO es un `metricaId` del
 * catalogo —esta cifra no vive ahi (ver `lib/analytics/entregas-conteo.ts`)— pero
 * `describirDenegado` exige uno para que la linea del log diga QUE se intento leer, y una
 * linea de auditoria sin sujeto no sirve para nada.
 */
const ID_AUDITORIA = "conteo_entregas";

export interface ConteoEntregasDeps {
  readonly service?: Pick<ConteoEntregasService, "consultar">;
  readonly getActor?: () => Promise<ActorAnalitica | null>;
  readonly logger?: ErrorLogger;
  /** Reloj inyectable (patron de `consultarAnaliticaOperativa`): misma entrada y mismo
   *  `now` => mismo resultado, sello `lastSync` incluido. */
  readonly now?: () => Date;
}

function construirServicio(now: () => Date): ConteoEntregasService {
  return new ConteoEntregasService(
    // El anillo es el PLIEGUE del desglose por status: misma consulta, misma semantica.
    // Cablearlo asi es lo que impide que los dos graficos de la pantalla discrepen sobre
    // cuantas entregadas hubo.
    new ConteoEntregasRepository(new ConteoPorStatusRepository(getPrismaClient())),
    crearConteoEntregasCacheDeNext(),
    { now },
  );
}

/**
 * La UNICA lectura del conteo de entregas.
 *
 * `raw` es el filtro sin validar tal cual lo manda el cliente. Se valida en el paso 2 contra
 * `conteoEntregasFiltroSchema`, que es `.strict()`: ni el rol ni el alcance pueden entrar por
 * ahi.
 */
export async function consultarConteoEntregas(
  raw: unknown,
  deps: ConteoEntregasDeps = {},
): Promise<ResultadoConteoEntregas> {
  const logger = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => new Date());
  const actor = await (deps.getActor ?? resolveActorFromSession)();

  const preparada = prepararConteoEntregas(raw, actor, now());

  if (preparada.status === "validation_error") {
    // Se devuelve SIN consultar y SIN auditar: no hay denegado que registrar, y una entrada
    // malformada tampoco puede servir para sondear permisos.
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
 * Registra el denegado y responde. Punto UNICO de respuesta negativa: una segunda forma de
 * decir «no» seria una que alguien puede olvidar auditar.
 *
 * `sin_sesion` sale como `unauthenticated` y todo lo demas como `forbidden`. NO es cosmetica:
 * «no sabemos quien eres» y «no puedes» piden cosas distintas del usuario —una se arregla
 * volviendo a entrar y la otra no—, y la pantalla ya tiene dos textos para eso. El MOTIVO
 * concreto (rol prohibido, zona sin asignar, filtro fuera de alcance) se queda en el log y no
 * viaja al cliente: seria una pista sobre el modelo de permisos.
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
