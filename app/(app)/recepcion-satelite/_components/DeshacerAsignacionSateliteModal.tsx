"use client";

import { DeshacerAsignacionModal } from "@/app/(app)/ordenes/_components/DeshacerAsignacionModal";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

export interface DeshacerAsignacionSateliteModalProps {
  open: boolean;
  /**
   * Órdenes `por_recoger` de la ZONA del adminSatelite (bucket `asignadas`, ya acotado
   * server-side). El caso (b) (`en_ruta_bodega_satelite`) NO llega nunca aquí: no se ofrece a
   * la satélite (R36) y el service lo rechazaría con `forbidden` (R5).
   */
  ordenes: RecepcionSateliteDTO[];
  onOpenChange: (open: boolean) => void;
  /** Éxito ⇒ el módulo hace `router.refresh()` (R38). */
  onSuccess: () => void;
}

/**
 * Feature 149 (T6.4, R35/R37/R38/R39) — "Deshacer asignación" desde la bodega satélite.
 *
 * Es un envoltorio DELGADO sobre `DeshacerAsignacionModal`: mismo cuerpo, mismo motivo
 * obligatorio, misma llamada única a la Server Action y misma traducción de errores
 * (design §6.2). `RecepcionSateliteDTO` cumple por estructura la forma mínima que el modal
 * necesita (`id`, `numRemision`, `zonaNombre`), así que no se duplica ni el formulario ni el
 * manejo de errores: duplicarlos habría hecho que un arreglo en una superficie no llegara a la
 * otra.
 */
export function DeshacerAsignacionSateliteModal({
  open,
  ordenes,
  onOpenChange,
  onSuccess,
}: DeshacerAsignacionSateliteModalProps) {
  return (
    <DeshacerAsignacionModal
      open={open}
      ordenes={ordenes}
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
    />
  );
}
