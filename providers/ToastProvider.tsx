"use client";

import type { ReactNode } from "react";
import { Toast } from "@base-ui/react/toast";

import { ToastItem } from "@/components/shared/Toast";
import { cn } from "@/lib/utils";

/** Variantes soportadas por el sistema de toast (R7). */
export type ToastVariant = "success" | "error" | "info" | "warning";

/** Opciones del método genérico `show` de la API de disparo. */
export interface ToastOptions {
  /** Texto visible del toast → Toast.Title (R4). */
  message: string;
  /** Variante; default "info" en show() si se omite (R7). */
  variant?: ToastVariant;
  /**
   * ms hasta el auto-descarte → `timeout` de Base UI (R10, R11).
   * `0` => persistente (R12). Default: timeout del provider.
   */
  duration?: number;
  /** Invocado una vez al retirarse → `onClose` de Base UI (R16). */
  onDismiss?: () => void;
}

/** API de disparo devuelta por `useToast()` (R1, R5). */
export interface ToastApi {
  /** Genérico; llama add(...) y devuelve el id (R5, R6). */
  show: (options: ToastOptions) => string;
  success: (
    message: string,
    options?: Omit<ToastOptions, "message" | "variant">,
  ) => string;
  error: (
    message: string,
    options?: Omit<ToastOptions, "message" | "variant">,
  ) => string;
  info: (
    message: string,
    options?: Omit<ToastOptions, "message" | "variant">,
  ) => string;
  warning: (
    message: string,
    options?: Omit<ToastOptions, "message" | "variant">,
  ) => string;
  /** close(id) de Base UI; no-op si no existe (R14). */
  dismiss: (id: string) => void;
}

export interface ToastProviderProps {
  children: ReactNode;
  /** → `limit` de Base UI (R18). Default 4. */
  max?: number;
  /** → `timeout` de Base UI (R10). Default 5000. */
  defaultDuration?: number;
  /** Clases de posición del viewport. Default esquina superior derecha. */
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
}

/** Mapea cada posición a clases Tailwind del viewport fijo (R9). */
const positionClasses: Record<
  NonNullable<ToastProviderProps["position"]>,
  string
> = {
  "top-right": "top-4 right-4",
  "top-left": "top-4 left-4",
  "bottom-right": "bottom-4 right-4",
  "bottom-left": "bottom-4 left-4",
};

/** Renderiza un `Toast` por cada item activo del manager de Base UI. */
function ToastList() {
  const { toasts } = Toast.useToastManager();
  return (
    <>
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </>
  );
}

/**
 * Provider del sistema de toast, compuesto sobre `@base-ui/react/toast`
 * (decisión humana [RESUELTO-C]). Reutiliza la mecánica nativa de Base UI:
 * auto-descarte (`timeout`), persistencia (`timeout: 0`), pausa por hover/foco,
 * apilado y límite (`limit`), ids únicos, cierre programático (`close`) y
 * `onClose`. Aporta la capa de producto: viewport accesible por portal (R9),
 * posición y el render presentacional de cada toast.
 */
export function ToastProvider({
  children,
  max = 4,
  defaultDuration = 5000,
  position = "top-right",
}: ToastProviderProps) {
  return (
    <Toast.Provider timeout={defaultDuration} limit={max}>
      {children}
      <Toast.Portal>
        <Toast.Viewport
          role="region"
          aria-label="Notificaciones"
          className={cn(
            "fixed z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2",
            positionClasses[position],
          )}
        >
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
