import type { ReactNode } from "react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Cuántas columnas usa la rejilla interior. Se declara como unión cerrada —y no
 * como `number`— porque las clases de Tailwind se compilan estáticamente: un
 * `grid-cols-${n}` interpolado no existiría en el CSS final.
 */
export type ColumnasContenedor = 1 | 2 | 3;

export interface ContenedorSeccionProps {
  /** Título del encabezado. Es lo único obligatorio del header. */
  readonly titulo: string;
  /** Línea secundaria opcional bajo el título. */
  readonly descripcion?: string;
  /** Controles del encabezado (export, refrescar, un toggle…), alineados a la derecha. */
  readonly acciones?: ReactNode;
  /** Los N componentes a pintar dentro. Uno, seis o ninguno: no hay tope. */
  readonly children?: ReactNode;
  /** Columnas de la rejilla interior a partir de `md`. Por defecto una pila vertical. */
  readonly columnas?: ColumnasContenedor;
  /** Qué pintar cuando no llega ningún hijo. Sin él, el cuerpo no se renderiza. */
  readonly vacio?: ReactNode;
  readonly className?: string;
}

/**
 * De 1..3 columnas a su clase, escritas COMPLETAS para que Tailwind las vea.
 * `md:` y no `sm:`: en móvil una rejilla de paneles es ilegible a cualquier ancho.
 */
const CLASES_COLUMNAS: Record<ColumnasContenedor, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 md:grid-cols-2",
  3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
};

/**
 * Contenedor genérico de un bloque de página: UN encabezado (título, descripción
 * y acciones) y N componentes dentro.
 *
 * Es PURO: sin `"use client"`, sin fetch y sin cálculo. Todo lo que pinta llega
 * por props — de modo que sirve tanto para envolver componentes de servidor
 * (el tablero financiero de analítica) como de cliente (los paneles operativos o
 * el de postulaciones, que traen su propia directiva).
 *
 * NO emite `role="region"` ni un `<section aria-label>` a propósito: las regiones
 * de cada página las declaran sus shells, y en analítica sus nombres accesibles
 * están congelados por los guardias de `AnaliticaShell.test.tsx` («exactamente
 * dos regiones») y de `AnaliticaPage.test.tsx`. Un contenedor que añadiera
 * landmarks los rompería sólo por envolver contenido, que es justo lo que no
 * debe costar.
 */
export function ContenedorSeccion({
  titulo,
  descripcion,
  acciones,
  children,
  columnas = 1,
  vacio,
  className,
}: Readonly<ContenedorSeccionProps>) {
  // `children` puede ser `null`, `false` o `[]` — todos significan «no hay nada
  // que pintar». `?? vacio` no bastaría: sólo cubre `null`/`undefined`.
  const hayContenido = Boolean(children);
  const cuerpo = hayContenido ? children : vacio;

  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle>{titulo}</CardTitle>
        {descripcion ? <CardDescription>{descripcion}</CardDescription> : null}
        {acciones ? <CardAction>{acciones}</CardAction> : null}
      </CardHeader>
      {cuerpo ? (
        <CardContent className={cn("grid gap-4", CLASES_COLUMNAS[columnas])}>
          {cuerpo}
        </CardContent>
      ) : null}
    </Card>
  );
}
