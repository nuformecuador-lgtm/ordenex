import type { MetodoLiquidacion } from "@/lib/types/liquidacion";

// Feature 172 (design §3.3) — dos piezas PURAS que la liquidacion necesita para componer el
// movimiento que nace de un pago: como se fecha y que dice su linea del libro. Sin efectos, sin
// Prisma y sin HTTP: se prueban con una llamada.

/**
 * Etiqueta legible de cada metodo. `Record` EXHAUSTIVO sobre `MetodoLiquidacion`: si el enum
 * `metodo_pago_value` ganara un valor, el build rompe aqui en vez de emitir una descripcion
 * vacia en el libro.
 *
 * No se importa `METODO_PAGO_LABEL` de `app/(app)/mis-asignaciones/_components/`: es un modulo
 * de PANTALLA y `lib/` no depende de `app/`. Coinciden en contenido porque describen el mismo
 * catalogo, no porque uno sea la fuente del otro.
 */
const ETIQUETA_METODO: Record<MetodoLiquidacion, string> = {
  efectivo: "Efectivo",
  SINPE: "SINPE",
  transferencia: "Transferencia",
};

/**
 * Linea del libro del beneficiario para el movimiento que nace de un pago: `"SINPE · 1234567"`,
 * o `"Efectivo"` cuando no hay referencia (la referencia solo es obligatoria en los metodos
 * electronicos, [P6]/R12).
 *
 * Es DENORMALIZACION DELIBERADA (design §3.3): sin ella la linea diria solo «Pago a la tienda» y
 * para saber COMO se pago habria que abrir otra lista. El dato canonico sigue siendo el de
 * `liquidacion_pago`; esto es una copia de conveniencia.
 *
 * NO lleva la NOTA (texto libre, puede ser largo y personal) ni NINGUN identificador: el enlace
 * al documento ya lo da `origen_tipo`/`origen_id` del movimiento (R38). Hay un test que lo fija.
 */
export function descripcionDePago(
  metodo: MetodoLiquidacion,
  referencia: string | null,
): string {
  const etiqueta = ETIQUETA_METODO[metodo];
  const ref = referencia?.trim();
  return ref ? `${etiqueta} · ${ref}` : etiqueta;
}

/**
 * Linea del libro para el CONTRAASIENTO de una anulacion (T F.2, design §6.2): la misma
 * descripcion del pago, precedida de la palabra que dice que es su reverso —
 * `"Anulación de pago · SINPE · 1234567"`.
 *
 * Se compone SOBRE `descripcionDePago` y no en paralelo: asi las dos lineas que cuelgan del
 * mismo documento se leen seguidas en el libro y no hay dos formas de nombrar el mismo pago.
 *
 * **NO lleva el MOTIVO de la anulacion**, por el mismo criterio que la del pago no lleva la
 * nota: es texto libre del usuario, puede ser largo y personal, y su sitio canonico es
 * `liquidacion_anulacion.motivo`, que la lista de comprobantes ya muestra (R74). Tampoco lleva
 * ningun identificador: el enlace al documento lo da `origen_tipo`/`origen_id` del movimiento.
 */
export function descripcionDeAnulacion(
  metodo: MetodoLiquidacion,
  referencia: string | null,
): string {
  return `Anulación de pago · ${descripcionDePago(metodo, referencia)}`;
}

/**
 * MEDIANOCHE UTC de una fecha calendario `YYYY-MM-DD` (design §2.4, R37).
 *
 * Trampa de fechas, resuelta y declarada en el diseño: el movimiento del pago NO se fecha con
 * `inicioDelDiaCREnUtc` (06:00Z). Los filtros de rango de los dos desgloses usan
 * `z.coerce.date()` sobre `YYYY-MM-DD` —que produce medianoche UTC— y comparan
 * `fecha_movimiento >= desde` / `<= hasta`. Con 06:00Z el pago quedaria FUERA de su propio dia
 * al filtrar por `hasta`; con medianoche UTC entra por los dos lados. Es ademas la convencion
 * que ya usa el repo para las columnas `@db.Date` (`fecha_reprogramacion`, features 36/46).
 *
 * `fecha` debe venir ya validada como `YYYY-MM-DD` por el borde (`fechaPagoSchema`).
 */
export function medianocheUtcDelDia(fecha: string): Date {
  return new Date(`${fecha}T00:00:00.000Z`);
}
