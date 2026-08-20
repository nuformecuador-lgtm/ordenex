"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { ManifiestoResultado } from "@/components/shared/ManifiestoResultado";
import { SelectorDiaReparto } from "@/components/shared/SelectorDiaReparto";
import { Select } from "@/components/ui/select";
import { useToast } from "@/hooks/useToast";
import { asignarDesdeSatelite } from "@/lib/actions/recepcion-satelite";
import type { DiaReparto } from "@/lib/types/dia-reparto";
import {
  confirmacionDiaReparto,
  type FechasDiaReparto,
} from "@/lib/utils/dia-reparto-textos";
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
   * Feature 246 (T4.3, R29): las MISMAS fechas y el MISMO contrato que la bodega central. La
   * simetría no es estética: D4 se firmó para que la elección del día signifique exactamente lo
   * mismo desde las dos bodegas.
   */
  fechasDiaReparto: FechasDiaReparto;
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
  fechasDiaReparto,
  onOpenChange,
  onSuccess,
}: AsignarSateliteModalProps) {
  const toast = useToast();
  const [mensajeroId, setMensajeroId] = useState("");
  // Feature 246 (T4.3, R27): «Hoy» PRESELECCIONADO, igual que en bodega central. Ninguna orden
  // acaba reservada para mañana sin que alguien lo elija.
  const [dia, setDia] = useState<DiaReparto>("hoy");
  // Feature 148 (T12, §9.7): fase "resultado" con el lote ya asignado.
  const [resultado, setResultado] = useState<{
    ordenIds: string[];
    mensaje: string;
    /** R28: para qué día quedó el lote, en palabras. Se congela con el lote cometido. */
    confirmacionDia: string;
  } | null>(null);
  // Reinicia la selección solo al transicionar a `open` (ajuste de estado durante
  // el render, no en un `useEffect`, para evitar el render en cascada).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setMensajeroId("");
      // El día vuelve a «hoy» en CADA apertura: el modal no se desmonta al cerrarse, así que
      // sin esto un «mañana» elegido para un lote se quedaría pegado al siguiente.
      setDia("hoy");
      setResultado(null);
    }
  }

  const sinMensajeros = mensajeros.length === 0; // R6
  // Pedido humano 2026-08-18: ya no se deshabilita a nadie por tener un cierre abierto — el
  // service dejo de rechazarlo. Este selector no tiene ninguna otra regla de elegibilidad (la
  // dedicacion reparto/recoleccion es de la central), asi que va sin motivos.
  const mensajeroOptions = toMensajeroOptions(mensajeros);

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
      // Feature 246 (R2/R3): el MISMO token, para TODO el lote. Va siempre, aunque el borde
      // tenga `.default("hoy")`: sin este campo el olvido sería silencioso.
      dia,
    });
    if (result.status !== "ok") {
      throw result;
    }

    const mensaje = `Mensajero asignado a ${result.resultados.length} orden(es).`;
    toast.success(mensaje);
    // Feature 148 (§9.7): asignación ya cometida → fase "resultado"; `onSuccess()`
    // se difiere al cierre. Nada del contrato de negocio cambia (R27).
    setResultado({
      ordenIds: result.resultados.map((r) => r.ordenId),
      mensaje,
      // R28: se congela con el lote cometido, no se deriva del estado vivo del selector.
      confirmacionDia: confirmacionDiaReparto(dia, fechasDiaReparto),
    });
  }

  function handleError(error: unknown) {
    toast.error(asignacionSateliteErrorMessage(error));
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
          : `Asigna un mensajero a ${ordenes.length} orden(es) seleccionada(s) de tu zona.`
      }
      confirmLabel="Asignar"
      cancelLabel={resultado ? "Cerrar" : "Cancelar"}
      confirmDisabled={sinMensajeros}
      hideConfirm={resultado !== null}
      closeOnConfirm={false}
      onConfirm={handleConfirm}
      onError={handleError}
    >
      {resultado ? (
        <div className="flex flex-col gap-3">
          {/* Feature 246 (T4.4, R28): para qué día quedó el lote, con palabras. Espejo exacto
              del de bodega central. */}
          <p
            role="status"
            className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary"
          >
            {resultado.confirmacionDia}
          </p>
          <ManifiestoResultado
            mensaje={resultado.mensaje}
            flujo="asignacion_satelite"
            seleccion={{ ordenIds: resultado.ordenIds }}
          />
        </div>
      ) : (
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
          <>
            <Select
              value={mensajeroId}
              onValueChange={setMensajeroId}
              options={mensajeroOptions}
              placeholder="Selecciona un mensajero"
              aria-label="Mensajero para el lote"
            />
            {/* Feature 246 (T4.3, R2/R27): la MISMA elección que en bodega central. Va dentro
                de la rama con mensajeros: sin nadie a quien asignar, elegir el día no lleva a
                ninguna acción. */}
            <SelectorDiaReparto
              valor={dia}
              onValorChange={setDia}
              fechas={fechasDiaReparto}
            />
          </>
        )}
      </div>
      )}
    </Modal>
  );
}
