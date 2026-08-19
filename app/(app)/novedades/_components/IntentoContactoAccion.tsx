"use client";

import { useState } from "react";
import { PhoneOutgoing } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/useToast";
import { registrarIntentoContactoOrden } from "@/lib/actions/orden-ayuda";
import type { NovedadDTO } from "@/lib/types/novedad";

// Pedido humano 2026-08-18 — «+1 intento de contacto»: el botón con el que la TIENDA registra que
// volvió a intentar resolver una orden con ayuda pedida, y el contador de esos intentos.
//
// SOLO se monta cuando `novedad.ayuda` es `true` (la condición la aplica `NovedadAcciones`, que es
// quien conoce la fila entera). Sobre una devolución corriente no aparece: el contador nació para
// medir el esfuerzo sobre una orden atascada, y ofrecerlo en toda la lista lo convertiría en otro
// número más que nadie mira.
//
// EL CONTADOR SE PINTA SIEMPRE QUE EL BOTÓN ESTÉ, EL `0` INCLUIDO. «Todavía no lo intentó nadie» es
// un dato, y es justamente el que hace falta para decidir si vale la pena intentarlo ahora. Un
// contador que sólo aparece a partir de uno obliga a leer su ausencia, y una ausencia no se
// distingue de un componente que falló al montar.
//
// OPTIMISTA CON VUELTA ATRÁS: el número sube al pulsar y, si el servidor rechaza, vuelve a bajar
// con un aviso. El servidor manda siempre — su respuesta trae el valor YA INCREMENTADO y ése es el
// que se pinta, no el que este componente había calculado. Eso importa con dos personas de la
// misma tienda mirando la misma orden: el `increment` ocurre en la base, así que dos pulsaciones
// simultáneas dan dos, y quien pulsó segundo ve el 2 aunque su pantalla dijera 0 hace un momento.

export interface IntentoContactoAccionProps {
  novedad: NovedadDTO;
}

/** Etiqueta del tooltip. Es la ACCIÓN, no el nombre accesible del control (ver abajo). */
const TOOLTIP = "+1 intento de contacto";

export function IntentoContactoAccion({ novedad }: IntentoContactoAccionProps) {
  const toast = useToast();
  // Semilla del servidor. La fila se remonta al cambiar de página (`key={novedad.id}` en el
  // módulo), así que este estado nunca sobrevive a una orden distinta.
  const [intentos, setIntentos] = useState(novedad.intentosContacto);
  const [enviando, setEnviando] = useState(false);

  async function handleClick() {
    if (enviando) return;
    setEnviando(true);
    const previo = intentos;
    setIntentos(previo + 1); // optimista
    try {
      const result = await registrarIntentoContactoOrden({ ordenId: novedad.id });
      if (result.status === "ok") {
        // El valor del SERVIDOR, no el que calculamos: es el que cuenta las pulsaciones de todos.
        setIntentos(result.intentosContacto);
        return;
      }
      setIntentos(previo); // vuelta atrás: el número no puede quedar diciendo algo que no se guardó
      toast.error(
        result.status === "unauthenticated"
          ? "Tu sesión expiró. Iniciá sesión de nuevo."
          : "No se pudo registrar el intento de contacto de esta orden.",
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="outline"
              // `icon` (size-8): el mismo cuadrado que sus vecinos de la fila. Dos tamaños en
              // una misma fila de botones se leen como dos grupos de acciones que no existen.
              size="icon"
              className="shrink-0"
              disabled={enviando}
              onClick={handleClick}
              // EL TOOLTIP NO ES EL NOMBRE DEL CONTROL: aparece al pasar el puntero o al enfocar,
              // y en el móvil de una tienda no hay hover con el que descubrirlo. El nombre
              // accesible nombra la orden concreta, porque la lista trae varias filas y todos
              // estos botones llevan el mismo icono.
              aria-label={`Registrar un intento de contacto con la orden de ${novedad.destinatario}`}
            >
              <PhoneOutgoing className="size-4" aria-hidden="true" />
            </Button>
          }
        />
        <TooltipContent>{TOOLTIP}</TooltipContent>
      </Tooltip>
      <span
        // `aria-live`: quien no ve la pantalla necesita enterarse de que el número subió, y el
        // botón no se lo dice (su nombre no cambia). `polite` porque no interrumpe nada.
        aria-live="polite"
        className="min-w-6 rounded-full bg-muted px-1.5 py-0.5 text-center font-mono text-xs font-bold tabular-nums text-muted-foreground"
      >
        <span className="sr-only">Intentos de contacto: </span>
        {intentos}
      </span>
    </div>
  );
}
