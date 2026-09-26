import { z } from "zod";

import { comprobanteSchema } from "@/lib/types/pago-por-cuenta-tienda";
import { destinoMovimientoSchema } from "@/lib/types/wallet-anulacion";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B (design §4.1/§6, D6/D12, R74–R80) — el COMPROBANTE de los caminos sin documento propio:
// adjuntarlo despues (una sola vez) y verlo por un enlace temporal. Contratos de borde.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// El comprobante se nombra por el DESTINO del movimiento (la fila o su documento), nunca por su ruta en
// el bucket: la ruta no sale del servidor (R80). Tipos y tope, los de la 459 (`comprobanteSchema`, que
// usa la misma pieza pura que el servicio: `problemaDeComprobante`).

/** El destino viaja en el `FormData` como JSON (un `FormData` no anida objetos). */
const destinoEnFormData = z
  .string()
  .transform((texto, ctx) => {
    try {
      return JSON.parse(texto) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "El destino no es valido." });
      return z.NEVER;
    }
  })
  .pipe(destinoMovimientoSchema);

/** D6/R79 — adjuntar DESPUES: el destino y el archivo. `.strict()`. */
export const adjuntarComprobanteSchema = z
  .object({
    destino: destinoEnFormData,
    comprobante: comprobanteSchema,
  })
  .strict();

export type AdjuntarComprobanteInput = z.infer<typeof adjuntarComprobanteSchema>;

/** R77/R78 — ver: el destino. `.strict()`. */
export const verComprobanteSchema = z.object({ destino: destinoMovimientoSchema }).strict();

export type VerComprobanteInput = z.infer<typeof verComprobanteSchema>;

/**
 * Por que un destino no admite un comprobante LATERAL: lo que produce un cierre y los contra-asientos
 * no llevan comprobante; el pago de un gasto, el aporte y el pago de una tienda a Ordenex lo llevan
 * en SU documento y se adjunta al registrarlos (459/457).
 */
export type MotivoSinComprobanteLateral = "no_admite" | "en_su_documento";

export type AdjuntarComprobanteResult =
  | { status: "ok" }
  /** R79 — ya tenia uno: ni se reemplaza ni se suma otro. */
  | { status: "ya_tiene" }
  | { status: "no_encontrado" }
  | { status: "no_admite"; motivo: MotivoSinComprobanteLateral }
  /** R76 — no se pudo guardar el archivo: no se escribio nada. */
  | { status: "comprobante_no_guardado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

/**
 * R80 — lo que la pantalla necesita para nombrar el comprobante («Comprobante del sueldo del 12 sep»),
 * sin la ruta del objeto. `fuente` dice de donde sale `categoria`: la categoria de la fila de la caja o
 * de la tienda (`egreso_sueldo`, `cobro_manual`…), o, para un documento, su tipo (`liquidacion_pago`,
 * `pago_por_cuenta_tienda`, `aporte_capital`, `abono_tienda`). El texto lo pone la pantalla (458-C/D).
 */
export interface RotuloComprobanteDTO {
  fuente: "caja" | "tienda" | "documento";
  categoria: string;
  /** Dia CR del movimiento o del documento (`AAAA-MM-DD`). */
  fecha: string;
}

export type VerComprobanteResult =
  | { status: "ok"; url: string; contentType: string; rotulo: RotuloComprobanteDTO }
  | { status: "sin_comprobante" }
  /** R77 — ajeno o inexistente, sin distinguir. */
  | { status: "no_encontrado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
