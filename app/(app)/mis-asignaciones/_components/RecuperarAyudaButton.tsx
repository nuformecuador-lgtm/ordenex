"use client";

import { useState } from "react";
import { Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { recuperarOrdenAyuda } from "@/lib/actions/orden-ayuda";

// Pedido humano 2026-08-18 — «Recuperar»: retira la solicitud de ayuda y devuelve la orden al
// listado normal de «por gestionar».
//
// Viaja como el nodo de la prop `acciones` de la card POS, que es el slot que la card ofrece al
// pie para los controles que ella no conoce (el mismo por el que `/novedades` le pasa sus cinco
// botones). La card es un `<article>`, no un botón, así que alojar un control aquí es HTML
// válido y su gate de selección ignora los clicks que nacen en un control.
//
// NO PIDE CONFIRMACIÓN, y es deliberado: la acción es reversible con un gesto (volver a pulsar
// «Ayuda» en el panel) y no destruye nada — los motivos escritos siguen en el hilo de la orden.
// Un diálogo aquí cobraría un gesto extra por algo que se deshace con otro.
//
// `Undo2` es el MISMO icono que el repo ya usa para «Devolver» en `/novedades` y en el panel de
// gestión: no se eligió por parecerse a la palabra, sino porque en este repo ese dibujo ya
// significa «devolver esto a donde estaba».

export interface RecuperarAyudaButtonProps {
  ordenId: string;
  /** Para el nombre accesible: en una lista de varias filas es lo que distingue un botón de otro. */
  numRemision: string;
  /** Se invoca tras un `ok` para que el módulo relea el listado (la orden cambia de sección). */
  onRecuperada: () => void;
  /** `true` con el mensajero bloqueado por cierre pendiente (feature 111/R14). */
  disabled?: boolean;
}

export function RecuperarAyudaButton({
  ordenId,
  numRemision,
  onRecuperada,
  disabled,
}: RecuperarAyudaButtonProps) {
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);

  async function handleClick() {
    if (enviando) return;
    setEnviando(true);
    try {
      const result = await recuperarOrdenAyuda({ ordenId });
      if (result.status === "ok") {
        toast.success(`Orden ${numRemision}: se retiró la solicitud de ayuda.`);
        onRecuperada();
        return;
      }
      // `forbidden` es opaco por diseño (mismo borde que el hilo de notas): el mensaje dice qué
      // comprobar, no cuál de las causas fue.
      toast.error(
        result.status === "unauthenticated"
          ? "Tu sesión expiró. Iniciá sesión de nuevo."
          : "No se pudo retirar la solicitud. Revisá que la orden siga en reparto y asignada a vos.",
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="shrink-0"
      disabled={disabled || enviando}
      onClick={handleClick}
      aria-label={`Retirar la solicitud de ayuda de la orden ${numRemision}`}
    >
      <Undo2 className="size-4" aria-hidden="true" />
      Recuperar
    </Button>
  );
}
