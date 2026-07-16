"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/hooks/useToast";
import { asignarDesdeBodega } from "@/lib/actions/ordenes-guia";
import type { AsignarBodegaResult } from "@/lib/types/orden-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";

import { toMensajeroOptions } from "./mensajero-options";
import { guiaDecisionErrorMessage } from "./guia-decision-error-messages";

export interface AsignarBodegaModalProps {
  open: boolean;
  /** Órdenes de `en_bodega` seleccionadas al abrir (snapshot, R17/R26). */
  ordenes: OrdenListItemDTO[];
  /** TODOS los mensajeros, sin filtro de zona (R28). */
  mensajeros: MensajeroLiteDTO[];
  /** Ajuste maestro: ids de mensajeros con cierre abierto; se deshabilitan en el selector. */
  mensajerosBloqueadosIds?: string[];
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

/**
 * Modal async "Asignar mensajero" desde `en_bodega` (feature 17, T19, R26): un
 * único mensajero para todo el lote seleccionado (design.md §3.2,
 * `asignarDesdeBodega({ ordenIds, mensajeroId })`); NO reasigna `num_guia`
 * (R5/R26, ya asignado en "Generar guía").
 */
export function AsignarBodegaModal({
  open,
  ordenes,
  mensajeros,
  mensajerosBloqueadosIds = [],
  onOpenChange,
  onSuccess,
}: AsignarBodegaModalProps) {
  const toast = useToast();
  const [mensajeroId, setMensajeroId] = useState("");
  // Reinicia la selección solo al transicionar a `open` (ajuste de estado
  // durante el render, no en un `useEffect`, para evitar el render en cascada).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setMensajeroId("");
  }

  const mensajeroOptions = toMensajeroOptions(
    mensajeros,
    new Set(mensajerosBloqueadosIds),
  );

  async function handleConfirm() {
    if (!mensajeroId) {
      // Validación en el borde de UI: sin mensajero no hay nada que asignar.
      // Reusa el canal de error del Modal con la misma forma de resultado.
      const validationError: AsignarBodegaResult = {
        status: "validation_error",
        fieldErrors: { mensajeroId: ["Selecciona un mensajero"] },
      };
      throw validationError;
    }

    const result = await asignarDesdeBodega({
      ordenIds: ordenes.map((orden) => orden.id),
      mensajeroId,
    });
    if (result.status !== "ok") {
      throw result;
    }

    toast.success(`Mensajero asignado a ${result.resultados.length} orden(es).`);
    onSuccess();
  }

  function handleError(error: unknown) {
    toast.error(guiaDecisionErrorMessage(error));
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Asignar mensajero"
      description={`Asigna un mensajero a ${ordenes.length} orden(es) seleccionada(s) de bodega.`}
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
          aria-label="Mensajero para el lote"
        />
      </div>
    </Modal>
  );
}
