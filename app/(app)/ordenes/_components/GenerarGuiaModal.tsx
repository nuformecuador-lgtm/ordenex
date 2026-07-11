"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Select } from "@/components/ui/select";
import { useToast } from "@/hooks/useToast";
import { generarGuia } from "@/lib/actions/ordenes-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";

import { toMensajeroOptions } from "./mensajero-options";
import { guiaDecisionErrorMessage } from "./guia-decision-error-messages";

export interface GenerarGuiaModalProps {
  /** Visibilidad controlada por el padre (patrón `Modal`, feature 13). */
  open: boolean;
  /** Órdenes seleccionadas al abrir (snapshot de un único apartado, R17). */
  ordenes: OrdenListItemDTO[];
  /** TODOS los mensajeros, sin filtro de zona (R28). */
  mensajeros: MensajeroLiteDTO[];
  onOpenChange: (open: boolean) => void;
  /** Se invoca tras un "ok" para que el padre refresque los apartados. */
  onSuccess: () => void;
}

const SIN_MENSAJERO_LABEL = "Sin mensajero";

/** `ordenId -> mensajeroId` ("" = sin mensajero). Preselecciona el sugerido (R20/R21). */
function seleccionInicial(ordenes: OrdenListItemDTO[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const orden of ordenes) {
    next[orden.id] = orden.mensajeroSugeridoId ?? "";
  }
  return next;
}

/**
 * Modal async "Generar guía" (feature 17, T18, R20/R24): agrupa la selección
 * en (a) órdenes CON `mensajeroSugeridoId` (preselecciona, permite override o
 * "sin mensajero") y (b) SIN sugerido (elige mensajero o deja "sin"). Al
 * confirmar construye `decisiones: [{ ordenId, mensajeroId | null }]` y hace
 * UNA sola llamada a `generarGuia` (R19/R21-R24), con independencia de que la
 * orden termine en `en_espera_aceptacion` o `en_bodega` (R23).
 */
export function GenerarGuiaModal({
  open,
  ordenes,
  mensajeros,
  onOpenChange,
  onSuccess,
}: GenerarGuiaModalProps) {
  const toast = useToast();
  // R20: preselección inicial (sugerido u "sin mensajero") calculada en el
  // primer render si ya monta abierto (inicializador perezoso), y recalculada
  // solo al transicionar a `open` en re-aperturas, sin reiniciar la selección
  // del usuario mientras el modal permanece abierto. Patrón "ajustar estado
  // durante el render" (no efecto) para evitar el render en cascada de un
  // `useEffect`.
  const [seleccion, setSeleccion] = useState<Record<string, string>>(() =>
    open ? seleccionInicial(ordenes) : {},
  );
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setSeleccion(seleccionInicial(ordenes));
  }

  const mensajeroOptions = toMensajeroOptions(mensajeros);
  const conSugerido = ordenes.filter((o) => o.mensajeroSugeridoId != null);
  const sinSugerido = ordenes.filter((o) => o.mensajeroSugeridoId == null);

  function handleRowChange(ordenId: string, mensajeroId: string) {
    setSeleccion((prev) => ({ ...prev, [ordenId]: mensajeroId }));
  }

  const columns: Column<OrdenListItemDTO>[] = [
    { id: "numRemision", value: "Nº Remisión", render: "numRemision" },
    { id: "destinatario", value: "Destinatario", render: "destinatario" },
    {
      id: "mensajero",
      value: "Mensajero",
      render: (row) => (
        <Select
          value={seleccion[row.id] ?? ""}
          onValueChange={(mensajeroId) => handleRowChange(row.id, mensajeroId)}
          options={mensajeroOptions}
          placeholder={SIN_MENSAJERO_LABEL}
          aria-label={`Mensajero para la orden ${row.numRemision}`}
        />
      ),
    },
  ];

  async function handleConfirm() {
    const decisiones = ordenes.map((orden) => ({
      ordenId: orden.id,
      mensajeroId: seleccion[orden.id] ? seleccion[orden.id] : null,
    }));

    const result = await generarGuia({ decisiones });
    if (result.status !== "ok") {
      // R25: fallo del lote → el Modal invoca `onError`, permanece abierto,
      // ninguna orden queda numerada a medias.
      throw result;
    }

    const espera = result.resultados.filter(
      (r) => r.estado === "en_espera_aceptacion",
    ).length;
    const bodega = result.resultados.filter(
      (r) => r.estado === "en_bodega",
    ).length;
    toast.success(
      `Guía generada para ${result.resultados.length} orden(es): ${espera} en espera de aceptación, ${bodega} en bodega.`,
    );
    onSuccess();
  }

  function handleError(error: unknown) {
    toast.error(guiaDecisionErrorMessage(error));
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Generar guía"
      description="Confirma el mensajero por orden. Las órdenes sin mensajero pasan a bodega."
      confirmLabel="Generar guía"
      onConfirm={handleConfirm}
      onError={handleError}
      className="max-w-2xl"
    >
      <div className="flex flex-col gap-4">
        {conSugerido.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Con mensajero sugerido</h3>
            <DataTable
              columns={columns}
              data={conSugerido}
              rowKey="id"
              ariaLabel="Órdenes con mensajero sugerido"
            />
          </div>
        ) : null}
        {sinSugerido.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Sin mensajero sugerido</h3>
            <DataTable
              columns={columns}
              data={sinSugerido}
              rowKey="id"
              ariaLabel="Órdenes sin mensajero sugerido"
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
