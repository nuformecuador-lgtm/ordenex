import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { formatPeso } from "./pos-format";

// POS card · cabecera (réplica del `Header` de la referencia): a la izquierda el nº
// de parada de la ruta en un cuadro navy + el código de remisión y la posición
// "N de total · peso"; a la derecha un badge de estado sólido. Presentación pura.

export interface PosCardHeaderProps {
  orden: MiAsignacionDTO;
  /** Total de órdenes en reparto, para el texto "N de total". */
  total: number;
  /** Etiqueta de estado (p. ej. "En gestión", "En detalle", "En reparto"). */
  estado: string;
  /**
   * `false` para las superficies SIN ruta optimizada (p. ej. "Por recoger"): se omiten
   * el cuadro de parada y el "N de total", que ahí no significan nada. Default `true`.
   */
  mostrarParada?: boolean;
}

export function PosCardHeader({
  orden,
  total,
  estado,
  mostrarParada = true,
}: PosCardHeaderProps) {
  // R28: nº de parada en la ruta optimizada; "·" cuando aún no tiene posición.
  const parada = orden.secuenciaRuta;
  return (
    <div className="flex items-center justify-between border-b-4 border-navy px-4 py-3">
      <div className="flex items-center gap-2">
        {mostrarParada ? (
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-lg bg-navy text-base font-black text-white"
          >
            {parada ?? "·"}
          </span>
        ) : null}
        <div className="leading-none">
          <p className="font-mono text-sm font-bold tracking-wide text-foreground">
            {orden.numRemision}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
            {mostrarParada ? (
              <>
                {parada !== null ? (
                  <>
                    <span className="sr-only">Parada </span>
                    {parada} de {total}
                  </>
                ) : (
                  "Sin posición"
                )}{" "}
                ·{" "}
              </>
            ) : null}
            {formatPeso(orden.peso)}
          </p>
        </div>
      </div>
      <span className="rounded-lg bg-warning px-3 py-1.5 text-xs font-black uppercase tracking-wide text-navy">
        {estado}
      </span>
    </div>
  );
}
