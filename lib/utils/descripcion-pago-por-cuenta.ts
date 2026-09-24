import type { MetodoLiquidacion } from "@/lib/types/liquidacion";
import { descripcionDePago } from "@/lib/utils/descripcion-pago";

// Ficha 459 (design §6.1, R43) — las lineas del libro de un PAGO POR CUENTA de una tienda: dinero
// que Ordenex saca de la caja para pagarle a un tercero (su proveedor, su publicidad, su personal)
// en nombre de la tienda. Funciones PURAS: sin Prisma, sin HTTP.
//
// NINGUNA lleva un identificador interno (R43/R100): el enlace al documento lo dan
// `origen_tipo`/`origen_id` del movimiento. El metodo y la referencia se componen con
// `descripcionDePago` (la misma pieza que el pago a tienda), para que «SINPE · 1234567» se lea
// igual en los dos conceptos.

/** Lo que el documento aporta a su descripcion. Todo texto ya validado en el borde. */
export interface DatosDescripcionPagoPorCuenta {
  /** A quien se le pago (nombre libre, H2 de la 458). */
  beneficiario: string;
  /** Por que se pago. */
  motivo: string;
  metodo: MetodoLiquidacion;
  referencia: string | null;
}

/** Libro de la TIENDA: `A {beneficiario} · {motivo} · {Metodo}[ · {referencia}]`. */
export function descripcionPagoPorCuentaEnTienda(datos: DatosDescripcionPagoPorCuenta): string {
  return `A ${datos.beneficiario.trim()} · ${datos.motivo.trim()} · ${descripcionDePago(
    datos.metodo,
    datos.referencia,
  )}`;
}

/**
 * Libro de la CAJA: la misma linea precedida del NOMBRE de la tienda, porque en la caja conviven
 * los pagos por cuenta de todas y sin el no se sabe de quien es el dinero que salio.
 */
export function descripcionPagoPorCuentaEnCaja(
  tiendaNombre: string,
  datos: DatosDescripcionPagoPorCuenta,
): string {
  return `${tiendaNombre.trim()} · ${descripcionPagoPorCuentaEnTienda(datos)}`;
}

/**
 * Contra-asiento de una ANULACION (R46): la descripcion original precedida de «Anulación · ». NO
 * lleva el motivo de la anulacion, que vive en su propia tabla (mismo criterio que
 * `descripcionDeAnulacion` del pago a tienda).
 */
export function descripcionAnulacionPagoPorCuenta(descripcionOriginal: string): string {
  return `Anulación · ${descripcionOriginal}`;
}
