import { MapPin, Navigation } from "lucide-react";

import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { mapsNavUrl } from "./pos-format";

// POS card · bloque de NAVEGACIÓN (réplica del `NavBlock` de la referencia). En la
// referencia el lado derecho muestra distancia + ETA; el DTO del mensajero no trae
// esos datos, así que se ADAPTA sin perder la estructura: cantón (mono, destacado) +
// badge de distrito arriba, y la dirección completa con el pin abajo. Es un enlace
// real a Google Maps (ruta directa) — se abre en pestaña nueva, no fuerza GPS.

export interface PosNavBlockProps {
  orden: MiAsignacionDTO;
}

export function PosNavBlock({ orden }: PosNavBlockProps) {
  return (
    <a
      href={mapsNavUrl(orden)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Navegar a ${orden.direccion ?? orden.cantonNombre}`}
      className="flex w-full items-stretch gap-3 rounded-2xl bg-navy p-3 text-left text-white transition-transform active:scale-[0.99]"
    >
      <div className="flex flex-col items-center justify-center rounded-xl bg-brand px-4 py-2 text-white">
        <Navigation className="size-6" aria-hidden="true" />
        <span className="mt-1 text-[10px] font-bold uppercase tracking-wide">Ir</span>
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-lg font-bold tabular-nums text-white">
            {orden.cantonNombre}
          </span>
          {orden.distritoNombre ? (
            <span className="shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] font-bold">
              {orden.distritoNombre}
            </span>
          ) : null}
        </div>
        <p className="mt-1 flex items-start gap-1 text-sm font-semibold leading-tight text-white/90">
          <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="text-pretty">{orden.direccion ?? "Sin dirección"}</span>
        </p>
      </div>
    </a>
  );
}
