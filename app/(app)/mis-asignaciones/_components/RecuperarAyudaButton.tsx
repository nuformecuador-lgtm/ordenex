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
// Se probó a colgarle un modal con nota (2026-08-18) y se REVIRTIÓ por decisión humana: ese paso
// con nota vive en «Habilitar», del lado de la tienda, no aquí.
//
// `Undo2` es el MISMO icono que el repo ya usa para «Devolver» en `/novedades` y en el panel de
// gestión: no se eligió por parecerse a la palabra, sino porque en este repo ese dibujo ya
// significa «devolver esto a donde estaba».
//
// ⚠️ FEATURE 235 (R25) — ESTE BOTÓN NO TIENE PROP `disabled`, Y ES A PROPÓSITO. La tuvo, con el
// sentido «`true` con el mensajero bloqueado por cierre pendiente (feature 111/R14)», y eso
// contradecía R25: el rescate DEBE seguir disponible con el mensajero bloqueado, porque es la
// salida del deadlock que documenta `lib/services/rescate-ayuda.ts` (cierre `vencido` + orden en
// ayuda = ni rescatar ni cerrar). El servicio nunca comprobó el bloqueo; solo la pantalla lo
// negaba, y un permiso que existe en el servidor y no se puede ejercer en la UI es lo que R35
// prohíbe. La prop se retiró en vez de corregir su doc para que no haya por dónde reponer la
// conducta: lo único que apaga este botón es su propio envío en curso.

export interface RecuperarAyudaButtonProps {
  ordenId: string;
  /** Para el nombre accesible: en una lista de varias filas es lo que distingue un botón de otro. */
  numRemision: string;
  /** Se invoca tras un `ok` para que el módulo relea el listado (la orden cambia de sección). */
  onRecuperada: () => void;
}

export function RecuperarAyudaButton({
  ordenId,
  numRemision,
  onRecuperada,
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
      disabled={enviando}
      onClick={handleClick}
      aria-label={`Retirar la solicitud de ayuda de la orden ${numRemision}`}
    >
      <Undo2 className="size-4" aria-hidden="true" />
      Recuperar
    </Button>
  );
}
