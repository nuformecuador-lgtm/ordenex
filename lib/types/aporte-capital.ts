import { z } from "zod";

import { montoLiquidacionSchema } from "@/lib/types/liquidacion";
import { comprobanteSchema, PAGO_POR_CUENTA_MOTIVO_MAX } from "@/lib/types/pago-por-cuenta-tienda";
import { esFechaCalendarioValida, fechaCalendarioCR } from "@/lib/utils/fecha-cr";

// FICHA 459 (design §6.2/§7.2, P1/P7/P8) — el SALDO INICIAL o APORTE DE CAPITAL: dinero de Ordenex
// que entra a la caja y NO es ganancia. Lo teclea una persona; la app NUNCA propone, precalcula
// ni sugiere un importe (R27, HF4). Montos SIEMPRE STRING.

/** Las dos clases (R69). Texto con CHECK en la base, no enum: su `down` es un `DROP TABLE`. */
export const CLASE_APORTE_CAPITAL_SEED = ["saldo_inicial", "aporte"] as const;
export type ClaseAporteCapital = (typeof CLASE_APORTE_CAPITAL_SEED)[number];

/**
 * R69 — la fecha: dia que existe y no posterior a hoy en Costa Rica. SIN ventana hacia atras
 * (P7): el saldo inicial se fecha el dia en que empezo la app, que puede quedar lejos. El tope
 * del saldo inicial contra el primer movimiento de la caja (R71) lo aplica el servicio, que es
 * quien puede leer la caja.
 */
export const fechaAporteCapitalSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener el formato YYYY-MM-DD.")
  .superRefine((v, ctx) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    if (!esFechaCalendarioValida(v)) {
      ctx.addIssue({ code: "custom", message: "Esa fecha no existe en el calendario." });
      return;
    }
    if (v > fechaCalendarioCR(new Date())) {
      ctx.addIssue({ code: "custom", message: "La fecha no puede ser posterior a hoy." });
    }
  });

/** R68/R69 — el registro. `.strict()`: una clave no prevista muere en el borde. */
export const registrarAporteCapitalSchema = z
  .object({
    claveIdempotencia: z.string().uuid(),
    clase: z.enum(CLASE_APORTE_CAPITAL_SEED, {
      error: "Elija si es el saldo inicial o un aporte de capital.",
    }),
    monto: montoLiquidacionSchema,
    fecha: fechaAporteCapitalSchema,
    motivo: z
      .string()
      .trim()
      .min(1, "El motivo es obligatorio.")
      .max(
        PAGO_POR_CUENTA_MOTIVO_MAX,
        `El motivo no puede superar ${PAGO_POR_CUENTA_MOTIVO_MAX} caracteres.`,
      ),
    comprobante: comprobanteSchema.optional(),
  })
  .strict();

export type RegistrarAporteCapitalInput = Omit<
  z.infer<typeof registrarAporteCapitalSchema>,
  "comprobante"
>;

/** R74 — la anulacion: el documento y un motivo. Sin monto. */
export const anularAporteCapitalSchema = z
  .object({
    aporteId: z.string().uuid(),
    motivo: z.string().trim().min(1, "El motivo de la anulacion es obligatorio."),
  })
  .strict();

export type AnularAporteCapitalInput = z.infer<typeof anularAporteCapitalSchema>;

export const obtenerComprobanteAporteCapitalSchema = z
  .object({ aporteId: z.string().uuid() })
  .strict();

/** DTO sin ids de usuario, sin clave y sin ruta de comprobante (R58/R100). */
export type AporteCapitalDTO = {
  id: string;
  clase: ClaseAporteCapital;
  monto: string; // STRING escala 2
  motivo: string;
  fecha: string; // YYYY-MM-DD
  registradoPorNombre: string;
  registradoAt: string;
  anulado: boolean;
  tieneComprobante: boolean;
};

export type RegistrarAporteCapitalResult =
  | { status: "ok"; aporte: AporteCapitalDTO }
  | { status: "ya_registrado"; aporte: AporteCapitalDTO }
  | { status: "ya_hay_saldo_inicial" }
  | { status: "comprobante_no_guardado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

export type AnularAporteCapitalResult =
  | { status: "ok" }
  | { status: "ya_anulado" }
  | { status: "no_encontrado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
