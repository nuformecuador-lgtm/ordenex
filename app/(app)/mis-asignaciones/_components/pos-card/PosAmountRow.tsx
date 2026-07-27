import { formatMonto } from "./pos-format";

// POS card · fila "Cobrar" (réplica del `AmountRow` de la referencia): recuadro con
// borde punteado navy y el monto a cobrar en grande, mono y tabular. Presentación pura.

export interface PosAmountRowProps {
  montoCobrar: number | null;
}

export function PosAmountRow({ montoCobrar }: PosAmountRowProps) {
  return (
    <div className="flex items-center justify-between rounded-xl border-2 border-dashed border-navy/30 bg-muted px-4 py-2.5">
      <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">
        Cobrar
      </span>
      <span className="font-mono text-2xl font-black tabular-nums text-foreground">
        {formatMonto(montoCobrar)}
      </span>
    </div>
  );
}
