import { Prisma } from "@prisma/client";
import type { WalletBalanceDTO } from "@/lib/types/wallet";

/**
 * Feature 42 (design §1.4, R16/R17) — DERIVA el balance de la wallet a partir de los
 * totales de ingresos y egresos. Funcion PURA, money-safe: resta con `Prisma.Decimal`,
 * salida STRING escala 2 (el balance puede ser negativo, p.ej. "-123.45"). El signo es
 * explicito (positivo/negativo/cero). Nunca lee un saldo mutable almacenado.
 */
export function derivarBalance(ingresos: string | Prisma.Decimal, egresos: string | Prisma.Decimal): WalletBalanceDTO {
  const ing = new Prisma.Decimal(ingresos);
  const egr = new Prisma.Decimal(egresos);
  const balance = ing.sub(egr);

  const signo: WalletBalanceDTO["signo"] = balance.gt(0)
    ? "positivo"
    : balance.lt(0)
      ? "negativo"
      : "cero";

  return {
    ingresos: ing.toFixed(2),
    egresos: egr.toFixed(2),
    balance: balance.toFixed(2),
    signo,
  };
}
