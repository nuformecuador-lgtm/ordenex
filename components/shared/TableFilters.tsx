"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Definición de un campo de filtro. El contrato mínimo pedido es `nombre` +
 * `defaultValue`; `label`, `placeholder` y `type` son opcionales para pulir UI.
 */
export interface FilterField {
  /** Clave del campo. Es la key del objeto de valores emitido y el name del input. */
  nombre: string;
  /** Valor inicial del filtro (y valor al que vuelve "Limpiar"). Default "". */
  defaultValue?: string;
  /** Etiqueta visible del campo. Si se omite, se usa `nombre`. */
  label?: string;
  /** Placeholder del input. */
  placeholder?: string;
  /** Tipo de input HTML (text, search, number, date…). Default "text". */
  type?: string;
}

/** Mapa `{ [nombre]: valor }` con el estado actual de todos los filtros. */
export type FilterValues = Record<string, string>;

export interface TableFiltersProps {
  /** Campos a renderizar. Cada uno aporta `nombre` y opcionalmente `defaultValue`. */
  fields: FilterField[];
  /** Se emite en cada cambio con el mapa completo de valores. */
  onChange?: (values: FilterValues) => void;
  /**
   * Se emite al enviar el formulario (Enter o botón "Aplicar"). Si se provee,
   * se renderiza el botón "Aplicar" para filtrado bajo demanda.
   */
  onSubmit?: (values: FilterValues) => void;
  /** Deshabilita todos los controles (p. ej. mientras carga). */
  disabled?: boolean;
  /** Etiqueta del botón de reinicio. Default "Limpiar". */
  resetLabel?: string;
  /** Etiqueta del botón de envío. Default "Aplicar". */
  submitLabel?: string;
  /** Nombre accesible del formulario. Default "Filtros". */
  ariaLabel?: string;
  className?: string;
}

/** Construye el mapa inicial de valores a partir de los `defaultValue` (o ""). */
function buildInitialValues(fields: FilterField[]): FilterValues {
  return fields.reduce<FilterValues>((acc, field) => {
    acc[field.nombre] = field.defaultValue ?? "";
    return acc;
  }, {});
}

/**
 * Barra de filtros genérica para tablas. Recibe un array de campos (cada uno con
 * `nombre` y `defaultValue`) y mantiene su propio estado, emitiéndolo por
 * `onChange` en cada tecleo y por `onSubmit` al aplicar. UI pura: no conoce el
 * dominio ni la tabla, solo produce el mapa de valores.
 */
export function TableFilters({
  fields,
  onChange,
  onSubmit,
  disabled = false,
  resetLabel = "Limpiar",
  submitLabel = "Aplicar",
  ariaLabel = "Filtros",
  className,
}: TableFiltersProps) {
  // La forma inicial se calcula una vez; cambios posteriores en `fields` no
  // reinician el estado (contrato "uncontrolled" simple y predecible).
  const initialValues = useMemo(() => buildInitialValues(fields), [fields]);
  const [values, setValues] = useState<FilterValues>(initialValues);

  function emit(next: FilterValues) {
    setValues(next);
    onChange?.(next);
  }

  function handleField(nombre: string, value: string) {
    emit({ ...values, [nombre]: value });
  }

  function handleReset() {
    emit(initialValues);
  }

  return (
    <form
      aria-label={ariaLabel}
      className={cn("flex flex-wrap items-end gap-3", className)}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.(values);
      }}
    >
      {fields.map((field) => {
        const inputId = `filtro-${field.nombre}`;
        return (
          <div key={field.nombre} className="flex flex-col gap-1">
            <Label htmlFor={inputId}>{field.label ?? field.nombre}</Label>
            <Input
              id={inputId}
              name={field.nombre}
              type={field.type ?? "text"}
              value={values[field.nombre] ?? ""}
              placeholder={field.placeholder}
              disabled={disabled}
              onChange={(e) => handleField(field.nombre, e.target.value)}
            />
          </div>
        );
      })}

      <div className="flex items-center gap-2">
        {onSubmit && (
          <Button type="submit" disabled={disabled}>
            {submitLabel}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={handleReset}
        >
          {resetLabel}
        </Button>
      </div>
    </form>
  );
}
