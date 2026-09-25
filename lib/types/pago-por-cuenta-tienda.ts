import { z } from "zod";

import { walletComprobanteConfig } from "@/lib/config/wallet-comprobante";
import {
  LIQUIDACION_REFERENCIA_MAX,
  montoLiquidacionSchema,
  type MetodoLiquidacion,
} from "@/lib/types/liquidacion";
import { METODO_PAGO_SEED } from "@/lib/types/metodo-pago";
import type { SaldoTiendaDTO } from "@/lib/types/wallet-tienda";
import { fechaMovimientoSchema } from "@/lib/types/wallet";
import { problemaDeComprobante } from "@/lib/utils/comprobante";

// FICHA 459 (design §6.1/§7.1) — el PAGO POR CUENTA de una tienda: dinero que Ordenex SACA de la
// caja para pagarle a un tercero (su proveedor, su publicidad, su personal) en nombre de la tienda.
// Baja la caja y el saldo de la tienda; no toca la ganancia. Montos SIEMPRE STRING.

/** R31 — tope del beneficiario, medido tras recortar. */
export const PAGO_POR_CUENTA_BENEFICIARIO_MAX = 120;
/** R33 — tope del motivo, medido tras recortar. */
export const PAGO_POR_CUENTA_MOTIVO_MAX = 200;

/** Lo unico del `File` que el servidor necesita del comprobante. */
export interface ArchivoComprobanteLike {
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function esArchivo(v: unknown): v is ArchivoComprobanteLike {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as ArchivoComprobanteLike).arrayBuffer === "function" &&
    typeof (v as ArchivoComprobanteLike).size === "number" &&
    typeof (v as ArchivoComprobanteLike).type === "string"
  );
}

/**
 * R54 — el comprobante, validado en el BORDE con la MISMA pieza pura que usa el servicio. Un
 * campo vacio del formulario (el navegador manda un `File` de 0 bytes sin nombre) se trata como
 * «sin comprobante».
 */
export const comprobanteSchema = z
  .custom<ArchivoComprobanteLike>(esArchivo, "El comprobante no es un archivo.")
  .superRefine((archivo, ctx) => {
    if (archivo.size === 0) return;
    const problema = problemaDeComprobante(archivo, walletComprobanteConfig);
    if (problema !== null) ctx.addIssue({ code: "custom", message: problema });
  });

/**
 * R31–R37 — el registro. `.strict()`: una clave no prevista muere en el borde (R37). La fecha
 * usa la ventana de los movimientos manuales (R35). La referencia es obligatoria en SINPE y
 * transferencia (R34), con el MISMO criterio que el pago a tienda de la 172.
 */
export const registrarPagoPorCuentaTiendaSchema = z
  .object({
    claveIdempotencia: z.string().uuid(),
    tiendaId: z.string().uuid(),
    beneficiario: z
      .string()
      .trim()
      .min(1, "Indique a quien se le pago.")
      .max(
        PAGO_POR_CUENTA_BENEFICIARIO_MAX,
        `El beneficiario no puede superar ${PAGO_POR_CUENTA_BENEFICIARIO_MAX} caracteres.`,
      ),
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
      .max(
        PAGO_POR_CUENTA_MOTIVO_MAX,
        `El motivo no puede superar ${PAGO_POR_CUENTA_MOTIVO_MAX} caracteres.`,
      ),
    fecha: fechaMovimientoSchema.optional(),
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

export type RegistrarPagoPorCuentaTiendaInput = Omit<
  z.infer<typeof registrarPagoPorCuentaTiendaSchema>,
  "comprobante"
>;

/** R46/R49 — la anulacion: el pago y un motivo. SIN monto (R37): el del documento manda. */
export const anularPagoPorCuentaTiendaSchema = z
  .object({
    pagoId: z.string().uuid(),
    motivo: z.string().trim().min(1, "El motivo de la anulacion es obligatorio."),
  })
  .strict();

export type AnularPagoPorCuentaTiendaInput = z.infer<typeof anularPagoPorCuentaTiendaSchema>;

/** R57 — pedir el enlace temporal del comprobante. */
export const obtenerComprobantePagoPorCuentaSchema = z
  .object({ pagoId: z.string().uuid() })
  .strict();

// ── DTOs (frontera Server Action -> cliente). Sin `tiendaId`, sin ids de usuario, sin la clave de
// idempotencia y sin la ruta del comprobante (R58/R100). El `id` del documento SI viaja: es lo
// que la pantalla devuelve para anular, igual que el `origenId` del libro. ──

export type PagoPorCuentaTiendaDTO = {
  id: string;
  tiendaNombre: string;
  beneficiario: string;
  monto: string; // STRING escala 2
  metodo: MetodoLiquidacion;
  referencia: string | null;
  motivo: string;
  fechaPago: string; // YYYY-MM-DD
  registradoPorNombre: string;
  registradoAt: string; // ISO
  anulado: boolean;
  tieneComprobante: boolean;
};

export type RegistrarPagoPorCuentaTiendaResult =
  | { status: "ok"; pago: PagoPorCuentaTiendaDTO; saldo: SaldoTiendaDTO }
  | { status: "ya_registrado"; pago: PagoPorCuentaTiendaDTO; saldo: SaldoTiendaDTO }
  | { status: "comprobante_no_guardado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

export type AnularPagoPorCuentaTiendaResult =
  | { status: "ok"; saldo: SaldoTiendaDTO }
  | { status: "ya_anulado" }
  | { status: "no_encontrado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

export type ObtenerComprobanteResult =
  | { status: "ok"; url: string }
  | { status: "sin_comprobante" }
  | { status: "no_encontrado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
