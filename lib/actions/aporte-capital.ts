"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { walletComprobanteConfig } from "@/lib/config/wallet-comprobante";
import { isAppErrorShape, UnauthenticatedError, withErrorHandler } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";
import type { IAporteCapitalService } from "@/lib/interfaces/services/IAporteCapitalService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { AporteCapitalRepository } from "@/lib/repositories/AporteCapitalRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { AporteCapitalService } from "@/lib/services/AporteCapitalService";
import { CajaAporteCapitalFeedService } from "@/lib/services/CajaAporteCapitalFeedService";
import { SupabaseFileStorage } from "@/lib/storage/SupabaseFileStorage";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import {
  anularAporteCapitalSchema,
  obtenerComprobanteAporteCapitalSchema,
  registrarAporteCapitalSchema,
  type AnularAporteCapitalResult,
  type RegistrarAporteCapitalResult,
} from "@/lib/types/aporte-capital";
import type { ObtenerComprobanteResult } from "@/lib/types/pago-por-cuenta-tienda";

// FICHA 459 (design §7.2) — el BORDE del saldo inicial o aporte de capital. Mismo orden que el
// pago por cuenta: sesion → zod `.strict()` → servicio. R27: ninguna action devuelve, propone ni
// calcula un importe de saldo inicial; el monto solo lo teclea una persona.

/** El COMPOSITION ROOT, con el puerto de caja REAL y el storage del bucket de comprobantes. */
function buildService(): IAporteCapitalService {
  const prisma = getPrismaClient();
  const caja = new WalletMovimientoRepository(prisma);
  return new AporteCapitalService(
    new AporteCapitalRepository(prisma),
    new CajaAporteCapitalFeedService(caja),
    caja,
    new SupabaseFileStorage(undefined, walletComprobanteConfig.BUCKET),
    new SupabaseSignedUrlProvider(undefined, walletComprobanteConfig.BUCKET),
    (fn) => prisma.$transaction((tx) => fn(tx)),
  );
}

export interface AporteCapitalDeps {
  service?: IAporteCapitalService;
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
      throw new Error(`aporte-capital: AppErrorCode inesperado ${shape.code}`);
  }
}

function crudoDelFormData(formData: FormData): Record<string, unknown> {
  const crudo: Record<string, unknown> = {};
  for (const [clave, valor] of formData.entries()) {
    if (typeof valor !== "string" && valor.size === 0) continue;
    crudo[clave] = valor;
  }
  return crudo;
}

/**
 * R68–R73 — registra un saldo inicial o un aporte de capital.
 */
export async function registrarAporteCapitalAction(
  formData: FormData,
  deps: AporteCapitalDeps = {},
): Promise<RegistrarAporteCapitalResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R76
    const { comprobante, ...input } = registrarAporteCapitalSchema.parse(
      crudoDelFormData(formData),
    );
    const archivo =
      comprobante === undefined
        ? null
        : { contentType: comprobante.type, bytes: new Uint8Array(await comprobante.arrayBuffer()) };
    const service = deps.service ?? buildService();
    return service.registrar(input, archivo, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/**
 * R74 — anula un saldo inicial o aporte.
 */
export async function anularAporteCapitalAction(
  input: unknown,
  deps: AporteCapitalDeps = {},
): Promise<AnularAporteCapitalResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = anularAporteCapitalSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.anular(data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/**
 * R57 — el enlace temporal del comprobante (solo acceso total).
 *
 * @sin-superficie FICHA 458-C (TC.3/TC.5, decision, no deuda): el panel «Ver» del libro pide TODO comprobante por `verComprobanteAction({ destino })`, que tambien lee el de este documento (458-B, R77).
 */
export async function obtenerComprobanteAporteCapitalAction(
  input: unknown,
  deps: AporteCapitalDeps = {},
): Promise<ObtenerComprobanteResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = obtenerComprobanteAporteCapitalSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.obtenerComprobante(data.aporteId, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}
