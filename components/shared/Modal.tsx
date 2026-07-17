"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ModalProps {
  /** Visibilidad controlada. El padre es la fuente de verdad (R1, R2). */
  open: boolean;
  /** Emite el nuevo estado abierto/cerrado. El padre actualiza `open` (R3, R4). */
  onOpenChange: (open: boolean) => void;

  /** Título; se asocia como aria-labelledby (R5). */
  title: ReactNode;
  /** Descripción opcional; aria-describedby (R6). */
  description?: ReactNode;
  /** Contenido arbitrario del cuerpo (R7). */
  children?: ReactNode;

  /** Etiqueta del botón confirmar (R8). Default "Confirmar". */
  confirmLabel?: string;
  /** Etiqueta del botón cancelar (R8). Default "Cancelar". */
  cancelLabel?: string;
  /**
   * Variante visual del confirmar; se pasa al Button (R8b). Default "default".
   * `brand-outline` se añadió para flujos de marca (carga masiva); es aditivo y
   * no altera el default.
   */
  confirmVariant?: "default" | "destructive" | "brand-outline";
  /** Oculta el botón cancelar (R10). Default false. */
  hideCancel?: boolean;
  /**
   * Oculta el botón confirmar (útil en flujos multi-paso donde la acción vive en
   * el cuerpo). Aditivo; no afecta el comportamiento por defecto. Default false.
   */
  hideConfirm?: boolean;
  /**
   * Deshabilita el botón confirmar por decisión del consumidor (p. ej. sin datos
   * accionables). Aditivo; el bloqueo por fase "pending" es independiente.
   * Default false.
   */
  confirmDisabled?: boolean;

  /**
   * Handler de confirmación (R9, R11, R14). Puede ser síncrono (void) o async
   * (Promise<void>). Si devuelve una promesa, se activa el flujo async.
   */
  onConfirm?: () => void | Promise<void>;
  /** Handler de cancelación, previo al cierre (R13). */
  onCancel?: () => void;
  /**
   * Único canal de error: se invoca con el error capturado si el confirmar async
   * rechaza (R23). El componente NO renderiza error propio; el consumidor decide
   * cómo mostrarlo (p. ej. toast de la feature 11).
   */
  onError?: (error: unknown) => void;

  /**
   * Si false, el modal NO se cierra tras un confirmar exitoso; permanece abierto
   * para flujos multi-paso (R12, R20, R21). Default true.
   */
  closeOnConfirm?: boolean;
  /**
   * Si false, deshabilita cierre por Escape y overlay (R27). Default true.
   * Independiente del bloqueo temporal durante "pendiente" (R19).
   */
  dismissible?: boolean;

  /**
   * Ancho MÁXIMO del popup. Admite un token (`sm`/`md`/`lg`/`xl`) o una medida CSS
   * explícita en % o px (`"75%"`, `"800px"`). Default `"75%"`: el popup nunca ocupa
   * el ancho completo de la pantalla.
   *
   * Es un TECHO, no un ancho fijo: el popup sigue limitado a `w-[calc(100%-2rem)]`,
   * así que en pantallas chicas se encoge en vez de desbordar. Por debajo manda el
   * `min-width` de 300px (ver `MIN_WIDTH_PX`).
   */
  size?: ModalMaxWidth;

  /** Clases extra para el popup. */
  className?: string;
}

/** Tamaños con nombre admitidos por el Modal. */
export type ModalSize = "sm" | "md" | "lg" | "xl";

/** Medida CSS explícita para `size`: solo % o px (no `rem`, `vw`, `calc()`…). */
export type ModalMaxWidthUnit = `${number}%` | `${number}px`;

/** Un token con nombre o una medida explícita. */
export type ModalMaxWidth = ModalSize | ModalMaxWidthUnit;

/** Ancho máximo por token. */
const SIZE_MAX_WIDTH: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-[1000px]",
};

/**
 * Ancho máximo por defecto: el popup ocupa como mucho 3/4 de la pantalla. Antes el
 * default era `md` (448px) y los flujos anchos lo pisaban con `className`.
 */
const DEFAULT_MAX_WIDTH: ModalMaxWidth = "75%";

/**
 * Ancho mínimo del popup, en px. Va acá y no en cada consumidor: un modal más angosto
 * que esto no es legible, sea cual sea su contenido.
 */
const MIN_WIDTH_PX = 300;

/** `true` si el valor es un token con nombre (y no una medida CSS). */
function esToken(size: ModalMaxWidth): size is ModalSize {
  return size in SIZE_MAX_WIDTH;
}

/** Fase interna del confirmar; el `open` lo controla siempre el padre. */
type ConfirmPhase = "idle" | "pending";

