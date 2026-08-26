"use client";

import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/hooks/useToast";
import { eliminarOrdenes } from "@/lib/actions/eliminar-orden";

import { eliminarOrdenErrorMessage } from "./eliminar-orden-error-messages";

/**
 * Forma MÍNIMA que el modal necesita de una orden. La cumple por estructura
 * `OrdenListItemDTO`; se declara aparte para que otra superficie pueda reusar el cuerpo sin
 * arrastrar el DTO completo (patrón `DeshacerAsignacionOrdenUI`).
 */
export interface EliminarOrdenUI {
  id: string;
  numRemision: string;
  numGuia?: number | null;
}

export interface EliminarOrdenModalProps {
  open: boolean;
  /** Snapshot del LOTE seleccionado al abrir. Vacío ⇒ el confirmar queda deshabilitado. */
  ordenes: readonly EliminarOrdenUI[];
  onOpenChange: (open: boolean) => void;
  /** Éxito: el padre cierra y RELEE el estado del servidor. */
  onSuccess: () => void;
}

const TITULO = "Eliminar órdenes";
const CONFIRMAR = "Eliminar";

/**
 * Feature «eliminar orden» — Modal por LOTE de "Eliminar".
 *
 * - UNA sola llamada a la Server Action con el lote COMPLETO: el backend es todo-o-nada por
 *   lote, así que partirlo en N llamadas produciría el estado parcial que el diseño evita.
 * - Confirmación EXPLÍCITA y botón `destructive`: el borrado retira la orden de todos los
 *   listados y ninguna pantalla lo deshace. Se dice en la descripción, no solo en el color.
 * - Los fallos van al canal de error del `Modal` y se traducen por causa, sin exponer
 *   identificadores internos.
 */
export function EliminarOrdenModal({
  open,
  ordenes,
  onOpenChange,
  onSuccess,
}: EliminarOrdenModalProps) {
  const toast = useToast();
  const sinOrdenes = ordenes.length === 0;

  async function handleConfirm() {
    // Guarda redundante con `confirmDisabled`: el handler no debe depender del bloqueo visual
    // para no llamar a la acción con un lote vacío.
    if (sinOrdenes) return;

    const result = await eliminarOrdenes({ ordenIds: ordenes.map((o) => o.id) });
    if (result.status !== "ok") {
      throw result; // canal de error del Modal
    }

    // Se informa CUÁNTAS eliminó el SERVIDOR, no cuántas se marcaron.
    toast.success(`${result.eliminadas} orden(es) eliminada(s).`);
    onSuccess();
  }

  function handleError(error: unknown) {
    toast.error(eliminarOrdenErrorMessage(error));
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={TITULO}
      description={`Se eliminarán ${ordenes.length} orden(es). Dejarán de aparecer en los listados y esta acción no se puede deshacer desde la aplicación.`}
      confirmLabel={CONFIRMAR}
      confirmVariant="destructive"
      confirmDisabled={sinOrdenes}
      onConfirm={handleConfirm}
      onError={handleError}
    >
      {sinOrdenes ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Selecciona al menos una orden.
        </p>
      ) : (
        <ul className="max-h-40 list-disc overflow-auto pl-5 text-sm text-muted-foreground">
          {ordenes.map((orden) => (
            <li key={orden.id}>
              {orden.numRemision}
              {orden.numGuia ? ` — guía ${orden.numGuia}` : ""}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
