"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { GastoFijoCobroRepository } from "@/lib/repositories/GastoFijoCobroRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { GastoFijoCobroService } from "@/lib/services/GastoFijoCobroService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IGastoFijoCobroService } from "@/lib/interfaces/services/IGastoFijoCobroService";
import {
  contarCobrosPendientesDePlantillaSchema,
  decidirCobroGastoFijoSchema,
  listarCobrosPendientesSchema,
  type AprobarCobroGastoFijoResult,
  type ContarCobrosPendientesDePlantillaResult,
  type ListarCobrosPendientesResult,
  type RechazarCobroGastoFijoResult,
} from "@/lib/types/gasto-fijo-cobro";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// FICHA 333 (F1, design §6.2) — las CUATRO Server Actions de los COBROS de gasto fijo: ver la
// cola, APROBAR, RECHAZAR y contar los pendientes de una plantilla que se va a borrar.
//
// Son mutaciones y lecturas INTERNAS del mismo proyecto, asi que van como Server Action y no como
// route handler (`docs/architecture.md`). Molde exacto de `lib/actions/wallet-egresos.ts`:
// resolver el actor por sesion -> `UnauthenticatedError` ANTES de tocar el servicio (R26) ->
// `schema.parse` en el borde (ZodError -> `validation_error`) -> servicio bajo `withErrorHandler`.
// El resto —`ok`, `forbidden`, `not_found`, `ya_decidido`— lo decide el SERVICIO como resultado
// de dominio.
//
// ⚠️ NINGUNA DE LAS CUATRO ACEPTA UN MONTO DEL CLIENTE, y eso es R16 en el borde: el importe que
// se cobra sale de la COPIA que el cobro guardo al generarse, leida server-side. Los schemas son
// `.strict()`, asi que un `monto` colado en el payload muere aqui con `validation_error` en vez
// de ignorarse en silencio. Es la misma regla por la que `reversarEgreso` lee el monto en el
// servidor.
//
// ⚠️ QUIEN DECIDE NO SE RESUELVE AQUI: `aprobar`/`rechazar` los autoriza el SERVICIO con
// `puedeDecidirCobroGastoFijo` (`maestro` y nadie mas, R24). Esconder el boton en la UI seria
// autorizacion de mentira.

export type ListarCobrosPendientesActionResult = ListarCobrosPendientesResult;
export type AprobarCobroGastoFijoActionResult = AprobarCobroGastoFijoResult;
export type RechazarCobroGastoFijoActionResult = RechazarCobroGastoFijoResult;
export type ContarCobrosPendientesDePlantillaActionResult =
  ContarCobrosPendientesDePlantillaResult;

/**
 * Traduce el `AppErrorShape` del borde: ZodError (VALIDATION_ERROR) o falta de sesion
 * (UNAUTHORIZED). Espejo de `toEgresoActionError`. Cualquier otro codigo es un fallo real y se
 * RELANZA: convertirlo en un `validation_error` mentiroso escondería un 500 de una operacion de
 * dinero detras de un mensaje de formulario.
 */
function toCobroActionError(
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
      throw new Error(`gasto-fijo-cobro: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * Composition root del servicio de cobros: los dos repositorios, el cliente de escritura y el
 * ejecutor de transacciones interactivas —que es lo que hace ATOMICOS el movimiento del libro y
 * el cambio de estado del cobro (R15)—.
 */
function buildService(): IGastoFijoCobroService {
  const prisma = getPrismaClient();
  return new GastoFijoCobroService(
    new GastoFijoCobroRepository(prisma),
    new WalletMovimientoRepository(prisma),
    prisma,
    (fn) => prisma.$transaction((tx) => fn(tx)),
  );
}

export interface GastoFijoCobroDeps {
  service?: IGastoFijoCobroService;
  getActor?: () => Promise<Actor | null>;
  /** Reloj inyectable: el `decidido_at` de una decision no sale de un `new Date()` escondido. */
  now?: () => Date;
}

/**
 * R25/R26/R39/R41 — la COLA de cobros pendientes, del mas antiguo al mas reciente, con el `total`
 * REAL del servidor aparte del recorte.
 *
 * La ve quien tenga ACCESO TOTAL (`maestro` + `admin`): el admin mira la cola aunque no pueda
 * decidirla. El schema no admite NINGUNA clave —ni `page`, ni `pageSize`, ni un `estado` que
 * ensanchara el conjunto—: se parsea igual porque parsear ES la barrera.
 */
export async function listarCobrosPendientesAction(
  input: unknown = {},
  deps: GastoFijoCobroDeps = {},
): Promise<ListarCobrosPendientesActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R26: antes de tocar el service
    listarCobrosPendientesSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarPendientes(actor);
  });
  return isAppErrorShape(r) ? toCobroActionError(r) : r;
}

/**
 * R14/R16/R17/R18/R19/R20/R24/R26 — APRUEBA un cobro: escribe el egreso en el libro con la clave
 * y el monto que el cobro guardo, y deja el cobro `aprobado`, enlazado, con quien y cuando.
 *
 * SOLO el `id` cruza. El monto lo pone el servidor (R16). `ya_decidido` no es un error del
 * usuario: es el final normal cuando alguien decidio antes, o cuando dos aprobaciones llegaron a
 * la vez y el motor serializo (R18).
 */
export async function aprobarCobroGastoFijoAction(
  input: unknown,
  deps: GastoFijoCobroDeps = {},
): Promise<AprobarCobroGastoFijoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R26
    const data = decidirCobroGastoFijoSchema.parse(input); // `.strict()`: nada de montos del cliente
    const service = deps.service ?? buildService();
    return service.aprobar(data, actor, (deps.now ?? (() => new Date()))());
  });
  return isAppErrorShape(r) ? toCobroActionError(r) : r;
}

/**
 * R21/R23/R24/R26 — RECHAZA un cobro: lo deja en `rechazado` con quien y cuando, y NO escribe
 * absolutamente nada en el libro.
 *
 * El «no» dura lo que dura su periodo (R22): el cobro rechazado conserva su clave, asi que la
 * corrida siguiente del mismo periodo choca con `gasto_fijo_cobro_origen_uq` y no reaparece.
 */
export async function rechazarCobroGastoFijoAction(
  input: unknown,
  deps: GastoFijoCobroDeps = {},
): Promise<RechazarCobroGastoFijoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R26
    const data = decidirCobroGastoFijoSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.rechazar(data, actor, (deps.now ?? (() => new Date()))());
  });
  return isAppErrorShape(r) ? toCobroActionError(r) : r;
}

/**
 * R55 — cuantos cobros pendientes se cancelaran si se borra ESA plantilla.
 *
 * La llama el dialogo de confirmacion del borrado AL ABRIRSE, para que el usuario lea «se
 * cancelaran N cobros pendientes» ANTES de aceptar. Se pide en ese momento y no se cuelga de un
 * listado traido con la pagina: un numero con minutos de antiguedad estaria autorizando un
 * borrado irreversible.
 *
 * Autoriza `esAccesoTotal` —lo decide el servicio—, no el predicado estrecho: acompaña al borrado
 * de plantillas, cuya autorizacion esta ficha NO cambia (R28).
 */
export async function contarCobrosPendientesDePlantillaAction(
  input: unknown,
  deps: GastoFijoCobroDeps = {},
): Promise<ContarCobrosPendientesDePlantillaActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R26
    const data = contarCobrosPendientesDePlantillaSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.contarPendientesDePlantilla(data, actor);
  });
  return isAppErrorShape(r) ? toCobroActionError(r) : r;
}
