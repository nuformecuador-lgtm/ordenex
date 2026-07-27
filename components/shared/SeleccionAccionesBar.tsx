"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Barra de acciones de una tabla con selección por checkbox. Con la selección vacía la
// barra NO se ve; al seleccionar la primera fila emerge DESDE DETRÁS de la tabla y sube
// hasta quedar sobre su borde superior.
//
// La barra está en posición ABSOLUTA respecto del contenedor de la tabla, así que no
// ocupa espacio en el flujo: la tabla no se mueve ni al aparecer ni al desaparecer
// (el motivo de este componente). El ocultamiento es por CAPAS, no por `display`:
//  - barra en z-0, desplazada hacia abajo (`translate-y-full`) => queda sobre la franja
//    superior de la tabla;
//  - la tabla va en z-10 con fondo OPACO => la tapa por completo.
// Al activarse, la barra vuelve a `translate-y: 0` (arriba de la tabla) con una
// transición: se percibe como que sale de detrás de la tabla.

const DURACION_MS = 220;

export interface SeleccionAccionesBarProps {
  /** `true` cuando hay al menos una fila seleccionada: la barra sube y se ve. */
  activa: boolean;
  /** Botones de la barra (acción principal y secundarias). */
  acciones: ReactNode;
  /** La tabla. Se envuelve en la capa opaca que oculta la barra en reposo. */
  children: ReactNode;
  /** Clases extra del contenedor externo. */
  className?: string;
}

export function SeleccionAccionesBar({
  activa,
  acciones,
  children,
  className,
}: SeleccionAccionesBarProps) {
  return (
    <div className={cn("relative", className)}>
      <div
        className={cn(
          // `bottom-full` ancla la barra al borde SUPERIOR de la tabla; con
          // `translate-y-full` baja justo encima de ella (y queda tapada por su capa).
          "absolute right-0 bottom-full z-0 flex flex-wrap items-center justify-end gap-2 pb-2",
          activa
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-full opacity-0",
        )}
        style={{
          // En Tailwind v4 `translate-*` usa la propiedad CSS `translate` (no
          // `transform`): hay que nombrarla explícitamente o no se anima el desplazamiento.
          transitionProperty: "translate, opacity",
          transitionDuration: `${DURACION_MS}ms`,
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {acciones}
      </div>
      {/* Capa opaca por encima (z-10): es lo que "esconde" la barra en reposo. */}
      <div className="relative z-10 bg-background">{children}</div>
    </div>
  );
}
