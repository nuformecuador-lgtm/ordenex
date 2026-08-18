"use client";

import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";

/**
 * Control SEGMENTADO: dos o más opciones excluyentes en un solo bloque, con la activa
 * resaltada. Es el conmutador que la rama ux estrenó en el portal del mensajero para alternar
 * entre la vista «mosaico» y la «detalle» de sus órdenes.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO (pedido humano del 2026-08-16): la pantalla de cierres pidió
 * «tabs bodega/mensajero con el que se usa en órdenes del mensajero». La forma barata de
 * cumplirlo era copiar `VistaCardsToggle` y cambiarle las etiquetas; la forma que no se
 * despega es esta: el control se extrae aquí SIN dominio y las dos pantallas lo montan. Un
 * copiado habría tenido el mismo aspecto el primer día y otro distinto al primer retoque, que
 * es justo lo que «el mismo que usa el mensajero» pide que no pase.
 *
 * LO QUE NO CAMBIA respecto al original, y por eso este archivo no es una reescritura: el DOM
 * es el mismo (`ButtonGroup` + un `Button` por opción), y la selección se anuncia con
 * `aria-pressed` en vez de con un `radiogroup` porque detrás no hay formulario. Los tests de
 * las pantallas del mensajero localizan el control por `role="group"` y su nombre accesible, y
 * siguen encontrándolo igual.
 *
 * ES ESTADO DE UI PURO: no filtra, no reordena y no toca la ruta. Quien lo monta decide qué
 * significa cada opción.
 */
export interface SegmentedOption<T extends string> {
  valor: T;
  etiqueta: string;
  /** Icono opcional a la izquierda de la etiqueta. */
  Icono?: LucideIcon;
  /**
   * Contador que acompaña a la etiqueta («Pendientes 12»). Es un dato, no un adorno: en un
   * conmutador que ESCONDE la opción no elegida, sin él la pestaña que no se está mirando no
   * dice si tiene trabajo esperando. Se omite cuando no hay número que dar.
   */
  conteo?: number;
}

export interface SegmentedToggleProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  valor: T;
  onChange: (valor: T) => void;
  /** Nombre accesible del grupo. Obligatorio: una pantalla puede montar más de uno. */
  ariaLabel: string;
  className?: string;
}

export function SegmentedToggle<T extends string>({
  options,
  valor,
  onChange,
  ariaLabel,
  className,
}: Readonly<SegmentedToggleProps<T>>) {
  return (
    <ButtonGroup aria-label={ariaLabel} className={className}>
      {options.map(({ valor: opcion, etiqueta, Icono, conteo }) => {
        const activa = valor === opcion;
        return (
          <Button
            key={opcion}
            type="button"
            variant={activa ? "default" : "outline"}
            aria-pressed={activa}
            onClick={() => onChange(opcion)}
          >
            {Icono ? <Icono aria-hidden="true" /> : null}
            {etiqueta}
            {conteo === undefined ? null : (
              // El conteo va DENTRO del botón y no en un badge aparte: forma parte del nombre
              // accesible de la opción, así que un lector de pantalla anuncia «Pendientes (12)»
              // en vez de dejar el número suelto al lado.
              //
              // Entre PARÉNTESIS, y no a secas: es el mismo idioma con el que esta app escribe
              // los contadores de listado desde la feature 170 («Histórico (60)»), y sin ellos
              // el número queda pegado a la etiqueta —«Pendientes12»— tanto en el nombre
              // accesible como para quien lee la pestaña de un vistazo.
              <span className="tabular-nums opacity-70">({conteo})</span>
            )}
          </Button>
        );
      })}
    </ButtonGroup>
  );
}
