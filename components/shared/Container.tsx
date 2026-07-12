import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface ContainerProps {
  children: ReactNode;
  /** Clases extra para casos puntuales. */
  className?: string;
}

/**
 * Contenedor común del contenido de una página (padding `p-6`). Va DEBAJO del
 * `PageHeader`, que queda fuera a todo el ancho. Apila su contenido en columna
 * con separación consistente.
 */
export function Container({ children, className }: Readonly<ContainerProps>) {
  return (
    <div className={cn("flex flex-1 flex-col gap-6 p-6", className)}>
      {children}
    </div>
  );
}
