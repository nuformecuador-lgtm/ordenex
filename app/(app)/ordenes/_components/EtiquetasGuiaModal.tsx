"use client";

import { useEffect, useRef, useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { generarEtiquetas } from "@/lib/actions/etiquetas-guia";
import type {
  EtiquetaGuiaDTO,
  EtiquetaOmitidaDTO,
  GenerarEtiquetasResult,
} from "@/lib/types/etiqueta-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { EtiquetaGuia } from "./EtiquetaGuia";
import { descargarEtiquetasPdf } from "./etiquetas-pdf";

export interface EtiquetasGuiaModalProps {
  open: boolean;
  /** Órdenes seleccionadas al abrir (snapshot de un apartado con `num_guia`). */
  ordenes: OrdenListItemDTO[];
  onOpenChange: (open: boolean) => void;
  /** Reservado para simetría con los demás modales; no muta datos (READ). */
  onSuccess?: () => void;
}

type Estado =
  | { fase: "cargando" }
  | {
      fase: "listo";
      etiquetas: EtiquetaGuiaDTO[];
      omitidas: EtiquetaOmitidaDTO[];
    }
  | { fase: "error"; mensaje: string };

const MOTIVO_TEXTO: Record<EtiquetaOmitidaDTO["motivo"], string> = {
  sin_guia: "sin guía",
  no_encontrada: "no encontrada",
};

/** Traduce un resultado no-"ok" de la action a un mensaje para el usuario. */
function mensajeDeError(
  status: Exclude<GenerarEtiquetasResult["status"], "ok">,
): string {
  switch (status) {
    case "forbidden":
      return "No tienes permiso para generar etiquetas.";
    case "unauthenticated":
      return "Tu sesión expiró. Vuelve a iniciar sesión.";
    case "validation_error":
      return "No se pudieron generar las etiquetas: la selección no es válida.";
  }
}

/** Resume las órdenes omitidas por motivo para el aviso (R11). */
function resumenOmitidas(omitidas: EtiquetaOmitidaDTO[]): string {
  const conteo = new Map<EtiquetaOmitidaDTO["motivo"], number>();
  for (const o of omitidas) conteo.set(o.motivo, (conteo.get(o.motivo) ?? 0) + 1);
  const partes = Array.from(conteo, ([motivo, n]) => `${n} ${MOTIVO_TEXTO[motivo]}`);
  return partes.join(", ");
}

/**
 * Feature 32 (T2.3, R9-R12) — Modal "Imprimir etiquetas". Al abrir consume la
 * Server Action de solo lectura `generarEtiquetas({ ordenIds })` y muestra una
 * vista previa de las etiquetas imprimibles (R9). Avisa de las órdenes omitidas
 * (N−M) con su motivo (R11). Si NINGUNA es imprimible, informa y NO ofrece
 * descarga (R12). El boton "Descargar etiquetas" arma y descarga el PDF
 * multipagina 100x100 mm (decision F1.4 (c), `descargarEtiquetasPdf`), tomando
 * el raster del QR de cada `<canvas>` de la vista previa. `forbidden`/
 * `unauthenticated`/`validation_error` se traducen a un mensaje (R13/R14/R15-UI).
 */
export function EtiquetasGuiaModal({
  open,
  ordenes,
  onOpenChange,
  onSuccess,
}: EtiquetasGuiaModalProps) {
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  // Canvas del QR por `ordenId`, recolectados de la vista previa para rasterizar
  // al PDF (qrcode.react reenvia la ref al canvas nativo).
  const qrCanvases = useRef<Map<string, HTMLCanvasElement>>(new Map());

  // Reinicia a "cargando" solo al transicionar a `open` (ajuste de estado durante
  // el render, no en un `useEffect`, para evitar el render en cascada). Patrón de
  // GenerarGuiaModal/AsignarBodegaModal.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setEstado({ fase: "cargando" });
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    qrCanvases.current.clear();

    generarEtiquetas({ ordenIds: ordenes.map((o) => o.id) })
      .then((res) => {
        if (cancelled) return;
        if (res.status === "ok") {
          setEstado({
            fase: "listo",
            etiquetas: res.etiquetas,
            omitidas: res.omitidas,
          });
        } else {
          setEstado({ fase: "error", mensaje: mensajeDeError(res.status) });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setEstado({
          fase: "error",
          mensaje: "No se pudieron generar las etiquetas.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [open, ordenes]);

  const etiquetas = estado.fase === "listo" ? estado.etiquetas : [];
  const omitidas = estado.fase === "listo" ? estado.omitidas : [];
  const hayImprimibles = etiquetas.length > 0;

  function handleDescargar() {
    // R12: sin imprimibles no se genera/descarga PDF (defensa; el botón no se
    // ofrece en ese caso).
    if (etiquetas.length === 0) return;
    descargarEtiquetasPdf(etiquetas, qrCanvases.current);
    onSuccess?.();
  }

  function cerrar() {
    onOpenChange(false);
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Imprimir etiquetas"
      description="Vista previa de las etiquetas de las órdenes con guía. Cada etiqueta se descarga como una página de 100 × 100 mm."
      confirmLabel={hayImprimibles ? "Descargar etiquetas" : "Cerrar"}
      onConfirm={hayImprimibles ? handleDescargar : cerrar}
      closeOnConfirm={!hayImprimibles}
      hideCancel={!hayImprimibles}
      cancelLabel="Cerrar"
      className="max-w-3xl"
    >
      <div className="flex flex-col gap-4">
        {estado.fase === "cargando" ? (
          <p role="status" className="text-sm text-muted-foreground">
            Generando etiquetas…
          </p>
        ) : null}

        {estado.fase === "error" ? (
          <Alert variant="destructive">
            <AlertDescription>{estado.mensaje}</AlertDescription>
          </Alert>
        ) : null}

        {estado.fase === "listo" && omitidas.length > 0 ? (
          <Alert>
            <AlertDescription>
              {`${omitidas.length} orden(es) omitida(s) (${resumenOmitidas(omitidas)}).`}
            </AlertDescription>
          </Alert>
        ) : null}

        {estado.fase === "listo" && !hayImprimibles ? (
          <Alert>
            <AlertDescription>
              Ninguna de las órdenes seleccionadas tiene guía; no hay etiquetas
              para imprimir.
            </AlertDescription>
          </Alert>
        ) : null}

        {hayImprimibles ? (
          <div className="flex max-h-[60vh] flex-wrap gap-4 overflow-auto">
            {etiquetas.map((etiqueta) => (
              <EtiquetaGuia
                key={etiqueta.ordenId}
                etiqueta={etiqueta}
                qrCanvasRef={(el) => {
                  if (el) qrCanvases.current.set(etiqueta.ordenId, el);
                  else qrCanvases.current.delete(etiqueta.ordenId);
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
