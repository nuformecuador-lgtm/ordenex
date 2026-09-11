"use server";

// FICHA 410 (design §11/§12, T3.9) — las tres operaciones del canal de push como Server Actions del
// propio proyecto, NO como rutas API internas (docs/architecture.md). Patron
// `lib/actions/notificaciones.ts`: resuelven el actor con la sesion, validan el borde con zod,
// envuelven con `withErrorHandler` y traducen con `toActionError`. `deps` inyectables para test sin
// DB ni cookies.
//
// ⚠️ EL USUARIO SALE DE LA SESION, NUNCA DE LA ENTRADA (R50). Es el requisito que decide la forma de
// este archivo: si el identificador viajara en el cuerpo, cualquiera podria suscribir un dispositivo
// a nombre de otra persona y recibir en SU telefono los avisos de un rol que no tiene. Los dos
// schemas son `strict()`, asi que un `usuarioId` inyectado no se ignora: da `validation_error`.
import {
  eliminarSuscripcionSchema,
  registrarSuscripcionSchema,
  type ClavePublicaPushResult,
  type SuscripcionPushResult,
} from "@/lib/types/push";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IPushSuscripcionRepository } from "@/lib/interfaces/repositories/IPushSuscripcionRepository";
import { PushSuscripcionRepository } from "@/lib/repositories/PushSuscripcionRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { clavePublicaPush } from "@/lib/config/push";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import { toActionError } from "@/lib/actions/_shared/to-action-error";

export interface PushActionDeps {
  repo?: IPushSuscripcionRepository;
  getActor?: () => Promise<Actor | null>;
  /** La clave publica, inyectable para el test. Por defecto la del entorno (R32). */
  clavePublica?: () => string | null;
}

function buildRepo(): IPushSuscripcionRepository {
  return new PushSuscripcionRepository(getPrismaClient());
}

/** R50: sin sesion valida NO se lee ni se escribe NADA del canal. */
async function actorRequerido(deps: PushActionDeps): Promise<Actor> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) throw new UnauthenticatedError();
  return actor;
}

/**
 * R32 — la clave PUBLICA con la que el navegador se suscribe, resuelta en TIEMPO DE EJECUCION.
 *
 * `clavePublica: null` no es un error: significa «este despliegue no tiene canal de push», y el
 * control de activacion sencillamente no se ofrece (R13/R30). La app no se entera de nada mas.
 *
 * NO devuelve, ni por asomo, la clave PRIVADA (R31): `clavePublicaPush()` solo lee la publica.
 *
 * @sin-superficie la superficie de las tres acciones del canal es `components/shared/PushOptIn.tsx`
 * via `hooks/usePushSuscripcion.ts`, que son la tanda 5 de ESTA MISMA ficha (410/T5.1-T5.3) y las
 * escribe el agente de frontend sobre esta rama. El backend va primero por decision del arnes.
 * ⚠️ QUIEN MONTE EL CONTROL TIENE QUE BORRAR ESTAS TRES ANOTACIONES: la guardia caduca solas y se
 * pone roja si lo anotado vuelve a ser alcanzable.
 */
export async function obtenerClavePublicaPush(
  deps: PushActionDeps = {},
): Promise<ClavePublicaPushResult> {
  const r = await withErrorHandler(async () => {
    await actorRequerido(deps);
    return { status: "ok" as const, clavePublica: (deps.clavePublica ?? clavePublicaPush)() };
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/**
 * R16/R17/R18/R50 — registra (o REEMPLAZA) la suscripcion de ESTE dispositivo a nombre del usuario
 * de la sesion. La identidad es el `endpoint`: si el dispositivo ya estaba suscrito a otra persona,
 * la fila pasa a ser de quien acaba de iniciar sesion y la anterior deja de recibir ahi.
 *
 * @sin-superficie la llama `hooks/usePushSuscripcion.ts` al activar el control, y ese hook es la
 * tanda 5 de ESTA MISMA ficha (410/T5.1). Se borra esta anotacion al montarlo.
 */
export async function registrarSuscripcionPush(
  input: unknown,
  deps: PushActionDeps = {},
): Promise<SuscripcionPushResult> {
  const r = await withErrorHandler(async () => {
    // El actor PRIMERO: sin sesion no se valida ni se escribe nada.
    const actor = await actorRequerido(deps);
    const data = registrarSuscripcionSchema.parse(input); // ZodError -> VALIDATION_ERROR
    await (deps.repo ?? buildRepo()).registrar(actor.usuarioId, data);
    return { status: "ok" as const };
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/**
 * R15/R19 — baja de la suscripcion de ESTE dispositivo. Acotada al usuario de la sesion: una
 * persona solo retira lo suyo, aunque conozca el endpoint de otra.
 *
 * Que no hubiera nada que borrar NO es un error: desactivar dos veces, o cerrar sesion en un
 * dispositivo que nunca se suscribio, devuelve `ok`. Un `not_found` aqui obligaria al cierre de
 * sesion a decidir que hacer con el (R20), y la respuesta correcta es «seguir saliendo».
 *
 * @sin-superficie la llaman el control al desactivar (410/T5.1) y el `LogoutButton` al cerrar
 * sesion (410/T5.5), y las dos son la tanda 5 de ESTA MISMA ficha. Se borra al montarlas.
 */
export async function eliminarSuscripcionPush(
  input: unknown,
  deps: PushActionDeps = {},
): Promise<SuscripcionPushResult> {
  const r = await withErrorHandler(async () => {
    const actor = await actorRequerido(deps);
    const data = eliminarSuscripcionSchema.parse(input);
    await (deps.repo ?? buildRepo()).eliminarDeUsuario(actor.usuarioId, data.endpoint);
    return { status: "ok" as const };
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}
