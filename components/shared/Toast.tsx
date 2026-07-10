"use client";

import type { ComponentType } from "react";
import { Toast } from "@base-ui/react/toast";
import { cva } from "class-variance-authority";
import {
  CheckCircle2,
  Info,
  TriangleAlert,
  XCircle,
  type LucideProps,
} from "lucide-react";

import type { ToastVariant } from "@/providers/ToastProvider";
import { cn } from "@/lib/utils";

/** Clases por variante (fondo/color/borde), estilo `alert.tsx` (R7). */
const toastVariants = cva(
  "pointer-events-auto grid w-full grid-cols-[auto_1fr_auto] items-start gap-2 rounded-lg border p-3 text-sm shadow-lg [&>svg]:size-4 [&>svg]:translate-y-0.5",
  {
    variants: {
      variant: {
        // Fondo -soft (marca) + texto oscurecido sobre ese fondo (mix con
        // negro) para pasar AA en light; en dark, fondo translucido sobre el
        // canvas oscuro + texto aclarado (mix con blanco) por la misma razon.
        success:
          "border-success/30 bg-success-soft text-[color-mix(in_srgb,var(--color-success)_55%,black)] dark:border-success/40 dark:bg-success/15 dark:text-[color-mix(in_srgb,var(--color-success)_80%,white)]",
        error:
          "border-danger/30 bg-danger-soft text-[color-mix(in_srgb,var(--color-danger)_55%,black)] dark:border-danger/40 dark:bg-danger/15 dark:text-[color-mix(in_srgb,var(--color-danger)_80%,white)]",
        info: "border-info/30 bg-[color-mix(in_srgb,var(--color-info)_10%,white)] text-[color-mix(in_srgb,var(--color-info)_55%,black)] dark:border-info/40 dark:bg-info/15 dark:text-[color-mix(in_srgb,var(--color-info)_80%,white)]",
        warning:
          "border-warning/30 bg-warning-soft text-[color-mix(in_srgb,var(--color-warning)_55%,black)] dark:border-warning/40 dark:bg-warning/15 dark:text-[color-mix(in_srgb,var(--color-warning)_80%,white)]",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  },
);

/** Icono `lucide` por variante (R7). */
const iconByVariant: Record<ToastVariant, ComponentType<LucideProps>> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: TriangleAlert,
};

/** Normaliza el `type` (string | undefined) de Base UI a una variante conocida. */
function toVariant(type: string | undefined): ToastVariant {
  if (type === "success" || type === "error" || type === "warning") {
    return type;
  }
  return "info";
}

export interface ToastItemProps {
  /** Un item del manager de Base UI (`useToastManager().toasts`). */
  toast: Toast.Root.ToastObject;
}

/**
 * Render presentacional de UN toast. Compone `Toast.Root`/`Title`/`Description`/
 * `Close` de Base UI y aplica la capa de producto: variante (icono + clases),
 * `data-variant` (R7), `role` accesible (R8) y botón de cierre (R13).
 */
export function ToastItem({ toast }: ToastItemProps) {
  const variant = toVariant(toast.type);
  const Icon = iconByVariant[variant];
  const isUrgent = variant === "error" || variant === "warning";

  return (
    <Toast.Root
      toast={toast}
      data-variant={variant}
      role={isUrgent ? "alert" : "status"}
      className={cn(toastVariants({ variant }))}
    >
      <Icon aria-hidden="true" />
      <div className="flex flex-col gap-0.5">
        <Toast.Title className="font-medium">{toast.title}</Toast.Title>
        {toast.description ? (
          <Toast.Description className="text-muted-foreground">
            {toast.description}
          </Toast.Description>
        ) : null}
      </div>
      <Toast.Close
        aria-label="Cerrar notificación"
        className="rounded p-1 text-current/70 hover:text-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
      >
        <span aria-hidden="true">×</span>
      </Toast.Close>
    </Toast.Root>
  );
}
