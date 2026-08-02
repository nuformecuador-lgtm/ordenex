import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { MetodoPagoValue } from "@prisma/client";
import { METODO_PAGO_SEED } from "@/lib/types/metodo-pago";
import { montoPositivoSchema } from "@/lib/types/wallet";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

// Feature 172 (design §3.2) — contratos I/O de la LIQUIDACION en la frontera Server Action ->
// cliente, y los schemas zod del BORDE. Money-critical: ningun `number` cruza la frontera
// (R14); todo monto viaja como STRING con 2 decimales y solo se convierte a `Prisma.Decimal`
// al escribir. Cero `parseFloat` y cero `Number(` sobre montos, aqui y en sus tests.
//
// Los DTO NO emiten `mensajeroId`, `tiendaId`, `cierreId`, `registradoPor`, `anuladoPor` ni la
// clave de idempotencia: son identificadores internos y la guardia de columnas de descarga los
// rechaza (R56). El `id` del pago si viaja —es lo que la pantalla necesita para pedir su
// anulacion— pero no se pinta ni se descarga.

/**
 * R8 — el catalogo de metodos de pago es EXACTAMENTE el del recaudo de una entrega (feature
 * 36), sin declarar uno propio: se deriva del SEED, que a su vez esta atado por `satisfies` al
 * enum Postgres `metodo_pago_value`. La guardia de abajo rompe el build si el enum ganara un
 * valor que este tipo no cubre.
 */
export type MetodoLiquidacion = (typeof METODO_PAGO_SEED)[number];

type _EnsureMetodoExhaustive = Exclude<MetodoPagoValue, MetodoLiquidacion> extends never
  ? true
  : never;
const _metodoExhaustive: _EnsureMetodoExhaustive = true;
void _metodoExhaustive;

/**
 * R11 — TOPE del monto, DERIVADO DE LA COLUMNA y no elegido a ojo (molde:
 * `INDEMNIZACION_MONTO_MAX` de la 158). `liquidacion_pago.monto` es `DECIMAL(12,2)`:
 * precision 12, escala 2 -> 12 - 2 = **10 digitos enteros** -> el mayor valor representable es
 * `9999999999.99`. Un centimo mas y Postgres responde `numeric field overflow`.
 *
 * Se declara AQUI y no se importa el de la 158: aquel esta derivado de
 * `gestion_orden.indemnizacion` y su docstring lo dice. Coinciden en valor porque coinciden en
 * precision, no porque sean el mismo limite; si una de las dos columnas cambiara, importarlo
 * habria propagado el numero equivocado en silencio.
 *
 * El rechazo ocurre en el BORDE, como `validation_error` por campo, ANTES de abrir la
 * transaccion del dinero.
 */
const LIQUIDACION_MONTO_DIGITOS_ENTEROS = 10; // = precision(12) - escala(2)
export const LIQUIDACION_MONTO_MAX = `${"9".repeat(LIQUIDACION_MONTO_DIGITOS_ENTEROS)}.99`;

/**
 * R13 — tope de la nota libre. La columna es `text` (ilimitada en Postgres), asi que el limite
 * vive en el borde y se puede ajustar sin tocar el modelo. Molde: `NOTA_MAX` de la 116.
 */
export const LIQUIDACION_NOTA_MAX = 500;

/**
 * R11 — monto STRING con hasta 2 decimales y > 0 (`montoPositivoSchema`, reutilizado de la
 * wallet: la misma regla money-safe que ya valida los egresos), acotado ademas por arriba a lo
 * que la columna puede representar.
 */
const montoLiquidacionSchema = montoPositivoSchema.refine((v) => {
  try {
    return new Prisma.Decimal(v).lte(LIQUIDACION_MONTO_MAX);
  } catch {
    // Zod v4 corre este refine AUNQUE el regex de `montoPositivoSchema` ya haya fallado. Un
    // valor no numerico no es un problema DE TOPE: se devuelve `true` para no anadir un
    // mensaje enganoso, y el regex + el `> 0` lo rechazan igual con el suyo.
    return true;
  }
}, `El monto no puede superar ${LIQUIDACION_MONTO_MAX}.`);

/**
 * R10 — la fecha REAL del pago es una fecha CALENDARIO `YYYY-MM-DD` y NO puede ser posterior al
 * dia en curso **de Costa Rica**. El dia de hoy se resuelve con `fechaCalendarioCR` (UTC-6
 * fijo) y NO con los campos UTC de `new Date()`: entre las 18:00 y la medianoche de CR el dia
 * UTC ya es el siguiente y "mañana" pasaria por "hoy" (off-by-one). La comparacion es
 * lexicografica: `YYYY-MM-DD` ordena igual como texto que como fecha.
 *
 * Un dia INEXISTENTE (`2026-02-31`) tambien se rechaza, y hace falta el ROUND-TRIP para
 * cazarlo: al contrario de lo que se suele suponer, V8 **no** devuelve `Invalid Date` con el
 * dia desbordado —`new Date("2026-02-31T00:00:00.000Z")` es el 3 de marzo—, solo con el mes
 * (`2026-13-01`). Comprobado en este repo; hay un test que lo fija.
 */
export function esFechaPagoValida(value: string, now: Date = new Date()): boolean {
  const dia = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(dia.getTime())) return false;
  if (dia.toISOString().slice(0, 10) !== value) return false;
  return value <= fechaCalendarioCR(now);
}

const fechaPagoSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha del pago debe tener el formato YYYY-MM-DD.")
  .refine((v) => esFechaPagoValida(v), "La fecha del pago no puede ser posterior a hoy.");

/**
 * [P6]/R12 — la referencia es OBLIGATORIA en SINPE y transferencia (un pago electronico sin
 * referencia no se puede conciliar) y OPCIONAL en efectivo. Se emite en el campo `referencia`
 * para que la pantalla la pinte donde toca.
 */
function exigirReferenciaEnPagoElectronico(
  valor: { metodo: MetodoLiquidacion; referencia?: string },
  ctx: z.RefinementCtx,
): void {
  if (valor.metodo !== "efectivo" && !valor.referencia) {
    ctx.addIssue({
      code: "custom",
      path: ["referencia"],
      message: "La referencia es obligatoria en SINPE y transferencia.",
    });
  }
}

// Campos comunes a los dos registros de pago. Lo unico que cambia entre ellos es CONTRA QUE se
// registra: un cierre aprobado (mensajero) o la tienda entera (decision 4 del humano).
const camposComunesDelPago = {
  // §4.1: uuid generado por el CLIENTE al ABRIR el formulario. La columna es UNIQUE, asi que
  // la proteccion contra el doble pago es DE DATOS (R44), no un `if` previo.
  claveIdempotencia: z.string().uuid(),
  monto: montoLiquidacionSchema,
  metodo: z.enum(METODO_PAGO_SEED),
  referencia: z.string().trim().optional(),
  nota: z
    .string()
    .max(LIQUIDACION_NOTA_MAX, `La nota no puede superar ${LIQUIDACION_NOTA_MAX} caracteres.`)
    .optional(),
  fechaPago: fechaPagoSchema,
};

/**
 * R21 — un pago a un mensajero va SIEMPRE atado a un cierre aprobado concreto. `.strict()`:
 * cualquier clave desconocida —empezando por un campo de archivo adjunto, que R15 [P7] prohibe—
 * muere en el borde con `validation_error`, sin escribir nada.
 */
export const registrarPagoMensajeroSchema = z
  .object({ ...camposComunesDelPago, cierreId: z.string().uuid() })
  .strict()
  .superRefine(exigirReferenciaEnPagoElectronico);

/**
 * R29 — el pago a una tienda va contra su SALDO ACUMULADO y no admite cierre: `cierreId` no
 * esta en este schema y `.strict()` lo rechaza si alguien lo cuela.
 */
export const registrarPagoTiendaSchema = z
  .object({ ...camposComunesDelPago, tiendaId: z.string().uuid() })
  .strict()
  .superRefine(exigirReferenciaEnPagoElectronico);

/**
 * R70/R72 — la anulacion NO lleva monto: el del contraasiento se lee del pago original, en el
 * servidor. `.strict()` es lo que impide que un `monto` colado en la peticion llegue siquiera
 * al servicio. El motivo es obligatorio y no vacio.
 */
export const anularPagoSchema = z
  .object({
    pagoId: z.string().uuid(),
    motivo: z.string().trim().min(1, "El motivo de la anulacion es obligatorio."),
  })
  .strict();

export type RegistrarPagoMensajeroInput = z.infer<typeof registrarPagoMensajeroSchema>;
export type RegistrarPagoTiendaInput = z.infer<typeof registrarPagoTiendaSchema>;
export type AnularPagoInput = z.infer<typeof anularPagoSchema>;

// ── DTOs de salida (frontera Server Action -> cliente). Montos SIEMPRE STRING (R14) ──

/** R74 — el bloque de anulacion que acompana a un pago anulado. NOMBRE, no id (R56). */
export type AnulacionDTO = {
  motivo: string;
  anuladoPorNombre: string;
  anuladoAt: string; // ISO — instante de la anulacion (R73)
};

/** R49/R50/R74 — el comprobante tal y como se lista, anulado o no. */
export type PagoRegistradoDTO = {
  id: string;
  monto: string; // STRING 2 dec
  metodo: MetodoLiquidacion;
  referencia: string | null;
  nota: string | null;
  fechaPago: string; // "YYYY-MM-DD" — fecha REAL del pago
  registradoPorNombre: string;
  registradoAt: string; // ISO — instante de registro
  anulacion: AnulacionDTO | null; // null = vigente (R74)
};

/**
 * Resultado de registrar. `ya_registrado` es la respuesta idempotente (R43/R47) y devuelve el
 * MISMO comprobante; `excede` informa de cuanto queda disponible [P1] (R25/R31); `sin_saldo`
 * cubre la tienda sin saldo a favor (R32) y `cierre_no_aprobado` el cierre que no lo esta (R20).
 */
export type RegistrarPagoResult =
  | { status: "ok"; pago: PagoRegistradoDTO; restante: string }
  | { status: "ya_registrado"; pago: PagoRegistradoDTO; restante: string }
  | { status: "excede"; disponible: string }
  | { status: "sin_saldo" }
  | { status: "cierre_no_aprobado" }
  | { status: "no_encontrado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

/** Resultado de anular. `ya_anulado` es lo que devuelve el segundo intento (R75). */
export type AnularPagoResult =
  | { status: "ok"; pago: PagoRegistradoDTO; restante: string }
  | { status: "ya_anulado"; pago: PagoRegistradoDTO }
  | { status: "no_encontrado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
