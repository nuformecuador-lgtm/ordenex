"use client";

import { useState } from "react";
import { QrCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { EtiquetasGuiaModal } from "./EtiquetasGuiaModal";

export interface EtiquetaOrdenAccionProps {
  /** Orden de la fila; se pasa como lote de UNO al modal de etiquetas (reuso). */
  orden: OrdenListItemDTO;
}

/**
 * Acción por fila "Ver etiqueta": botón de icono (QR) con tooltip que abre la vista
 * previa de la etiqueta (QR con el ID de la orden + datos + código de barras) y
 * permite descargar el PDF 100×100 mm. REUTILIZA `EtiquetasGuiaModal` (feature 32),
 * que recibe `ordenes: []`: aquí se le pasa un lote de una sola orden. Patrón
 * autocontenido de `HistorialOrdenSheet` (estado `open` propio + disparador + modal).
 *
 * La etiqueta/QR solo existe para órdenes con Nº de guía: sin guía el botón se
 * deshabilita y el tooltip lo explica (el backend omitiría la orden con `sin_guia`).
 */
export function EtiquetaOrdenAccion({ orden }: EtiquetaOrdenAccionProps) {
  const [open, setOpen] = useState(false);
  const sinGuia = orden.numGuia === null;
  const label = sinGuia
    ? "La orden aún no tiene guía asignada"
    : "Ver etiqueta";

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
              disabled={sinGuia}
              aria-label={`Ver etiqueta de la orden ${orden.numRemision}`}
            >
              <QrCode className="size-4" />
            </Button>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <EtiquetasGuiaModal open={open} ordenes={[orden]} onOpenChange={setOpen} />
    </>
  );
}
