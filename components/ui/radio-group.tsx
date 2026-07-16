"use client";

import * as React from "react";
import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";

import { cn } from "@/lib/utils";

/** Una opción del `RadioGroup` (espejo de `SelectOption`, `components/ui/select.tsx`). */
export interface RadioGroupOption {
  value: string;
  label: string;
}

export interface RadioGroupProps {
  /** Valor seleccionado. Cadena vacía representa "sin selección" (igual que `Select`). */
  value: string;
  /** Emite el nuevo valor elegido; `""` si se limpia la selección. */
  onValueChange: (value: string) => void;
  /** Opciones renderizadas, en orden (cada una un `role="radio"`). */
  options: readonly RadioGroupOption[];
  /** Deshabilita el grupo completo. */
  disabled?: boolean;
  /** Nombre accesible del grupo (rol `radiogroup`). */
  "aria-label"?: string;
  /** Marca el grupo como inválido (mismo contrato que los campos del panel). */
  "aria-invalid"?: boolean;
  /** Clases extra para el contenedor del grupo. */
  className?: string;
}

/**
 * Primitiva `RadioGroup` reutilizable construida sobre `@base-ui/react/radio-group` +
 * `@base-ui/react/radio`, coherente con el precedente de `Select` (`select.tsx:4`) y
 * `Checkbox` (`checkbox.tsx:3`). Este repo NO usa Radix: sus primitivas van sobre Base UI,
 * por lo que `npx shadcn add radio-group` sería la instrucción equivocada aquí.
 *
 * Expone `value`/`onValueChange`/`options` como contrato mínimo de producto sobre la
 * composición headless de Base UI, que aporta el rol `radiogroup`, el rol `radio` por opción,
 * `aria-checked`, la navegación por flechas y el manejo de foco (un solo tab-stop por grupo).
 * El nombre accesible de cada opción sale de su `<label>` envolvente, que además hace toda la
 * fila pulsable (móvil-first).
 */
export function RadioGroup({
  value,
  onValueChange,
  options,
  disabled = false,
  className,
  ...rest
}: RadioGroupProps) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      value={value === "" ? null : value}
      onValueChange={(next) => onValueChange((next as string | null) ?? "")}
      disabled={disabled}
      aria-label={rest["aria-label"]}
      aria-invalid={rest["aria-invalid"] ? true : undefined}
      className={cn("flex flex-col gap-2", className)}
    >
      {options.map((option) => (
        <label
          key={option.value}
          data-slot="radio-group-item"
          className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-input px-3 py-2.5 text-sm transition-colors has-data-checked:border-primary has-data-checked:bg-primary/5 has-disabled:cursor-not-allowed has-disabled:opacity-50"
        >
          <RadioPrimitive.Root
            value={option.value}
            data-slot="radio-group-indicator-root"
            className="relative flex size-4 shrink-0 items-center justify-center rounded-full border border-input outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:border-primary data-checked:bg-primary data-disabled:cursor-not-allowed dark:bg-input/30 dark:data-checked:bg-primary"
          >
            <RadioPrimitive.Indicator
              data-slot="radio-group-indicator"
              className="size-1.5 rounded-full bg-primary-foreground"
            />
          </RadioPrimitive.Root>
          {option.label}
        </label>
      ))}
    </RadioGroupPrimitive>
  );
}
