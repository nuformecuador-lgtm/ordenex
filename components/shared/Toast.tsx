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
        success: "border-green-200 bg-green-50 text-green-900",
        error: "border-red-200 bg-red-50 text-red-900",
        info: "border-blue-200 bg-blue-50 text-blue-900",
        warning: "border-amber-200 bg-amber-50 text-amber-900",
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
