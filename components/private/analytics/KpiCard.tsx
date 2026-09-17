// Cifra unica con su etiqueta y su variacion (R12-R15).
//
// Sin recharts y con la CIFRA ANIMADA desde el 2026-08-19 (pedido humano). Es exactamente el
// camino que este comentario dejaba abierto: Q5 arreglo `components/shared/KpiValorAnimado`
// —que hardcodeaba el simbolo del colon— y dejo dicho que quien quisiera el numero animado
// montara el compartido en su sitio, con la condicion de ensenarle antes a respetar
// `prefers-reduced-motion` (R28). Eso es lo que se hizo: la preferencia se atiende DENTRO del
// componente compartido, porque esta cuenta la lleva `requestAnimationFrame` y ninguna regla
// CSS puede detener JavaScript.
//
// El montaje va a traves de `KpiValor` y no directo: `KpiValorAnimado` recibe el formateador
// como FUNCION, y una funcion no cruza la frontera RSC. Esta tarjeta sigue siendo
// server-compatible y solo pasa props serializables (el numero y su unidad).
//
// Lo que NO cambio: el texto lo sigue escribiendo `formatearValor`, asi que el fotograma final
// es identico al que se pintaba antes. Y la VARIACION no se anima —es la linea secundaria, y
// dos cifras contando a la vez en una tarjeta de cuatro centimetros compiten entre si—.
//
// El signo de la variacion se dice con TEXTO ademas de con color (R15): un
// daltonico no ve la diferencia entre verde y rojo, y "-3" a secas tampoco
// explica respecto a que.

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { formatearValor } from "./formato";
import {
  CLASES_CIFRA,
  CLASES_ROTULO,
  CLASES_TARJETA,
  JERARQUIA_POR_DEFECTO,
} from "./jerarquia";
import { KpiValor } from "./KpiValor";
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
  // FICHA 441 — el rango de la tarjeta dentro de su fila. El default es lo de siempre, asi que
  // las pantallas que no lo pasan (tablero financiero, paneles operativos, ciclo de vida antes
  // de esta ficha) se pintan exactamente igual que antes.
  jerarquia = JERARQUIA_POR_DEFECTO,
}: KpiCardProps) {
  return (
    // `h-full`: la tarjeta ocupa TODO el alto de su celda, no el de su contenido.
    //
    // Sin esto, cada KPI mide lo que mide su texto y una fila de tarjetas queda con los bordes
    // inferiores a distintas alturas —basta que un rotulo ocupe dos lineas y otro una—, que se
    // lee como si estuvieran mal alineadas. NO es un alto FIJO: no hay `h-[120px]` ni `min-h`
    // en pixeles; el alto lo decide la fila (la celda mas alta manda) y las demas la igualan,
    // asi que la tarjeta sigue creciendo si su contenido crece.
    //
    // Funciona porque una celda de grid se estira por defecto (`align-items: stretch`): la
    // celda ya tiene el alto de la fila y `h-full` hace que la tarjeta lo llene. Un
    // `self-start` en la celda lo anula — por eso no debe haber ninguno alrededor de un KPI.
    <Card className={cn("h-full w-full gap-1 p-4", CLASES_TARJETA[jerarquia], className)}>
      <p className={CLASES_ROTULO[jerarquia]}>{etiqueta}</p>
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
          <p className={cn(CLASES_CIFRA[jerarquia], "tabular-nums text-foreground")}>
            <KpiValor valor={valor} unidad={unidad} />
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
