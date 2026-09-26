import { z } from "zod";

import {
  LIQUIDACION_REFERENCIA_MAX,
  fechaPagoSchema,
  montoLiquidacionSchema,
  type MetodoLiquidacion,
} from "@/lib/types/liquidacion";
import { METODO_PAGO_SEED } from "@/lib/types/metodo-pago";
import { comprobanteSchema, type ObtenerComprobanteResult } from "@/lib/types/pago-por-cuenta-tienda";
import { claveIdempotenciaSchema } from "@/lib/types/wallet";
import type { SaldoTiendaDTO } from "@/lib/types/wallet-tienda";

// FICHA 457 (design §7) — el PAGO DE UNA TIENDA A ORDENEX (tecnico: `abono_tienda`): el dinero que una
// tienda con saldo en contra le entrega a Ordenex. Documento propio; credito en su libro; ingreso de
// TERCEROS en la caja (DH1). Montos SIEMPRE STRING (R5).

/** R6 — tope del motivo, medido tras recortar. */
export const ABONO_TIENDA_MOTIVO_MAX = 200;

/**
 * R4–R9, R12, R13 — el registro. `.strict()`: una clave no prevista muere en el borde (R12). La fecha
 * es la del pago a tienda de la 172 (`fechaPagoSchema`: dia existente y no posterior a hoy en CR, SIN
 * ventana hacia atras: D3). La referencia es obligatoria en SINPE y transferencia (R7), con el MISMO
 * criterio y el mismo texto que el pago de un gasto de la 459. El comprobante es el compartido de la
 * wallet (R26), opcional (R30).
 */
export const registrarAbonoTiendaSchema = z
  .object({
    claveIdempotencia: claveIdempotenciaSchema,
    tiendaId: z.string().uuid("Elegí la tienda que paga."),
    monto: montoLiquidacionSchema,
    metodo: z.enum(METODO_PAGO_SEED),
    referencia: z
      .string()
      .trim()
      .max(
        LIQUIDACION_REFERENCIA_MAX,
        `La referencia no puede superar ${LIQUIDACION_REFERENCIA_MAX} caracteres.`,
      )
      .optional(),
    motivo: z
      .string()
      .trim()
      .min(1, "El motivo es obligatorio.")
      .max(ABONO_TIENDA_MOTIVO_MAX, `El motivo no puede superar ${ABONO_TIENDA_MOTIVO_MAX} caracteres.`),
    fechaPago: fechaPagoSchema,
    comprobante: comprobanteSchema.optional(),
  })
  .strict()
  .superRefine((valor, ctx) => {
    if (valor.metodo !== "efectivo" && !valor.referencia) {
      ctx.addIssue({
        code: "custom",
        path: ["referencia"],
        message: "La referencia es obligatoria en SINPE y transferencia.",
      });
    }
  });

export type RegistrarAbonoTiendaInput = Omit<z.infer<typeof registrarAbonoTiendaSchema>, "comprobante">;

/** R34/R35 — la anulacion: el pago y un motivo. SIN monto (R34): el del documento manda. */
export const anularAbonoTiendaSchema = z
  .object({
    abonoId: z.string().uuid(),
    motivo: z.string().trim().min(1, "El motivo de la anulación es obligatorio."),
  })
  .strict();

export type AnularAbonoTiendaInput = z.infer<typeof anularAbonoTiendaSchema>;

/** R42 — pedir el enlace temporal del comprobante. */
export const obtenerComprobanteAbonoSchema = z.object({ abonoId: z.string().uuid() }).strict();

// ── DTOs (frontera Server Action -> cliente). Sin `tiendaId`, sin ids de usuario, sin la clave de
// idempotencia y sin la ruta del comprobante (R48). El `id` del documento SI viaja: es lo que la
// pantalla devuelve para anular, igual que el `origenId` del libro. ──

export type AbonoTiendaDTO = {
  id: string;
  tiendaNombre: string;
  monto: string; // STRING escala 2
  metodo: MetodoLiquidacion;
  referencia: string | null;
  motivo: string;
  fechaPago: string; // YYYY-MM-DD (la fecha REAL del pago)
  registradoPorNombre: string;
  registradoAt: string; // ISO
  anulado: boolean;
  tieneComprobante: boolean;
};

/**
 * R14/R15/R18/R25 — la respuesta del registro. `sin_deuda` y `excede` traen el saldo/la deuda que el
 * SERVIDOR leyo bajo el candado, para que el dialogo pinte el importe sin recalcular nada (R58).
 * `deuda` es el valor ABSOLUTO del saldo en contra, STRING escala 2.
 */
export type RegistrarAbonoTiendaResult =
  | { status: "ok"; abono: AbonoTiendaDTO; saldo: SaldoTiendaDTO }
  | { status: "ya_registrado"; abono: AbonoTiendaDTO; saldo: SaldoTiendaDTO }
  | { status: "sin_deuda"; saldo: SaldoTiendaDTO }
  | { status: "excede"; deuda: string }
  | { status: "comprobante_no_guardado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

export type AnularAbonoTiendaResult =
  | { status: "ok"; saldo: SaldoTiendaDTO }
  | { status: "ya_anulado" }
  | { status: "no_encontrado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

/** R42–R44 — la MISMA forma que el comprobante del pago de un gasto (design §7). */
export type ObtenerComprobanteAbonoResult = ObtenerComprobanteResult;
