"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { buildBusquedaPorGuia } from "@/lib/actions/_shared/busqueda-por-guia";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IDetalleMovimientoService,
  VerDetalleMovimientoServiceResult,
} from "@/lib/interfaces/services/IDetalleMovimientoService";
import type { IEstadoCuentaService } from "@/lib/interfaces/services/IEstadoCuentaService";
import { CierreAporteRepository } from "@/lib/repositories/CierreAporteRepository";
import { EstadoCuentaRepository } from "@/lib/repositories/EstadoCuentaRepository";
import { OrigenLegibleRepository } from "@/lib/repositories/OrigenLegibleRepository";
import { RechazoTiendaCobroAnulacionRepository } from "@/lib/repositories/RechazoTiendaCobroAnulacionRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { DetalleMovimientoService } from "@/lib/services/DetalleMovimientoService";
import { DetalleEnLoteService } from "@/lib/services/DetalleEnLoteService";
import { CuentaKardexService } from "@/lib/services/LibroKardexService";
import type { ICuentaKardexService } from "@/lib/interfaces/services/ICuentaKardexService";
import type { CuentaKardexConDetalleServiceResult, CuentaKardexServiceResult } from "@/lib/types/libro-kardex";
import { EstadoCuentaService } from "@/lib/services/EstadoCuentaService";
import { OrigenLegibleService } from "@/lib/services/OrigenLegibleService";
import {
  estadoCuentaCompletoSchema,
  estadoCuentaSchema,
  miEstadoCuentaCompletoSchema,
  miEstadoCuentaSchema,
  ordenesDeFilaSchema,
  type VerEstadoCuentaCompletoResult,
  type VerEstadoCuentaResult,
} from "@/lib/types/estado-cuenta";

// FICHA 458-B (design §3.2/§6, R16–R25, R81) — el borde del ESTADO DE CUENTA. Lectura interna del
// mismo proyecto: Server Action (`docs/architecture.md`). Sesion primero, forma despues (`.strict()`:
// una clave de mas es `validation_error` sin leer nada), el resto lo decide el servicio (rol antes de
// leer, cuenta inexistente o de otro papel → `no_encontrado` sin distinguir).
//
// FICHA 458-D (servidor) — el mismo borde gana: filtro por cierre (R10/R12), origen con entidad y
// enlace y metodo/referencia en cada fila (R6–R8), la lectura de `/mi-wallet` acotada a la tienda de la
// sesion (R34/R36), el periodo entero con tope en el servidor (TD.6/R32) y las ordenes de una fila de
// cierre desde la oficina (R19). Contratos para el frontend en `progress/impl_458-D.md` §Servidor.

type ErrorDeBorde =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

