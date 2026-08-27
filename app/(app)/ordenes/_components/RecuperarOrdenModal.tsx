"use client";

import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/hooks/useToast";
import { recuperarOrdenes } from "@/lib/actions/recuperar-orden";

import { recuperarOrdenErrorMessage } from "./recuperar-orden-error-messages";

/**
 * Forma MÍNIMA que el modal necesita de una orden. La cumple por estructura
 * `OrdenListItemDTO`; se declara aparte por el mismo motivo que su gemela
 * `EliminarOrdenUI`.
 */
export interface RecuperarOrdenUI {
  id: string;
  numRemision: string;
  numGuia?: number | null;
}

export interface RecuperarOrdenModalProps {
  open: boolean;
  /** Snapshot del LOTE seleccionado al abrir. Vacío ⇒ el confirmar queda deshabilitado. */
  ordenes: readonly RecuperarOrdenUI[];
  onOpenChange: (open: boolean) => void;
  /** Éxito: el padre cierra y RELEE el estado del servidor. */
  onSuccess: () => void;
}

const TITULO = "Recuperar órdenes";
const CONFIRMAR = "Recuperar";

/**
 * Pedido humano (2026-08-27) — Modal por LOTE de "Recuperar", la REVERSIÓN del borrado lógico.
 *
 * - UNA sola llamada a la Server Action con el lote COMPLETO, igual que su gemelo: el backend es
 *   todo-o-nada por lote, así que partirlo en N llamadas produciría el estado parcial que el
 *   diseño evita.
 * - "Una por una" NO es otro camino de código: es este mismo modal con UNA orden marcada. Un
 *   botón por fila habría sido una segunda superficie con su propia autorización y su propio
 *   manejo de errores, para decir exactamente lo mismo.
 * - Botón NO destructivo (variante por defecto), al revés que el de eliminar: esto DEVUELVE la
 *   orden al sistema, y pintarlo en rojo enseñaría a temer la acción segura de las dos.
 */
export function RecuperarOrdenModal({
  open,
  ordenes,
  onOpenChange,
  onSuccess,
}: RecuperarOrdenModalProps) {
  const toast = useToast();
  const sinOrdenes = ordenes.length === 0;

  async function handleConfirm() {
    // Guarda redundante con `confirmDisabled`: el handler no debe depender del bloqueo visual
    // para no llamar a la acción con un lote vacío.
    if (sinOrdenes) return;

    const result = await recuperarOrdenes({ ordenIds: ordenes.map((o) => o.id) });
    if (result.status !== "ok") {
      throw result; // canal de error del Modal
    }

    // Se informa CUÁNTAS recuperó el SERVIDOR, no cuántas se marcaron.
    toast.success(`${result.recuperadas} orden(es) recuperada(s).`);
    onSuccess();
  }

  function handleError(error: unknown) {
    toast.error(recuperarOrdenErrorMessage(error));
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={TITULO}
      description={`Se recuperarán ${ordenes.length} orden(es). Volverán a aparecer en los listados con el estado y el historial que tenían al eliminarlas.`}
      confirmLabel={CONFIRMAR}
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
