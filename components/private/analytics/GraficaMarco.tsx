// Envoltura de estados comun a las tres graficas (R5-R9, R24, R25, R28).
//
// Precedencia error > carga > vacio > datos, espejo exacto de
// `components/shared/DataTable.tsx`: dos superficies con la misma jerarquia de
// estados que se comportaran distinto serian una trampa para el usuario.
//
// No anima nada (R28). El paquete no lee `matchMedia` (R4), asi que la unica
// forma honesta de respetar la reduccion de movimiento es no depender de ella:
// sin clases de animacion no hay animacion que suprimir.

import type { ReactNode } from "react";

import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { EstadoVisual, TextoVacio } from "./tipos";

export interface GraficaMarcoProps extends EstadoVisual {
  /** Nombre accesible de la region (R9), consultable sin mirar el SVG. */
  readonly titulo: string;
  /** Texto del vacio: habla de la METRICA SIN DATOS EN EL RANGO (R25). */
  readonly vacio: TextoVacio;
  /** `false` => estado vacio; `true` => se pintan `children`. */
  readonly hayDatos: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * Alto del lienzo por proporcion, no por pixeles (R24): el slot `operativo` del
 * shell es una columna flex y cualquier `w-[600px]` se rompe ahi.
 */
export const CLASES_LIENZO = "aspect-video w-full min-h-0";

export function GraficaMarco({
  titulo,
  vacio,
  hayDatos,
  cargando = false,
  error = null,
  className,
  children,
}: GraficaMarcoProps) {
  let cuerpo: ReactNode;

  if (error) {
    cuerpo = (
      <p role="alert" className="text-sm text-danger-strong">
        {error}
      </p>
    );
  } else if (cargando) {
    cuerpo = (
      <>
        <span role="status" className="sr-only">
          {titulo}
        </span>
        <Skeleton aria-hidden="true" className={CLASES_LIENZO} />
      </>
    );
  } else if (!hayDatos) {
    cuerpo = <EmptyState title={vacio.titulo} description={vacio.descripcion} />;
  } else {
    cuerpo = children;
  }

  return (
    <section aria-label={titulo} className={cn("flex w-full flex-col gap-2", className)}>
      <h3 className="text-sm font-medium text-foreground">{titulo}</h3>
      {cuerpo}
    </section>
  );
}
