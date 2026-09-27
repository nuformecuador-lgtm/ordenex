import { z } from "zod";

import type { EstadoCaja } from "@/lib/types/wallet";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B (design §3.7, R58) — «Cómo quedó»: la caja y la cuenta afectada TRAS un movimiento.
// Solo lectura; sin derivaciones nuevas (`derivarCaja`, `derivarSaldoTienda`, `derivarCuentaPorPagar`).
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** La fila de un libro (el panel «Ver» abre filas; los documentos se ven por su fila). `.strict()`. */
export const comoQuedoSchema = z
  .object({
    destino: z
      .object({
        libro: z.enum(["caja", "tienda", "mensajero"]),
        movimientoId: z.string().uuid(),
      })
      .strict(),
  })
  .strict();

export type ComoQuedoInput = z.infer<typeof comoQuedoSchema>;

export interface ComoQuedoDTO {
  /**
   * La caja tras el movimiento (orden `fecha_movimiento, created_at, id`). Para una fila de una cuenta,
   * tras SU contrapartida en la caja; `null` si el movimiento no tiene linea de caja (p. ej. el pago a un
   * mensajero, [P2] de la 173). `rotulo` = el ESTADO de la caja HOY (el texto lo pone la pantalla).
   */
  caja: {
    cifraPrincipal: string;
    rotulo: EstadoCaja;
    ganancia: string;
    deTiendas: string;
    capital: string;
  } | null;
  /**
   * El saldo de la cuenta afectada tras el movimiento (la ventana de §3.2). Para una fila de la caja,
   * la UNICA cuenta de su contrapartida; `null` si no la tiene o si la contrapartida toca varias cuentas
   * (la aprobacion de un cierre reparte entre muchas tiendas).
   */
  cuenta: { tipo: "tienda" | "mensajero"; id: string; saldo: string } | null;
}

export type ComoQuedoResult =
  | { status: "ok"; comoQuedo: ComoQuedoDTO }
  | { status: "no_encontrado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
