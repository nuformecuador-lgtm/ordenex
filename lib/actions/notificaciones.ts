"use server";

// Feature 146 (design §3, R38) — las operaciones de la campana como Server Actions del
// propio proyecto, NO como rutas API internas consumidas por `fetch` (docs/architecture.md;
// alternativa A7 descartada). Patron `lib/actions/aprobacion-postulaciones.ts`: resuelven el
// actor con la sesion, validan el borde con zod, envuelven con `withErrorHandler` y traducen
// con `toActionError`. `deps` inyectables para test sin DB ni cookies.
//
// Eran CINCO; hoy son CUATRO. `marcarNotificacionLeida` (R31) se borro el 2026-08-07 por
// decision humana: la campana solo ofrece «descartar» y «marcar todas», y `git log -S` sobre
// `app/` y `components/` devuelve CERO commits en toda su vida — nunca tuvo punto de entrada.
// `INotificacionService.marcarLeida` y `NotificacionRepository.marcarLeida` NO se tocan: siguen
// probados y son lo que habria que recablear si alguien anade el boton.
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
import { VigenciaAvisoAgregadoService } from "@/lib/services/VigenciaAvisoAgregadoService";
import { AvisoAgregadoRepository } from "@/lib/repositories/AvisoAgregadoRepository";
import { RepartoMananaRepository } from "@/lib/repositories/RepartoMananaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { avisosDiariosConfig } from "@/lib/config/avisos-diarios";
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

/**
 * ⚠️ FICHA 409 (T5.4, design §5) — COMPOSITION ROOT DEL RESOLUTOR DE VIGENCIA, y esta linea es el
 * requisito. Sin ella el service se queda con `vigenciaNoResuelta` y los avisos AGREGADOS no se
 * apagarian nunca: la campana volveria a ser ruido, que es exactamente lo que esta ficha existe
 * para quitar. Es la familia «el composition root que no inyecta» —2 de 7 notificadores muertos en
 * este arbol con la suite entera en verde—, y por eso hay un test que afirma que ALGUIEN LO PASA
 * (sobre el fuente sin imports ni comentarios), no que alguien lo importe.
 *
 * El resolutor acota la cifra AL AMBITO DEL ACTOR (su tienda, su zona, o el total), que es lo que
 * hace que el numero del panel sea el mismo que el de su pantalla (R57).
 */
function buildService(): INotificacionService {
  const prisma = getPrismaClient();
  return new NotificacionService(
    new NotificacionRepository(prisma),
    () => new Date(),
    new VigenciaAvisoAgregadoService(
      // El conteo VIVO de novedades DELEGA en el metodo que ya pinta `/novedades`.
      new AvisoAgregadoRepository(prisma, new OrdenRepository(prisma)),
      avisosDiariosConfig.DIAS_REPRESAMIENTO, // R53: el MISMO umbral que aplica el cron
      () => new Date(),
      // ⚠️ FICHA 413 (T6.1, R13) — LA CIFRA VIVA DEL REPARTO DE MAÑANA, Y ESTA LINEA ES EL
      // REQUISITO. Sin ella el resolutor lanza para `reparto_manana`, `cifrasVivas` lo registra y
      // el aviso se muestra SIN numero (R16): no se rompe nada visible, y por eso el fallo seria
      // MUDO — la familia «el composition root que no inyecta», que en este arbol ya dejo dos
      // notificadores muertos con la suite entera en verde.
      new RepartoMananaRepository(prisma),
    ),
  );
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
