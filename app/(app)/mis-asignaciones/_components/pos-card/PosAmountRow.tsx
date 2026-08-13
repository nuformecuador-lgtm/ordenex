import { formatMonto } from "./pos-format";

// POS card · fila "Cobrar" (réplica del `AmountRow` de la referencia): recuadro con
// borde punteado y el monto a cobrar en grande, mono y tabular. Presentación pura.
//
// Feature 208: el borde iba en `navy/30` fijo sobre `bg-muted`, que sí gira con el
// tema; en oscuro el recuadro del dinero se perdía contra su propio fondo. Con
// `foreground/30` la línea punteada existe en los dos temas.

export interface PosAmountRowProps {
  montoCobrar: number | null;
}

export function PosAmountRow({ montoCobrar }: PosAmountRowProps) {
  return (
    <div className="flex items-center justify-between rounded-xl border-2 border-dashed border-foreground/30 bg-muted px-4 py-2.5">
      <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">
        Cobrar
      </span>
      <span className="font-mono text-2xl font-black tabular-nums text-foreground">
        {formatMonto(montoCobrar)}
      </span>
    </div>
  );
}
