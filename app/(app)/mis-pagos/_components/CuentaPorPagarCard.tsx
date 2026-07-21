"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CuentaPorPagarDTO } from "@/lib/types/wallet-mensajero";

import { CUENTA_COLOR, CUENTA_LABEL, SIGNO_BADGE, money } from "./mis-pagos-labels";

// Feature 44 (T15, R16/R20/R21) — tarjeta de la CUENTA POR PAGAR del mensajero (lo que
// Ordenex le debe: devengado menos lo ya pagado del efectivo). Recibe la cuenta ya
// serializada (STRING + signo) por props desde el modulo; el signo lo da el backend
// (`positivo`/`cero`), no se recalcula en cliente. La cuenta por pagar nunca es negativa en
// flujo normal (R16). Money-safe: los tres montos (devengado/pagado/cuentaPorPagar) se
// renderizan TAL CUAL con `money`, sin parseFloat/Number.

export interface CuentaPorPagarCardProps {
  cuenta: CuentaPorPagarDTO;
}

export function CuentaPorPagarCard({ cuenta }: CuentaPorPagarCardProps) {
  const badge = SIGNO_BADGE[cuenta.signo];

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-2">
        <section aria-label="Cuenta por pagar" className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {CUENTA_LABEL.cuentaPorPagar}
            </span>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          <span
            className={`text-3xl font-semibold tracking-tight ${CUENTA_COLOR[cuenta.signo]}`}
          >
            {money(cuenta.cuentaPorPagar)}
          </span>
          <span className="text-xs text-muted-foreground">
            {CUENTA_LABEL.cuentaPorPagarHint}
          </span>
        </section>

        <div className="grid grid-cols-2 gap-4 border-t pt-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-muted-foreground">{CUENTA_LABEL.devengado}</span>
            <span className="text-lg font-medium">{money(cuenta.devengado)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-muted-foreground">{CUENTA_LABEL.pagado}</span>
            <span className="text-lg font-medium text-success-strong">
              {money(cuenta.pagado)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
