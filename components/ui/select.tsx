"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/** Una opción del `Select` (R32, design.md "Componente Select"). */
export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  /** Valor seleccionado. Cadena vacía representa "sin selección" (R32). */
  value: string;
  /** Emite el nuevo valor elegido; `""` si se limpia la selección. */
  onValueChange: (value: string) => void;
  /** Opciones renderizadas en la lista (R32). */
  options: SelectOption[];
  /** Texto mostrado cuando no hay selección. */
  placeholder?: string;
  /** Deshabilita el control por completo (p. ej. mientras cargan los mensajeros, R31). */
  disabled?: boolean;
  /** Nombre accesible del control (rol `combobox`, R32). */
  "aria-label"?: string;
  /** Clases extra para el trigger. */
  className?: string;
}

/**
 * Primitiva `Select` reutilizable construida sobre `@base-ui/react/select`
 * (R32, [RESUELTO-7]), coherente con el precedente de `Modal`/`Toast` (ambos
 * sobre `@base-ui/react`). Expone `value`/`onValueChange`/`options` como
 * contrato mínimo de producto sobre la composición headless de Base UI, que
 * aporta el rol `combobox`, `aria-expanded`, navegación por teclado y manejo
 * de foco (R32).
 */
export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Selecciona una opción",
  disabled = false,
  className,
  ...rest
}: SelectProps) {
  const ariaLabel = rest["aria-label"];

  return (
    <SelectPrimitive.Root
      value={value === "" ? null : value}
      onValueChange={(next) => onValueChange(next ?? "")}
      disabled={disabled}
      items={options}
    >
      <SelectPrimitive.Trigger
        data-slot="select-trigger"
        aria-label={ariaLabel}
        className={cn(
          "flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 opacity-60" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner sideOffset={4} className="z-50">
          <SelectPrimitive.Popup className="max-h-64 min-w-[var(--anchor-width)] overflow-auto rounded-lg border border-border bg-background p-1 shadow-lg outline-none">
            <SelectPrimitive.List>
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-muted"
                >
                  <SelectPrimitive.ItemText>
                    {option.label}
                  </SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator>
                    <Check className="size-4" aria-hidden="true" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
