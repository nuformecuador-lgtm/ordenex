"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { CierreAporteRepository } from "@/lib/repositories/CierreAporteRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { DetalleMovimientoService } from "@/lib/services/DetalleMovimientoService";
import { WalletTiendaService } from "@/lib/services/WalletTiendaService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IWalletTiendaService,
  ListarMisCierresServiceResult,
  ListarMisMovimientosServiceResult,
  ListarSaldosTiendasPaginadoServiceResult,
  ListarMovimientosDeTiendaServiceResult,
  ListarSaldosTiendasServiceResult,
  VerMiSaldoServiceResult,
} from "@/lib/interfaces/services/IWalletTiendaService";
import {
  listarMovimientosDeTiendaCompletoSchema,
  listarMovimientosDeTiendaSchema,
  listarMovimientosTiendaCompletoSchema,
  listarMovimientosTiendaSchema,
  listarSaldosTiendasCompletoSchema,
  listarSaldosTiendasPaginadoSchema,
  type ListarMovimientosDeTiendaCompletoResult,
  type ListarMovimientosTiendaCompletoResult,
  type ListarSaldosTiendasCompletoResult,
} from "@/lib/types/wallet-tienda";
import type {
  IDetalleMovimientoService,
  VerDetalleMovimientoCompletoServiceResult,
  VerDetalleMovimientoServiceResult,
} from "@/lib/interfaces/services/IDetalleMovimientoService";
import {
  verDetalleDeMovimientoCompletoSchema,
  verDetalleDeMovimientoSchema,
} from "@/lib/types/detalle-movimiento";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 43 (T13) — Server Actions del ledger POR TIENDA (lecturas internas del mismo
// proyecto -> Server Action, no Route API, patron wallet.ts). Resuelve el actor por sesion,
// valida en el borde con zod y delega en el servicio bajo `withErrorHandler`. `unauthenticated`
// (sin sesion) y `validation_error` (ZodError) se resuelven en el borde; `forbidden`/`ok` los
// devuelve el service como resultado de dominio. Money-safe: los DTOs exponen montos como
// STRING (R21/R27); el cliente nunca recibe Prisma.Decimal.

export type VerMiSaldoActionResult =
  | VerMiSaldoServiceResult
  | { status: "unauthenticated" };

export type ListarMisMovimientosActionResult =
  | ListarMisMovimientosServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type ListarSaldosTiendasActionResult =
  | ListarSaldosTiendasServiceResult
  | { status: "unauthenticated" };

/**
 * FICHA 335 (design §2.4, R3/R4) — los cierres del libro de la propia tienda, para el selector
 * del filtro de `/mi-wallet`.
 *
 * TRES estados y ni uno mas: `ok`, `forbidden` (lo decide el servicio) y `unauthenticated` (lo
 * decide este borde). NO hay `validation_error` porque no hay entrada que validar (R5).
 */
export type ListarMisCierresActionResult =
  | ListarMisCierresServiceResult
  | { status: "unauthenticated" };

// Feature 170 (T I.1, R41): el listado paginado de saldos. `forbidden` lo decide el servicio;
// `unauthenticated` y `validation_error`, este borde.
export type ListarSaldosTiendasPaginadoActionResult =
  | ListarSaldosTiendasPaginadoServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

// Feature 171 — desglose de UNA tienda elegida. `forbidden` lo decide el servicio (dominio);
// `unauthenticated` y `validation_error` los decide este borde, antes de llamarlo.
export type ListarMovimientosDeTiendaActionResult =
  | ListarMovimientosDeTiendaServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

// Traduce el AppErrorShape del borde: ZodError (VALIDATION_ERROR) o falta de sesion
// (UNAUTHORIZED). Espejo de `toWalletActionError`.
function toWalletTiendaActionError(
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
      throw new Error(`wallet-tienda: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IWalletTiendaService {
  const prisma = getPrismaClient();
  return new WalletTiendaService(new WalletTiendaMovimientoRepository(prisma));
}

/**
 * Ficha 344 — composition root del detalle de una fila del libro de la TIENDA. Es el MISMO
 * servicio que sirve a la caja: lo unico que cambia es el metodo que este borde llama, y con el
 * el guard de rol y el `tiendaId` que acota las dos lecturas.
 */
function buildDetalleService(): IDetalleMovimientoService {
  const prisma = getPrismaClient();
  return new DetalleMovimientoService(
    new WalletMovimientoRepository(prisma),
    new WalletTiendaMovimientoRepository(prisma),
    new CierreAporteRepository(prisma),
  );
}

export interface WalletTiendaDeps {
  service?: IWalletTiendaService;
  getActor?: () => Promise<Actor | null>;
}

/** Las dependencias del detalle, inyectables en test igual que las del ledger. */
export interface DetalleMiMovimientoDeps {
  service?: IDetalleMovimientoService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * Ficha 344 (T4.4) — el detalle de una fila del libro de la tienda en el BORDE. `forbidden`,
 * `not_found` y `sin_reparto` los decide el DOMINIO; `unauthenticated` y `validation_error` los
 * decide este borde. Ninguna rama de error viaja con ordenes.
 */
export type VerDetalleDeMiMovimientoActionResult =
  | VerDetalleMovimientoServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type VerDetalleDeMiMovimientoCompletoActionResult =
  | VerDetalleMovimientoCompletoServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

/** R17/R19: saldo total del adminTienda (STRING+signo), acotado a su tienda_id. Forbidden/unauthenticated sin exponer datos. */
export async function verMiSaldoAction(
  deps: WalletTiendaDeps = {},
): Promise<VerMiSaldoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R19: antes de tocar el service
    const service = deps.service ?? buildService();
    return service.verMiSaldo(actor);
  });
  // Este borde no tiene zod: el unico AppErrorShape posible es UNAUTHORIZED.
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/** R19/R22/R27: movimientos paginados + filtros del adminTienda, acotados a su tienda_id en el WHERE. */
export async function listarMisMovimientosAction(
  input: unknown,
  deps: WalletTiendaDeps = {},
): Promise<ListarMisMovimientosActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = listarMovimientosTiendaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarMisMovimientos(data, actor);
  });
  return isAppErrorShape(r) ? toWalletTiendaActionError(r) : r;
}

/**
 * Feature 170 (T C.2, design §4) — ledger COMPLETO de la tienda del actor, sin paginacion,
 * para la descarga. Calcado de `listarMisMovimientosAction`: mismo borde, mismo actor, mismo
 * schema (menos `page`/`pageSize`, y `.strict()`) y el MISMO servicio, que acota a su
 * `tienda_id` (R14/R15). Ninguna rama devuelve filas junto a un error (R16/R17/R18).
 */
export async function listarMisMovimientosCompletoAction(
  input: unknown,
  deps: WalletTiendaDeps = {},
): Promise<ListarMovimientosTiendaCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R16: antes de tocar el service
    const data = listarMovimientosTiendaCompletoSchema.parse(input ?? {}); // R18: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarMisMovimientosCompleto(data, actor);
  });
  return isAppErrorShape(r) ? toWalletTiendaActionError(r) : r;
}

/**
 * R20/R27: saldo de TODAS las tiendas (solo maestro). Forbidden/unauthenticated sin exponer datos.
 *
 * **Feature 184 (T H.2) — CERO consumidores de produccion, y se CONSERVA a proposito.** La tanda G
 * se llevo su unico lector: la descarga de `SaldosTiendasTable`, que ahora sale de
 * `listarSaldosTiendasCompletoAction` —la MISMA llamada que la pagina, con otro rango, para que el
 * archivo salga ORDENADO como la tabla (R5)—.
 *
 * Por que NO se borra: en este listado y en el de plantillas, a diferencia de los de las tandas
 * B-F, las dos lecturas devuelven **las mismas filas** y el xlsx sale identico por los dos
 * caminos. Contar llamadas es lo UNICO que los separa, y por eso
 * `tests/components/descarga/WalletPropsDescarga.test.tsx` (R1) afirma que esta no se llama **y**
 * la invoca al final para comprobar que el doble esta VIVO y responde el conjunto entero. Borrarla
 * deja el `not.toHaveBeenCalled()` sin objeto y R1 de este listado sin discriminador de conducta:
 * quedaria solo la mitad estatica del censo.
 *
 * Lo que impide que «conservar» sea «olvidar»: `tests/unit/descarga/adaptador-conjunto.guardia.test.ts`
 * (R32) afirma que ninguna pantalla vuelve a llamarla. Vive como testigo, no como camino.
 *
 * @sin-superficie decision de la feature 184 (T H.2), no deuda: testigo de anti-vacuidad de R1, no camino de usuario. La superficie viva es `listarSaldosTiendasCompletoAction`.
 */
export async function listarSaldosTiendasAction(
  deps: WalletTiendaDeps = {},
): Promise<ListarSaldosTiendasActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const service = deps.service ?? buildService();
    return service.listarSaldosTiendas(actor);
  });
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/**
 * FICHA 335 (design §2.4, R1/R3/R4/R5) — los cierres que dejaron movimientos en el libro de la
 * tienda del actor. Es la lectura que sustituye al campo de texto donde habia que teclear el
 * identificador del cierre.
 *
 * Calcada de `verMiSaldoAction`, con las mismas dos propiedades y por los mismos motivos:
 *
 *  - **SIN zod, porque no hay entrada (R5).** El unico argumento es `deps`, que es la costura de
 *    inyeccion de los tests. No existe ninguna clave de peticion que pueda ampliar el alcance:
 *    la barrera no es una validacion, es la ausencia de superficie.
 *  - **`UnauthenticatedError` ANTES de instanciar el servicio (R4).** Sin sesion no se construye
 *    el repositorio ni se abre conexion: se corta aqui.
 *
 * El unico `AppErrorShape` que puede salir de `withErrorHandler` es `UNAUTHORIZED`, asi que no
 * se usa `toWalletTiendaActionError` —cuyo `switch` existe para traducir tambien el `ZodError`
 * que aqui no puede ocurrir—.
 */
export async function listarMisCierresAction(
  deps: WalletTiendaDeps = {},
): Promise<ListarMisCierresActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R4: antes de tocar el service
    const service = deps.service ?? buildService();
    return service.listarMisCierres(actor);
  });
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/**
 * Feature 170 — FASE 2 (T I.1, R40/R41/R44): UNA pagina de los saldos por tienda + el total.
 *
 * Espejo exacto de `listarSaldosTiendasAction` con `page`/`pageSize` validados por zod. Quien
 * puede verlo lo sigue decidiendo el servicio (acceso total, R20): este borde solo resuelve
 * la sesion y la entrada.
 */
export async function listarSaldosTiendasPaginadoAction(
  input: unknown,
  deps: WalletTiendaDeps = {},
): Promise<ListarSaldosTiendasPaginadoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = listarSaldosTiendasPaginadoSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarSaldosTiendasPaginado(data, actor);
  });
  return isAppErrorShape(r) ? toWalletTiendaActionError(r) : r;
}

/**
 * Feature 184 — Tanda G (R1/R5/R6/R7/R17) — el CONJUNTO de «Saldos de tiendas», sin recorte,
 * para producir el archivo (listado 12 del Anexo A).
 *
 * Sustituye a la relectura de `listarSaldosTiendasAction()` que hacia la tabla. La sustitucion
 * NO abarata la consulta —es la misma agregacion del ledger entero— y esta bitacora no va a
 * fingir que si. Lo que gana: el tope lo decide el SERVIDOR (R6), y sobre todo el archivo pasa
 * a salir ORDENADO como la tabla (R5), cosa que hoy no ocurre porque el listado sin paginar
 * devuelve las filas en el orden del planificador.
 *
 * Como este listado no tiene filtros, la lista blanca derivada de la de su pagina no deja
 * NINGUNA clave: `tiendaId` —la que convertiria el saldo de TODAS las tiendas en el de una— y
 * `page`/`pageSize` mueren aqui con `validation_error` sin tocar el servicio (R17). El input se
 * parsea aunque no se transporte nada: parsear ES la barrera.
 */
export async function listarSaldosTiendasCompletoAction(
  input: unknown = {},
  deps: WalletTiendaDeps = {},
): Promise<ListarSaldosTiendasCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R7: antes de tocar el service
    listarSaldosTiendasCompletoSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarSaldosTiendasCompleto(actor);
  });
  return isAppErrorShape(r) ? toWalletTiendaActionError(r) : r;
}

/**
 * Feature 171 (T1.5, R22/R25/R29) — desglose de UNA tienda elegida por el acceso total:
 * pagina de movimientos + total del conjunto filtrado + los cuatro importes de la cabecera.
 *
 * Mismo esqueleto que las cuatro de arriba, y el ORDEN importa: sin sesion se corta ANTES de
 * validar y antes de llamar al servicio (R29), y un `tiendaId` ausente o vacio se corta en
 * `schema.parse` (R25) — en ninguno de los dos casos se llega a consultar la base.
 */
export async function listarMovimientosDeTiendaAction(
  input: unknown,
  deps: WalletTiendaDeps = {},
): Promise<ListarMovimientosDeTiendaActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R29: antes del schema y del service
    const data = listarMovimientosDeTiendaSchema.parse(input); // R25: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarMovimientosDeTienda(data, actor);
  });
  return isAppErrorShape(r) ? toWalletTiendaActionError(r) : r;
}

/**
 * Feature 171 (T1.5, R37/R40) — el MISMO desglose sin paginacion, para la descarga. Mismo
 * borde, mismo actor, mismo `tiendaId` requerido y el mismo servicio; el schema `.strict()`
 * rechaza `page`/`pageSize` porque este modo no pagina. Ninguna rama devuelve filas junto a un
 * error.
 */
export async function listarMovimientosDeTiendaCompletoAction(
  input: unknown,
  deps: WalletTiendaDeps = {},
): Promise<ListarMovimientosDeTiendaCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R29: antes de tocar el service
    const data = listarMovimientosDeTiendaCompletoSchema.parse(input); // R25
    const service = deps.service ?? buildService();
    return service.listarMovimientosDeTiendaCompleto(data, actor);
  });
  return isAppErrorShape(r) ? toWalletTiendaActionError(r) : r;
}

/**
 * Ficha 344 (T4.4, design §3.5) — las ordenes que componen el importe de UNA fila del libro de
 * la tienda. Mismo borde que su gemela de la caja; lo que cambia vive en el SERVICIO: el guard
 * es el rol de tienda y `tiendaId = actor.usuarioId` entra en el `WHERE` de las DOS lecturas.
 *
 * El cliente manda el id del MOVIMIENTO y la pagina, y NADA mas: no hay `tiendaId` que colar
 * —el `.strict()` del schema lo mata en el borde (R42)— asi que el alcance no es forzable desde
 * fuera. Un movimiento de otra tienda responde `not_found` (R41).
 *
 * @sin-superficie el panel que la monta llega en el bloque B7 (frontend) de la ficha 344; esta
 * tanda es solo backend. QUIEN CABLEE `DetalleMiMovimientoCierre` DEBE BORRAR ESTA LINEA: la
 * guardia de superficie de uso falla tambien cuando una anotacion sobrevive a su motivo.
 */
export async function verDetalleDeMiMovimientoAction(
  input: unknown,
  deps: DetalleMiMovimientoDeps = {},
): Promise<VerDetalleDeMiMovimientoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // antes del schema y del service
    const data = verDetalleDeMovimientoSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildDetalleService();
    return service.verDetalleDeMiMovimiento(data, actor);
  });
  return isAppErrorShape(r) ? toWalletTiendaActionError(r) : r;
}

/**
 * Ficha 344 (T4.4, R32/R33) — el MISMO detalle de la tienda sin recorte por pagina, para la
 * descarga. El tope lo evalua y lo aplica el SERVICIO, con el mismo acotamiento por tienda.
 *
 * @sin-superficie su control de descarga llega en el bloque B8 (frontend) de la ficha 344; esta
 * tanda es solo backend. QUIEN CABLEE LA DESCARGA DEBE BORRAR ESTA LINEA, por el mismo motivo
 * que en su hermana paginada.
 */
export async function verDetalleDeMiMovimientoCompletoAction(
  input: unknown,
  deps: DetalleMiMovimientoDeps = {},
): Promise<VerDetalleDeMiMovimientoCompletoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = verDetalleDeMovimientoCompletoSchema.parse(input); // R29
    const service = deps.service ?? buildDetalleService();
    return service.verDetalleDeMiMovimientoCompleto(data, actor);
  });
  return isAppErrorShape(r) ? toWalletTiendaActionError(r) : r;
}
