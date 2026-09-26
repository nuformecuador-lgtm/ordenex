// FICHA 458-B (design §4.1, R74) — lo que comparten los bordes que ganan comprobante (sueldo, gasto,
// correccion, pago a tienda/mensajero, cobro): el puerto REAL del comprobante lateral y la lectura del
// archivo ya validado. Sin «use server»: son piezas del composition root, no acciones.
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { walletComprobanteConfig } from "@/lib/config/wallet-comprobante";
import type { ComprobanteRecibido, IWalletComprobanteService } from "@/lib/interfaces/services/IWalletComprobanteService";
import { WalletAnulacionDestinoRepository } from "@/lib/repositories/WalletAnulacionDestinoRepository";
import { WalletComprobanteRepository } from "@/lib/repositories/WalletComprobanteRepository";
import { WalletAnulacionService } from "@/lib/services/WalletAnulacionService";
import { WalletComprobanteService } from "@/lib/services/WalletComprobanteService";
import { SupabaseFileStorage } from "@/lib/storage/SupabaseFileStorage";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import { comprobanteOpcionalSchema } from "@/lib/types/wallet-laterales";

/** El puerto REAL: el bucket privado compartido de comprobantes (el de la 459/457). */
export function buildComprobantes(prisma: PrismaClient): IWalletComprobanteService {
  return new WalletComprobanteService(
    new WalletComprobanteRepository(prisma),
    new WalletAnulacionService(new WalletAnulacionDestinoRepository(prisma)),
    new SupabaseFileStorage(undefined, walletComprobanteConfig.BUCKET),
    new SupabaseSignedUrlProvider(undefined, walletComprobanteConfig.BUCKET),
    (fn) => prisma.$transaction((tx) => fn(tx)),
  );
}

/**
 * El comprobante del `FormData`, validado en el borde con la MISMA pieza que el servicio (R75): un
 * archivo invalido es `ZodError` bajo `comprobante` → `validation_error` sin tocar nada. `null` = no vino.
 */
export async function leerComprobanteOpcional(valor: unknown): Promise<ComprobanteRecibido | null> {
  const { comprobante: archivo } = z.object({ comprobante: comprobanteOpcionalSchema }).parse({ comprobante: valor });
  if (archivo === undefined) return null;
  return { contentType: archivo.type, bytes: new Uint8Array(await archivo.arrayBuffer()) };
}
