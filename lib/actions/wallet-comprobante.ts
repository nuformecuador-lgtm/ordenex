"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { walletComprobanteConfig } from "@/lib/config/wallet-comprobante";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletComprobanteService } from "@/lib/interfaces/services/IWalletComprobanteService";
import { WalletAnulacionDestinoRepository } from "@/lib/repositories/WalletAnulacionDestinoRepository";
import { WalletComprobanteRepository } from "@/lib/repositories/WalletComprobanteRepository";
import { WalletAnulacionService } from "@/lib/services/WalletAnulacionService";
import { WalletComprobanteService } from "@/lib/services/WalletComprobanteService";
import { SupabaseFileStorage } from "@/lib/storage/SupabaseFileStorage";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import {
  adjuntarComprobanteSchema,
  verComprobanteSchema,
  type AdjuntarComprobanteResult,
  type VerComprobanteResult,
} from "@/lib/types/wallet-comprobante-lateral";

// FICHA 458-B (design §4.1, D6/D12, R74–R80) — el borde del comprobante LATERAL: adjuntarlo despues
// (una vez, acceso total) y verlo por enlace temporal (acceso total o la tienda duena). Sesion primero,
// forma despues (`.strict()`), alcance en el servicio.

/**
 * El COMPOSITION ROOT: el repo real, el MISMO clasificador que la anulacion y el bucket privado
 * compartido de comprobantes (el de la 459/457).
 */
function buildService(): IWalletComprobanteService {
  const prisma = getPrismaClient();
  return new WalletComprobanteService(
    new WalletComprobanteRepository(prisma),
    new WalletAnulacionService(new WalletAnulacionDestinoRepository(prisma)),
    new SupabaseFileStorage(undefined, walletComprobanteConfig.BUCKET),
    new SupabaseSignedUrlProvider(undefined, walletComprobanteConfig.BUCKET),
    (fn) => prisma.$transaction((tx) => fn(tx)),
  );
}

function toComprobanteActionError(
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
      throw new Error(`wallet-comprobante: AppErrorCode inesperado ${shape.code}`);
  }
}

export interface WalletComprobanteDeps {
  service?: IWalletComprobanteService;
  getActor?: () => Promise<Actor | null>;
}

/** Todas las claves del `FormData`, sin coercion: asi `.strict()` ve tambien las no previstas. */
function crudoDelFormData(formData: FormData): Record<string, unknown> {
  const crudo: Record<string, unknown> = {};
  for (const [clave, valor] of formData.entries()) crudo[clave] = valor;
  return crudo;
}

/**
 * D6/R79 — adjunta el comprobante a un movimiento que no lo tiene. `FormData`: `destino` (JSON del
 * destino, el mismo de la anulacion) y `comprobante` (File).
 *
 * @sin-superficie FICHA 458-B (backend por delante del frontend): la llama el panel «Ver» de la 458-C (design §4.1, D6). Esta anotacion CADUCA con la 458-C.
 */
export async function adjuntarComprobanteAction(
  formData: FormData,
  deps: WalletComprobanteDeps = {},
): Promise<AdjuntarComprobanteResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // antes de mirar la entrada
    const { destino, comprobante } = adjuntarComprobanteSchema.parse(crudoDelFormData(formData));
    const bytes = new Uint8Array(await comprobante.arrayBuffer());
    const service = deps.service ?? buildService();
    return service.adjuntar(destino, { contentType: comprobante.type, bytes }, actor);
  });
  return isAppErrorShape(r) ? toComprobanteActionError(r) : r;
}

/**
 * R77/R78/R80 — el enlace temporal del comprobante de un destino, con su rotulo. Nunca la ruta.
 *
 * @sin-superficie FICHA 458-B (backend por delante del frontend): la llaman el panel «Ver» (458-C) y los estados de cuenta y `/mi-wallet` (458-D). Esta anotacion CADUCA con la 458-C.
 */
export async function verComprobanteAction(
  input: unknown,
  deps: WalletComprobanteDeps = {},
): Promise<VerComprobanteResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const { destino } = verComprobanteSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.ver(destino, actor);
  });
  return isAppErrorShape(r) ? toComprobanteActionError(r) : r;
}
