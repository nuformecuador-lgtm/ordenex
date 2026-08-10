"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ColumnasManifiestoPopover } from "@/components/shared/ColumnasManifiestoPopover";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { usePreferenciaColumnasManifiesto } from "@/hooks/usePreferenciaColumnasManifiesto";
import { useToast } from "@/hooks/useToast";
import { obtenerManifiesto } from "@/lib/actions/manifiesto";
import type { ManifiestoFlujo, ManifiestoResult } from "@/lib/types/manifiesto";
import { XLSX_MIME } from "@/lib/utils/xlsx-template";

/**
 * Selección del lote (design.md §2). `numRemisiones` es la vía EXCLUSIVA de la carga
 * masiva, cuyo resumen no lleva ids de orden; el resto de flujos usa `ordenIds`.
 */
export type ManifiestoSeleccion =
  | { ordenIds: string[] }
  | { numRemisiones: string[] };

export interface DescargarManifiestoButtonProps {
  /** Punto de enganche: decide origen/destino/responsable y el nombre del archivo. */
  flujo: ManifiestoFlujo;
  /** Lote ya cometido por la operación de negocio. Vacío ⇒ el botón no se renderiza (R17). */
  seleccion: ManifiestoSeleccion;
  /** Texto del botón (i18n por prop, sin literal fijo en el consumidor). */
  label?: string;
  /** Clases extra del botón, para encajarlo en la barra de acciones del consumidor. */
  className?: string;
}

const DEFAULT_LABEL = "Descargar manifiesto";

/**
 * R26 — Mensajes ACCIONABLES por causa: cada uno dice qué hacer, no solo que falló.
 * El resultado de la operación de negocio ya está cometido y sigue visible; esto solo
 * informa que el archivo no se pudo producir.
 */
const MENSAJE_ERROR: Record<string, string> = {
  unauthenticated:
    "Tu sesión expiró. Vuelve a iniciar sesión y descarga el manifiesto desde el listado.",
  forbidden: "No tienes permiso para descargar el manifiesto de estas órdenes.",
  validation_error:
    "No se pudo preparar el manifiesto: la selección de órdenes no es válida.",
  sin_filas:
    "No hay órdenes con datos para el manifiesto; revisa si siguen disponibles.",
  fallo:
    "No se pudo generar el manifiesto. Vuelve a intentarlo; la operación ya quedó registrada.",
};

/** ¿La selección tiene al menos un elemento? (R17: sin lote no se ofrece descarga.) */
function tieneSeleccion(seleccion: ManifiestoSeleccion): boolean {
  return "ordenIds" in seleccion
    ? seleccion.ordenIds.length > 0
    : seleccion.numRemisiones.length > 0;
}

/**
 * Feature 148 (T9) — ÚNICO botón de descarga del manifiesto: lo comparten los 6 puntos
 * de UI (carga masiva, generación de guía, asignación desde bodega, ruteo a satélite,
 * asignación satélite, devolución a central y envío a la tienda). Parametrizado por
 * `flujo` + selección; no duplica ni el mapeo de columnas (vive en el servicio único,
 * R1) ni la mecánica de descarga (`descargar-blob`).
 *
 * Es un AÑADIDO POSTERIOR al éxito de la operación de negocio, nunca un paso de su
 * camino crítico: pulsa quien quiere el archivo, y si el archivo falla, el resultado ya
 * cometido no se toca, no se reintenta y no se revierte (R25). El binario se arma aquí,
 * en el navegador, y se descarga sin subirlo a ninguna parte (R15).
 *
 * Feature 194 (design §6, D4) — el botón lleva ADOSADO su selector de columnas, de modo que
 * los 7 puntos de enganche ganan la función sin tocar un solo archivo de `app/`. El selector
 * es un control PARALELO, nunca un paso del camino del botón: abrirlo NO descarga nada, y
 * pulsar el botón descarga en UN solo click con la preferencia ya guardada de ese flujo, sin
 * ningún paso intermedio de confirmación de columnas (R10). Lo único que cambia respecto de la
 * 148 es qué columnas lleva el archivo: ni la petición al servidor (R25) ni el nombre del
 * archivo (R11) se ven afectados.
 */
export function DescargarManifiestoButton({
  flujo,
  seleccion,
  label,
  className,
}: DescargarManifiestoButtonProps) {
  const toast = useToast();
  const [generando, setGenerando] = useState(false);
  // Los hooks van ANTES del return temprano de R17: React exige el mismo número de hooks en
  // cada render y la selección puede vaciarse entre uno y otro.
  const { clavesVisibles } = usePreferenciaColumnasManifiesto(flujo);

  // R17: con el lote vacío no se ofrece la descarga (y no se genera nada). Desaparece el
  // grupo ENTERO, botón y selector: sin lote no hay columnas que elegir.
  if (!tieneSeleccion(seleccion)) return null;

  async function handleClick() {
    // R16: una sola generación en vuelo por lote; el `disabled` cubre el click y el
    // guard cubre la carrera entre dos clicks previos al re-render.
    if (generando) return;
    setGenerando(true);
    try {
      const result: ManifiestoResult = await obtenerManifiesto({
        flujo,
        ...seleccion,
      });
      if (result.status !== "ok") {
        toast.error(MENSAJE_ERROR[result.status] ?? MENSAJE_ERROR.fallo);
        return;
      }
      if (result.filas.length === 0) {
        toast.error(MENSAJE_ERROR.sin_filas); // R17: sin filas no se genera archivo
        return;
      }
      const { buildManifiestoXlsx, manifiestoFileName } = await import(
        "@/lib/utils/manifiesto-xlsx"
      );
      // 194/R7: el archivo lleva las columnas visibles de ESTE flujo. El generador filtra
      // `COLUMNAS_MANIFIESTO` con estas claves, así que el orden publicado es inviolable (R8).
      const buffer = await buildManifiestoXlsx(result.filas, clavesVisibles);
      descargarBlob(
        buffer,
        XLSX_MIME,
        // R14: la fecha del nombre es la MISMA que la columna `fecha` de las filas.
        manifiestoFileName(flujo, result.filas[0].fecha),
      );
      if (result.omitidas.length > 0) {
        // R12: el lote no se aborta por una referencia perdida; se informa cuántas.
        toast.warning(
          `${result.omitidas.length} orden(es) del lote no se incluyeron en el manifiesto.`,
        );
      }
    } catch {
      // R25/R26: el fallo muere aquí. No se re-ejecuta ni se revierte nada de negocio.
      toast.error(MENSAJE_ERROR.fallo);
    } finally {
      setGenerando(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      {/* `className` sigue aplicándose al BOTÓN, no al grupo: los consumidores la usan para
          encajar el botón en su barra de acciones (design §6). */}
      <Button
        type="button"
        variant="brand-outline"
        className={className}
        onClick={() => void handleClick()}
        disabled={generando}
        loading={generando}
      >
        {generando ? null : <Download aria-hidden="true" />}
        {label ?? DEFAULT_LABEL}
      </Button>
      <ColumnasManifiestoPopover flujo={flujo} />
    </div>
  );
}
