import { z } from "zod";

import type { AnulacionDeFilaDTO, RegistroDTO } from "@/lib/types/estado-cuenta";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B (design §3.4, R56/R57) — «A quien» y «Registro» de las filas del libro de la caja.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// La pantalla (458-E) pide la autoria de las filas de la pagina que ya tiene, por sus ids (que viajan
// y nunca se pintan). Tope de la lista = el tope de la pagina del libro (100). Todo NOMBRE, nunca un id
// (H6); el id de la cuenta solo va para el enlace al estado de cuenta (D1).

export const autoriaLibroCajaSchema = z
  .object({
    movimientoIds: z.array(z.string().uuid()).min(1).max(100),
  })
  .strict();

export type AutoriaLibroCajaInput = z.infer<typeof autoriaLibroCajaSchema>;

/** R56 — a quien se le pago (o de quien vino) el dinero de una fila. */
export interface AQuienDTO {
  /** Tienda, mensajero, persona o proveedor; `null` = una fila anterior a la 458 sin anotacion («—»). */
  nombre: string | null;
  /** Solo el pago de un gasto de una tienda (459): el tercero al que se le pago («a Facebook»). */
  beneficiario: string | null;
  /** El estado de cuenta al que enlazar (tienda o mensajero). Viaja, no se pinta. */
  cuenta: { tipo: "tienda" | "mensajero"; id: string } | null;
  /** El aporte de capital: «Ordenex». */
  esOrdenex: boolean;
}

/**
 * Ficha 458-C (revision M1, R58) — «Como»: el metodo y la referencia del documento de la fila (pago a
 * una tienda o a un mensajero, pago de un gasto de una tienda, pago de una tienda a Ordenex) o la
 * referencia anotada a mano (sueldo, gasto, correccion). `null` = la fila no tiene ninguno de los dos.
 */
export interface ComoDTO {
  metodo: "efectivo" | "SINPE" | "transferencia" | null;
  referencia: string | null;
}

export interface AutoriaDeFilaDTO {
  movimientoId: string;
  aQuien: AQuienDTO;
  registro: RegistroDTO;
  /** Ficha 458-C (M1, R58) — como se pago; `null` = la fila no lo registra. */
  como: ComoDTO | null;
  /**
   * Ficha 458-C (M1, R58) — quien anulo el documento de la fila ORIGINAL, cuando (dia CR) y con que
   * motivo, leido de SU constancia. `null` = vigente, un contra-asiento, o anulada sin constancia (un
   * reverso de antes de la 458: el libro ya dice «motivo no registrado»).
   */
  anulacion: AnulacionDeFilaDTO | null;
}

export type AutoriaLibroCajaResult =
  | { status: "ok"; filas: AutoriaDeFilaDTO[] }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
