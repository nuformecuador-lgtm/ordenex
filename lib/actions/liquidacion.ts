"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";
import { LiquidacionRepartoRepository } from "@/lib/repositories/LiquidacionRepartoRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { CajaPagoTiendaFeedService } from "@/lib/services/CajaPagoTiendaFeedService";
import { LiquidacionService } from "@/lib/services/LiquidacionService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ILiquidacionService } from "@/lib/interfaces/services/ILiquidacionService";
import {
  anularPagoSchema,
  anularRepartoSchema,
  listarPagosDeCierreSchema,
  listarPagosDeTiendaSchema,
  registrarPagoMensajeroSchema,
  registrarPagoTiendaSchema,
  type AnularPagoResult,
  type AnularRepartoResult,
  type ListarPagosResult,
  type RegistrarPagoResult,
} from "@/lib/types/liquidacion";
import {
  previsualizarRepartoSchema,
  registrarRepartoMensajeroSchema,
  type PrevisualizarRepartoResult,
  type RegistrarRepartoResult,
} from "@/lib/types/liquidacion-reparto";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 172 (T B.7 + T C.1 + T F.4, design §3.1) — las CINCO Server Actions de la LIQUIDACION:
// las dos de REGISTRO, las dos de LISTAR comprobantes y la de ANULAR.
// Son operaciones INTERNAS del mismo proyecto, asi que van como Server Action y no como Route
// Handler (no hay CORS que servir ni cliente externo que las llame); el molde es
// `lib/actions/wallet-egresos.ts`:
// resolver el actor por sesion -> `UnauthenticatedError` ANTES del servicio (R3) -> `schema.parse`
// en el borde (ZodError -> `validation_error`) -> servicio bajo `withErrorHandler`.
//
// **No existe —ni existira— una accion de EDITAR un pago (R65).** La unica correccion posible es
// anular y registrar de nuevo: una edicion no deja rastro de la cifra anterior y obligaria a
// recalcular saldos en sitio. Tampoco existe una de DESANULAR (R82). Hay un test que afirma la
// lista EXACTA de exportaciones de este modulo, para que anadir un `editarPagoAction` rompa la
// suite y no pase inadvertido.
//
// Money-safe (R14): ningun monto viaja como `number`. Los schemas no coercionan, asi que un
// `monto: 15000` numerico muere en el borde con `validation_error` en vez de colarse.

export type RegistrarPagoActionResult = RegistrarPagoResult;
export type ListarPagosActionResult = ListarPagosResult;
export type AnularPagoActionResult = AnularPagoResult;
/** Feature 206 — la anulacion AGRUPADA no aporta ramas nuevas al borde: es el mismo molde. */
export type AnularRepartoActionResult = AnularRepartoResult;
// Feature 205 (T4.2): las dos del REPARTO. Son SIETE acciones en total y la lista exacta esta
// bajo test — anadir aqui un `editarRepartoAction` rompe la suite (R52).
export type PrevisualizarRepartoActionResult = PrevisualizarRepartoResult;
export type RegistrarRepartoActionResult = RegistrarRepartoResult;

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
 * Cablea el servicio con los tres repositorios, el ejecutor de transacciones y —desde la feature
 * 173 (design §4)— el PUERTO ESTRECHO de la caja principal. El runner es `prisma.$transaction`
 * interactivo: es lo que hace que documento, movimiento del ledger y egreso de la caja sean
 * atomicos (R39/R19).
 *
 * **Sigue sin inyectarse `IWalletMovimientoRepository` al servicio**, y ese es el punto: el
 * repositorio queda encapsulado DENTRO de `CajaPagoTiendaFeedService`, que solo sabe emitir dos
 * filas —el egreso del pago a tienda y su reverso—. La liquidacion al MENSAJERO sigue sin tocar
 * la caja ([P2] = (a), R22/R27), y ahora no por ausencia de repositorio sino porque el puerto no
 * tiene ningun metodo que pueda escribir `egreso_pago_mensajero` (R23).
 */
