"use client";

import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/hooks/useToast";
import {
  devolverATienda,
  type DevolverATiendaActionResult,
} from "@/lib/actions/devolucion-origen";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { devolucionOrigenErrorMessage } from "./devolucion-origen-error-messages";

export interface DevolverATiendaModalProps {
  open: boolean;
  /**
   * Órdenes `por_devolver_a_tienda` seleccionadas al abrir (snapshot). Feature 139/R15:
   * la acción es maestro/admin central directa (NO por zona), así que el padre NO
   * filtra por `zonaEsGam` — estas órdenes están, por construcción, físicamente en la
   * central (incluidas las de origen satélite ya recibidas). Si el lote está vacío, el
   * modal avisa y deshabilita el confirmar.
   */
  ordenes: OrdenListItemDTO[];
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

/**
 * Feature 48 (T8) / Feature 139 (T3.2, R15) — Modal de confirmación "Enviar a la tienda".
 * Toma las órdenes `por_devolver_a_tienda` seleccionadas y ejecuta el envío
 * `por_devolver_a_tienda → devolviendo_a_tienda` llamando a `devolverATienda({ ordenId })`
 * por cada una (loop `await`), acumulando los resultados no-"ok". Si TODAS salen `ok` →
 * `onSuccess()`; si alguna falla, el primer error se lanza al canal de error del
 * `Modal` y se traduce a un mensaje de usuario. El botón queda deshabilitado
 * mientras procesa (fase "pending" del `Modal`). Patrón `RutearSateliteModal`.
 */
export function DevolverATiendaModal({
  open,
  ordenes,
  onOpenChange,
  onSuccess,
}: DevolverATiendaModalProps) {
  const toast = useToast();
  const sinOrdenes = ordenes.length === 0;

  async function handleConfirm() {
    // R15: por cada orden seleccionada se ejecuta el envío (loop await),
    // acumulando los resultados no-"ok" para no ocultar un fallo parcial.
    const errores: DevolverATiendaActionResult[] = [];
    for (const orden of ordenes) {
      const result = await devolverATienda({ ordenId: orden.id });
      if (result.status !== "ok") errores.push(result);
    }
    if (errores.length > 0) {
      throw errores[0]; // canal de error del Modal (mismo patrón que RutearSateliteModal)
    }

    toast.success(`${ordenes.length} orden(es) enviada(s) a la tienda.`);
    onSuccess();
  }

  function handleError(error: unknown) {
    toast.error(devolucionOrigenErrorMessage(error));
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Enviar a la tienda"
      description={`Se enviarán ${ordenes.length} orden(es) a su tienda de origen.`}
      confirmLabel="Enviar a la tienda"
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
              {orden.zonaNombre ? ` — ${orden.zonaNombre}` : ""}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
