"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export interface FormSheetProps {
  /** Visibilidad controlada; el padre es la fuente de verdad. */
  open: boolean;
  /** Emite el nuevo estado abierto/cerrado. El padre actualiza `open`. */
  onOpenChange: (open: boolean) => void;

  /** Título del panel. */
  title: string;
  /** Etiqueta del botón confirmar. */
  confirmLabel: string;
  /** Etiqueta del botón cancelar. Default "Cancelar". */
  cancelLabel?: string;
  /** Handler de confirmación. Puede ser síncrono o async. */
  onConfirm: () => void | Promise<void>;

  /** Ancho del panel como PORCENTAJE del viewport. Default 30. */
  anchoPorcentaje?: number;
  /** Suelo en px: el panel nunca baja de aquí. Default 300. */
  anchoMinimoPx?: number;

  children: React.ReactNode;
}

const DEFAULT_ANCHO_PORCENTAJE = 30;
const DEFAULT_ANCHO_MINIMO_PX = 300;

/**
 * `FormSheet` — envoltura local de `Sheet` para los formularios de "Nueva plantilla" /
 * "Editar plantilla" (feature 288). Vive junto a `PlantillasModule.tsx` y NO en
 * `components/shared/` porque hoy solo tiene DOS consumidores dentro del MISMO módulo;
 * si aparece un tercer consumidor en otro módulo, se promueve a `components/shared/`
 * (la regla del repo es "compuesto reutilizable" cuando ya hay evidencia de reuso,
 * no antes).
 *
 * Replica la conducta de `Modal` con `closeOnConfirm={false}`: anti-doble-submit,
 * spinner accesible mientras `pending`, y el cierre lo decide SIEMPRE el padre según
 * el resultado de `onConfirm` (nunca este componente). Ver `onOpenChange` no se llama
 * tras un `onConfirm` exitoso: eso es justo lo que hacía `closeOnConfirm={false}` en
 * `Modal`, así que aquí no es configurable — es el único comportamiento que tiene
 * sentido para un formulario (el padre decide si hubo éxito real, p.ej. validación
 * o conflicto del backend).
 */
export function FormSheet({
  open,
  onOpenChange,
  title,
  confirmLabel,
  cancelLabel = "Cancelar",
  onConfirm,
  anchoPorcentaje = DEFAULT_ANCHO_PORCENTAJE,
  anchoMinimoPx = DEFAULT_ANCHO_MINIMO_PX,
  children,
}: Readonly<FormSheetProps>) {
  const [pending, setPending] = useState(false);
  const mountedRef = useRef(true);
  // Espejo síncrono de `pending`: cierra la ventana de carrera entre dos clicks
  // emitidos antes de que React re-renderice con el botón `disabled` (patrón `Modal`).
  const pendingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleConfirm() {
    if (pendingRef.current) {
      return; // anti-doble-submit
    }
    const result = onConfirm();

    if (!(result instanceof Promise)) {
      // Síncrono: no hay fase "pending" que gestionar. El cierre, si procede, lo
      // decide el padre por su cuenta (no cerramos aquí tampoco).
      return;
    }

    pendingRef.current = true;
    setPending(true);
    try {
      await result;
      if (!mountedRef.current) return;
      pendingRef.current = false;
      setPending(false);
      // NUNCA se cierra solo tras confirmar: el padre decide (onConfirmCrear /
      // onConfirmEditar) según si el resultado fue realmente un éxito.
    } catch {
      if (!mountedRef.current) return;
      pendingRef.current = false;
      setPending(false);
      // El rechazo se DESCARTA a proposito, no se re-lanza: `onConfirmCrear` y
      // `onConfirmEditar` ya resuelven sus propios errores con toasts dentro de
      // `onConfirm`, asi que lo unico que falta aqui es soltar el estado `pending`
      // para que el panel no se quede bloqueado. Por eso tampoco hay canal `onError`
      // como en `Modal`: no habria quien lo escuchara.
    }
  }

  function handleCancel() {
    if (pending) return;
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : handleCancel())}>
      <SheetContent
        side="right"
        // Requisito duro de ancho: `style` inline con `max(<pct>vw, <min>px)`.
        // Dos hechos que no se ven al leer las clases de `SheetContent`:
        // 1) el `style` inline gana al `w-3/4` de la clase base (mayor especificidad
        //    de un atributo `style` sobre una clase de Tailwind).
        // 2) PERO `data-[side=right]:sm:max-w-sm` (24rem = 384px) seguiría recortando
        //    el ancho si no ponemos también `maxWidth: "none"` en el mismo `style`:
        //    sin esto, un `anchoPorcentaje` grande nunca superaría los 384px.
        style={{
          width: `max(${anchoPorcentaje}vw, ${anchoMinimoPx}px)`,
          maxWidth: "none",
        }}
        // NO se pasa `className` con utilidades de ancho: `w-full`/`sm:max-w-none` PIERDEN
        // por especificidad contra las variantes `data-[side=right]:` de la clase base, asi
        // que serian decorativas y harian creer que el ancho depende de ellas. Todo el ancho
        // lo sostiene el `style` de arriba, que es el unico que gana.
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-auto px-4">{children}</div>

        <SheetFooter className="flex-row justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={pending}
          >
            {cancelLabel}
          </Button>
          <Button type="button" onClick={() => void handleConfirm()} disabled={pending}>
            {pending ? (
              <span role="status" className="flex items-center gap-2">
                <Loader2 className="animate-spin" aria-hidden="true" />
                <span className="sr-only">Procesando…</span>
              </span>
            ) : null}
            {confirmLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
