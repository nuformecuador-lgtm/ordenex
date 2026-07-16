"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/hooks/useToast";
import { asignarDesdeSatelite } from "@/lib/actions/recepcion-satelite";
import type { AsignarSateliteResult } from "@/lib/types/recepcion-satelite";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

import { toMensajeroOptions } from "@/app/(app)/ordenes/_components/mensajero-options";
import { asignacionSateliteErrorMessage } from "./asignacion-satelite-error-messages";

export interface AsignarSateliteModalProps {
  open: boolean;
  /** Órdenes `en_bodega_satelite` seleccionadas al abrir (snapshot, R4). */
  ordenes: RecepcionSateliteDTO[];
  /** Mensajeros de la zona del adminSatelite (ya scoped server-side, R5). */
  mensajeros: { id: string; nombre: string }[];
  /**
   * Pedido admin_satelite: ids de mensajeros con un cierre abierto. Se muestran
   * deshabilitados en el selector (no asignables) para poder seguir asignando al resto.
   */
  mensajerosBloqueadosIds?: string[];
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

/**
 * Feature 34 (T9, F1.4-d): modal por lote con UN mensajero para asignar órdenes
 * `en_bodega_satelite` de la zona del adminSatelite (clon de `AsignarBodegaModal`
 * de la 17). Confirmar → `asignarDesdeSatelite({ ordenIds, mensajeroId })`; un
 * resultado no-"ok" se lanza al canal de error del `Modal` y se traduce a un
 * mensaje de usuario (R7/R9/R10). Si la zona no tiene mensajeros (R6), muestra un
 * estado vacío accionable y deshabilita el confirmar, SIN efectos en datos.
 */
export function AsignarSateliteModal({
  open,
  ordenes,
  mensajeros,
  mensajerosBloqueadosIds = [],
  onOpenChange,
  onSuccess,
}: AsignarSateliteModalProps) {
  const toast = useToast();
  const [mensajeroId, setMensajeroId] = useState("");
  // Reinicia la selección solo al transicionar a `open` (ajuste de estado durante
  // el render, no en un `useEffect`, para evitar el render en cascada).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setMensajeroId("");
  }

  const sinMensajeros = mensajeros.length === 0; // R6
  const mensajeroOptions = toMensajeroOptions(
    mensajeros,
    new Set(mensajerosBloqueadosIds),
  );

  async function handleConfirm() {
    if (!mensajeroId) {
      // Validación en el borde de UI: sin mensajero no hay nada que asignar.
      // Reusa el canal de error del Modal con la misma forma de resultado.
      const validationError: AsignarSateliteResult = {
        status: "validation_error",
        fieldErrors: { mensajeroId: ["Selecciona un mensajero"] },
      };
      throw validationError;
    }

    const result = await asignarDesdeSatelite({
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
    toast.error(asignacionSateliteErrorMessage(error));
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Asignar mensajero"
      description={`Asigna un mensajero a ${ordenes.length} orden(es) seleccionada(s) de tu zona.`}
      confirmLabel="Asignar"
      confirmDisabled={sinMensajeros}
      onConfirm={handleConfirm}
      onError={handleError}
    >
      <div className="flex flex-col gap-2">
        <ul className="max-h-40 list-disc overflow-auto pl-5 text-sm text-muted-foreground">
          {ordenes.map((orden) => (
            <li key={orden.id}>{orden.numRemision}</li>
          ))}
        </ul>
        {sinMensajeros ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            No hay mensajeros en tu zona. Pide a un administrador que asigne
            mensajeros a tu zona para poder asignar órdenes.
          </p>
        ) : (
          <Select
            value={mensajeroId}
            onValueChange={setMensajeroId}
            options={mensajeroOptions}
            placeholder="Selecciona un mensajero"
            aria-label="Mensajero para el lote"
          />
        )}
      </div>
    </Modal>
  );
}
