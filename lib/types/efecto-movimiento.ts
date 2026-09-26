import { z } from "zod";

import { montoPositivoSchema, type EstadoCaja } from "@/lib/types/wallet";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B (design §4.1/§4.4/§6, R44–R47, R82) — «Así queda»: el catalogo de conceptos del
// registro unico y el contrato de la previsualizacion. Lectura: no escribe nada.
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Los DIEZ conceptos del registro unico (design §4.1), en los tres grupos de la 461. Es la clave de
 * `EFECTO_POR_TIPO` y de la tabla de enrutado del dialogo (458-C): un concepto nuevo no compila
 * hasta que alguien decida su efecto.
 */
export const CONCEPTO_REGISTRO_SEED = [
  // Sale
  "gasto_ordenex",
  "sueldo",
  "pago_gasto_tienda",
  "correccion_resta",
  "pago_a_tienda",
  "pago_a_mensajero",
  // Llega
  "aporte",
  "correccion_suma",
  "tienda_paga_a_ordenex",
  // Se descuenta
  "cobro_a_tienda",
] as const;

export type ConceptoRegistro = (typeof CONCEPTO_REGISTRO_SEED)[number];

/** R44 — pedir el efecto: el concepto, la cuenta (si el concepto la lleva) y el monto. `.strict()`. */
export const previsualizarMovimientoSchema = z
  .object({
    concepto: z.enum(CONCEPTO_REGISTRO_SEED),
    cuentaId: z.string().uuid().optional(),
    monto: montoPositivoSchema,
  })
  .strict();

export type PrevisualizarMovimientoInput = z.infer<typeof previsualizarMovimientoSchema>;

/** Una linea de «Así queda»: antes y despues (STRING escala 2) y si cambia (R45: «no cambia»). */
export interface LineaEfectoDTO {
  antes: string;
  despues: string;
  cambia: boolean;
}

/**
 * R44–R47 — el efecto, calculado en el SERVIDOR con `derivarCaja` y la derivacion del saldo de la
 * cuenta. `cifraPrincipal.rotulo` es el ESTADO de la caja (la pantalla elige el texto, como en la
 * 459). `cuenta` es `null` si el concepto no afecta a una cuenta. `superaDisponible` solo existe en
 * el pago a una tienda y en el pago de una tienda a Ordenex (el tope lo decide el servidor).
 */
export interface EfectoMovimientoDTO {
  lineas: {
    cuenta: (LineaEfectoDTO & { tipo: "tienda" | "mensajero" }) | null;
    cifraPrincipal: LineaEfectoDTO & { rotulo: EstadoCaja };
    ganancia: LineaEfectoDTO;
    deTiendas: LineaEfectoDTO;
    capital: LineaEfectoDTO;
  };
  /** R47 — la tienda queda con saldo en contra tras el movimiento. */
  saldoEnContra: boolean;
  superaDisponible?: boolean;
}

export type PrevisualizarMovimientoResult =
  | { status: "ok"; efecto: EfectoMovimientoDTO }
  /** La cuenta no existe o no es del tipo que el concepto pide. */
  | { status: "no_encontrado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
