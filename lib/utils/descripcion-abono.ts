import type { MetodoLiquidacion } from "@/lib/types/liquidacion";
import { descripcionDePago } from "@/lib/utils/descripcion-pago";

// Ficha 457 (design §5.4, R21) — las lineas del libro de un PAGO DE UNA TIENDA A ORDENEX: el dinero
// que una tienda con saldo en contra le entrega a Ordenex. Funciones PURAS: sin Prisma, sin HTTP.
//
// NINGUNA lleva un identificador interno (R21/R48): el enlace al documento lo dan
// `origen_tipo`/`origen_id` del movimiento. El metodo y la referencia se componen con
// `descripcionDePago` (la misma pieza que el pago a tienda y el pago de un gasto), para que
// «SINPE · 1234567» se lea igual en todos los conceptos. El motivo SI entra (DH2/DH3: la tienda lo
// lee en su libro); el motivo de la ANULACION no (vive en su tabla).

/** Lo que el documento aporta a su descripcion. Todo texto ya validado en el borde. */
export interface DatosDescripcionAbono {
  /** Por que pago la tienda (D4: texto libre de 1 a 200, visible para la tienda). */
  motivo: string;
  metodo: MetodoLiquidacion;
  referencia: string | null;
}

/** Libro de la TIENDA: `{motivo} · {Metodo}[ · {referencia}]`. */
export function descripcionAbonoEnTienda(datos: DatosDescripcionAbono): string {
  return `${datos.motivo.trim()} · ${descripcionDePago(datos.metodo, datos.referencia)}`;
}

/**
 * Libro de la CAJA: la misma linea precedida del NOMBRE de la tienda, porque en la caja conviven los
 * pagos de todas las tiendas y sin el no se sabe de quien es el dinero que entro.
 */
export function descripcionAbonoEnCaja(tiendaNombre: string, datos: DatosDescripcionAbono): string {
  return `${tiendaNombre.trim()} · ${descripcionAbonoEnTienda(datos)}`;
}

/**
 * Contra-asiento de una ANULACION (R31/R33): la descripcion original precedida de «Anulación · ». NO
 * lleva el motivo de la anulacion, que vive en su propia tabla (mismo criterio que
 * `descripcionAnulacionPagoPorCuenta`).
 */
export function descripcionAnulacionAbono(descripcionOriginal: string): string {
  return `Anulación · ${descripcionOriginal}`;
}