/** Detecta si un valor es "thenable" (promesa nativa o similar) sin usar instanceof. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value != null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Modal genérico y reutilizable compuesto sobre la primitiva `@base-ui/react`
 * Dialog: reutiliza su focus-trap, overlay, `aria-modal` y restauración de foco
 * (R28–R31). Sobre esa base añade la capa de producto: layout, botones
 * confirmar/cancelar y toda la lógica async (spinner, bloqueo, anti-doble-submit,
 * resolución/rechazo con `onError`).
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  confirmVariant = "default",
  hideCancel = false,
  hideConfirm = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  onError,
  closeOnConfirm = true,
  dismissible = true,
  size = DEFAULT_MAX_WIDTH,
  className,
}: Readonly<ModalProps>) {
  const [phase, setPhase] = useState<ConfirmPhase>("idle");
  const mountedRef = useRef(true);
  // Espejo síncrono de la fase pendiente: cierra la ventana de carrera entre dos
  // clicks emitidos antes de que React re-renderice con el botón `disabled` (R17).
  const pendingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const pending = phase === "pending";

  /** Traduce el `onOpenChange` de Base UI aplicando el bloqueo por fase (R19) y `dismissible` (R27). */
  function handleRootOpenChange(
    next: boolean,
    details: Dialog.Root.ChangeEventDetails,
  ) {
    if (next) {
      onOpenChange(true); // R4 (apertura)
      return;
    }
    if (pending) {
      return; // R19: no cerrar mientras corre la operación
    }
    const { reason } = details;
    if (
      !dismissible &&
      (reason === "escape-key" || reason === "outside-press")
    ) {
      return; // R27: no cerrar por Escape/overlay
    }
    onOpenChange(false); // R3, R25, R26
  }

  async function handleConfirm() {
    if (pendingRef.current || confirmDisabled) {
      return; // R17: anti-doble-submit; o confirmar deshabilitado por el consumidor
    }
    const result = onConfirm?.(); // R9, R11

    if (!isThenable(result)) {
      if (closeOnConfirm) {
        onOpenChange(false); // R12
      }
      return;
    }

    pendingRef.current = true;
    setPhase("pending"); // R14, R15, R16, R18, R19
    try {
      await result;
      if (!mountedRef.current) return;
      pendingRef.current = false;
      setPhase("idle"); // R20/R21: sale de pending
      if (closeOnConfirm) {
        onOpenChange(false); // R20
      }
      // closeOnConfirm === false → permanece abierto (R21)
    } catch (error) {
      if (!mountedRef.current) return;
      pendingRef.current = false;
      setPhase("idle"); // R22: re-habilita botones (confirmar y cancelar), detiene spinner
      onError?.(error); // R23: único canal de error, sin render propio
      // NO se cierra → permanece abierto (R22)
    }
  }

  function handleCancel() {
    if (pending) {
      return; // R19
    }
    onCancel?.();
    onOpenChange(false); // R13
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={handleRootOpenChange}
      disablePointerDismissal={!dismissible || pending}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          data-testid="modal-backdrop"
          className="fixed inset-0 z-50 bg-black/50"
        />
        <Dialog.Popup
          aria-modal="true"
          aria-busy={pending || undefined}
          // Una medida explícita (%/px) va por `style` y no por clase: Tailwind compila
          // clases estáticas, así que un valor arbitrario en runtime no existiría en el CSS.
          style={{
            minWidth: `${MIN_WIDTH_PX}px`,
            ...(esToken(size) ? {} : { maxWidth: size }),
          }}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border border-border bg-background p-6 shadow-lg outline-none",
            esToken(size) ? SIZE_MAX_WIDTH[size] : undefined,
            className,
          )}
        >
          <div className="flex shrink-0 flex-col gap-1.5">
            <Dialog.Title className="text-lg font-semibold">
              {title}
            </Dialog.Title>
            {description ? (
              <Dialog.Description className="text-sm text-muted-foreground">
                {description}
              </Dialog.Description>
            ) : null}
          </div>

          {children ? (
            <div className="min-h-0 flex-1 overflow-auto">{children}</div>
          ) : null}

          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {!hideCancel ? (
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={pending}
              >
                {cancelLabel}
              </Button>
            ) : null}
            {!hideConfirm ? (
              <Button
                type="button"
                variant={confirmVariant}
                onClick={handleConfirm}
                disabled={pending || confirmDisabled}
              >
                {pending ? (
                  <span
                    role="status"
                    className="flex items-center gap-2"
                  >
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    <span className="sr-only">Procesando…</span>
                  </span>
                ) : null}
                {confirmLabel}
              </Button>
            ) : null}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
