"use client";

import { SegmentedToggle } from "@/components/shared/SegmentedToggle";
import type { TipoDeCuenta } from "@/lib/types/estado-cuenta";
import { CHIPS_BODEGA, CHIPS_MENSAJERO, CHIPS_TIENDA } from "@/lib/utils/estado-cuenta-chips";

import { CHIP_LABEL, CHIP_TODO, ESTADO_CUENTA_TEXTO, type ChipOTodo } from "./estado-cuenta-labels";

// FICHA 458-D (T D.1, D10; R24) — los CHIPS del estado de cuenta, por tipo de cuenta: tienda «Todo ·
// Cierres · Pagos · Cobros · Correcciones», mensajero «Todo · Cierres · Pagos · Premios · Correcciones»,
// bodega «Todo · Declarado · Recibido». La lista sale de las MISMAS constantes con las que el servidor
// decide el chip de cada fila (`lib/utils/estado-cuenta-chips.ts`): el filtro y la fila no pueden
// discrepar.

export const CHIPS_POR_TIPO: Record<TipoDeCuenta, readonly ChipOTodo[]> = {
  tienda: [CHIP_TODO, ...CHIPS_TIENDA],
  mensajero: [CHIP_TODO, ...CHIPS_MENSAJERO],
  bodega: [CHIP_TODO, ...CHIPS_BODEGA],
};

export interface ChipsEstadoCuentaProps {
  tipo: TipoDeCuenta;
  nombre: string;
  valor: ChipOTodo;
  onChange: (chip: ChipOTodo) => void;
}

export function ChipsEstadoCuenta({ tipo, nombre, valor, onChange }: Readonly<ChipsEstadoCuentaProps>) {
  return (
    <SegmentedToggle
      options={CHIPS_POR_TIPO[tipo].map((chip) => ({ valor: chip, etiqueta: CHIP_LABEL[chip] }))}
      valor={valor}
      onChange={onChange}
      ariaLabel={ESTADO_CUENTA_TEXTO.chips(nombre)}
    />
  );
}
