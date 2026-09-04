"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/** Una opción del `Select` (R32, design.md "Componente Select"). */
export interface SelectOption {
  value: string;
  label: string;
  /** Si `true`, la opción se muestra pero no es seleccionable (p. ej. mensajero con cierre abierto). */
  disabled?: boolean;
  /**
   * Etiqueta del grupo al que pertenece la opción. Cuando alguna opción la trae,
   * la lista se renderiza agrupada con un encabezado por grupo (`Select.Group` +
   * `Select.GroupLabel`), que es lo que diferencia opciones homónimas de
   * distinta procedencia (p. ej. administradores de tienda vs API keys).
   */
  group?: string;
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
  /** Id del trigger, para casar con un `Label htmlFor` (patrón `FormField`). */
  id?: string;
  /** Marca de invalidez para el estado de error del campo (`FormField`). */
  "aria-invalid"?: boolean;
  /** Id del bloque de ayuda/error asociado, para lectores de pantalla (`FormField`). */
  "aria-describedby"?: string;
  /** Clases extra para el trigger. */
  className?: string;
  /**
   * FICHA 372 — rótulo VISIBLE dentro del disparador, en gris y delante del valor
   * («Salida a reparto: Todas»). Es OPCIONAL y aditivo: sin él, el disparador
   * renderiza exactamente el mismo marcado de siempre, así que ningún consumidor
   * previo cambia de aspecto.
   *
   * Existe porque un `Select` en una BARRA DE FILTROS no tiene rótulo encima ni al
   * lado: sin esto, el control se lee «Todas» y no dice qué filtra. NO sustituye al
   * `aria-label` —que sigue siendo el nombre accesible—, lo acompaña para quien ve.
   * Es el mismo tratamiento que `MultiSelectFilter` ya daba a su disparador, de modo
   * que `multi` y `single` conviven en la misma fila sin distinguirse.
   */
  labelPrefix?: string;
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
  id,
  className,
  labelPrefix,
  ...rest
}: SelectProps) {
  const ariaLabel = rest["aria-label"];
  const ariaInvalid = rest["aria-invalid"];
  const ariaDescribedBy = rest["aria-describedby"];

  return (
    <SelectPrimitive.Root
      value={value === "" ? null : value}
      onValueChange={(next) => onValueChange(next ?? "")}
      disabled={disabled}
      items={options}
    >
      <SelectPrimitive.Trigger
        data-slot="select-trigger"
        id={id}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        className={cn(
          "flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
          className,
        )}
      >
        {/* Sin `labelPrefix` el disparador es EL DE SIEMPRE: un `Select.Value` pelado.
            Con él, el rótulo va delante en gris y el valor detrás, dentro del mismo
            hueco truncable (mismo patrón que `MultiSelectFilter`). */}
        {labelPrefix === undefined ? (
          <SelectPrimitive.Value placeholder={placeholder} />
        ) : (
          <span className="min-w-0 truncate">
            <span className="text-muted-foreground">{labelPrefix}: </span>
            <SelectPrimitive.Value placeholder={placeholder} />
          </span>
        )}
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 opacity-60" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner sideOffset={4} className="z-50">
          <SelectPrimitive.Popup className="max-h-64 min-w-[var(--anchor-width)] overflow-auto rounded-lg border border-border bg-background p-1 shadow-lg outline-none">
            <SelectPrimitive.List>
              {agrupar(options).map(({ group, items }, i) =>
                group === undefined ? (
                  <React.Fragment key={`plain:${i}`}>
                    {items.map((option) => renderItem(option))}
                  </React.Fragment>
                ) : (
                  <SelectPrimitive.Group key={`group:${group}`}>
                    <SelectPrimitive.GroupLabel className="px-2 py-1 text-xs font-medium text-muted-foreground">
                      {group}
                    </SelectPrimitive.GroupLabel>
                    {items.map((option) => renderItem(option))}
                  </SelectPrimitive.Group>
                ),
              )}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/** Una opción ya renderizada como `Select.Item` (compartido por lista plana y agrupada). */
function renderItem(option: SelectOption) {
  return (
    <SelectPrimitive.Item
      key={option.value}
      value={option.value}
      disabled={option.disabled}
      className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-muted data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
    >
      <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator>
        <Check className="size-4" aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

/**
 * Parte las opciones en tramos consecutivos por `group`, conservando el orden de
 * entrada. Las opciones sin `group` salen en un tramo sin encabezado, de modo que
 * un `Select` que nunca usa grupos renderiza exactamente la lista plana de antes.
 */
export function agrupar(
  options: SelectOption[],
): Array<{ group: string | undefined; items: SelectOption[] }> {
  const tramos: Array<{ group: string | undefined; items: SelectOption[] }> = [];
  for (const option of options) {
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && ultimo.group === option.group) ultimo.items.push(option);
    else tramos.push({ group: option.group, items: [option] });
  }
  return tramos;
}
