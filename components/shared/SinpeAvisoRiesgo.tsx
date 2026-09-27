import { TriangleAlert } from "lucide-react";

import { SINPE_AVISO_RIESGO } from "@/components/shared/sinpe-textos";

/**
 * ⭑ FICHA 429 (T21) — EL AVISO QUE NOMBRA EL DAÑO, NO EL PROCEDIMIENTO.
 *
 * No dice «revisá los datos antes de guardar», que es lo que nadie lee. Dice qué pasa cuando el
 * número está mal: NADA, durante días — y esa es exactamente la razón por la que hay que mirarlo
 * ahora. Un aviso que describe el mecanismo del fallo se recuerda; uno que pide cuidado, no.
 *
 * ⚠️ TONO `warning` Y NO `destructive`. No hay nada roto: hay algo que conviene mirar. Pintarlo
 * de rojo en una pantalla que se abre a diario lo convierte en ruido, y la próxima alarma roja
 * —la que sí importa— llega a una persona que ya aprendió a taparlas.
 *
 * Tokens del sistema (`-soft` de fondo, `-strong` de texto, con la técnica soft-badge en oscuro);
 * cero hex sueltos, como manda `DESIGN.md`.
 */
export function SinpeAvisoRiesgo() {
  return (
    <div
      role="note"
      className="flex max-w-prose items-start gap-3 rounded-lg border border-warning/30 bg-warning-soft p-4 dark:bg-warning/15"
    >
      <TriangleAlert
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-warning-strong"
      />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-warning-strong">
          {SINPE_AVISO_RIESGO.titulo}
        </p>
        <p className="text-sm text-warning-strong">
          {SINPE_AVISO_RIESGO.cuerpo}
        </p>
      </div>
    </div>
  );
}
