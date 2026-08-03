"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DesgloseTiendaDTO, SaldoTiendaDTO } from "@/lib/types/wallet-tienda";

import {
  DESGLOSE_MI_WALLET_AVISO,
  DESGLOSE_MI_WALLET_LABEL,
  money,
} from "./mi-wallet-labels";

// Feature 43 (T15, R17/R21) — tarjeta del SALDO A FAVOR de la tienda (cuanto le debe
// entregar Ordenex). Recibe el saldo ya serializado (STRING + signo) por props desde el
// modulo; el signo lo da el backend (`positivo`/`negativo`/`cero`), no se recalcula en
// cliente. El saldo puede ser NEGATIVO (la tienda debe a Ordenex, p. ej. por devoluciones):
// se muestra con color rojo y el STRING tal cual (que ya trae "-"). Money-safe: los montos se
// renderizan TAL CUAL con `money`, sin parseFloat/Number.
//
// Feature 172 (T G.2, R55) `[P5]` — la fila de debajo pasa de DOS importes («Créditos» /
// «Débitos») a los TRES de la 171: a tu favor, cargos de Ordenex y ya pagado. El motivo es
// concreto: desde la 172 el libro de la tienda tiene movimientos `pago_tienda`, que son
// débitos igual que un flete, así que con la cabecera vieja el dinero que Ordenex le ENTREGÓ
// aparecía sumado dentro de «Débitos», indistinguible de un cargo.
//
// La clasificacion NO vive aqui: los tres importes llegan ya derivados del servidor por
// `derivarDesgloseTienda` + `CUBETA_POR_CATEGORIA` (`lib/utils/desglose-tienda.ts`), la MISMA
// funcion que alimenta la cabecera del maestro en `/wallet/tiendas`. Este componente solo
// pinta STRINGS.

/** Color del monto del saldo segun su signo (verde a favor / rojo en contra / neutro). */
const SALDO_COLOR: Record<SaldoTiendaDTO["signo"], string> = {
  positivo: "text-success-strong",
  negativo: "text-danger-strong",
  cero: "text-muted-foreground",
};

const SIGNO_BADGE: Record<
  SaldoTiendaDTO["signo"],
  { variant: "default" | "secondary" | "destructive" | "outline"; label: string }
> = {
  positivo: { variant: "default", label: "A favor" },
  negativo: { variant: "destructive", label: "En contra" },
  cero: { variant: "secondary", label: "En cero" },
};

/** Un importe de la cabecera: rotulo, cifra ya formateada por el servidor y aclaracion. */
function Importe({
  rotulo,
  valor,
  pista,
  className,
}: {
  rotulo: string;
  /** STRING del servidor, pintado tal cual. */
  valor: string;
  pista: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm text-muted-foreground">{rotulo}</span>
      <span className={`text-lg font-medium ${className ?? ""}`}>{money(valor)}</span>
      <span className="text-xs text-muted-foreground">{pista}</span>
    </div>
  );
}

export interface SaldoTiendaCardProps {
  saldo: SaldoTiendaDTO;
  /**
   * Feature 172 (T G.2, R55) — los tres importes del conjunto filtrado, ya clasificados y
   * sumados en el SERVIDOR. Requerido: sin esto la tienda no puede distinguir un pago de un
   * cargo, que es justo lo que esta task existe para arreglar.
   */
  desglose: DesgloseTiendaDTO;
}

export function SaldoTiendaCard({ saldo, desglose }: SaldoTiendaCardProps) {
  const badge = SIGNO_BADGE[saldo.signo];

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-2">
        <section aria-label="Saldo a favor" className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {DESGLOSE_MI_WALLET_LABEL.saldo}
            </span>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          <span
            className={`text-3xl font-semibold tracking-tight ${SALDO_COLOR[saldo.signo]}`}
          >
            {money(saldo.saldo)}
          </span>
        </section>

        {/* R55 — los tres importes, en el orden de la fórmula: a tu favor − cargos − ya pagado. */}
        <div className="grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-3">
          <Importe
            rotulo={DESGLOSE_MI_WALLET_LABEL.aFavor}
            valor={desglose.aFavor}
            pista={DESGLOSE_MI_WALLET_LABEL.aFavorHint}
            className="text-success-strong"
          />
          <Importe
            rotulo={DESGLOSE_MI_WALLET_LABEL.cargos}
            valor={desglose.cargos}
            pista={DESGLOSE_MI_WALLET_LABEL.cargosHint}
            className="text-danger-strong"
          />
          <Importe
            rotulo={DESGLOSE_MI_WALLET_LABEL.pagado}
            valor={desglose.pagado}
            pista={DESGLOSE_MI_WALLET_LABEL.pagadoHint}
          />
        </div>

        {/* La limitación N1, junto a las cifras que afecta (misma regla que T F.6). */}
        <p role="note" className="text-xs text-muted-foreground">
          {DESGLOSE_MI_WALLET_AVISO}
        </p>
      </CardContent>
    </Card>
  );
}
