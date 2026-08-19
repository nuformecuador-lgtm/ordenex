"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/hooks/useToast";
import { asignarRecoleccion } from "@/lib/actions/ordenes-guia";
import type { AsignarRecoleccionResult } from "@/lib/types/orden-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";

import { toMensajeroOptions } from "./mensajero-options";
import { guiaDecisionErrorMessage } from "./guia-decision-error-messages";

export interface AsignarRecoleccionModalProps {
  open: boolean;
  /** Órdenes de `por_recolectar_en_tienda` seleccionadas al abrir (snapshot, R3). */
  ordenes: OrdenListItemDTO[];
  /** Mensajeros elegibles: CUALQUIERA activo (decisión del humano 2026-07-30, R6). */
  mensajeros: MensajeroLiteDTO[];
  /**
   * Ids con órdenes de REPARTO pendientes (regla de dedicación, 2026-07-31): quien va a
   * una tienda a recoger un lote sale sin carga, así que no se les puede asignar. Se
   * deshabilitan con el motivo a la vista; el service lo revalida igual.
   */
  mensajerosConRepartoIds?: string[];
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

/**
 * Feature 157 (R3) — "Asignar mensajero para recolección": quién va a la tienda a recoger un
 * lote que sigue físicamente allí. Copia REDUCIDA de `AsignarBodegaModal`, con dos ausencias
 * deliberadas:
 *
 * - **Sin fase "resultado" con manifiesto.** El manifiesto de estas órdenes ya se emitió al
 *   crearlas (feature 155, rama sin fulfillment): repetirlo aquí sería un segundo documento
 *   del mismo lote. Al éxito se cierra y se revalida, como el resto de acciones por lote.
 * - **Sin `IntentosDato`.** Los intentos de entrega son del tramo de reparto; una orden que
 *   todavía está en la tienda no ha intentado entregarse nunca.
 *
 * La orden NO cambia de estado: sigue en `por_recolectar_en_tienda` hasta que el mensajero
 * confirme la recolección escaneando su etiqueta.
 */
export function AsignarRecoleccionModal({
  open,
  ordenes,
  mensajeros,
  mensajerosConRepartoIds = [],
  onOpenChange,
  onSuccess,
}: AsignarRecoleccionModalProps) {
  const toast = useToast();
  const [mensajeroId, setMensajeroId] = useState("");
  // Reinicia la selección solo al transicionar a `open` (ajuste de estado durante el render,
  // no en un `useEffect`, para evitar el render en cascada). Mismo patrón que el modal hermano.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setMensajeroId("");
  }

  const mensajeroOptions = toMensajeroOptions(
    mensajeros,
    new Map(mensajerosConRepartoIds.map((id) => [id, "tiene reparto pendiente"])),
  );

  async function handleConfirm() {
    if (!mensajeroId) {
      // Validación en el borde de UI: sin mensajero no hay nada que asignar. Reusa el canal
      // de error del Modal con la misma forma de resultado que devuelve la action.
      const validationError: AsignarRecoleccionResult = {
        status: "validation_error",
        fieldErrors: { mensajeroId: ["Selecciona un mensajero"] },
      };
      throw validationError;
    }

    const result = await asignarRecoleccion({
      ordenIds: ordenes.map((orden) => orden.id),
      mensajeroId,
    });
    if (result.status !== "ok") throw result;

    toast.success(
      `Mensajero asignado para recolectar ${result.resultados.length} orden(es).`,
    );
    onSuccess();
  }

  function handleError(error: unknown) {
    toast.error(guiaDecisionErrorMessage(error));
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Asignar mensajero para recolección"
      description={`Elige quién va a la tienda a recoger ${ordenes.length} orden(es).`}
      confirmLabel="Asignar"
      onConfirm={handleConfirm}
      onError={handleError}
    >
      <div className="flex flex-col gap-2">
        <ul className="max-h-40 list-disc overflow-auto pl-5 text-sm text-muted-foreground">
          {ordenes.map((orden) => (
            <li key={orden.id}>{orden.numRemision}</li>
          ))}
        </ul>
        <Select
          value={mensajeroId}
          onValueChange={setMensajeroId}
          options={mensajeroOptions}
          placeholder="Selecciona un mensajero"
          aria-label="Mensajero para la recolección"
        />
      </div>
    </Modal>
  );
}
