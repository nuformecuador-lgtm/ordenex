"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { RechazoTiendaCobroRepository } from "@/lib/repositories/RechazoTiendaCobroRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { RechazoTiendaCobroService } from "@/lib/services/RechazoTiendaCobroService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IRechazoTiendaCobroService } from "@/lib/interfaces/services/IRechazoTiendaCobroService";
import {
  decidirCobroRechazoTiendaSchema,
  listarCobrosRechazoTiendaSchema,
  type AprobarCobroRechazoTiendaResult,
  type ListarCobrosRechazoTiendaResult,
  type RechazarCobroRechazoTiendaResult,
} from "@/lib/types/rechazo-tienda-cobro";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// 💰 FICHA 337 (segunda mitad) — las TRES Server Actions de los COBROS POR RECHAZO DESDE
// NOVEDADES: ver la cola, APROBAR y RECHAZAR.
//
// Son mutaciones y lecturas INTERNAS del mismo proyecto, asi que van como Server Action y no como
// route handler (`docs/architecture.md`). Molde exacto de `lib/actions/gasto-fijo-cobro.ts`:
// resolver el actor por sesion -> `UnauthenticatedError` ANTES de tocar el servicio ->
// `schema.parse` en el borde (ZodError -> `validation_error`) -> servicio bajo `withErrorHandler`.
// El resto —`ok`, `forbidden`, `not_found`, `ya_decidido`— lo decide el SERVICIO como resultado
// de dominio.
//
// ⚠️ NINGUNA DE LAS TRES ACEPTA UN IMPORTE DEL CLIENTE. Lo que se cobra sale de la COPIA que el
// cobro congelo cuando la tienda rechazo, leida server-side. Los schemas son `.strict()`, asi que
// un `montoFlete` colado en el payload muere aqui con `validation_error` en vez de ignorarse en
// silencio.
//
// ⚠️ QUIEN DECIDE NO SE RESUELVE AQUI: lo autoriza el SERVICIO con `esAccesoTotal` (maestro +
// admin). Esconder el boton en la UI seria autorizacion de mentira: la Server Action seguiria
// abierta. La UI esconde ADEMAS, no en vez de.

export type ListarCobrosRechazoTiendaActionResult = ListarCobrosRechazoTiendaResult;
export type AprobarCobroRechazoTiendaActionResult = AprobarCobroRechazoTiendaResult;
export type RechazarCobroRechazoTiendaActionResult = RechazarCobroRechazoTiendaResult;

/**
 * Traduce el `AppErrorShape` del borde: ZodError (VALIDATION_ERROR) o falta de sesion
 * (UNAUTHORIZED). Espejo de `toCobroActionError` (333). Cualquier otro codigo es un fallo real y
 * se RELANZA: convertirlo en un `validation_error` mentiroso esconderia un 500 de una operacion
 * de dinero detras de un mensaje de formulario.
 */
function toRechazoCobroActionError(
  shape: AppErrorShape,
):
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" } {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      throw new Error(`rechazo-tienda-cobro: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * Composition root del servicio: los TRES repositorios, el cliente de escritura y el ejecutor de
 * transacciones interactivas —que es lo que hace ATOMICOS los cuatro apuntes de los dos libros y
 * el cambio de estado del cobro—.
 */
function buildService(): IRechazoTiendaCobroService {
  const prisma = getPrismaClient();
  return new RechazoTiendaCobroService(
    new RechazoTiendaCobroRepository(prisma),
    new WalletMovimientoRepository(prisma),
    new WalletTiendaMovimientoRepository(prisma),
    prisma,
    (fn) => prisma.$transaction((tx) => fn(tx)),
  );
}

export interface RechazoTiendaCobroDeps {
  service?: IRechazoTiendaCobroService;
  getActor?: () => Promise<Actor | null>;
  /** Reloj inyectable: el `decidido_at` de una decision no sale de un `new Date()` escondido. */
  now?: () => Date;
}

/**
 * La COLA de cobros pendientes, del mas antiguo al mas reciente, con el `total` REAL del servidor
 * aparte del recorte.
 *
 * La ve quien tenga ACCESO TOTAL (maestro + admin), que es tambien quien puede decidirla. El
 * schema no admite NINGUNA clave —ni `page`, ni `pageSize`, ni un `tiendaId` que convirtiera la
 * cola en un listado dirigido—: se parsea igual porque parsear ES la barrera.
 */
export async function listarCobrosRechazoTiendaAction(
  input: unknown = {},
  deps: RechazoTiendaCobroDeps = {},
): Promise<ListarCobrosRechazoTiendaActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // antes de tocar el service
    listarCobrosRechazoTiendaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarPendientes(actor);
  });
  return isAppErrorShape(r) ? toRechazoCobroActionError(r) : r;
}

/**
 * ⚠️ APRUEBA un cobro: escribe los DOS ingresos en la caja de Ordenex y sus DOS debitos espejo en
 * el libro de la tienda, con la clave y los importes que el cobro congelo, y deja el cobro
 * `aprobado` con quien y cuando. Todo en UNA transaccion.
 *
 * SOLO el `id` cruza. Los importes los pone el servidor. `ya_decidido` no es un error del
 * usuario: es el final normal cuando alguien decidio antes, o cuando dos aprobaciones llegaron a
 * la vez y el motor serializo.
 */
export async function aprobarCobroRechazoTiendaAction(
  input: unknown,
  deps: RechazoTiendaCobroDeps = {},
): Promise<AprobarCobroRechazoTiendaActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = decidirCobroRechazoTiendaSchema.parse(input); // `.strict()`: nada de importes
    const service = deps.service ?? buildService();
    return service.aprobar(data, actor, (deps.now ?? (() => new Date()))());
  });
  return isAppErrorShape(r) ? toRechazoCobroActionError(r) : r;
}

/**
 * RECHAZA un cobro: lo deja en `rechazado` con quien y cuando, y NO escribe absolutamente nada en
 * ningun libro.
 *
 * El «no» es durable: el cobro rechazado conserva su `gestion_id`, asi que
 * `rechazo_tienda_cobro_gestion_uq` impide que ese mismo rechazo vuelva a darse de alta.
 */
export async function rechazarCobroRechazoTiendaAction(
  input: unknown,
  deps: RechazoTiendaCobroDeps = {},
): Promise<RechazarCobroRechazoTiendaActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = decidirCobroRechazoTiendaSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.rechazar(data, actor, (deps.now ?? (() => new Date()))());
  });
  return isAppErrorShape(r) ? toRechazoCobroActionError(r) : r;
}
