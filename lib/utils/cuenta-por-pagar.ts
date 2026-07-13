import { Prisma } from "@prisma/client";
import type { CuentaPorPagarDTO } from "@/lib/types/wallet-mensajero";

/**
 * Feature 44 (design §0/§4, R9) — regla money-safe `min(P, E)` del pago al mensajero. Funcion
 * PURA: dado el pago debido `P` (snapshot 39) y el efectivo recaudado `E` (snapshot 37), calcula
 * lo devengado (= P), lo pagado (= min(P, E), acotado por el efectivo en mano) y lo pendiente
 * (= P - pagado, la cuenta por pagar generada por ESE cierre). Todo con `Prisma.Decimal`
 * (comparacion exacta, sin `Number`); salida STRING escala 2. Es la fuente UNICA de la regla
 * `min(P, E)` (R9/R13): se netea POR CIERRE, nunca acumulando efectivo entre cierres.
 */
export interface SplitPago {
  devengado: string; // = P (STRING 2 dec)
  pagado: string; // = min(P, E) (STRING 2 dec, <= P y <= E)
  pendiente: string; // = P - pagado (STRING 2 dec, >= 0)
}

function round2(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function calcularSplitPago(
  pagoDebido: string | Prisma.Decimal,
  efectivo: string | Prisma.Decimal,
): SplitPago {
  const P = round2(new Prisma.Decimal(pagoDebido));
  const E = round2(new Prisma.Decimal(efectivo));
  // R9: pagado = min(P, E) (acotado por el efectivo recaudado y por el pago debido).
  const pagado = P.lte(E) ? P : E;
  // R10: pendiente = P - pagado (>= 0; si E >= P -> 0; si E = 0 -> P).
  const pendiente = P.sub(pagado);
  return {
    devengado: P.toFixed(2),
    pagado: pagado.toFixed(2),
    pendiente: pendiente.toFixed(2),
  };
}

/**
 * Feature 44 (design §1.4, R14/R16) — DERIVA la cuenta por pagar de un mensajero a partir de los
 * totales devengado (Σ tipo=devengo) y pagado (Σ tipo=pago). Funcion PURA, money-safe: resta con
 * `Prisma.Decimal`, salida STRING escala 2. En el flujo normal la cuenta por pagar es positiva
 * (Ordenex debe) o cero, NUNCA negativa (R16). Nunca lee un saldo mutable almacenado (R14).
 */
export function derivarCuentaPorPagar(
  devengado: string | Prisma.Decimal,
  pagado: string | Prisma.Decimal,
): CuentaPorPagarDTO {
  const dev = new Prisma.Decimal(devengado);
  const pag = new Prisma.Decimal(pagado);
  const cuentaPorPagar = dev.sub(pag);

  // R16: en el flujo normal nunca es negativa; positivo (Ordenex debe) o cero.
  const signo: CuentaPorPagarDTO["signo"] = cuentaPorPagar.gt(0) ? "positivo" : "cero";

  return {
    devengado: dev.toFixed(2),
    pagado: pag.toFixed(2),
    cuentaPorPagar: cuentaPorPagar.toFixed(2),
    signo,
  };
}
