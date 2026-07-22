"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/useToast";
import { mananaCalendarioCR } from "@/lib/utils/fecha-cr";
import { reprogramarNovedad } from "@/lib/actions/resolver-novedad";
import type { NovedadDTO } from "@/lib/types/novedad";

import { reprogramarNovedadErrorMessage } from "./reprogramar-novedad-error-messages";

export interface ReprogramarNovedadModalProps {
  /**
   * Orden `devuelta` a reprogramar (snapshot). El padre monta el modal SOLO cuando
   * hay una orden activa, con `key={orden.id}`, de modo que la fecha/motivo arrancan
   * frescos en cada apertura sin un efecto de reinicio.
   */
  orden: NovedadDTO;
  onOpenChange: (open: boolean) => void;
  /** Éxito: id de la orden reprogramada; el padre la quita de la lista. */
  onReprogramada: (ordenId: string) => void;
}

/**
 * Feature 100 (T3.1/T3.2) — Modal "Reprogramar" de /novedades. El adminTienda dueño
 * elige una nueva fecha (mañana o posterior en el calendario de CR: `min`/default =
 * `mananaCalendarioCR`, R4) y un motivo OPCIONAL (Q1), y confirma la transición
 * `devuelta → reprogramada` vía `reprogramarNovedad`. En éxito la orden sale de la
 * lista (`onReprogramada`) + toast de éxito; un `status` no-"ok" se enruta al canal de
 * error del `Modal` (throw) y se traduce a un mensaje claro por estado (toast). Patrón
 * `DevolverATiendaModal` (feature 48).
 */
export function ReprogramarNovedadModal({
  orden,
  onOpenChange,
  onReprogramada,
}: ReprogramarNovedadModalProps) {
  const toast = useToast();
  // Default y mínimo = mañana (CR): la reprogramación más temprana posible (R4).
  const manana = mananaCalendarioCR();
  const [fecha, setFecha] = useState(manana);
  const [motivo, setMotivo] = useState("");

  // Guarda de UI (defensa de superficie); el borde revalida con zod (R4/R23).
  const fechaInvalida = fecha === "" || fecha < manana;

  async function handleConfirm() {
    const motivoLimpio = motivo.trim();
    const result = await reprogramarNovedad({
      ordenId: orden.id,
      fechaReprogramacion: fecha,
      // Motivo OPCIONAL (Q1): vacío -> se omite (no forzar texto).
      motivo: motivoLimpio === "" ? undefined : motivoLimpio,
    });
    if (result.status !== "ok") {
      throw result; // canal de error del Modal (mismo patrón que DevolverATiendaModal)
    }
    toast.success("Orden reprogramada.");
    onReprogramada(orden.id);
  }

  function handleError(error: unknown) {
    toast.error(reprogramarNovedadErrorMessage(error));
  }

  const guia =
    orden.numGuia !== null ? `guía ${orden.numGuia}` : "sin guía asignada";

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      title="Reprogramar entrega"
      description={`Elegí una nueva fecha para la orden de ${orden.destinatario} (${guia}).`}
      confirmLabel="Reprogramar"
      confirmDisabled={fechaInvalida}
      onConfirm={handleConfirm}
      onError={handleError}
      size="sm"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reprogramar-fecha">Nueva fecha</Label>
          <Input
            id="reprogramar-fecha"
            type="date"
            value={fecha}
            min={manana}
            onChange={(e) => setFecha(e.target.value)}
            aria-invalid={fechaInvalida || undefined}
            aria-describedby={fechaInvalida ? "reprogramar-fecha-error" : undefined}
          />
          {fechaInvalida ? (
            <p
              id="reprogramar-fecha-error"
              role="alert"
              className="text-sm text-destructive"
            >
              La fecha debe ser mañana o posterior.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reprogramar-motivo">
            Motivo{" "}
            <span className="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <textarea
            id="reprogramar-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground dark:bg-input/30"
          />
        </div>
      </div>
    </Modal>
  );
}
