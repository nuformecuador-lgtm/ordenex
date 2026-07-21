import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /**
   * Icono opcional (lucide). Se pinta dentro de un disco `bg-muted` y es
   * decorativo (`aria-hidden`): el significado ya lo dan el título y la
   * descripción, no el icono.
   */
  icon?: LucideIcon;
  /**
   * Mensaje principal. No es un "nada aquí": enseña el estado y, junto con la
   * descripción/CTA, el próximo paso. Se renderiza con `text-foreground`
   * (contraste pleno, no gris lavado).
   */
  title: ReactNode;
  /**
   * Detalle opcional que explica QUÉ hacer a continuación (p. ej. "Crea la
   * primera zona para agrupar los distritos de reparto").
   */
  description?: ReactNode;
  /**
   * Llamada a la acción opcional: normalmente un `<Button>` con su handler
   * (p. ej. "Crear zona"). Se coloca bajo el mensaje, centrada.
   */
  action?: ReactNode;
  /** Clases extra para el contenedor (p. ej. ajustar el padding en un caso). */
  className?: string;
}

/**
 * Estado vacío consistente (DESIGN.md, «Componentes → EmptyState»): icono
 * opcional + mensaje que ENSEÑA el próximo paso + CTA opcional. Centrado, con
 * padding generoso y contraste correcto (título en `text-foreground`,
 * descripción en `text-muted-foreground`). Pieza de presentación pura: no
 * conoce dominio ni hace fetch; el consumidor pasa textos y acción por props
 * (i18n-ready). Lo usa el `DataTable` para su estado vacío y puede usarse
 * suelto en cualquier lista.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <span
          aria-hidden="true"
          className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <Icon className="size-5" />
        </span>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-prose text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
