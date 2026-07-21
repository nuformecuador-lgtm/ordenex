"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { WalletBalanceDTO } from "@/lib/types/wallet";

import { money } from "./wallet-labels";

// Feature 42 (T12, R16/R17/R21) — tarjeta del balance general DERIVADO. Recibe el
// balance ya serializado (STRING + signo) por props desde el módulo; el signo lo da el
// backend (`positivo`/`negativo`/`cero`), no se recalcula en cliente. Money-safe: los
// tres montos (ingresos/egresos/balance) se renderizan TAL CUAL con `money`, sin
// parseFloat/Number. El balance puede venir negativo ("-123.45").

const SIGNO_BADGE: Record<
  WalletBalanceDTO["signo"],
  { variant: "default" | "secondary" | "destructive" | "outline"; label: string }
> = {
  positivo: { variant: "default", label: "Positivo" },
  negativo: { variant: "destructive", label: "Negativo" },
  cero: { variant: "secondary", label: "En cero" },
};

/** Color del monto del balance según su signo (verde/rojo/neutro). */
const BALANCE_COLOR: Record<WalletBalanceDTO["signo"], string> = {
  positivo: "text-success-strong",
  negativo: "text-danger-strong",
  cero: "text-muted-foreground",
};

export interface WalletBalanceCardProps {
  balance: WalletBalanceDTO;
}

export function WalletBalanceCard({ balance }: WalletBalanceCardProps) {
  const badge = SIGNO_BADGE[balance.signo];

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-2">
        <section
          aria-label="Balance general"
          className="flex flex-col gap-1"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Balance general</span>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          <span
            className={`text-3xl font-semibold tracking-tight ${BALANCE_COLOR[balance.signo]}`}
          >
            {money(balance.balance)}
          </span>
        </section>

        <div className="grid grid-cols-2 gap-4 border-t pt-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-muted-foreground">Ingresos</span>
            <span className="text-lg font-medium text-success-strong">
              {money(balance.ingresos)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-muted-foreground">Egresos</span>
            <span className="text-lg font-medium text-danger-strong">
              {money(balance.egresos)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
