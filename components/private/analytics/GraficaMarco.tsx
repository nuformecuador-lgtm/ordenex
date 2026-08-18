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
  /** Proporcion del lienzo, para que el esqueleto de carga mida lo mismo que la grafica. */
  readonly proporcion?: "normal" | "bajo";
  readonly children: ReactNode;
}

/**
 * Alto del lienzo por proporcion, no por pixeles (R24): el slot `operativo` del
 * shell es una columna flex y cualquier `w-[600px]` se rompe ahi.
 *
 * Se conserva el nombre y el valor de siempre para que ningun consumidor cambie de forma.
 */
export const CLASES_LIENZO = "aspect-video w-full min-h-0";

/**
 * La MITAD de alto (32:9). Nacio el 2026-08-18 para la serie de ordenes cargadas por dia:
 * a ancho completo, un 16:9 son ~675 px de alto para una fila de barras — la grafica se comia
 * la pantalla y obligaba a bajar para ver lo que hay debajo.
 *
 * Las dos clases se escriben COMPLETAS y literales: Tailwind compila estaticamente, asi que
 * una clase construida por interpolacion no existiria en el CSS final.
 */
const CLASES_LIENZO_BAJO = "aspect-[32/9] w-full min-h-0";

/** La clase del lienzo segun la proporcion pedida. `undefined` = la de siempre. */
export function clasesDeLienzo(proporcion?: "normal" | "bajo"): string {
  return proporcion === "bajo" ? CLASES_LIENZO_BAJO : CLASES_LIENZO;
}

export function GraficaMarco({
  titulo,
  vacio,
  hayDatos,
  cargando = false,
  error = null,
  className,
  proporcion,
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
        <Skeleton aria-hidden="true" className={clasesDeLienzo(proporcion)} />
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
