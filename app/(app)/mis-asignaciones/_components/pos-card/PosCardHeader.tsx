import { EstadoConInfo, NotaAyudaConInfo } from "@/components/shared/EstadoInfo";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { CLASE_NOTA_AYUDA, type MarcaPintable } from "./pos-estado";
import { formatPeso } from "./pos-format";

// POS card · cabecera (réplica del `Header` de la referencia): a la izquierda el nº
// de parada de la ruta en un cuadro navy + el código de remisión y la posición
// "N de total · peso"; a la derecha un badge de estado sólido. Presentación pura.

export interface PosCardHeaderProps {
  orden: MiAsignacionDTO;
  /** Total de órdenes en reparto, para el texto "N de total". */
  total: number;
  /**
   * FICHA 456 (T3.6): el chip se pinta desde `orden.estatusValue` con `EstadoConInfo` (nombre +
   * botón de información). La prop `estado` (el texto ya resuelto) se retira: nadie le pasa texto.
   */
  /** Marcas de la interfaz y notas del consumidor, pintadas JUNTO al chip (R8). */
  marcas?: readonly MarcaPintable[];
  /** FICHA 456 (R12): la orden tiene una ayuda a la tienda abierta: nota con su botón. */
  notaAyuda?: boolean;
  /**
   * `false` para las superficies SIN ruta optimizada (p. ej. "Por recoger"): se omiten
   * el cuadro de parada y el "N de total", que ahí no significan nada. Default `true`.
   */
  mostrarParada?: boolean;
}

export function PosCardHeader({
  orden,
  total,
  marcas = [],
  notaAyuda = false,
  mostrarParada = true,
}: PosCardHeaderProps) {
  // R28: nº de parada en la ruta optimizada; "·" cuando aún no tiene posición.
  const parada = orden.secuenciaRuta;
  return (
    // Feature 208 — REGLA de esta card: el navy que es SUPERFICIE se conserva (el
    // cuadro de la parada de abajo es un bloque navy con texto blanco, 13.2:1 en los
    // dos temas); el navy que es LÍNEA sobre la card —esta subrayada de 4px— se migra,
    // porque la card gira con el tema y en oscuro la línea desaparecía.
    <div className="flex items-center justify-between border-b-4 border-foreground px-4 py-3">
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
      <div className="flex flex-col items-end gap-1">
        <EstadoConInfo
          codigo={orden.estatusValue}
          chipClassName="rounded-lg bg-warning px-3 py-1.5 text-xs font-black uppercase tracking-wide text-navy"
        />
        {marcas.map((m) => (
          <span
            key={m.texto}
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${m.clase}`}
          >
            {m.texto}
          </span>
        ))}
        {notaAyuda ? (
          <NotaAyudaConInfo
            chipClassName={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${CLASE_NOTA_AYUDA}`}
          />
        ) : null}
      </div>
    </div>
  );
}
