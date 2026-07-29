"use client";

import { Modal } from "@/components/shared/Modal";
import { IntentosDato, valorIntentos } from "@/components/shared/intentos-entrega";
import { useToast } from "@/hooks/useToast";
import {
  recuperarABodega,
  type RecuperarABodegaActionResult,
} from "@/lib/actions/resolver-novedad";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { recuperarBodegaErrorMessage } from "./recuperar-bodega-error-messages";

export interface RecuperarABodegaModalProps {
  open: boolean;
  /**
   * Órdenes `devuelta` de zona CENTRAL seleccionadas al abrir (snapshot). El padre ya
   * filtró a `zonaEsGam === true` (maestro/admin solo recupera las de la bodega
   * central, R15); una orden satélite aquí sería rechazada por el service con
   * `forbidden` (defensa en profundidad), pero no se ofrece en la UI. Si el filtro
   * deja el lote vacío, el modal avisa y deshabilita el confirmar.
   */
  ordenes: OrdenListItemDTO[];
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

/**
 * Feature 100 (T4.2, R12/R15) — Modal "Recuperar a bodega". Toma las órdenes
 * `devuelta` de zona central seleccionadas y ejecuta la recuperación
 * `devuelta → en_bodega_central` llamando a `recuperarABodega({ ordenId })` por cada una
 * (loop `await`), acumulando los resultados no-"ok". Si TODAS salen `ok` →
 * `onSuccess()`; si alguna falla, el primer error se lanza al canal de error del
 * `Modal` y se traduce a un mensaje de usuario por estado. El botón queda
 * deshabilitado mientras procesa (fase "pending" del `Modal`). Espejo de
 * `DevolverATiendaModal` (feature 48).
 */
export function RecuperarABodegaModal({
  open,
  ordenes,
  onOpenChange,
  onSuccess,
}: RecuperarABodegaModalProps) {
  const toast = useToast();
  const sinOrdenes = ordenes.length === 0;

  async function handleConfirm() {
    // R12: por cada orden seleccionada se ejecuta la recuperación (loop await),
    // acumulando los resultados no-"ok" para no ocultar un fallo parcial.
    const errores: RecuperarABodegaActionResult[] = [];
    for (const orden of ordenes) {
      const result = await recuperarABodega({ ordenId: orden.id });
      if (result.status !== "ok") errores.push(result);
    }
    if (errores.length > 0) {
      throw errores[0]; // canal de error del Modal (mismo patrón que DevolverATiendaModal)
    }

    toast.success(`${ordenes.length} orden(es) recuperada(s) a bodega.`);
    onSuccess();
  }

  function handleError(error: unknown) {
    toast.error(recuperarBodegaErrorMessage(error));
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Recuperar a bodega"
      description={`Se recuperarán ${ordenes.length} orden(es) en devolución a la bodega central para un nuevo intento.`}
      confirmLabel="Recuperar a bodega"
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
          {/* Feature 160 (R18/R19/R23): dato etiquetado junto a cada orden listada, en
              la misma linea y con el mismo markup que el resto del `<li>`. Siempre
              visible, `0` incluido; sin umbral (R20). */}
          {ordenes.map((orden) => (
            <li key={orden.id}>
              {orden.numRemision}
              {orden.zonaNombre ? ` — ${orden.zonaNombre}` : ""}
              {" · "}
              <IntentosDato intentos={valorIntentos(orden)} />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
