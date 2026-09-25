// Ficha 461 (design §5.5, R7) — las lineas del libro de la CAJA de un COBRO de Ordenex a una tienda
// y de su anulacion. Funciones PURAS: sin Prisma, sin HTTP.
//
// NINGUNA lleva un identificador interno (R7/R52): el enlace al cobro lo dan `origen_tipo`/
// `origen_id` del movimiento. El debito de la TIENDA conserva la descripcion que tecleo la persona,
// tal cual (R7): estas funciones solo componen lo que va a la caja y los dos contra-asientos.
//
// Misma composicion que la migracion de datos (`20260926120200_cobro_tienda_461_completar_caja`):
// «{Tienda} · {descripcion}» con `concat_ws`, asi que una linea completada y una del servicio se leen
// igual. El nombre de la tienda lo trae quien llama (nombre + primer apellido, `etiquetaDePersona`).

const SEPARADOR = " · ";

/**
 * Libro de la CAJA: `{Tienda} · {descripcion del cobro}`. En la caja conviven los cobros a todas las
 * tiendas y sin el nombre no se sabe a quien se le cobro. Las partes vacias se omiten (como
 * `concat_ws`), asi que un cobro sin descripcion —imposible por el borde, pero el tipo lo admite—
 * no deja un separador suelto.
 */
export function descripcionCobroEnCaja(tiendaNombre: string, descripcion: string | null): string {
  return [tiendaNombre, descripcion ?? ""]
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(SEPARADOR);
}

/**
 * Contra-asiento de una ANULACION (R10/R11): la descripcion original precedida de «Anulación · ».
 * NO lleva el motivo de la anulacion, que vive en `cobro_tienda_anulacion` (mismo criterio que
 * `descripcionAnulacionPagoPorCuenta` y que `descripcionDeAnulacion` del pago a tienda).
 */
export function descripcionAnulacionCobro(descripcionOriginal: string | null): string {
  const original = (descripcionOriginal ?? "").trim();
  return original.length > 0 ? `Anulación${SEPARADOR}${original}` : "Anulación";
}
