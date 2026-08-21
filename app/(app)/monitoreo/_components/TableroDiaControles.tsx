"use client";

// Feature 258 (F4.2) — la barra de controles del tablero: FILTRO por nombre + DENSIDAD.
//
// Los dos son estado de PRESENTACION y no tocan el servidor (R40/R45): el filtro recorta que
// tarjetas se pintan y la densidad cuanto aprietan. Ninguno consulta, ninguno reordena y
// ninguno cambia una cifra.
//
// ⛔ NI EL FILTRO NI LA DENSIDAD VAN A LA URL (R73). El unico parametro de estado de la ruta
// sigue siendo `?mensajero=`. El estado vive en `TableroDiaModule`, que es su dueño; este
// componente es controlado y no recuerda nada.
//
// Las dos primitivas del repo, sin envoltorio propio: `Input` (`components/ui/input`) y
// `SegmentedToggle` (`components/shared/SegmentedToggle`).

import { Search, X } from "lucide-react";

import { SegmentedToggle } from "@/components/shared/SegmentedToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  DENSIDADES,
  ETIQUETA_DENSIDAD,
  type DensidadTablero,
} from "./densidad";

/** R39 — nombre accesible del campo. No hay `<label>` visible: la barra es de una linea. */
const FILTRO_ETIQUETA = "Filtrar por nombre de mensajero";
const FILTRO_MARCADOR = "Buscar mensajero…";
const LIMPIAR_FILTRO = "Limpiar el filtro";
/** R44 — nombre accesible del grupo: una pantalla puede montar mas de un conmutador. */
const DENSIDAD_ETIQUETA = "Densidad del tablero";

export interface TableroDiaControlesProps {
  readonly filtro: string;
  readonly onFiltroChange: (filtro: string) => void;
  readonly densidad: DensidadTablero;
  readonly onDensidadChange: (densidad: DensidadTablero) => void;
}

export function TableroDiaControles({
  filtro,
  onFiltroChange,
  densidad,
  onDensidadChange,
}: TableroDiaControlesProps) {
  return (
    <div
      data-slot="tablero-dia-controles"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <div data-slot="tablero-dia-filtro" className="relative min-w-0 flex-1 sm:max-w-xs">
        {/* El icono es DECORATIVO: el nombre del campo lo da el `aria-label`, no el dibujo. */}
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={filtro}
          onChange={(evento) => onFiltroChange(evento.target.value)}
          aria-label={FILTRO_ETIQUETA}
          placeholder={FILTRO_MARCADOR}
          className="pr-8 pl-8"
        />
        {/* Solo cuando hay algo que limpiar: un boton permanentemente inutil es ruido. */}
        {filtro !== "" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={LIMPIAR_FILTRO}
            onClick={() => onFiltroChange("")}
            className="absolute top-1/2 right-0.5 size-7 -translate-y-1/2"
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      <div data-slot="tablero-dia-densidad">
        <SegmentedToggle
          options={DENSIDADES.map((valor) => ({
            valor,
            etiqueta: ETIQUETA_DENSIDAD[valor],
          }))}
          valor={densidad}
          onChange={onDensidadChange}
          ariaLabel={DENSIDAD_ETIQUETA}
        />
      </div>
    </div>
  );
}
