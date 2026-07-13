"use client";

import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/hooks/useToast";
import { rutearABodegaSatelite } from "@/lib/actions/ordenes-guia";
import type { RutearSateliteResult } from "@/lib/types/orden-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { guiaDecisionErrorMessage } from "./guia-decision-error-messages";

export interface RutearSateliteModalProps {
  open: boolean;
  /**
   * Órdenes NO-central seleccionadas al abrir (snapshot). El padre ya filtró a
   * `zonaEsCentral === false` (R13); una orden central aquí sería rechazada por el
   * service (defensa en profundidad), pero no se ofrece en la UI.
   */
  ordenes: OrdenListItemDTO[];
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

/**
 * Feature 30 (T16, R13/R15) — Modal de confirmación "Rutear a bodega satélite".
 * Toma las órdenes NO-GAM seleccionadas y las pasa a `en_ruta_bodega_satelite`
 * en UNA sola llamada a `rutearABodegaSatelite({ ordenIds })` (destino derivado
 * de la zona de cada orden, R15). Todo-o-nada: un `status` no-"ok" mantiene el
 * modal abierto vía `onError` del `Modal`, sin efectos parciales (R17).
 */
export function RutearSateliteModal({
  open,
  ordenes,
  onOpenChange,
  onSuccess,
}: RutearSateliteModalProps) {
  const toast = useToast();

  async function handleConfirm() {
    if (ordenes.length === 0) {
      // Validación en el borde de UI: sin órdenes no-GAM no hay nada que rutear.
      const validationError: RutearSateliteResult = {
        status: "validation_error",
        fieldErrors: {
          ordenIds: ["No hay órdenes de bodega satélite seleccionadas"],
        },
      };
      throw validationError;
    }

    const result = await rutearABodegaSatelite({
      ordenIds: ordenes.map((orden) => orden.id),
    });
    if (result.status !== "ok") {
      throw result;
    }

    toast.success(
      `${result.resultados.length} orden(es) en ruta a bodega satélite.`,
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
      title="Rutear a bodega satélite"
      description={`Se enviarán ${ordenes.length} orden(es) no-GAM a la bodega satélite de su zona.`}
      confirmLabel="Rutear a bodega satélite"
      onConfirm={handleConfirm}
      onError={handleError}
    >
      <ul className="max-h-40 list-disc overflow-auto pl-5 text-sm text-muted-foreground">
        {ordenes.map((orden) => (
          <li key={orden.id}>
            {orden.numRemision}
            {orden.zonaNombre ? ` — ${orden.zonaNombre}` : ""}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
