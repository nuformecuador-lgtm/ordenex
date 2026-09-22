"use server";

// FICHA 453 (design §5, T2.2) — las cinco operaciones de las VISTAS DE FILTROS como Server Actions
// del propio proyecto, NO como rutas API internas (docs/architecture.md). Patron exacto de
// `lib/actions/push.ts`: el actor sale de la sesion, el borde valida con zod `.strict()`, se
// envuelve con `withErrorHandler` y se traduce con `toActionError`, y `deps` es inyectable para
// probar sin DB ni cookies.
//
// ⚠️ EL DUEÑO SALE DE LA SESION Y NUNCA DE LA ENTRADA (R3). Es el requisito que decide la forma de
// este archivo: si el identificador viajara en el cuerpo, cualquiera podria leer, renombrar o
// borrar las vistas de otra persona conociendo su id. Los cinco schemas son `.strict()`, asi que un
// `usuarioId` inyectado NO se ignora: da `validation_error`.
//
// ⚠️ NO HAY ACCION DE «APLICAR», Y ES DELIBERADO (R16). Aplicar una vista ocurre entero en el
// cliente —reponer los tres estados de la barra— y no escribe nada. Si existiera aqui una accion de
// aplicar, existiria un camino por el que un catalogo caido podria tocar lo guardado.
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IVistaFiltroService } from "@/lib/interfaces/services/IVistaFiltroService";
import { VistaFiltroRepository } from "@/lib/repositories/VistaFiltroRepository";
import { VistaFiltroService } from "@/lib/services/VistaFiltroService";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import { toActionError } from "@/lib/actions/_shared/to-action-error";
import {
  actualizarVistaFiltroSchema,
  eliminarVistaFiltroSchema,
  guardarVistaFiltroSchema,
  listarVistasFiltroSchema,
  renombrarVistaFiltroSchema,
  type EliminarVistaFiltroResult,
  type ListarVistasFiltroResult,
  type VistaFiltroResult,
} from "@/lib/types/vista-filtro";

export interface VistasFiltroActionDeps {
  servicio?: IVistaFiltroService;
  getActor?: () => Promise<Actor | null>;
}

function buildServicio(): IVistaFiltroService {
  return new VistaFiltroService(new VistaFiltroRepository(getPrismaClient()));
}

/** Sin sesion valida NO se lee ni se escribe NADA (R2/R3). Va SIEMPRE antes de validar la entrada. */
async function actorRequerido(deps: VistasFiltroActionDeps): Promise<Actor> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) throw new UnauthenticatedError();
  return actor;
}

/**
 * Las vistas de ESTA persona en ESTA superficie, ordenadas por nombre.
 *
 * R33 — una superficie NO DECLARADA da `validation_error` (el `z.enum` del borde), nunca una lista
 * vacia. Es la diferencia entre un error que se ve y una pantalla que parece normal: «no tienes
 * vistas aqui» es un estado legitimo (R38), asi que confundirlos haria invisible el fallo.
 *
 * Su superficie de uso es el control de vistas de la barra compartida (tanda 4 de la ficha), que la
 * lee con SWR bajo la clave `["vistas-filtro", superficie]`. Esta accion NO revalida cache de
 * servidor: la lista la mantiene el cliente.
 */
export async function listarVistasFiltro(
  input: unknown,
  deps: VistasFiltroActionDeps = {},
): Promise<ListarVistasFiltroResult> {
  const r = await withErrorHandler(async () => {
    const actor = await actorRequerido(deps);
    const data = listarVistasFiltroSchema.parse(input); // ZodError -> VALIDATION_ERROR
    return (deps.servicio ?? buildServicio()).listar(actor.usuarioId, data.superficie);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/** R9–R13 — guarda la combinacion que la persona tiene puesta, con un nombre suyo. */
export async function guardarVistaFiltro(
  input: unknown,
  deps: VistasFiltroActionDeps = {},
): Promise<VistaFiltroResult> {
  const r = await withErrorHandler(async () => {
    const actor = await actorRequerido(deps);
    const data = guardarVistaFiltroSchema.parse(input);
    return (deps.servicio ?? buildServicio()).guardar(actor.usuarioId, data);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/** R14 — renombrar, con las mismas reglas de nombre que guardar. */
export async function renombrarVistaFiltro(
  input: unknown,
  deps: VistasFiltroActionDeps = {},
): Promise<VistaFiltroResult> {
  const r = await withErrorHandler(async () => {
    const actor = await actorRequerido(deps);
    const data = renombrarVistaFiltroSchema.parse(input);
    return (deps.servicio ?? buildServicio()).renombrar(actor.usuarioId, data);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/**
 * R15 — reemplaza el filtro guardado de una vista con el que hay en pantalla, conservando su
 * nombre. Es ademas la unica forma de que una vista marcada INCOMPLETA (R28) deje de estarlo sin
 * borrarla: la persona la actualiza cuando quiere, y aplicar sigue sin escribir (R16).
 */
export async function actualizarVistaFiltro(
  input: unknown,
  deps: VistasFiltroActionDeps = {},
): Promise<VistaFiltroResult> {
  const r = await withErrorHandler(async () => {
    const actor = await actorRequerido(deps);
    const data = actualizarVistaFiltroSchema.parse(input);
    return (deps.servicio ?? buildServicio()).actualizar(actor.usuarioId, data);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/**
 * Borra una vista de ESTA persona.
 *
 * Una vista ajena responde `not_found` y no `forbidden` (design §5): `forbidden` confirmaria que
 * ese id existe y es de otra persona, que sobre un recurso estrictamente personal es una filtracion
 * gratuita. La confirmacion que NOMBRA la vista (R17) es de la pantalla; aqui no hay vuelta atras.
 */
export async function eliminarVistaFiltro(
  input: unknown,
  deps: VistasFiltroActionDeps = {},
): Promise<EliminarVistaFiltroResult> {
  const r = await withErrorHandler(async () => {
    const actor = await actorRequerido(deps);
    const data = eliminarVistaFiltroSchema.parse(input);
    return (deps.servicio ?? buildServicio()).eliminar(actor.usuarioId, data.id);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}
