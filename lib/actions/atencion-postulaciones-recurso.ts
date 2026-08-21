"use server";

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { getPrismaClient } from "@/lib/db/prisma-client";
import {
  withErrorHandler,
  isAppErrorShape,
  UnauthenticatedError,
  ValidationError,
  MSG,
} from "@/lib/errors";
import { toActionError } from "@/lib/actions/_shared/to-action-error";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IPostulacionRecursoService } from "@/lib/interfaces/services/IPostulacionRecursoService";
import { PostulacionRecursoRepository } from "@/lib/repositories/PostulacionRecursoRepository";
import { PostulacionRecursoService } from "@/lib/services/PostulacionRecursoService";
import {
  listarPostulacionesRecursoSchema,
  postulacionRecursoIdSchema,
  type AtenderPostulacionRecursoResult,
  type ListarPostulacionesRecursoResult,
} from "@/lib/types/postulacion-recurso";

// Feature 253 (T5.1, design §6) — las DOS Server Actions del ADMIN sobre las postulaciones de
// vehiculo o bodega. Molde literal de `lib/actions/aprobacion-postulaciones.ts`:
// `withErrorHandler` -> actor -> zod -> servicio -> `toActionError`.
//
// ⚠️ EL NOMBRE DEL MODULO ES `atencion-postulaciones-recurso.ts` Y NO `postulaciones-recurso.ts`,
// A PROPOSITO (design §6): a un metro de distancia no puede confundirse con la accion PUBLICA
// `postulacion-recurso.ts`. Dos modulos con nombres casi iguales y permisos opuestos es
// exactamente como se importa el equivocado sin que el typecheck diga ni una palabra.
//
// Al reves que la publica, estas DOS SI resuelven actor y SI comprueban rol: el guard de rol vive
// en el service (R27/R28) y aqui solo se exige que HAYA sesion.

/**
 * COMPOSITION ROOT. Sin notificador: el aviso de la campana lo emite el camino publico al llegar
 * una postulacion (D6), no el admin al leerla o atenderla. Un service sin cablear usa el no-op,
 * asi que estas dos acciones NO pueden escribir en `notificacion` por construccion.
 */
function buildService(): IPostulacionRecursoService {
  return new PostulacionRecursoService(new PostulacionRecursoRepository(getPrismaClient()));
}

export interface AtencionPostulacionesRecursoDeps {
  service?: IPostulacionRecursoService;
  getActor?: () => Promise<Actor | null>;
}

/** R27/R28/R30/R33: lista pendientes o atendidas, paginado. Sin sesion -> `unauthenticated`. */
export async function listarPostulacionesRecurso(
  input: unknown,
  deps: AtencionPostulacionesRecursoDeps = {},
): Promise<ListarPostulacionesRecursoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // antes del service: no se toca la base
    const data = listarPostulacionesRecursoSchema.parse(input ?? {}); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listar(data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/**
 * R31/R32/R34: marca una postulacion como atendida. Es la UNICA mutacion que un administrador
 * puede hacer sobre una fila.
 *
 * Los tres desenlaces de fallo son distinguibles y ninguno es mudo: `forbidden` (rol no
 * autorizado), `not_found` (no existe) y `conflict` (ya estaba atendida, y NO se sobrescribe
 * quien ni cuando).
 */
export async function marcarPostulacionRecursoAtendida(
  id: unknown,
  deps: AtencionPostulacionesRecursoDeps = {},
): Promise<AtenderPostulacionRecursoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const parsedId = postulacionRecursoIdSchema.safeParse(id);
    if (!parsedId.success) {
      // id vacio o mal formado -> validation_error SIN tocar el service.
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.service ?? buildService();
    return service.atender(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}
