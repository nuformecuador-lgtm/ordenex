"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { OrdenesCargaResumen } from "@/app/(app)/ordenes/_components/OrdenesCargaResumen";
import { OrdenesExistentesTabla } from "@/app/(app)/ordenes/_components/OrdenesExistentesTabla";
import { OrdenesConErrorTabla } from "@/app/(app)/ordenes/_components/OrdenesConErrorTabla";
import type { ClasificacionCarga } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";

export interface OrdenesCargaResumenPasoProps {
  /** Clasificación del `BulkSummary` (nuevas / existentes / con error), R1. */
  clasificacion: ClasificacionCarga;
  /** Se propaga a `OrdenesCargaResumen` (feature 16). */
  onDone?: () => void;
}

/**
 * Feature 29 — Contenedor del paso "resumen" (design D3). Compone, de arriba a
 * abajo: aviso explícito (R7, R8), resumen de asignación de las NUEVAS (R9, R10),
 * tabla de solo lectura de existentes (R4) y tabla de solo lectura de errores
 * (R18). Cada sección se renderiza solo si su grupo no está vacío. NO modifica
 * `OrdenesCargaResumen` ni ninguna primitiva (R16).
 */
export function OrdenesCargaResumenPaso({
  clasificacion,
  onDone,
}: OrdenesCargaResumenPasoProps) {
  const { numRemisionesNuevas, existentes, errores } = clasificacion;
  const nuevasCount = numRemisionesNuevas.length;
  const existentesCount = existentes.length;

  return (
    <div className="flex flex-col gap-4">
      <Alert variant="default">
        <AlertDescription>
          <span className="block font-medium">
            {nuevasCount === 1
              ? "1 nueva cargada."
              : `${nuevasCount} nuevas cargadas.`}{" "}
            Solo se cargan las órdenes nuevas.
          </span>
          {existentesCount > 0 ? (
            <span className="block">
              {existentesCount === 1
                ? "1 ya existía y no se recarga."
                : `${existentesCount} ya existían y no se recargan.`}
            </span>
          ) : null}
        </AlertDescription>
      </Alert>

      {nuevasCount > 0 ? (
        <OrdenesCargaResumen numRemisiones={numRemisionesNuevas} onDone={onDone} />
      ) : null}

      {existentesCount > 0 ? (
        <OrdenesExistentesTabla existentes={existentes} />
      ) : null}

      {errores.length > 0 ? <OrdenesConErrorTabla errores={errores} /> : null}
    </div>
  );
}
