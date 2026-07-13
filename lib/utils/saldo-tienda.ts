import { Prisma } from "@prisma/client";
import type { SaldoTiendaDTO } from "@/lib/types/wallet-tienda";

/**
 * Feature 43 (design §1.4, R16/R17) — DERIVA el saldo a favor de una tienda a partir de los
 * totales de creditos (COD recaudado) y debitos (descuentos de Ordenex + pagos). Funcion
 * PURA, money-safe: resta con `Prisma.Decimal`, salida STRING escala 2. El saldo PUEDE ser
 * negativo (p.ej. una tienda con solo devoluciones DEBE el flete de devolucion -> "-123.45").
 * Espejo estructural de `lib/utils/wallet-balance.ts`. Nunca lee un saldo mutable almacenado.
 */
export function derivarSaldoTienda(
  creditos: string | Prisma.Decimal,
  debitos: string | Prisma.Decimal,
): SaldoTiendaDTO {
  const cred = new Prisma.Decimal(creditos);
  const deb = new Prisma.Decimal(debitos);
  const saldo = cred.sub(deb);

  const signo: SaldoTiendaDTO["signo"] = saldo.gt(0)
    ? "positivo"
    : saldo.lt(0)
      ? "negativo"
      : "cero";

  return {
    creditos: cred.toFixed(2),
    debitos: deb.toFixed(2),
    saldo: saldo.toFixed(2),
    signo,
  };
}
