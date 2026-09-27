"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
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
  );
}

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
 * Superficie (FICHA 458-D): la descarga de `components/shared/estado-cuenta/EstadoCuenta.tsx` (`filasDelPeriodo`) en las tres paginas de la oficina.
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
 * Superficie (FICHA 458-D): la descarga del estado de cuenta de `/mi-wallet` (`MiEstadoCuenta.tsx`).
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
