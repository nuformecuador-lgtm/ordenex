"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { walletComprobanteConfig } from "@/lib/config/wallet-comprobante";
import { isAppErrorShape, UnauthenticatedError, withErrorHandler } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ComprobanteRecibido,
  IPagoPorCuentaTiendaService,
} from "@/lib/interfaces/services/IPagoPorCuentaTiendaService";
import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";
import { PagoPorCuentaTiendaRepository } from "@/lib/repositories/PagoPorCuentaTiendaRepository";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { CajaPagoPorCuentaFeedService } from "@/lib/services/CajaPagoPorCuentaFeedService";
import { PagoPorCuentaTiendaService } from "@/lib/services/PagoPorCuentaTiendaService";
import { SupabaseFileStorage } from "@/lib/storage/SupabaseFileStorage";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import {
  anularPagoPorCuentaTiendaSchema,
  obtenerComprobantePagoPorCuentaSchema,
  registrarPagoPorCuentaTiendaSchema,
  type AnularPagoPorCuentaTiendaResult,
  type ArchivoComprobanteLike,
  type ObtenerComprobanteResult,
  type RegistrarPagoPorCuentaTiendaResult,
} from "@/lib/types/pago-por-cuenta-tienda";

// FICHA 459 (design §7.1) — el BORDE del pago por cuenta de una tienda. Archivo NUEVO a proposito:
// `wallet-tienda.ts` y `liquidacion.ts` tienen tests de lista exacta de exportaciones.
//
// Orden de cada action: sesion (`unauthenticated` antes de mirar la entrada) → zod `.strict()`
// (`validation_error`, R37) → servicio bajo `withErrorHandler`. El rol lo decide el SERVICIO
// (`forbidden`, R38). NO hay action para editar un pago por cuenta ni para deshacer su anulacion
// (R52): la ausencia de superficie es el requisito.

/**
 * El COMPOSITION ROOT. Inyecta el puerto de caja REAL, el MISMO candado de tienda que el pago a
 * tienda (R42) y el storage del bucket de comprobantes. Un test de integracion pasa POR ESTAS
 * ACTIONS y encuentra las filas en Postgres (el composition root que no inyecta ya costo 2 de 7
 * notificadores).
 */
function buildService(): IPagoPorCuentaTiendaService {
  const prisma = getPrismaClient();
  return new PagoPorCuentaTiendaService(
    new PagoPorCuentaTiendaRepository(prisma),
    new WalletTiendaMovimientoRepository(prisma),
    new LiquidacionPagoRepository(prisma),
    new UserRepository(prisma),
    new CajaPagoPorCuentaFeedService(new WalletMovimientoRepository(prisma)),
    new SupabaseFileStorage(undefined, walletComprobanteConfig.BUCKET),
    new SupabaseSignedUrlProvider(undefined, walletComprobanteConfig.BUCKET),
    (fn) => prisma.$transaction((tx) => fn(tx)),
  );
}

export interface PagoPorCuentaTiendaDeps {
  service?: IPagoPorCuentaTiendaService;
  getActor?: () => Promise<Actor | null>;
}

function toActionError(
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
      throw new Error(`pago-por-cuenta-tienda: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * Todas las claves del `FormData`, sin coercion: asi `.strict()` ve TAMBIEN las que no estan
 * previstas (R37). El campo de archivo vacio del formulario (un `File` de 0 bytes) es «sin
 * comprobante», no un comprobante invalido.
 */
function crudoDelFormData(formData: FormData): Record<string, unknown> {
  const crudo: Record<string, unknown> = {};
  for (const [clave, valor] of formData.entries()) {
    if (typeof valor !== "string" && valor.size === 0) continue;
    crudo[clave] = valor;
  }
  return crudo;
}

async function leerComprobante(
  archivo: ArchivoComprobanteLike | undefined,
): Promise<ComprobanteRecibido | null> {
  if (archivo === undefined) return null;
  return { contentType: archivo.type, bytes: new Uint8Array(await archivo.arrayBuffer()) };
}

/**
 * R29–R41/R54–R56 — registra un pago por cuenta de una tienda.
 */
export async function registrarPagoPorCuentaTiendaAction(
  formData: FormData,
  deps: PagoPorCuentaTiendaDeps = {},
): Promise<RegistrarPagoPorCuentaTiendaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R38: antes de mirar la entrada
    const { comprobante, ...input } = registrarPagoPorCuentaTiendaSchema.parse(
      crudoDelFormData(formData),
    );
    const archivo = await leerComprobante(comprobante);
    const service = deps.service ?? buildService();
    return service.registrar(input, archivo, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/**
 * R46–R51 — anula un pago por cuenta. Sin monto: el del documento manda (R37).
 */
export async function anularPagoPorCuentaTiendaAction(
  input: unknown,
  deps: PagoPorCuentaTiendaDeps = {},
): Promise<AnularPagoPorCuentaTiendaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = anularPagoPorCuentaTiendaSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.anular(data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/**
 * R57 — el enlace temporal del comprobante (acceso total, o la tienda duena).
 */
export async function obtenerComprobantePagoPorCuentaAction(
  input: unknown,
  deps: PagoPorCuentaTiendaDeps = {},
): Promise<ObtenerComprobanteResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = obtenerComprobantePagoPorCuentaSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.obtenerComprobante(data.pagoId, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}
