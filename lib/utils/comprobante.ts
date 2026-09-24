import { randomUUID } from "node:crypto";

import {
  WALLET_COMPROBANTE_EXTENSION,
  WALLET_COMPROBANTE_MIME,
  walletComprobanteConfig,
  type WalletComprobanteConfig,
  type WalletComprobanteMime,
} from "@/lib/config/wallet-comprobante";

// Ficha 459 (design §8, R54/R55) — las dos piezas PURAS del comprobante que comparten el borde
// (la Server Action, antes de tocar el servicio) y el servicio (antes de subir): que archivo se
// admite y como se llama el objeto. Sin Prisma, sin Storage y sin HTTP.

/** Lo unico del `File` que hace falta para validarlo. */
export interface ArchivoComprobante {
  type: string;
  size: number;
}

function esMimeAdmitido(tipo: string): tipo is WalletComprobanteMime {
  return (WALLET_COMPROBANTE_MIME as readonly string[]).includes(tipo);
}

/** El tope, dicho en megas para el mensaje. Se deriva de la config: nunca un «4» escrito aqui. */
function topeEnMegas(maxBytes: number): string {
  const megas = maxBytes / (1024 * 1024);
  return Number.isInteger(megas) ? String(megas) : megas.toFixed(1);
}

/**
 * R54 — que le pasa al archivo como comprobante, o `null` si se admite. Devuelve el MOTIVO (el
 * texto que el dialogo pinta bajo el campo del comprobante), no un booleano: «vacio», «tipo» y
 * «tamano» no se arreglan igual.
 */
export function problemaDeComprobante(
  archivo: ArchivoComprobante,
  config: Pick<WalletComprobanteConfig, "MAX_BYTES"> = walletComprobanteConfig,
): string | null {
  if (archivo.size <= 0) return "El comprobante esta vacio.";
  if (!esMimeAdmitido(archivo.type)) {
    return "El comprobante debe ser una imagen JPEG, PNG o WebP, o un PDF.";
  }
  if (archivo.size > config.MAX_BYTES) {
    return `El comprobante no puede pesar mas de ${topeEnMegas(config.MAX_BYTES)} MB.`;
  }
  return null;
}

/**
 * Carpeta del objeto dentro del bucket, por tipo de documento. La 457 anade la suya
 * (`abonos-tienda`) aqui mismo.
 */
export const PREFIJO_COMPROBANTE = {
  pago_por_cuenta_tienda: "pagos-por-cuenta",
  aporte_capital: "aportes-capital",
} as const;
export type DocumentoConComprobante = keyof typeof PREFIJO_COMPROBANTE;

/**
 * R55 — nombre del objeto: `<carpeta>/<uuid ALEATORIO>.<ext>`. NO contiene el identificador de la
 * tienda, del documento ni de ningun usuario: el unico enlace entre el documento y su archivo es
 * la columna `comprobante_path` del documento. `generarId` se inyecta solo para los tests.
 *
 * Lanza si el tipo no se admite: llamarla con un archivo sin validar es un error de programacion
 * (la validacion de `problemaDeComprobante` va antes, en el borde y en el servicio).
 */
export function rutaDeComprobante(
  documento: DocumentoConComprobante,
  mime: string,
  generarId: () => string = randomUUID,
): string {
  if (!esMimeAdmitido(mime)) {
    throw new Error(`comprobante: tipo no admitido «${mime}»; validar antes de nombrar el objeto`);
  }
  return `${PREFIJO_COMPROBANTE[documento]}/${generarId()}.${WALLET_COMPROBANTE_EXTENSION[mime]}`;
}