function buildService(): ILiquidacionService {
  const prisma = getPrismaClient();
  return new LiquidacionService(
    new LiquidacionPagoRepository(prisma),
    new WalletTiendaMovimientoRepository(prisma),
    new PagoMensajeroMovimientoRepository(prisma),
    (fn) => prisma.$transaction((tx) => fn(tx)),
    new CajaPagoTiendaFeedService(new WalletMovimientoRepository(prisma)),
    // Feature 205 (T4.2): el cableado suma EL REPOSITORIO DEL ACTO y nada mas. La caja sigue sin
    // tocarse en la rama del mensajero ([P2] = (a)) y el `tope` no se pasa: lo pone el unico
    // punto de configuracion por defecto (R53), sin que este archivo escriba ningun numero.
    new LiquidacionRepartoRepository(prisma),
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
 * Feature 205 (T4.2, R2/R9/R47) — PREVISUALIZA el reparto de un importe entre los cierres
 * pendientes de un mensajero. Molde identico al de las cinco de arriba, y el orden de sus tres
 * pasos es el contrato: SESION (R2, antes de evaluar ningun otro dato) -> FORMA -> servicio.
 *
 * `previsualizarRepartoSchema` es `.strict()` y **no tiene `cierreId`**: una peticion que intente
 * elegir contra que cierre se imputa muere aqui con `validation_error` y sin que el servicio se
 * construya siquiera (R9/R47). El rol lo decide el servicio (`forbidden`), como en las otras.
 *
 * SUPERFICIE (tanda 5): la monta `RepartoPrevisualizacion` en el desglose de
 * `/wallet/mensajeros`, dentro del formulario de pago. La excepcion que esta accion llevo
 * anotada mientras esa pantalla no existia quedo BORRADA al montarla: el guard
 * `superficie-de-uso` exige que ninguna excepcion sobreviva a su motivo.
 */
export async function previsualizarRepartoMensajeroAction(
  input: unknown,
  deps: LiquidacionDeps = {},
): Promise<PrevisualizarRepartoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R2: antes de evaluar ningun otro dato
    const data = previsualizarRepartoSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.previsualizarRepartoMensajero(data, actor);
  });
  return isAppErrorShape(r) ? toLiquidacionActionError(r) : r;
}

/**
 * Feature 205 (T4.2, R2/R9/R27/R47/R58) — REGISTRA el reparto. Mismo molde y mismas tres
 * barreras del borde:
 *
 *  - la SESION, antes que nada (R2);
 *  - la FORMA, con `.strict()` y sin `cierreId` (R9): contra que cierres se imputa lo decide el
 *    servidor, y un `cierreId` colado no llega al servicio;
 *  - UNA clave de idempotencia que viene del CLIENTE (R27), acuñada al abrir el formulario. No se
 *    genera aqui: una clave nacida en el servidor cambiaria en cada reintento y no protegeria de
 *    nada.
 *
 * SUPERFICIE (tanda 5): la monta `PagoMensajeroAcciones` en el desglose de
 * `/wallet/mensajeros`, que es quien le pone el `mensajeroId` al formulario compartido. La
 * excepcion que esta accion llevo anotada mientras esa pantalla no existia quedo BORRADA al
 * montarla: el guard `superficie-de-uso` exige que ninguna excepcion sobreviva a su motivo.
 */
export async function registrarRepartoMensajeroAction(
  input: unknown,
  deps: LiquidacionDeps = {},
): Promise<RegistrarRepartoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R2: antes de evaluar ningun otro dato
    const data = registrarRepartoMensajeroSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.registrarRepartoMensajero(data, actor);
  });
  return isAppErrorShape(r) ? toLiquidacionActionError(r) : r;
}

/**
 * T F.4 (R3/R72) — ANULA un pago. Mismo molde que las de registro, y las dos unicas cosas que
 * decide este borde son las de siempre: la SESION (R3, antes que nada) y la FORMA.
 *
 * `anularPagoSchema` es `{ pagoId, motivo }` con `.strict()`, y esa es la primera de las dos
 * barreras de R70: **un `monto` colado en la peticion no pasa de aqui**. La segunda —la que de
 * verdad manda— es que el servicio lee el importe del pago y jamas del input.
 *
 * El motivo en blanco muere aqui con `validation_error` en el campo `motivo` (R72).
 */
export async function anularPagoAction(
  input: unknown,
  deps: LiquidacionDeps = {},
): Promise<AnularPagoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R3: antes de evaluar ningun otro dato
    const data = anularPagoSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.anularPago(data, actor);
  });
  return isAppErrorShape(r) ? toLiquidacionActionError(r) : r;
}

/**
 * Feature 206 — ANULA UN REPARTO COMPLETO. Mismo molde y mismas dos únicas decisiones de borde
 * que la anulación individual: la SESIÓN primero y la FORMA después.
 *
 * `anularRepartoSchema` es `{ repartoId, motivo }` con `.strict()`, y su forma es la primera
 * barrera de dos cosas: **ni un `monto`** (que sale de cada pago en el servidor) **ni una lista
 * de `pagoId`**. Lo segundo importa tanto como lo primero: si el cliente pudiera enumerar qué
 * imputaciones anular, volvería a existir el reparto a medias que esta feature viene a cerrar.
 */
export async function anularRepartoAction(
  input: unknown,
  deps: LiquidacionDeps = {},
): Promise<AnularRepartoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R3: antes de evaluar ningun otro dato
    const data = anularRepartoSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.anularReparto(data, actor);
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
