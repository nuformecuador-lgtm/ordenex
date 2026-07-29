"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { ManifiestoResultado } from "@/components/shared/ManifiestoResultado";
import { useToast } from "@/hooks/useToast";
import { generarGuia } from "@/lib/actions/ordenes-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { guiaDecisionErrorMessage } from "./guia-decision-error-messages";

export interface GenerarGuiaModalProps {
  /** Visibilidad controlada por el padre (patrón `Modal`, feature 13). */
  open: boolean;
  /** Órdenes seleccionadas al abrir (snapshot de un único apartado, R17). */
  ordenes: OrdenListItemDTO[];
  onOpenChange: (open: boolean) => void;
  /** Se invoca tras un "ok" para que el padre refresque los apartados. */
  onSuccess: () => void;
}

/** Feature 148: lote ya cometido + su resumen, para la fase "resultado". */
interface GuiaGeneradaResumen {
  ordenIds: string[];
  mensaje: string;
}

/** Nombre accesible de la única tabla de la fase de edición (R20/R21). */
const TABLA_ARIA_LABEL = "Órdenes por numerar";

/**
 * Columnas de la fase de edición: identifican la orden y nada más (R20). No hay
 * columna de mensajero porque generar guía ya no decide mensajero.
 */
const COLUMNS: Column<OrdenListItemDTO>[] = [
  { id: "numRemision", value: "Nº Remisión", render: "numRemision" },
  { id: "destinatario", value: "Destinatario", render: "destinatario" },
];

/**
 * Modal async "Generar guía" (feature 156, R20-R27): CONFIRMACIÓN DE LOTE.
 *
 * Tras la feature 156 generar guía tiene un solo efecto —numerar y mover de
 * `en_preparacion` a `en_bodega_central`—, así que el modal perdió el selector de
 * mensajero por fila (feature 17) y la separación GAM / NO-GAM que anticipaba el
 * ruteo a satélite (feature 30). Queda una sola tabla con las
 * órdenes del lote (R20/R21) y UNA sola llamada `generarGuia({ ordenIds })`, sin
 * ningún dato de mensajero (R22). La asignación se hace después, desde la bodega
 * (`AsignarBodegaModal` / `RutearSateliteModal`).
 *
 * Feature 148 (§9.7): al confirmar NO se cierra; pasa a la fase "resultado" con el
 * manifiesto del lote (R24) y difiere `onSuccess()` al cierre de esa fase, de donde
 * cuelga el encadenado a "Imprimir etiquetas" del padre (feature 95, R27).
 */
export function GenerarGuiaModal({
  open,
  ordenes,
  onOpenChange,
  onSuccess,
}: GenerarGuiaModalProps) {
  const toast = useToast();
  // Feature 148 (T11, §9.7): fase "resultado". Guarda el LOTE ya cometido (ids del
  // resultado de negocio) para poder ofrecer el manifiesto sin perderlo al cerrar.
  // `null` = fase de edición; objeto = la guía ya se generó.
  const [resultado, setResultado] = useState<GuiaGeneradaResumen | null>(null);
  // Reinicio al REABRIR (ajuste de estado durante el render, no en un `useEffect`,
  // para evitar el render en cascada). Ya no hay selección que reiniciar: solo la
  // fase.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setResultado(null);
    }
  }

  async function handleConfirm() {
    // R22: UNA sola llamada con el lote completo y SIN ningún dato de mensajero.
    const result = await generarGuia({ ordenIds: ordenes.map((o) => o.id) });
    if (result.status !== "ok") {
      // R26: fallo del lote → el Modal invoca `onError`, permanece abierto en la
      // fase de edición y ninguna orden queda numerada a medias.
      throw result;
    }

    // R23: destino ÚNICO. Sin "espera de aceptación" ni "bodega satélite": esta
    // operación ya no puede producir ninguno de los dos.
    const mensaje = `Guía generada para ${result.resultados.length} orden(es): quedan en bodega central.`;
    toast.success(mensaje);
    // Feature 148 (§9.7): la operación YA está cometida; en vez de cerrar, el modal
    // pasa a la fase "resultado" con el mismo resumen + el botón de manifiesto.
    // `onSuccess()` (refresco del padre) se difiere al cierre de esa fase (R24).
    setResultado({
      ordenIds: result.resultados.map((r) => r.ordenId),
      mensaje,
    });
  }

  function handleError(error: unknown) {
    toast.error(guiaDecisionErrorMessage(error));
  }

  /**
   * Cierre de la fase "resultado" por cualquier vía (botón, Escape, overlay): recién
   * ahí se avisa al padre para que refresque. Un fallo de la descarga no pasa por
   * aquí, así que no puede alterar el resultado ya cometido (R25).
   */
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
      title="Generar guía"
      description={
        resultado
          ? "Guías generadas. Descarga el manifiesto del lote antes de cerrar."
          : `Se numerarán ${ordenes.length} orden(es) y pasarán a la bodega central. El mensajero se asigna después, desde la bodega.`
      }
      confirmLabel="Generar guía"
      cancelLabel={resultado ? "Cerrar" : "Cancelar"}
      hideConfirm={resultado !== null}
      // El modal NO se cierra al confirmar: pasa a la fase "resultado" (§9.7).
      closeOnConfirm={false}
      onConfirm={handleConfirm}
      onError={handleError}
      className="max-w-2xl"
    >
      {resultado ? (
        <ManifiestoResultado
          mensaje={resultado.mensaje}
          flujo="generacion_guia"
          seleccion={{ ordenIds: resultado.ordenIds }}
        />
      ) : (
        <DataTable
          columns={COLUMNS}
          data={ordenes}
          rowKey="id"
          ariaLabel={TABLA_ARIA_LABEL}
        />
      )}
    </Modal>
  );
}
