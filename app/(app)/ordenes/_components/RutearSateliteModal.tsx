"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { ManifiestoResultado } from "@/components/shared/ManifiestoResultado";
import { useToast } from "@/hooks/useToast";
import { rutearABodegaSatelite } from "@/lib/actions/ordenes-guia";
import type { RutearSateliteResult } from "@/lib/types/orden-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { guiaDecisionErrorMessage } from "./guia-decision-error-messages";

export interface RutearSateliteModalProps {
  open: boolean;
  /**
   * Órdenes NO-GAM seleccionadas al abrir (snapshot). El padre ya filtró a
   * `zonaEsGam === false` (R13); una orden GAM aquí sería rechazada por el
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
  // Feature 148 (T12, §9.7): fase "resultado" con el lote ya ruteado.
  const [resultado, setResultado] = useState<{
    ordenIds: string[];
    mensaje: string;
  } | null>(null);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setResultado(null);
  }

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

    const mensaje = `${result.resultados.length} orden(es) en ruta a bodega satélite.`;
    toast.success(mensaje);
    // Feature 148 (§9.7): ruteo ya cometido → fase "resultado"; `onSuccess()` se
    // difiere al cierre. Input, toast y manejo del resultado de negocio intactos (R27).
    setResultado({
      ordenIds: result.resultados.map((r) => r.ordenId),
      mensaje,
    });
  }

  function handleError(error: unknown) {
    toast.error(guiaDecisionErrorMessage(error));
  }

  /** Cierre de la fase "resultado" por cualquier vía: recién ahí refresca el padre. */
  function handleOpenChange(next: boolean) {
    if (!next && resultado) {
      setResultado(null);
      onOpenChange(false);
      onSuccess();
      return;
    }
    onOpenChange(next);
  }

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Rutear a bodega satélite"
      description={
        resultado
          ? "Órdenes ruteadas. Descarga el manifiesto del lote antes de cerrar."
          : `Se enviarán ${ordenes.length} orden(es) no-GAM a la bodega satélite de su zona.`
      }
      confirmLabel="Rutear a bodega satélite"
      cancelLabel={resultado ? "Cerrar" : "Cancelar"}
      hideConfirm={resultado !== null}
      closeOnConfirm={false}
      onConfirm={handleConfirm}
      onError={handleError}
    >
      {resultado ? (
        <ManifiestoResultado
          mensaje={resultado.mensaje}
          flujo="ruteo_satelite"
          seleccion={{ ordenIds: resultado.ordenIds }}
        />
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
