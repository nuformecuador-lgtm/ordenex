"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/utils";

export interface SwitchProps {
  /** Estado del interruptor (controlado). */
  checked: boolean;
  /** Emite el nuevo estado al alternar. */
  onCheckedChange: (checked: boolean) => void;
  /** Deshabilita el control por completo. */
  disabled?: boolean;
  /** Id del input oculto (para asociar un `Label htmlFor`). */
  id?: string;
  /** Nombre accesible del control (rol `switch`). */
  "aria-label"?: string;
  /** Clases extra para la raíz. */
  className?: string;
}

/**
 * Primitiva `Switch` reutilizable construida sobre `@base-ui/react/switch`,
 * coherente con el precedente de `Select`/`Modal`/`Toast` (todos sobre
 * `@base-ui/react`). Expone `checked`/`onCheckedChange` como contrato mínimo
 * sobre la composición headless de Base UI, que aporta el rol `switch`,
 * `aria-checked`, manejo de foco y navegación por teclado.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  id,
  className,
  ...rest
}: SwitchProps) {
  const ariaLabel = rest["aria-label"];

  return (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next)}
      disabled={disabled}
      aria-label={ariaLabel}
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent px-0.5 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:bg-primary data-[unchecked]:bg-input",
        className,
      )}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform data-[checked]:translate-x-4 data-[unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  );
}
