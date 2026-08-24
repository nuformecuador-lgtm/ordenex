"use client";

import { CambiarDiaRepartoModal } from "@/app/(app)/ordenes/_components/CambiarDiaRepartoModal";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import type { FechasDiaReparto } from "@/lib/utils/dia-reparto-textos";

export interface CambiarDiaRepartoSateliteModalProps {
  open: boolean;
  /**
   * Órdenes `por_recoger` de la ZONA del adminSatelite (ya acotadas server-side). Los otros dos
   * estados donde el día sigue vivo —`en_reparto` y `ayuda_tienda`— NO llegan nunca aquí: no
   * están entre los cinco que su listado ofrece. Ésa es la «escalera de dos peldaños» del
   * límite declarado 5: una orden satélite ya en la calle con el día equivocado la corrige
   * maestro/admin desde `/ordenes`, que alcanza cualquier zona.
   */
  ordenes: RecepcionSateliteDTO[];
  /** R17: resueltas por la página, en el servidor. Este componente sólo las transporta. */
  fechasDiaReparto: FechasDiaReparto;
  onOpenChange: (open: boolean) => void;
  /** Éxito ⇒ el módulo relee el estado del servidor. */
  onSuccess: () => void;
}

/**
 * Feature 262 (F2, R13, design §4.2) — «Cambiar día de reparto» desde la bodega satélite.
 *
 * Es un envoltorio DELGADO sobre `CambiarDiaRepartoModal`: mismo cuerpo, mismo selector sin
 * preselección, mismo motivo obligatorio, MISMOS TEXTOS y LA MISMA Server Action. Idéntico
 * reparto que `DeshacerAsignacionSateliteModal` sobre `DeshacerAsignacionModal` (149, design
 * §6.2). `RecepcionSateliteDTO` cumple por estructura la forma mínima que el modal necesita
 * (`id`, `numRemision`, `fechaRepartoISO`), así que no se duplica ni el formulario ni la
 * traducción de errores: duplicarlos habría hecho que un arreglo en una superficie no llegara a
 * la otra.
 *
 * ⚠️ POR QUÉ EXISTE ESTA SEGUNDA SUPERFICIE, y no basta con `/ordenes` (design §4.1). `/ordenes`
 * no recorta por rol: recorta por PUERTA — `app/(app)/ordenes/page.tsx` hace `notFound()` para
 * `mensajero` y `adminSatelite`. Si la corrección viviera sólo allí, el `adminSatelite` —que SÍ
 * elige el día al asignar— se quedaría sin poder corregir el suyo, y ni un test de rol lo
 * detectaría: la exclusión no está en ninguna regla de rol, está en un `notFound()` de una
 * página. Esta ficha NO toca esa puerta (R13).
 */
export function CambiarDiaRepartoSateliteModal({
  open,
  ordenes,
  fechasDiaReparto,
  onOpenChange,
  onSuccess,
}: Readonly<CambiarDiaRepartoSateliteModalProps>) {
  return (
    <CambiarDiaRepartoModal
      open={open}
      ordenes={ordenes}
      fechasDiaReparto={fechasDiaReparto}
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
    />
  );
}
