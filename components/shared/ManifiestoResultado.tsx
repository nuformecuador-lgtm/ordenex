"use client";

import type { ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  DescargarManifiestoButton,
  type ManifiestoSeleccion,
} from "@/components/shared/DescargarManifiestoButton";
import type { ManifiestoFlujo } from "@/lib/types/manifiesto";

export interface ManifiestoResultadoProps {
  /** Resumen de lo que la operación de negocio YA cometió (mismo texto del toast). */
  mensaje: ReactNode;
  /** Punto de enganche del manifiesto. */
  flujo: ManifiestoFlujo;
  /** Lote cometido; vacío ⇒ el botón no aparece (R17). */
  seleccion: ManifiestoSeleccion;
}

/**
 * Feature 148 (§9.7) — Cuerpo de la fase "resultado" que comparten los 4 modales por
 * lote: el resumen de la operación YA cometida + el botón explícito de descarga (NO
 * hay descarga automática ni acción en el toast). Se anuncia con `role="status"`
 * porque aparece tras una acción del usuario y no es un error.
 *
 * Vive en `components/shared/` porque lo consumen rutas de dos grupos distintos
 * (`app/(app)/ordenes` y `app/(app)/recepcion-satelite`) y evita repetir la misma
 * composición cinco veces.
 */
export function ManifiestoResultado({
  mensaje,
  flujo,
  seleccion,
}: ManifiestoResultadoProps) {
  return (
    <div className="flex flex-col gap-3">
      <Alert variant="default" role="status">
        <AlertDescription>{mensaje}</AlertDescription>
      </Alert>
      <div className="flex flex-wrap justify-start gap-2">
        <DescargarManifiestoButton flujo={flujo} seleccion={seleccion} />
      </div>
    </div>
  );
}
