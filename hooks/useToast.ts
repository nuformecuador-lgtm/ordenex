"use client";

import { useMemo } from "react";
import { Toast } from "@base-ui/react/toast";

import type { ToastApi, ToastOptions } from "@/providers/ToastProvider";

/**
 * Envuelve `useToastManager()` de Base UI y expone la API de disparo del
 * producto (`success/error/info/warning/show/dismiss`) con identidad estable
 * entre renders (R1). Si se usa fuera de un `ToastProvider`, `useToastManager()`
 * lanza; lo re-lanzamos con un mensaje que menciona `ToastProvider` (R2).
 */
export function useToast(): ToastApi {
  let manager: ReturnType<typeof Toast.useToastManager>;
  try {
    manager = Toast.useToastManager();
  } catch {
    throw new Error("useToast debe usarse dentro de un ToastProvider");
  }

  const { add, close } = manager;

  return useMemo<ToastApi>(() => {
    const show = ({
      message,
      variant = "info",
      duration,
      onDismiss,
    }: ToastOptions): string =>
      add({
        title: message, // R4 (Toast.Title)
        type: variant, // R7 (data-variant / icono / estilo)
        // R8: error/warning se anuncian con prioridad alta; success/info baja.
        priority: variant === "error" || variant === "warning" ? "high" : "low",
        // R11/R12: `undefined` deja que Base UI use su default; `0` persiste.
        timeout: duration,
        onClose: onDismiss, // R16
      });

    return {
      show,
      success: (message, options) =>
        show({ ...options, message, variant: "success" }),
      error: (message, options) =>
        show({ ...options, message, variant: "error" }),
      info: (message, options) => show({ ...options, message, variant: "info" }),
      warning: (message, options) =>
        show({ ...options, message, variant: "warning" }),
      dismiss: (id: string) => close(id), // R14 (no-op si el id no existe)
    };
  }, [add, close]);
}
