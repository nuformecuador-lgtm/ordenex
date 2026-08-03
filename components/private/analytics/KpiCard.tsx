// Cifra unica con su etiqueta y su variacion (R12-R15).
//
// Sin recharts y SIN ANIMAR. Q5 decidio *arreglar* `components/shared/KpiValorAnimado`
// (que hoy hardcodeaba el simbolo del colon), no *montarlo* aqui: animar exigiria
// ademas ensenarle a respetar `prefers-reduced-motion` (R28), y eso ampliaria el
// radio de un cambio compartido sin que nadie lo haya pedido. Si el tablero 131
// quiere el numero animado, monta el compartido —ya arreglado— en su sitio.
//
// El signo de la variacion se dice con TEXTO ademas de con color (R15): un
// daltonico no ve la diferencia entre verde y rojo, y "-3" a secas tampoco
// explica respecto a que.

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { formatearValor } from "./formato";
import type { KpiCardProps, VariacionKpi } from "./tipos";

function textoDelSigno(variacion: VariacionKpi): string {
  if (variacion.delta > 0) return variacion.texto.sube;
  if (variacion.delta < 0) return variacion.texto.baja;
  return variacion.texto.igual;
}

function claseDelSigno(delta: number): string {
  if (delta > 0) return "text-success-strong";
  if (delta < 0) return "text-danger-strong";
  return "text-muted-foreground";
}

export function KpiCard({
  etiqueta,
  valor,
  unidad,
  variacion,
  cargando = false,
  error = null,
  className,
}: KpiCardProps) {
  return (
    <Card className={cn("w-full gap-1 p-4", className)}>
      <p className="text-sm text-muted-foreground">{etiqueta}</p>
      {error ? (
        <p role="alert" className="text-sm text-danger-strong">
          {error}
        </p>
      ) : cargando ? (
        <>
          <span role="status" className="sr-only">
            {etiqueta}
          </span>
          <Skeleton aria-hidden="true" className="h-7 w-24" />
        </>
      ) : (
        <>
          <p className="text-2xl font-semibold tabular-nums text-foreground">
            {formatearValor(valor, unidad)}
          </p>
          {variacion ? (
            <p className={cn("text-sm", claseDelSigno(variacion.delta))}>
              {`${textoDelSigno(variacion)} ${formatearValor(Math.abs(variacion.delta), unidad)} ${variacion.etiqueta}`}
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}
