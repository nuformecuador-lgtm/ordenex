"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { OrdenesExistentesTabla } from "@/app/(app)/ordenes/_components/OrdenesExistentesTabla";
import { OrdenesConErrorTabla } from "@/app/(app)/ordenes/_components/OrdenesConErrorTabla";
import type { ClasificacionCarga } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";
import {
  construirChips,
  ordenarPorChip,
} from "@/app/(app)/ordenes/_components/carga-masiva-error-chips";
import {
  ERRORES_EXPORT_FIELDS,
  construirFilasErrorExport,
  nombreArchivoErrores,
} from "@/app/(app)/ordenes/_components/carga-masiva-export-errores";
import type { FilaParseada } from "@/app/(app)/ordenes/_components/carga-masiva-parser";
// Import ESTÁTICO a propósito: `xlsx-template` es liviano y NO arrastra la
// librería de generación XLSX, que `buildXlsxRows` carga con import dinámico por
// dentro (R19). Un `await import()` aquí no aplazaría nada, porque `XLSX_MIME` ya
// obliga a resolver el mismo módulo en este componente.
import { XLSX_MIME, buildXlsxRows } from "@/lib/utils/xlsx-template";
import { useToast } from "@/hooks/useToast";

export interface OrdenesCargaPreviewProps {
  /** Clasificación de la validación previa (dry-run): nada se ha persistido. */
  clasificacion: ClasificacionCarga;
  /**
   * Filas parseadas del archivo original (valores CRUDOS), para el export de las
   * filas con error (feature 143). Opcional: sin ellas el archivo se genera con
   * las columnas vacías salvo `num_remision` (R5).
   */
  filas?: FilaParseada[];
  /** `true` mientras se ejecuta la carga real tras confirmar. */
  confirmando: boolean;
  /** Texto de progreso mostrado durante la carga real (p. ej. "3.000 / 5.000"). */
  progresoTexto?: string | null;
  /** Dispara la carga real (persiste solo las nuevas válidas). */
  onConfirmar: () => void;
}

/**
 * Paso de VALIDACIÓN PREVIA del modal de carga masiva: muestra los hallazgos del
 * dry-run (num_remision duplicados y errores de geografía) ANTES de escribir en
 * la DB. Los chips resumen los tipos de error y, al pulsarlos, llevan al inicio
 * del resumen las filas con ese error. La carga real solo ocurre al confirmar.
 */
export function OrdenesCargaPreview({
  clasificacion,
  filas,
  confirmando,
  progresoTexto,
  onConfirmar,
}: OrdenesCargaPreviewProps) {
  const { numRemisionesNuevas, existentes, errores } = clasificacion;
  const nuevas = numRemisionesNuevas.length;

  const [chipActivo, setChipActivo] = useState<string | null>(null);
  const [generandoErrores, setGenerandoErrores] = useState(false);
  const toast = useToast();

  const chips = useMemo(() => construirChips(errores), [errores]);
  const erroresOrdenados = useMemo(
    () => ordenarPorChip(errores, chipActivo),
    [errores, chipActivo],
  );

  /**
   * Feature 143 — Descarga las filas con error en un XLSX con el MISMO formato
   * de la plantilla vigente (8 columnas, cabecera = clave máquina) + la columna
   * `motivo_error` al final, para corregirlas y volver a subir el archivo.
   *
   * Todo ocurre EN EL NAVEGADOR: los datos ya están en el estado del cliente, así
   * que no se hace ninguna petición de red (R9). `exceljs` no entra en el bundle
   * inicial porque `buildXlsxRows` lo carga dinámicamente por dentro (R19). Solo
   * `.xlsx`: no hay variante CSV (R21).
   */
  async function handleDescargarErrores() {
    // R11/R12: sin filas con error no hay nada que generar; una generación en
    // curso no se re-dispara.
    if (errores.length === 0 || generandoErrores) return;
    setGenerandoErrores(true);
    try {
      const buffer = await buildXlsxRows(
        ERRORES_EXPORT_FIELDS,
        construirFilasErrorExport(errores, filas ?? []),
        "Ordenes con error",
      );
      const blob = new Blob([buffer], { type: XLSX_MIME });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = nombreArchivoErrores(new Date());
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch {
      // R13: se informa del fallo y el paso sigue operativo (tabla + confirmar).
      toast.error("No se pudo generar el archivo de errores.");
    } finally {
      setGenerandoErrores(false);
    }
  }

  function toggleChip(key: string) {
    // Pulsar el chip activo lo desactiva (vuelve al orden original).
    setChipActivo((prev) => (prev === key ? null : key));
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert variant="default">
        <AlertDescription>
          <span className="block font-medium">
            {nuevas === 1
              ? "1 nueva lista para cargar."
              : `${nuevas} nuevas listas para cargar.`}{" "}
            Nada se ha guardado todavía: revisa los hallazgos y confirma.
          </span>
          {existentes.length > 0 ? (
            <span className="block">
              {existentes.length === 1
                ? "1 ya existe (num. de remisión repetido) y se omitirá."
                : `${existentes.length} ya existen (num. de remisión repetidos) y se omitirán.`}
            </span>
          ) : null}
          {errores.length > 0 ? (
            <span className="block">
              {errores.length === 1
                ? "1 con error y no se cargará."
                : `${errores.length} con error y no se cargarán.`}
            </span>
          ) : null}
        </AlertDescription>
      </Alert>

      {chips.length > 0 ? (
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Filtrar errores por tipo"
        >
          {chips.map((chip) => {
            const activo = chip.key === chipActivo;
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => toggleChip(chip.key)}
                aria-pressed={activo}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-brand/30",
                  activo
                    ? "border-brand bg-brand text-white"
                    : "border-input bg-background text-foreground hover:border-brand/60 hover:bg-brand-soft hover:text-brand-dark",
                )}
              >
                <span>{chip.label}</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 text-xs font-medium",
                    activo ? "bg-white/25" : "bg-muted text-muted-foreground",
                  )}
                >
                  {chip.count}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* R11: el botón solo existe si hay filas con error (oculto, no deshabilitado). */}
      {errores.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleDescargarErrores()}
              disabled={generandoErrores}
              aria-busy={generandoErrores}
            >
              <Download aria-hidden="true" />
              {generandoErrores
                ? "Generando archivo…"
                : "Descargar filas con error (.xlsx)"}
            </Button>
          </div>
          <OrdenesConErrorTabla errores={erroresOrdenados} />
        </div>
      ) : null}

      {existentes.length > 0 ? (
        <OrdenesExistentesTabla existentes={existentes} />
      ) : null}

      <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
        {confirmando && progresoTexto ? (
          <span role="status" className="text-sm text-muted-foreground">
            Cargando {progresoTexto} filas…
          </span>
        ) : null}
        <Button
          type="button"
          variant="brand-outline"
          onClick={onConfirmar}
          disabled={confirmando || nuevas === 0}
        >
          {confirmando
            ? "Cargando…"
            : nuevas === 1
              ? "Confirmar y cargar 1 nueva"
              : `Confirmar y cargar ${nuevas} nuevas`}
        </Button>
      </div>
    </div>
  );
}
