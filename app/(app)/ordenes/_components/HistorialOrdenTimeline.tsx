import type { OrdenHistorialEntradaDTO } from "@/lib/types/orden-historial";

import { estatusLabel } from "./estatus-label";

// Feature 49 (T6.1, R29/R30) — linea de tiempo de PRESENTACION pura del historial de una
// orden. Recibe las entradas ya resueltas por PROPS (R28: no fetchea por si mismo) y las
// pinta en orden cronologico ascendente (una por transicion). Los estados se muestran con
// su etiqueta legible via `estatusLabel` (R30, NUNCA UUIDs); el actor cae a "Sistema"
// cuando la transicion la origino el cron/job (R21/R29) y el motivo solo aparece si existe
// (R22). Sin logica de fetch/estado: es un componente tonto reutilizable por el drawer.

// Formateo FIJO a la zona de Costa Rica: la lectura del timestamp es estable y determinista
// (no depende de la zona horaria del entorno donde corre el render).
const FECHA_HORA = new Intl.DateTimeFormat("es-CR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Costa_Rica",
});

/** Actor del sistema (cron/job) cuando `actorNombre` es null (R21/R29). */
const ACTOR_SISTEMA = "Sistema";

function formatFechaHora(fecha: Date): string {
  const ms = fecha.getTime();
  return Number.isNaN(ms) ? "—" : FECHA_HORA.format(fecha);
}

export interface HistorialOrdenTimelineProps {
  /** Transiciones ya ordenadas cronologicamente (asc) y resueltas a valores legibles (R26/R28). */
  entradas: OrdenHistorialEntradaDTO[];
}

export function HistorialOrdenTimeline({ entradas }: HistorialOrdenTimelineProps) {
  if (entradas.length === 0) {
    // Estado vacio: orden sin historial (p. ej. creada antes del deploy de la feature).
    return <p className="text-sm text-muted-foreground">Sin historial todavía.</p>;
  }

  return (
    <ol aria-label="Línea de tiempo de estados" className="flex flex-col gap-4">
      {entradas.map((entrada, index) => {
        const esCreacion = entrada.estatusOrigenValue === null; // R20: origen vacio = creacion
        const destinoLabel = estatusLabel(entrada.estatusDestinoValue);
        const actor = entrada.actorNombre ?? ACTOR_SISTEMA;
        const createdMs = entrada.createdAt.getTime();

        return (
          <li
            key={`${index}-${Number.isNaN(createdMs) ? "na" : createdMs}`}
            className="relative flex flex-col gap-1 border-l-2 border-border pl-4"
          >
            <span
              aria-hidden="true"
              className="absolute top-1.5 -left-[5px] size-2 rounded-full bg-primary"
            />
            {/* R30: origen -> destino con etiquetas legibles; en la creacion, "Creación · destino". */}
            <p className="flex flex-wrap items-center gap-1 text-sm font-medium">
              <span>{esCreacion ? "Creación" : estatusLabel(entrada.estatusOrigenValue)}</span>
              <span aria-hidden="true">{esCreacion ? "·" : "→"}</span>
              <span>{destinoLabel}</span>
            </p>
            <time
              dateTime={Number.isNaN(createdMs) ? undefined : entrada.createdAt.toISOString()}
              className="text-xs text-muted-foreground"
            >
              {formatFechaHora(entrada.createdAt)}
            </time>
            <p className="text-xs text-muted-foreground">Por {actor}</p>
            {entrada.motivo ? (
              <p className="text-sm">Motivo: {entrada.motivo}</p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
