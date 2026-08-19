"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { IntentosDato, valorIntentos } from "@/components/shared/intentos-entrega";
import { ManifiestoResultado } from "@/components/shared/ManifiestoResultado";
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
  /**
   * Órdenes de `en_bodega_central` seleccionadas al abrir (snapshot, R17/R26). El padre
   * ya filtró a `zonaEsGam === true`: `asignarDesdeBodega` exige zona GAM y mensajero de
   * la zona central (R27/R12), así que una orden satélite aquí saldría `conflict`
   * (defensa en profundidad), pero no se ofrece en la UI. Si el filtro deja el lote
   * vacío, el modal avisa y deshabilita el confirmar.
   */
  ordenes: OrdenListItemDTO[];
  /** TODOS los mensajeros, sin filtro de zona (R28). */
  mensajeros: MensajeroLiteDTO[];
  /**
   * Feature 157 (regla de dedicación): ids con una RECOLECCIÓN en tienda sin confirmar.
   * Tienen un viaje comprometido, así que no reciben reparto hasta cerrarlo.
   */
  mensajerosConRecoleccionIds?: string[];
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

/**
 * Modal async "Asignar mensajero" desde `en_bodega_central` (feature 17, T19, R26): un
 * único mensajero para todo el lote seleccionado (design.md §3.2,
 * `asignarDesdeBodega({ ordenIds, mensajeroId })`); NO reasigna `num_guia`
 * (R5/R26, ya asignado en "Generar guía").
 */
export function AsignarBodegaModal({
  open,
  ordenes,
  mensajeros,
  mensajerosConRecoleccionIds = [],
  onOpenChange,
  onSuccess,
}: AsignarBodegaModalProps) {
  const toast = useToast();
  const [mensajeroId, setMensajeroId] = useState("");
  // Feature 148 (T11, §9.7): fase "resultado" con el lote ya cometido.
  const [resultado, setResultado] = useState<{
    ordenIds: string[];
    mensaje: string;
  } | null>(null);
  // Reinicia la selección solo al transicionar a `open` (ajuste de estado
  // durante el render, no en un `useEffect`, para evitar el render en cascada).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setMensajeroId("");
      setResultado(null);
    }
  }

  const mensajeroOptions = toMensajeroOptions(
    mensajeros,
    new Map(
      mensajerosConRecoleccionIds.map((id) => [id, "tiene recolección pendiente"]),
    ),
  );

  // El filtro por zona del padre puede dejar el lote vacío (selección solo de zonas
  // satélite). Sin órdenes no hay nada que asignar, y `asignarDesdeBodega` devolvería
  // un "ok" de 0 órdenes: se avisa y se deshabilita el confirmar, igual que
  // `RecuperarABodegaModal` con su propio filtro.
  const sinOrdenes = ordenes.length === 0;

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

    const mensaje = `Mensajero asignado a ${result.resultados.length} orden(es).`;
    toast.success(mensaje);
    // Feature 148 (§9.7): asignación ya cometida → fase "resultado"; `onSuccess()`
    // se difiere al cierre. La llamada de negocio, su input y su toast no cambian (R27).
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
      title="Asignar mensajero"
      description={
        resultado
          ? "Mensajero asignado. Descarga el manifiesto del lote antes de cerrar."
          : `Asigna un mensajero a ${ordenes.length} orden(es) seleccionada(s) de bodega.`
      }
      confirmLabel="Asignar"
      cancelLabel={resultado ? "Cerrar" : "Cancelar"}
      confirmDisabled={sinOrdenes}
      hideConfirm={resultado !== null}
      closeOnConfirm={false}
      onConfirm={handleConfirm}
      onError={handleError}
    >
      {resultado ? (
        <ManifiestoResultado
          mensaje={resultado.mensaje}
          flujo="generacion_guia"
          seleccion={{ ordenIds: resultado.ordenIds }}
        />
      ) : sinOrdenes ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Selecciona órdenes de la zona central.
        </p>
      ) : (
      <div className="flex flex-col gap-2">
        <ul className="max-h-40 list-disc overflow-auto pl-5 text-sm text-muted-foreground">
          {/* Feature 160 (R18/R19/R23): dato etiquetado junto a cada orden listada, en
              la misma línea y con el mismo markup que el resto del `<li>`. Siempre
              visible, `0` incluido; sin umbral (R20). */}
          {ordenes.map((orden) => (
            <li key={orden.id}>
              {orden.numRemision} · <IntentosDato intentos={valorIntentos(orden)} />
            </li>
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
      )}
    </Modal>
  );
}
