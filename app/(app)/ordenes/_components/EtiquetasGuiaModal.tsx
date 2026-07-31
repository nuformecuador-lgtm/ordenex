"use client";

import { useEffect, useRef, useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select } from "@/components/ui/select";
import { generarEtiquetas } from "@/lib/actions/etiquetas-guia";
import {
  formatMm,
  getHojaEtiqueta,
  HOJAS_ETIQUETA,
  HOJA_ETIQUETA_DEFAULT_ID,
  type HojaEtiquetaId,
} from "@/lib/config/etiquetas-hoja";
import type {
  EtiquetaGuiaDTO,
  EtiquetaOmitidaDTO,
  GenerarEtiquetasResult,
} from "@/lib/types/etiqueta-guia";

import { EtiquetaGuia } from "./EtiquetaGuia";
import { descargarEtiquetasPdf } from "./etiquetas-pdf";

export interface EtiquetasGuiaModalProps {
  open: boolean;
  /**
   * Órdenes seleccionadas al abrir (snapshot). Se pide la forma MÍNIMA que este modal
   * realmente usa —el `id`, que es lo único que viaja a `generarEtiquetas`— y no el
   * `OrdenListItemDTO` completo: así también puede abrirse desde el resumen de la carga
   * masiva, cuyas filas son `ResumenCargaOrdenDTO`. Un `OrdenListItemDTO[]` sigue siendo
   * asignable, así que los consumidores existentes no cambian.
   */
  ordenes: readonly { id: string }[];
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

/** Opciones del selector de tamaño, en el orden fijo del catálogo (R1/R6). */
const OPCIONES_HOJA = HOJAS_ETIQUETA.map((h) => ({ value: h.id, label: h.label }));

/** Rótulo del selector; también es su nombre accesible (R6). */
const LABEL_TAMANO_HOJA = "Tamaño de hoja";

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
 * multipagina (`descargarEtiquetasPdf`), tomando el raster del QR de cada
 * `<canvas>` de la vista previa. `forbidden`/`unauthenticated`/
 * `validation_error` se traducen a un mensaje (R13/R14/R15-UI).
 *
 * Feature 150 — El tamaño de hoja se elige en CADA descarga con un selector que
 * solo aparece si hay etiquetas imprimibles (R6/R11); arranca en el default del
 * catalogo en cada apertura (R7) y no se persiste de ninguna forma (R10).
 */
export function EtiquetasGuiaModal({
  open,
  ordenes,
  onOpenChange,
  onSuccess,
}: EtiquetasGuiaModalProps) {
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  // Feature 150 (D2/R10): el tamaño de hoja es estado LOCAL y efímero. No se
  // persiste en ningún sitio (ni `localStorage`, ni cookie, ni servidor): cada
  // apertura vuelve al default del catálogo (R7).
  const [hojaId, setHojaId] = useState<HojaEtiquetaId>(HOJA_ETIQUETA_DEFAULT_ID);
  // Canvas del QR por `ordenId`, recolectados de la vista previa para rasterizar
  // al PDF (qrcode.react reenvia la ref al canvas nativo).
  const qrCanvases = useRef<Map<string, HTMLCanvasElement>>(new Map());

  // Reinicia a "cargando" solo al transicionar a `open` (ajuste de estado durante
  // el render, no en un `useEffect`, para evitar el render en cascada). Patrón de
  // GenerarGuiaModal/AsignarBodegaModal.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setEstado({ fase: "cargando" });
      // R7: reabrir siempre parte del default, sin importar la elección anterior.
      setHojaId(HOJA_ETIQUETA_DEFAULT_ID);
    }
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
  const hoja = getHojaEtiqueta(hojaId);

  function handleDescargar() {
    // R12: sin imprimibles no se genera/descarga PDF (defensa; el botón no se
    // ofrece en ese caso).
    if (etiquetas.length === 0) return;
    // R9: el PDF sale con el tamaño que esté seleccionado en este momento.
    descargarEtiquetasPdf(etiquetas, qrCanvases.current, hoja);
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
      description={`Vista previa de las etiquetas de las órdenes con guía. Cada etiqueta se descarga como una página de ${hoja.label} (${formatMm(hoja.anchoMm)} × ${formatMm(hoja.altoMm)} mm).`}
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
          <div className="flex flex-col gap-1.5 sm:max-w-xs">
            <label
              htmlFor="etiquetas-tamano-hoja"
              className="text-sm font-medium"
            >
              {LABEL_TAMANO_HOJA}
            </label>
            <Select
              id="etiquetas-tamano-hoja"
              aria-label={LABEL_TAMANO_HOJA}
              value={hojaId}
              onValueChange={(next) => setHojaId(getHojaEtiqueta(next).id)}
              options={OPCIONES_HOJA}
            />
          </div>
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
