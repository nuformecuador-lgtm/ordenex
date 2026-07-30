"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useSWRConfig } from "swr";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { esEstadoReportable } from "./incidente-origenes";
import {
  ReportarIncidenteModal,
  type ReportarIncidenteOrdenUI,
} from "./ReportarIncidenteModal";

/**
 * Forma mínima que necesita el disparador: la del modal más el estado actual, que es lo que
 * decide si la acción se ofrece. La cumplen por estructura tanto `OrdenListItemDTO`
 * (`/ordenes`) como `RecepcionSateliteDTO` (`/recepcion-satelite`), de modo que las DOS
 * superficies comparten un único disparador y un único modal en vez de duplicarlos.
 */
export type ReportarIncidenteAccionOrden = ReportarIncidenteOrdenUI & {
  estatusValue?: string | null;
};

export interface ReportarIncidenteAccionProps {
  /** Orden de la fila. Se pasa de UNA en UNA: el incidente no es acción de lote (Q-H). */
  orden: ReportarIncidenteAccionOrden;
  /**
   * ¿Se ofrece la acción sobre ESTA orden? Por defecto se decide sólo por el estado (R41),
   * que es lo único que restringe a un rol de acceso total en `/ordenes`.
   *
   * La bodega satélite pasa el suyo: además del estado, el `adminSatelite` está acotado a su
   * zona (R48) y sin zona no tiene alcance sobre nada. La regla vive en la superficie que la
   * tiene, no aquí, para que este disparador no acumule condiciones de todos sus consumidores.
   */
  disponible?: boolean;
  /**
   * Qué hacer tras un reporte exitoso. Por defecto revalida el listado de `/ordenes` por su
   * prefijo de key SWR (igual que `OrdenesListado.revalidarTablas`). Las superficies que
   * releen del servidor con `router.refresh()` pasan el suyo.
   */
  onSuccess?: () => void;
}

/** Nombre accesible y tooltip del disparador (texto separado, i18n-ready). */
export const REPORTAR_INCIDENTE_ACCION_LABEL = "Reportar incidente";

/**
 * Feature 158 (T2.7, Q-H) — acción POR FILA «Reportar incidente». Patrón autocontenido de
 * `EtiquetaOrdenAccion` (32) y `HistorialOrdenSheet` (49): estado `open` propio + disparador
 * + modal.
 *
 * **No se renderiza nada** cuando la acción no está disponible (por estado, R41, o por el
 * criterio propio de la superficie, R48): una acción visible que el servidor va a rechazar es
 * una invitación al error, y un botón deshabilitado en un estado que nadie puede cambiar no
 * le dice nada útil a nadie. El servidor revalida rol, alcance y estado igualmente.
 *
 * Vive en `ordenes/_components/` porque ahí nació y ahí está su consumidor principal; la
 * bodega satélite lo IMPORTA en vez de duplicarlo (mismo precedente que
 * `CAUSA_INCIDENTE_LABEL` y `estatus-label`).
 */
export function ReportarIncidenteAccion({
  orden,
  disponible,
  onSuccess,
}: Readonly<ReportarIncidenteAccionProps>) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);

  const seOfrece = disponible ?? esEstadoReportable(orden.estatusValue);
  if (!seOfrece) return null;

  function handleSuccess() {
    setOpen(false);
    if (onSuccess) {
      onSuccess();
      return;
    }
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
