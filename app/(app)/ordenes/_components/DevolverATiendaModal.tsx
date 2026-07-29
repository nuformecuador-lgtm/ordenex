"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { IntentosDato, valorIntentos } from "@/components/shared/intentos-entrega";
import { ManifiestoResultado } from "@/components/shared/ManifiestoResultado";
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
  // Feature 148 (T14, §9.1/§9.7): fase "resultado". El lote de esta operación existe
  // SOLO en la UI (el service es por-orden), así que se acumulan aquí los ids con
  // `status === "ok"`; el service NO se toca (R27).
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
    // R15: por cada orden seleccionada se ejecuta el envío (loop await),
    // acumulando los resultados no-"ok" para no ocultar un fallo parcial.
    const errores: DevolverATiendaActionResult[] = [];
    const enviadasIds: string[] = [];
    for (const orden of ordenes) {
      const result = await devolverATienda({ ordenId: orden.id });
      if (result.status !== "ok") errores.push(result);
      else enviadasIds.push(orden.id); // R23: solo las efectivamente enviadas
    }
    if (errores.length > 0) {
      throw errores[0]; // canal de error del Modal (mismo patrón que RutearSateliteModal)
    }

    const mensaje = `${ordenes.length} orden(es) enviada(s) a la tienda.`;
    toast.success(mensaje);
    // El envío ya está cometido → fase "resultado"; `onSuccess()` se difiere al cierre.
    setResultado({ ordenIds: enviadasIds, mensaje });
  }

  function handleError(error: unknown) {
    toast.error(devolucionOrigenErrorMessage(error));
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
      title="Enviar a la tienda"
      description={
        resultado
          ? "Órdenes enviadas. Descarga el manifiesto del lote antes de cerrar."
          : `Se enviarán ${ordenes.length} orden(es) a su tienda de origen.`
      }
      confirmLabel="Enviar a la tienda"
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
          flujo="envio_tienda"
          seleccion={{ ordenIds: resultado.ordenIds }}
        />
      ) : sinOrdenes ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Selecciona al menos una orden.
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
