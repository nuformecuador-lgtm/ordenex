"use client";

import { useMemo, useState } from "react";

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

export interface OrdenesCargaPreviewProps {
  /** Clasificación de la validación previa (dry-run): nada se ha persistido. */
  clasificacion: ClasificacionCarga;
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
  confirmando,
  progresoTexto,
  onConfirmar,
}: OrdenesCargaPreviewProps) {
  const { numRemisionesNuevas, existentes, errores } = clasificacion;
  const nuevas = numRemisionesNuevas.length;

  const [chipActivo, setChipActivo] = useState<string | null>(null);

  const chips = useMemo(() => construirChips(errores), [errores]);
  const erroresOrdenados = useMemo(
    () => ordenarPorChip(errores, chipActivo),
    [errores, chipActivo],
  );

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

      {errores.length > 0 ? (
        <OrdenesConErrorTabla errores={erroresOrdenados} />
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
