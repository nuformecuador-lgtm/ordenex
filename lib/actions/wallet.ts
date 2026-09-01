"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletService } from "@/lib/services/WalletService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IWalletService,
  ListarMovimientosDeFilaServiceResult,
  ListarMovimientosServiceResult,
  RegistrarMovimientoManualServiceResult,
  VerResumenCajaServiceResult,
} from "@/lib/interfaces/services/IWalletService";
import {
  listarMovimientosCompletoSchema,
  listarMovimientosDeFilaSchema,
  listarMovimientosSchema,
  registrarMovimientoManualSchema,
  type ListarMovimientosCompletoResult,
} from "@/lib/types/wallet";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 42 (T10) — Server Actions de la wallet (mutaciones/lecturas internas del mismo
// proyecto -> Server Action, no Route API, patron cierres-admin). Resuelve el actor por
// sesion, valida en el borde con zod y delega en el servicio bajo `withErrorHandler`.
// `unauthenticated` (sin sesion) y `validation_error` (ZodError) se resuelven en el borde;
// `forbidden`/`ok` los devuelve el service como resultado de dominio. Money-safe: los DTOs
// exponen montos como STRING (R21/R25); el cliente nunca recibe Prisma.Decimal.

export type ListarMovimientosActionResult =
  | ListarMovimientosServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

/**
 * Ficha 339 (T3.4) — el detalle de una fila en el BORDE. Se DERIVA del resultado del servicio,
 * igual que el del listado: `forbidden` lo decide el dominio; `unauthenticated` (sin sesion) y
 * `validation_error` (ZodError: `fila` fuera del catalogo o `pageSize` por encima del tope) se
 * resuelven aqui. **Ninguna rama de error viaja con movimientos** (R32/R38).
 */
export type ListarMovimientosDeFilaActionResult =
  | ListarMovimientosDeFilaServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type VerResumenCajaActionResult =
  | VerResumenCajaServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type RegistrarMovimientoManualActionResult =
  | RegistrarMovimientoManualServiceResult
  | { status: "unauthenticated" };

// Traduce el AppErrorShape del borde: ZodError (VALIDATION_ERROR) o falta de sesion
// (UNAUTHORIZED). Espejo de `toCierresAdminActionError`.
function toWalletActionError(
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
      throw new Error(`wallet: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IWalletService {
  const prisma = getPrismaClient();
  const repo = new WalletMovimientoRepository(prisma);
  return new WalletService(repo, prisma);
}

export interface WalletDeps {
  service?: IWalletService;
  getActor?: () => Promise<Actor | null>;
}

/** R19/R20/R25: lista el libro (solo maestro). Forbidden/unauthenticated sin exponer datos. */
export async function listarMovimientosAction(
  input: unknown,
  deps: WalletDeps = {},
): Promise<ListarMovimientosActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R19: antes de tocar el service
    const data = listarMovimientosSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarMovimientos(data, actor);
  });
  return isAppErrorShape(r) ? toWalletActionError(r) : r;
}

/**
 * Feature 170 (T C.2, design §4) — libro de caja COMPLETO, sin paginacion, para la descarga.
 * Calcado de `listarMovimientosAction`: mismo borde, mismo actor, mismo schema (menos
 * `page`/`pageSize`, y `.strict()`) y el MISMO servicio, que es quien autoriza y aplica el
 * tope. Ninguna rama devuelve filas junto a un error (R16/R17/R18).
 */
export async function listarMovimientosCompletoAction(
  input: unknown,
  deps: WalletDeps = {},
): Promise<ListarMovimientosCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R16: antes de tocar el service
    const data = listarMovimientosCompletoSchema.parse(input ?? {}); // R18: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarMovimientosCompleto(data, actor);
  });
  return isAppErrorShape(r) ? toWalletActionError(r) : r;
}

/**
 * Ficha 339 (T3.4, design §4.5) — los movimientos que componen UNA fila de la tarjeta de la
 * ganancia. Calcada de `listarMovimientosAction`: resuelve el actor, lanza `UnauthenticatedError`
 * si no hay sesion, valida con el schema derivado del listado y delega en el servicio.
 *
 * Lectura interna del mismo proyecto ⇒ Server Action, no ruta API (`docs/architecture.md`). El
 * cliente manda el TOKEN de la fila; quien traduce ese token a un conjunto de categorias es el
 * servicio, con la misma definicion que produjo el importe de la fila.
 *
 * SU SUPERFICIE (bloque B5 de la 343): `DetalleFilaComposicion`, el panel que se despliega al
 * abrir una fila de la tarjeta «Como se compone la ganancia de Ordenex». Mientras esa pantalla
 * no existio, este docstring llevo la anotacion de excepcion de
 * `superficie-de-uso.guardia.test.ts`; al cablear el desplegable se borro, que es exactamente lo
 * que esa guardia obliga a hacer.
 */
export async function listarMovimientosDeFilaAction(
  input: unknown,
  deps: WalletDeps = {},
): Promise<ListarMovimientosDeFilaActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // antes de tocar el service
    const data = listarMovimientosDeFilaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarMovimientosDeFila(data, actor);
  });
  return isAppErrorShape(r) ? toWalletActionError(r) : r;
}

/**
 * Feature 173 (T D.2 — R8/R64/R65): las DOS cifras de la caja para el conjunto filtrado.
 *
 * Mismo borde que `listarMovimientosAction` y **el mismo schema**: los filtros del resumen no
 * pueden ser otros que los del listado, ni siquiera por accidente de validacion. El servicio es
 * quien autoriza (R65) y quien deriva; aqui no se toca ni un monto. Money-safe: el DTO cruza la
 * frontera con todos los importes como STRING (R64) — el navegador nunca ve un `Prisma.Decimal`
 * ni recalcula dinero.
 *
 * Feature 231 (T2.3): la rama `ok` pasa a llevar tambien `composicion`. El tipo de retorno de
 * esta accion NO se toca porque ya se DERIVA del contrato del servicio
 * (`VerResumenCajaActionResult = VerResumenCajaServiceResult | …`): ampliar el resultado del
 * servicio lo amplia aqui solo. Sin schema nuevo, sin accion nueva (design §6.3) y sin una
 * sola operacion aritmetica en el borde.
 */
export async function verResumenCajaAction(
  input: unknown,
  deps: WalletDeps = {},
): Promise<VerResumenCajaActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = listarMovimientosSchema.parse(input); // mismos filtros que el listado
    const service = deps.service ?? buildService();
    return service.verResumenCaja(data, actor);
  });
  return isAppErrorShape(r) ? toWalletActionError(r) : r;
}

// Feature 173 (T H.2/Tanda H) — el PUENTE `verBalanceAction` se RETIRA aqui.
//
// Existio entre la Tanda D y la Tanda G, y estaba declarado como puente desde el primer dia:
// `WalletService.verBalance` desaparecio con `T D.2` (design §5.2, sustituido por
// `verResumenCaja`), pero `/wallet` seguia siendo la pantalla de la 42 y la fase backend no
// podia tocarla. El puente proyectaba los campos del DTO nuevo sobre la forma vieja
// (`enCaja` -> `balance`), sin una sola operacion aritmetica propia.
//
// `T G.3` lo dejo SIN UN SOLO CONSUMIDOR (la pagina y el modulo pasaron a
// `verResumenCajaAction`); su docstring decia «lo borra `T G.3`» y era falso —retirarlo es
// tocar `lib/`, que es backend—. Lo borra esta tanda, que es la que puede.
//
// Con el se van `VerBalanceActionResult` y el import de `WalletBalanceDTO`, que no tenian otro
// uso en este archivo. `WalletBalanceDTO` NO se borra del arbol: es el tipo de retorno de
// `derivarBalance` (`lib/utils/wallet-balance.ts`), que R9 protege intacto.

/** R15/R19: registra un movimiento manual de ajuste (solo maestro; monto>0, descripcion obligatoria). */
export async function registrarMovimientoManualAction(
  input: unknown,
  deps: WalletDeps = {},
): Promise<RegistrarMovimientoManualActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = registrarMovimientoManualSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.registrarMovimientoManual(data, actor);
  });
  // El service ya devuelve validation_error de dominio si aplica; el borde solo traduce
  // ZodError/UNAUTHORIZED.
  if (isAppErrorShape(r)) {
    const t = toWalletActionError(r);
    if (t.status === "unauthenticated") return t;
    return { status: "validation_error", fieldErrors: t.fieldErrors };
  }
  return r;
}
