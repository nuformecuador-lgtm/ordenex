import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { DesgloseTiendaDTO } from "@/lib/types/wallet-tienda";

import { DESGLOSE_MI_WALLET_AVISO, DESGLOSE_MI_WALLET_LABEL, money } from "./mi-wallet-labels";

// FICHA 458-D (cierre; 172 R55 `[P5]` y N1) — VUELVE el resumen de tres cifras de la 172 encima del
// estado de cuenta de `/mi-wallet`: «A tu favor», «Cargos de Ordenex» y «Ya pagado», en el orden de la
// fórmula, con el saldo que resulta y la salvedad N1 junto a las cifras que afecta. Los textos son los
// de la 172 (`DESGLOSE_MI_WALLET_LABEL` / `_AVISO`), sin tocar un carácter; la maqueta es la de la
// tarjeta retirada (`SaldoTiendaCard`, 172 T G.2), sin la cifra grande: esa la da ya la tarjeta
// «Saldo actual» del estado de cuenta, y aquí el saldo se lee como el RESULTADO de la resta.
//
// Aquí no se clasifica ni se suma nada: las cuatro cifras llegan del servidor (`estado.resumen`),
// derivadas de la cuenta ENTERA por `derivarDesgloseTienda` en la MISMA lectura que el saldo actual, y
// el servicio afirma `resumen.saldo === saldoActual` antes de responder. Money-safe: STRING tal cual.

/** Color del saldo según su signo (tokens semánticos, como la tarjeta del estado de cuenta). */
const SALDO_COLOR: Record<DesgloseTiendaDTO["signo"], string> = {
  positivo: "text-success-strong",
  negativo: "text-danger-strong",
  cero: "text-muted-foreground",
};

/** El distintivo del saldo de la 172 (texto de `SaldoTiendaCard`, sin cambios). */
const SIGNO_BADGE: Record<
  DesgloseTiendaDTO["signo"],
  { variant: "default" | "secondary" | "destructive"; label: string }
> = {
  positivo: { variant: "default", label: "A favor" },
  negativo: { variant: "destructive", label: "En contra" },
  cero: { variant: "secondary", label: "En cero" },
};

/** Un importe del resumen: rótulo, cifra del servidor pintada tal cual y su aclaración. */
function Importe({
  rotulo,
  valor,
  pista,
  className,
}: {
  rotulo: string;
  valor: string;
  pista: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm text-muted-foreground">{rotulo}</span>
      <span className={`text-lg font-medium tabular-nums ${className ?? ""}`}>{money(valor)}</span>
      <span className="text-xs text-muted-foreground">{pista}</span>
    </div>
  );
}

export interface ResumenMiWalletProps {
  /** El resumen de la cuenta entera, tal como lo manda `verMiEstadoCuentaAction`. */
  resumen: DesgloseTiendaDTO;
}

export function ResumenMiWallet({ resumen }: Readonly<ResumenMiWalletProps>) {
  const badge = SIGNO_BADGE[resumen.signo];
  return (
    <Card>
      <CardContent className="pt-2">
        <section aria-label="Resumen de tu cuenta" className="flex flex-col gap-4">
          {/* R55 — los tres importes, en el orden de la fórmula: a tu favor − cargos − ya pagado. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Importe
              rotulo={DESGLOSE_MI_WALLET_LABEL.aFavor}
              valor={resumen.aFavor}
              pista={DESGLOSE_MI_WALLET_LABEL.aFavorHint}
              className="text-success-strong"
            />
            <Importe
              rotulo={DESGLOSE_MI_WALLET_LABEL.cargos}
              valor={resumen.cargos}
              pista={DESGLOSE_MI_WALLET_LABEL.cargosHint}
              className="text-danger-strong"
            />
            <Importe
              rotulo={DESGLOSE_MI_WALLET_LABEL.pagado}
              valor={resumen.pagado}
              pista={DESGLOSE_MI_WALLET_LABEL.pagadoHint}
            />
          </div>

          {/* El resultado de la resta: el MISMO número que la tarjeta «Saldo actual» (lo afirma el servidor). */}
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <span className="text-sm text-muted-foreground">{DESGLOSE_MI_WALLET_LABEL.saldo}</span>
            <Badge variant={badge.variant}>{badge.label}</Badge>
            <span className={`text-lg font-semibold tabular-nums ${SALDO_COLOR[resumen.signo]}`}>
              {money(resumen.saldo)}
            </span>
          </div>

          {/* La limitación N1, junto a las cifras que afecta (misma regla que T F.6 de la 172). */}
          <p role="note" className="text-xs text-muted-foreground">
            {DESGLOSE_MI_WALLET_AVISO}
          </p>
        </section>
      </CardContent>
    </Card>
  );
}
