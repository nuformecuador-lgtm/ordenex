"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { LiquidacionService } from "@/lib/services/LiquidacionService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ILiquidacionService } from "@/lib/interfaces/services/ILiquidacionService";
import {
  listarPagosDeCierreSchema,
  listarPagosDeTiendaSchema,
  registrarPagoMensajeroSchema,
  registrarPagoTiendaSchema,
  type ListarPagosResult,
  type RegistrarPagoResult,
} from "@/lib/types/liquidacion";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 172 (T B.7 + T C.1, design §3.1) — Server Actions de la LIQUIDACION: las dos de
// REGISTRO y las dos de LISTAR comprobantes. Falta la quinta del diseño, la anulacion (T F.4).
// Son operaciones INTERNAS del mismo proyecto, asi que van como Server Action y no como Route
// Handler (no hay CORS que servir ni cliente externo que las llame); el molde es
// `lib/actions/wallet-egresos.ts`:
// resolver el actor por sesion -> `UnauthenticatedError` ANTES del servicio (R3) -> `schema.parse`
// en el borde (ZodError -> `validation_error`) -> servicio bajo `withErrorHandler`.
//
// **No existe —ni existira— una accion de EDITAR un pago (R65).** La unica correccion posible es
// anular y registrar de nuevo (Tanda F): una edicion no deja rastro de la cifra anterior y
// obligaria a recalcular saldos en sitio. Hay un test que afirma la lista EXACTA de exportaciones
// de este modulo, para que anadir un `editarPagoAction` rompa la suite y no pase inadvertido.
//
// Money-safe (R14): ningun monto viaja como `number`. Los schemas no coercionan, asi que un
// `monto: 15000` numerico muere en el borde con `validation_error` en vez de colarse.

export type RegistrarPagoActionResult = RegistrarPagoResult;
export type ListarPagosActionResult = ListarPagosResult;

/**
 * Traduce el `AppErrorShape` del borde: ZodError (VALIDATION_ERROR) o falta de sesion
 * (UNAUTHORIZED). Espejo de `toEgresoActionError`. Cualquier otro codigo es un fallo real y se
 * relanza: convertirlo en un `validation_error` mentiroso escondería un 500 de una operacion de
 * dinero.
 */
function toLiquidacionActionError(
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
      throw new Error(`liquidacion: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * Cablea el servicio con los tres repositorios y el ejecutor de transacciones. El runner es
 * `prisma.$transaction` interactivo: es lo que hace que documento y movimiento sean atomicos
 * (R39). **No se le inyecta el repositorio de la caja principal** ([P2]/R40).
 */
function buildService(): ILiquidacionService {
  const prisma = getPrismaClient();
  return new LiquidacionService(
    new LiquidacionPagoRepository(prisma),
    new WalletTiendaMovimientoRepository(prisma),
    new PagoMensajeroMovimientoRepository(prisma),
    (fn) => prisma.$transaction((tx) => fn(tx)),
  );
}

export interface LiquidacionDeps {
  service?: ILiquidacionService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * R3/R21 — registra un pago a un MENSAJERO contra un cierre aprobado. El rol lo decide el
 * servicio (`forbidden`, R1/R6); aqui solo se resuelve la sesion y se valida la forma.
 */
export async function registrarPagoMensajeroAction(
  input: unknown,
  deps: LiquidacionDeps = {},
): Promise<RegistrarPagoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R3: antes de evaluar ningun otro dato
    const data = registrarPagoMensajeroSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.registrarPagoMensajero(data, actor);
  });
  return isAppErrorShape(r) ? toLiquidacionActionError(r) : r;
}

/**
 * R3/R29 — registra un pago a una TIENDA contra su saldo acumulado. Sin cierre: `.strict()`
 * rechaza un `cierreId` colado en la peticion.
 */
export async function registrarPagoTiendaAction(
  input: unknown,
  deps: LiquidacionDeps = {},
): Promise<RegistrarPagoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R3
    const data = registrarPagoTiendaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.registrarPagoTienda(data, actor);
  });
  return isAppErrorShape(r) ? toLiquidacionActionError(r) : r;
}

/**
 * R3/R49 — los comprobantes de un cierre. Es una LECTURA interna del mismo proyecto, asi que va
 * como Server Action igual que las mutaciones (no hay CORS que servir ni cliente externo).
 *
 * El rol lo decide el servicio (`forbidden`, [P3]/R1): aqui solo se resuelve la sesion y se
 * valida la forma del id. No hay `revalidate` ni cache: la lista se pide desde el cliente
 * cuando se abre el detalle, y tras registrar o anular se vuelve a pedir.
 */
export async function listarPagosDeCierreAction(
  input: unknown,
  deps: LiquidacionDeps = {},
): Promise<ListarPagosActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R3: antes de evaluar ningun otro dato
    const data = listarPagosDeCierreSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarPagosDeCierre(data.cierreId, actor);
  });
  return isAppErrorShape(r) ? toLiquidacionActionError(r) : r;
}

/** R3/R50 — los comprobantes de una tienda, con el mismo molde. */
export async function listarPagosDeTiendaAction(
  input: unknown,
  deps: LiquidacionDeps = {},
): Promise<ListarPagosActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R3
    const data = listarPagosDeTiendaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarPagosDeTienda(data.tiendaId, actor);
  });
  return isAppErrorShape(r) ? toLiquidacionActionError(r) : r;
}
