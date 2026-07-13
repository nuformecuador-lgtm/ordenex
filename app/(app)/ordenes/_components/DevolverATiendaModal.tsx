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
   * Órdenes `rechazada` de zona CENTRAL seleccionadas al abrir (snapshot). El
   * padre ya filtró a `zonaEsGam === true` (la bodega central solo devuelve las
   * de su zona, R10); una orden satélite aquí sería rechazada por el service con
   * `forbidden` (defensa en profundidad), pero no se ofrece en la UI. Si el
   * filtro deja el lote vacío, el modal avisa y deshabilita el confirmar.
   */
  ordenes: OrdenListItemDTO[];
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

/**
 * Feature 48 (T8, R4/R10/R14) — Modal de confirmación "Devolver a la tienda".
 * Toma las órdenes `rechazada` de zona central seleccionadas y ejecuta el retorno
 * `rechazada → devuelta_origen` llamando a `devolverATienda({ ordenId })` por cada
 * una (loop `await`), acumulando los resultados no-"ok". Si TODAS salen `ok` →
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
    // R4: por cada orden seleccionada se ejecuta el retorno (loop await),
    // acumulando los resultados no-"ok" para no ocultar un fallo parcial.
    const errores: DevolverATiendaActionResult[] = [];
    for (const orden of ordenes) {
      const result = await devolverATienda({ ordenId: orden.id });
      if (result.status !== "ok") errores.push(result);
    }
    if (errores.length > 0) {
      throw errores[0]; // canal de error del Modal (mismo patrón que RutearSateliteModal)
    }

    toast.success(`${ordenes.length} orden(es) devuelta(s) a la tienda.`);
    onSuccess();
  }

  function handleError(error: unknown) {
    toast.error(devolucionOrigenErrorMessage(error));
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Devolver a la tienda"
      description={`Se marcarán ${ordenes.length} orden(es) rechazada(s) como devueltas a su tienda de origen.`}
      confirmLabel="Devolver a la tienda"
      confirmDisabled={sinOrdenes}
      onConfirm={handleConfirm}
      onError={handleError}
    >
      {sinOrdenes ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Selecciona órdenes de zona central.
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
