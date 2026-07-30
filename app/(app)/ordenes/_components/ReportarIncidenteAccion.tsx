"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useSWRConfig } from "swr";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { esEstadoReportable } from "./incidente-origenes";
import { ReportarIncidenteModal } from "./ReportarIncidenteModal";

export interface ReportarIncidenteAccionProps {
  /** Orden de la fila. Se pasa de UNA en UNA: el incidente no es acción de lote (Q-H). */
  orden: OrdenListItemDTO;
}

/** Nombre accesible y tooltip del disparador (texto separado, i18n-ready). */
export const REPORTAR_INCIDENTE_ACCION_LABEL = "Reportar incidente";

/**
 * Feature 158 (T2.7, Q-H) — acción POR FILA «Reportar incidente» del listado de órdenes.
 * Patrón autocontenido de `EtiquetaOrdenAccion` (32) y `HistorialOrdenSheet` (49): estado
 * `open` propio + disparador + modal.
 *
 * **No se renderiza nada** si el estado de la orden no está en los cinco desde los que un
 * admin puede reportar (R41): una acción visible que el servidor va a rechazar es una
 * invitación al error. El rol lo decide el padre (`OrdenesModule`, que sólo monta esta
 * acción para roles de acceso total) y el servidor lo revalida (R48).
 *
 * Tras el éxito revalida el listado por su prefijo de key SWR —igual que hace
 * `OrdenesListado.revalidarTablas`—, de modo que la orden desaparece de su estado anterior
 * sin recargar la página.
 */
export function ReportarIncidenteAccion({ orden }: Readonly<ReportarIncidenteAccionProps>) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);

  if (!esEstadoReportable(orden.estatusValue)) return null;

  function handleSuccess() {
    setOpen(false);
    void mutate(
      (key) => Array.isArray(key) && key[0] === "ordenes:list",
      undefined,
      { revalidate: true },
    );
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setOpen(true)}
              aria-label={`${REPORTAR_INCIDENTE_ACCION_LABEL} de la orden ${orden.numRemision}`}
            >
              <ShieldAlert className="size-4" />
            </Button>
          }
        />
        <TooltipContent>{REPORTAR_INCIDENTE_ACCION_LABEL}</TooltipContent>
      </Tooltip>
      <ReportarIncidenteModal
        open={open}
        orden={orden}
        onOpenChange={setOpen}
        onSuccess={handleSuccess}
      />
    </>
  );
}
