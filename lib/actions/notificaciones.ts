"use server";

// Feature 146 (design §3, R38) — las CINCO operaciones de la campana como Server Actions del
// propio proyecto, NO como rutas API internas consumidas por `fetch` (docs/architecture.md;
// alternativa A7 descartada). Patron `lib/actions/aprobacion-postulaciones.ts`: resuelven el
// actor con la sesion, validan el borde con zod, envuelven con `withErrorHandler` y traducen
// con `toActionError`. `deps` inyectables para test sin DB ni cookies.
import {
  cargaTerminadaSchema,
  notificacionIdSchema,
  type ListarNotificacionesResult,
  type MarcarNotificacionResult,
  type MarcarTodasLeidasResult,
  type NotificarCargaMasivaResult,
} from "@/lib/types/notificacion";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { INotificacionService } from "@/lib/interfaces/services/INotificacionService";
import { NotificacionService } from "@/lib/services/NotificacionService";
import { NotificacionRepository } from "@/lib/repositories/NotificacionRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  withErrorHandler,
  isAppErrorShape,
  UnauthenticatedError,
  ValidationError,
  MSG,
} from "@/lib/errors";
import { toActionError } from "@/lib/actions/_shared/to-action-error";

function buildService(): INotificacionService {
  return new NotificacionService(new NotificacionRepository(getPrismaClient()));
}

export interface NotificacionActionDeps {
  service?: INotificacionService;
  getActor?: () => Promise<Actor | null>;
}

/** R34: sin sesion valida NO se lee ni se escribe nada de notificaciones. */
async function actorRequerido(deps: NotificacionActionDeps): Promise<Actor> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) throw new UnauthenticatedError();
  return actor;
}

/** R36: id mal formado -> validation_error ANTES de instanciar el service. */
function idValidado(id: unknown): string {
  const parsed = notificacionIdSchema.safeParse(id);
  if (!parsed.success) {
    throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
  }
  return parsed.data;
}

/** R28/R29/R30: listado visible del actor, con su estado de lectura y su contador. */
export async function listarNotificaciones(
  deps: NotificacionActionDeps = {},
): Promise<ListarNotificacionesResult> {
  const r = await withErrorHandler(async () => {
    const actor = await actorRequerido(deps);
    return (deps.service ?? buildService()).listar(actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/** R31/R35/R37: marca una notificacion como leida para el actor. */
export async function marcarNotificacionLeida(
  id: unknown,
  deps: NotificacionActionDeps = {},
): Promise<MarcarNotificacionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await actorRequerido(deps);
    const notificacionId = idValidado(id);
    return (deps.service ?? buildService()).marcarLeida(notificacionId, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/** R32: marca todas las visibles y no descartadas; el contador queda en cero. */
export async function marcarTodasLeidas(
  deps: NotificacionActionDeps = {},
): Promise<MarcarTodasLeidasResult> {
  const r = await withErrorHandler(async () => {
    const actor = await actorRequerido(deps);
    return (deps.service ?? buildService()).marcarTodasLeidas(actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/** R33/R35/R37: descarta la notificacion para ESTE usuario, sin borrar la fila. */
export async function descartarNotificacion(
  id: unknown,
  deps: NotificacionActionDeps = {},
): Promise<MarcarNotificacionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await actorRequerido(deps);
    const notificacionId = idValidado(id);
    return (deps.service ?? buildService()).descartar(notificacionId, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/**
 * R22/R39 (design §3.6) — cierre de la carga masiva por INTERFAZ. El servidor no sabe cual
 * es el ultimo chunk (lo trocea el cliente), asi que el cliente avisa con esta accion.
 *
 * El destinatario NO viaja en el input: se fija server-side al actor autenticado, asi que
 * nadie puede sembrar avisos en la campana de otro. `loteId` (uuid generado por el cliente al
 * INICIAR la carga) es la clave de idempotencia: una segunda invocacion para la misma carga
 * no produce una notificacion adicional.
 */
export async function notificarCargaMasivaTerminada(
  input: unknown,
  deps: NotificacionActionDeps = {},
): Promise<NotificarCargaMasivaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await actorRequerido(deps);
    const data = cargaTerminadaSchema.parse(input); // R36: ZodError -> VALIDATION_ERROR
    return (deps.service ?? buildService()).notificarCargaTerminada(data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}