function toEstadoCuentaActionError(shape: AppErrorShape): ErrorDeBorde {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      throw new Error(`estado-cuenta: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * El COMPOSITION ROOT del estado de cuenta: el repositorio de los libros, el de las anulaciones del
 * cobro por rechazo y el ORIGEN LEGIBLE de la 458-A (una consulta por tipo de origen presente). Los
 * tres son obligatorios en el constructor: ninguno puede quedarse sin inyectar en silencio.
 */
function buildService(): IEstadoCuentaService {
  const prisma = getPrismaClient();
  return new EstadoCuentaService(
    new EstadoCuentaRepository(prisma),
    new RechazoTiendaCobroAnulacionRepository(prisma),
    new OrigenLegibleService(new OrigenLegibleRepository(prisma)),
    buildBusquedaPorGuia(prisma), // FICHA 469 (design §3.3): guia o texto en tienda, mensajero y /mi-wallet
  );
}

/** R19 — el MISMO servicio del detalle de la 344 (una sola derivacion del aporte por orden). */
function buildDetalleService(): IDetalleMovimientoService {
  const prisma = getPrismaClient();
  return new DetalleMovimientoService(
    new WalletMovimientoRepository(prisma),
    new WalletTiendaMovimientoRepository(prisma),
    new CierreAporteRepository(prisma),
    new EstadoCuentaRepository(prisma),
    buildBusquedaPorGuia(prisma), // FICHA 469 (R25–R29): la guia buscada, destacada
  );
}

/**
 * Ficha 468 — el lote del detalle por guia sobre sus TRES repositorios reales (aportes, libro de la
 * tienda y libro del mensajero). Lo usa el composition root del kardex (el de la 464 se retiro en el
 * bloque B, al cablear la descarga a las acciones del kardex).
 */
function buildDetalleEnLote(prisma: ReturnType<typeof getPrismaClient>): DetalleEnLoteService {
  return new DetalleEnLoteService(
    new CierreAporteRepository(prisma),
    new WalletTiendaMovimientoRepository(prisma),
    new EstadoCuentaRepository(prisma),
  );
}

/**
 * Ficha 468 (design §4.3) — el composition root del estado de cuenta como KARDEX: el servicio de SIEMPRE
 * (`buildService`: la misma hoja, el mismo guard y el mismo tope) y el lote real, con el repositorio del
 * MENSAJERO incluido. Sin dependencias opcionales.
 */
function buildCuentaKardexService(): ICuentaKardexService {
  return new CuentaKardexService(buildService(), buildDetalleEnLote(getPrismaClient()));
}

/** Ficha 468 — dependencias del kardex del estado de cuenta, inyectables en test. */
export interface CuentaKardexDeps {
  service?: ICuentaKardexService;
  getActor?: () => Promise<Actor | null>;
}

export type CuentaKardexActionResult = CuentaKardexServiceResult | ErrorDeBorde;
export type CuentaKardexConDetalleActionResult = CuentaKardexConDetalleServiceResult | ErrorDeBorde;

/**
 * Ficha 468 (R25) — el borde del detalle por guia en la oficina: el del completo de SIEMPRE y, ademas, la
 * cuenta NO puede ser una bodega satelite (su libro son consolidaciones, sin guias). Tienda y mensajero
 * si (R24, R31).
 */
const estadoCuentaConGuiasCompletoSchema = estadoCuentaCompletoSchema.refine((v) => v.cuenta.tipo !== "bodega", {
  message: "El detalle por guía no existe en el estado de cuenta de una bodega satélite.",
  path: ["cuenta"],
});

export interface EstadoCuentaDeps {
  service?: IEstadoCuentaService;
  getActor?: () => Promise<Actor | null>;
}

export interface OrdenesDeFilaDeps {
  service?: IDetalleMovimientoService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * El estado de cuenta de una tienda, un mensajero o una bodega satelite: tarjetas (saldo actual con su
 * sentido, saldo inicial, abonos y cargos netos del periodo, saldo final) y el extracto paginado con
 * el saldo corrido de la cuenta ENTERA.
 *
 * FICHA 458-D (servidor): acepta `cierreId` (R10/R12) y cada fila trae `origen` y `pago`.
 *
 * Superficie (FICHA 458-D): las paginas `/wallet/tiendas/[tiendaId]`, `/wallet/mensajeros/[mensajeroId]`
 * y `/wallet/satelites/[zonaId]` (primera pagina, en el servidor) y `components/shared/estado-cuenta/
 * EstadoCuenta.tsx` (periodo, chip, paginas y descarga). La anotacion de excepcion que llevaba se borro
 * al montarlas.
 */
export async function verEstadoCuentaAction(
  input: unknown,
  deps: EstadoCuentaDeps = {},
): Promise<VerEstadoCuentaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = estadoCuentaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.leer(data, actor);
  });
  return isAppErrorShape(r) ? toEstadoCuentaActionError(r) : r;
}

/**
 * FICHA 458-D (servidor, TD.6/R32) — el periodo filtrado ENTERO de una cuenta, para la descarga. Mismos
 * filtros que la pagina sin `page`/`pageSize`; el tope (`descargaConfig.MAX_FILAS`) lo aplica el
 * servidor: por encima, `limite_excedido` con los conteos y ninguna fila.
 *
 * @sin-superficie FICHA 468 (bloque B): la descarga del estado de cuenta de la oficina paso a `estadoCuentaKardexAction` (kardex); esta accion queda sin pantalla y su retirada (con sus tests) la decide el leader.
 */
export async function verEstadoCuentaCompletoAction(
  input: unknown,
  deps: EstadoCuentaDeps = {},
): Promise<VerEstadoCuentaCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = estadoCuentaCompletoSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.leerCompleto(data, actor);
  });
  return isAppErrorShape(r) ? toEstadoCuentaActionError(r) : r;
}

/**
 * FICHA 458-D (servidor, R34–R36) — el estado de cuenta de `/mi-wallet`: el de la tienda de la SESION,
 * con el mismo saldo corrido que ve la oficina. Sin clave de cuenta en la entrada (`.strict()`: una
 * `cuenta` o un `tiendaId` es `validation_error` sin leer nada); cualquier rol que no sea
 * `adminTienda` → `forbidden`.
 *
 * Superficie (FICHA 458-D): `app/(app)/mi-wallet/page.tsx` (primera pagina) y `MiEstadoCuenta.tsx` (periodo, chip, cierre y paginas).
 */
export async function verMiEstadoCuentaAction(
  input: unknown,
  deps: EstadoCuentaDeps = {},
): Promise<VerEstadoCuentaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = miEstadoCuentaSchema.parse(input ?? {});
    const service = deps.service ?? buildService();
    return service.leerMiTienda(data, actor);
  });
  return isAppErrorShape(r) ? toEstadoCuentaActionError(r) : r;
}

/**
 * FICHA 458-D (servidor, R32/R36) — el de `/mi-wallet` con el periodo ENTERO, tope en el servidor.
 *
 * @sin-superficie FICHA 468 (bloque B): la descarga de `/mi-wallet` paso a `miEstadoCuentaKardexAction` (kardex); esta accion queda sin pantalla y su retirada (con sus tests) la decide el leader.
 */
export async function verMiEstadoCuentaCompletoAction(
  input: unknown,
  deps: EstadoCuentaDeps = {},
): Promise<VerEstadoCuentaCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = miEstadoCuentaCompletoSchema.parse(input ?? {});
    const service = deps.service ?? buildService();
    return service.leerMiTiendaCompleto(data, actor);
  });
  return isAppErrorShape(r) ? toEstadoCuentaActionError(r) : r;
}

/*
 * Ficha 464 — `verEstadoCuentaCompletoConDetalleAction` y `verMiEstadoCuentaCompletoConDetalleAction`
 * («Movimientos y detalle por orden») se RETIRARON en la 468 (bloque B), junto con su orquestador
 * `EstadoCuentaConDetalleService`: las sustituyen `estadoCuentaKardexConDetalleAction` (tienda y, nuevo,
 * mensajero) y `miEstadoCuentaKardexConDetalleAction`.
 */

/** R19 — `ok` / `sin_reparto` / `not_found` / `forbidden` del dominio, mas los dos del borde. */
export type VerOrdenesDeFilaResult = VerDetalleMovimientoServiceResult | ErrorDeBorde;

/**
 * FICHA 458-D (servidor, R19, 344) — las ordenes que componen el importe de una fila de cierre del
 * estado de cuenta de una tienda o de un mensajero, en la oficina. Acceso total; la cuenta y el
 * movimiento viajan como ids (nunca se pintan) y el movimiento de OTRA cuenta responde `not_found`.
 *
 * Superficie (FICHA 458-D): el despliegue de las filas de cierre del estado de cuenta de tienda y mensajero (`app/(app)/wallet/_components/ordenes-de-fila-cuenta.ts`).
 */
export async function verOrdenesDeFilaAction(
  input: unknown,
  deps: OrdenesDeFilaDeps = {},
): Promise<VerOrdenesDeFilaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = ordenesDeFilaSchema.parse(input);
    const service = deps.service ?? buildDetalleService();
    return service.verDetalleDeFilaDeCuenta(data, actor);
  });
  return isAppErrorShape(r) ? toEstadoCuentaActionError(r) : r;
}

/**
 * Ficha 468 (design §3.3, R2, R5–R16, R53, R57, R61) — la descarga «Solo los movimientos · una hoja» del
 * estado de cuenta de una tienda, un mensajero o una bodega satelite (oficina) como KARDEX: la MISMA
 * entrada que `verEstadoCuentaCompletoAction`, con el orden FORZADO a cronologico ascendente (R7), y el
 * `kardex` junto al `estado` (saldo inicial y final de la tarjeta, la columna y el saldo corrido de cada
 * fila, totales y el «N guía(s)» de los conteos, sin leer ninguna orden).
 *
 * Superficie (ficha 468, bloque B): la descarga «Solo los movimientos» de `components/shared/estado-cuenta/
 * EstadoCuenta.tsx` (`lectorDeLaCuenta`: tienda, mensajero y bodega de la oficina). Su `@sin-superficie`
 * se borro al cablearla.
 */
export async function estadoCuentaKardexAction(
  input: unknown,
  deps: CuentaKardexDeps = {},
): Promise<CuentaKardexActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = estadoCuentaCompletoSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildCuentaKardexService();
    return service.kardex(data, actor);
  });
  return isAppErrorShape(r) ? toEstadoCuentaActionError(r) : r;
}

/**
 * Ficha 468 (R24–R26, R30, R31, R33–R46, R55, R56) — la descarga «Movimientos y detalle por guía · dos
 * hojas» del estado de cuenta de una TIENDA o de un MENSAJERO en la oficina, en una sola peticion. La
 * bodega satelite es `validation_error` en el borde, sin leer nada (R25). Acceso total antes de leer
 * (R55); el tope del detalle es el de la 464 (R56).
 *
 * Superficie (ficha 468, bloque B): la descarga con detalle de `EstadoCuenta.tsx` (`lectorDeLaCuenta`,
 * tienda y mensajero). Su `@sin-superficie` se borro al cablearla.
 */
export async function estadoCuentaKardexConDetalleAction(
  input: unknown,
  deps: CuentaKardexDeps = {},
): Promise<CuentaKardexConDetalleActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = estadoCuentaConGuiasCompletoSchema.parse(input); // bodega -> VALIDATION_ERROR (R25)
    const service = deps.service ?? buildCuentaKardexService();
    return service.kardexConDetalle(data, actor);
  });
  return isAppErrorShape(r) ? toEstadoCuentaActionError(r) : r;
}

/**
 * Ficha 468 (R3, R5–R16) — «Solo los movimientos» de `/mi-wallet` como KARDEX. La tienda es la de la
 * SESION (`.strict()`: una `cuenta` o un `tiendaId` es `validation_error` sin leer nada).
 *
 * Superficie (ficha 468, bloque B): la descarga de `/mi-wallet` (`LECTOR_MI_TIENDA`, `MiEstadoCuenta.tsx`).
 * Su `@sin-superficie` se borro al cablearla.
 */
export async function miEstadoCuentaKardexAction(
  input: unknown,
  deps: CuentaKardexDeps = {},
): Promise<CuentaKardexActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = miEstadoCuentaCompletoSchema.parse(input ?? {});
    const service = deps.service ?? buildCuentaKardexService();
    return service.miKardex(data, actor);
  });
  return isAppErrorShape(r) ? toEstadoCuentaActionError(r) : r;
}

/**
 * Ficha 468 (R26, R32, R48, R49) — las dos hojas de `/mi-wallet`: solo guias de la tienda de la sesion y
 * ningun nombre de Ordenex ni de un mensajero.
 *
 * Superficie (ficha 468, bloque B): la descarga con detalle de `/mi-wallet` (`LECTOR_MI_TIENDA`,
 * `MiEstadoCuenta.tsx`). Su `@sin-superficie` se borro al cablearla.
 */
export async function miEstadoCuentaKardexConDetalleAction(
  input: unknown,
  deps: CuentaKardexDeps = {},
): Promise<CuentaKardexConDetalleActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = miEstadoCuentaCompletoSchema.parse(input ?? {});
    const service = deps.service ?? buildCuentaKardexService();
    return service.miKardexConDetalle(data, actor);
  });
  return isAppErrorShape(r) ? toEstadoCuentaActionError(r) : r;
}
