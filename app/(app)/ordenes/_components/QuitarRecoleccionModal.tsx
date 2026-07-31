"use client";

import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/hooks/useToast";
import { desasignarRecoleccion } from "@/lib/actions/ordenes-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { guiaDecisionErrorMessage } from "./guia-decision-error-messages";

export interface QuitarRecoleccionModalProps {
  open: boolean;
  /** Órdenes en `recolectando` seleccionadas al abrir (snapshot). */
  ordenes: OrdenListItemDTO[];
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

/**
 * Feature 157 (ampliación 2026-07-31) — "Quitar mensajero": devuelve una recolección al montón
 * de asignables (`recolectando` → `por_recolectar_en_tienda`, sin mensajero).
 *
 * No hay nada que elegir, así que no hay formulario: la confirmación ES la acción. Existe
 * porque cambiar de mensajero dejó de poder hacerse por encima — antes, asignar sobre una
 * orden ya asignada la sobreescribía en silencio y nunca salía del montón, así que la misma
 * orden podía reasignarse indefinidamente. Ahora son dos actos deliberados, y los dos quedan
 * en el historial.
 */
export function QuitarRecoleccionModal({
  open,
  ordenes,
  onOpenChange,
  onSuccess,
}: QuitarRecoleccionModalProps) {
  const toast = useToast();

  async function handleConfirm() {
    const result = await desasignarRecoleccion({
      ordenIds: ordenes.map((orden) => orden.id),
    });
    if (result.status !== "ok") throw result;

    toast.success(
      `${result.resultados.length} orden(es) vuelven a estar disponibles para asignar.`,
    );
    onSuccess();
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Quitar mensajero"
      description={`${ordenes.length} orden(es) volverán a "Por recolectar en tienda", sin mensajero, para poder asignarlas a otro.`}
      confirmLabel="Quitar mensajero"
      confirmVariant="destructive"
      onConfirm={handleConfirm}
      onError={(error) => toast.error(guiaDecisionErrorMessage(error))}
    >
      <ul className="max-h-40 list-disc overflow-auto pl-5 text-sm text-muted-foreground">
        {ordenes.map((orden) => (
          <li key={orden.id}>{orden.numRemision}</li>
        ))}
      </ul>
    </Modal>
  );
}
