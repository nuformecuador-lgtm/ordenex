"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SaldoTiendaDTO } from "@/lib/types/wallet-tienda";

import { money } from "./mi-wallet-labels";

// Feature 43 (T15, R17/R21) — tarjeta del SALDO A FAVOR de la tienda (cuanto le debe
// entregar Ordenex). Recibe el saldo ya serializado (STRING + signo) por props desde el
// modulo; el signo lo da el backend (`positivo`/`negativo`/`cero`), no se recalcula en
// cliente. El saldo puede ser NEGATIVO (la tienda debe a Ordenex, p. ej. por devoluciones):
// se muestra con color rojo y el STRING tal cual (que ya trae "-"). Money-safe: los tres
// montos (creditos/debitos/saldo) se renderizan TAL CUAL con `money`, sin parseFloat/Number.

const SIGNO_BADGE: Record<
  SaldoTiendaDTO["signo"],
  { variant: "default" | "secondary" | "destructive" | "outline"; label: string }
> = {
  positivo: { variant: "default", label: "A favor" },
  negativo: { variant: "destructive", label: "En contra" },
  cero: { variant: "secondary", label: "En cero" },
};

/** Color del monto del saldo segun su signo (verde a favor / rojo en contra / neutro). */
const SALDO_COLOR: Record<SaldoTiendaDTO["signo"], string> = {
  positivo: "text-success-strong",
  negativo: "text-danger-strong",
  cero: "text-muted-foreground",
};

export interface SaldoTiendaCardProps {
  saldo: SaldoTiendaDTO;
}

export function SaldoTiendaCard({ saldo }: SaldoTiendaCardProps) {
  const badge = SIGNO_BADGE[saldo.signo];

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-2">
        <section aria-label="Saldo a favor" className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Saldo a favor</span>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          <span
            className={`text-3xl font-semibold tracking-tight ${SALDO_COLOR[saldo.signo]}`}
          >
            {money(saldo.saldo)}
          </span>
        </section>

        <div className="grid grid-cols-2 gap-4 border-t pt-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-muted-foreground">Créditos (COD)</span>
            <span className="text-lg font-medium text-success-strong">
              {money(saldo.creditos)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-muted-foreground">Débitos</span>
            <span className="text-lg font-medium text-danger-strong">
              {money(saldo.debitos)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
