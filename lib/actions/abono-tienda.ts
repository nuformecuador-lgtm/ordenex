"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { walletComprobanteConfig } from "@/lib/config/wallet-comprobante";
import { isAppErrorShape, UnauthenticatedError, withErrorHandler } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ComprobanteRecibido, IAbonoTiendaService } from "@/lib/interfaces/services/IAbonoTiendaService";
import { AbonoTiendaRepository } from "@/lib/repositories/AbonoTiendaRepository";
import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { AbonoTiendaService } from "@/lib/services/AbonoTiendaService";
import { CajaAbonoTiendaFeedService } from "@/lib/services/CajaAbonoTiendaFeedService";
import { SupabaseFileStorage } from "@/lib/storage/SupabaseFileStorage";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import {
  anularAbonoTiendaSchema,
  obtenerComprobanteAbonoSchema,
  registrarAbonoTiendaSchema,
  type AnularAbonoTiendaResult,
  type ObtenerComprobanteAbonoResult,
  type RegistrarAbonoTiendaResult,
} from "@/lib/types/abono-tienda";
import type { ArchivoComprobanteLike } from "@/lib/types/pago-por-cuenta-tienda";

// FICHA 457 (design §7) — el BORDE del pago de una tienda a Ordenex. Archivo NUEVO a proposito:
// `wallet-tienda.ts` y `liquidacion.ts` tienen tests de lista exacta de exportaciones.
//
// Orden de cada action: sesion (`unauthenticated` antes de mirar la entrada, R3) → zod `.strict()`
// (`validation_error`, R12/R13) → servicio bajo `withErrorHandler`. El rol lo decide el SERVICIO
// (`forbidden`, R2). NO hay action para editar un pago de una tienda ni para deshacer su anulacion
// (R40): la ausencia de superficie es el requisito, y un test fija la lista EXACTA de exportaciones.

/**
 * El COMPOSITION ROOT. Inyecta el puerto de caja REAL, el MISMO candado de tienda que el pago a tienda
 * y el pago de un gasto (R16), y el storage del bucket compartido de comprobantes. Un test de
 * integracion pasa POR ESTAS ACTIONS y encuentra las cuatro filas en Postgres (el composition root que
 * no inyecta ya costo 2 de 7 notificadores).
 */
function buildService(): IAbonoTiendaService {
  const prisma = getPrismaClient();
  return new AbonoTiendaService(
    new AbonoTiendaRepository(prisma),
    new WalletTiendaMovimientoRepository(prisma),
    new LiquidacionPagoRepository(prisma),
    new UserRepository(prisma),
    new CajaAbonoTiendaFeedService(new WalletMovimientoRepository(prisma)),
    new SupabaseFileStorage(undefined, walletComprobanteConfig.BUCKET),
    new SupabaseSignedUrlProvider(undefined, walletComprobanteConfig.BUCKET),
    (fn) => prisma.$transaction((tx) => fn(tx)),
  );
}

export interface AbonoTiendaDeps {
  service?: IAbonoTiendaService;
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
      throw new Error(`abono-tienda: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * Todas las claves del `FormData`, sin coercion: asi `.strict()` ve TAMBIEN las que no estan previstas
 * (R12). El campo de archivo vacio del formulario (un `File` de 0 bytes) es «sin comprobante», no un
 * comprobante invalido (R30).
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
 * R1–R30 — registra un pago de una tienda a Ordenex. Entrada: `FormData` con `claveIdempotencia`,
 * `tiendaId`, `monto`, `metodo`, `referencia?`, `motivo`, `fechaPago` y `comprobante?` (File).
 */
export async function registrarAbonoTiendaAction(
  formData: FormData,
  deps: AbonoTiendaDeps = {},
): Promise<RegistrarAbonoTiendaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R3: antes de mirar la entrada
    const { comprobante, ...input } = registrarAbonoTiendaSchema.parse(crudoDelFormData(formData));
    const archivo = await leerComprobante(comprobante);
    const service = deps.service ?? buildService();
    return service.registrar(input, archivo, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/**
 * R31–R39 — anula un pago de una tienda a Ordenex. Sin monto: el del documento manda (R34).
 */
export async function anularAbonoTiendaAction(
  input: unknown,
  deps: AbonoTiendaDeps = {},
): Promise<AnularAbonoTiendaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = anularAbonoTiendaSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.anular(data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/**
 * R42–R44 — el enlace temporal del comprobante (acceso total, o la tienda dueña: DH3).
 */
export async function obtenerComprobanteAbonoAction(
  input: unknown,
  deps: AbonoTiendaDeps = {},
): Promise<ObtenerComprobanteAbonoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = obtenerComprobanteAbonoSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.obtenerComprobante(data.abonoId, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}
