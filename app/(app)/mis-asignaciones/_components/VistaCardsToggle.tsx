"use client";

import { LayoutGrid, Rows3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";

// Rama ux (pedido humano): conmutador de la VISTA de las cards de "En reparto / por
// gestionar". Dos presentaciones de los MISMOS datos, sin filtrar ni reordenar nada:
//   - "mosaico": grilla de tarjetas compactas (`PosOrderCardMosaico`), para barrer muchas.
//   - "detalle": una fila por orden con la acción de navegar (`PosOrderCardDetalle`).
// Es estado de UI puro (no toca datos ni ruta), así que vive en el módulo, no en la URL.

export type VistaCards = "mosaico" | "detalle";

export interface VistaCardsToggleProps {
  vista: VistaCards;
  onVistaChange: (vista: VistaCards) => void;
}

const OPCIONES: { valor: VistaCards; etiqueta: string; Icono: typeof LayoutGrid }[] = [
  { valor: "mosaico", etiqueta: "Mosaico", Icono: LayoutGrid },
  { valor: "detalle", etiqueta: "Detalle", Icono: Rows3 },
];

export function VistaCardsToggle({ vista, onVistaChange }: VistaCardsToggleProps) {
  return (
    // `ButtonGroup` de shadcn (une los botones en un solo control segmentado) +
    // `aria-pressed` por opción: el lector de pantalla anuncia cuál está activa sin
    // necesitar un radiogroup (no hay formulario detrás).
    <ButtonGroup aria-label="Vista de las órdenes">
      {OPCIONES.map(({ valor, etiqueta, Icono }) => {
        const activa = vista === valor;
        return (
          <Button
            key={valor}
            type="button"
            variant={activa ? "default" : "outline"}
            aria-pressed={activa}
            onClick={() => onVistaChange(valor)}
          >
            <Icono aria-hidden="true" />
            {etiqueta}
          </Button>
        );
      })}
    </ButtonGroup>
  );
}
