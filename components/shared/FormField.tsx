import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { FieldError } from "./FieldError";

/** Props de accesibilidad que `FormField` cablea sobre el control. */
export interface FormFieldControlProps {
  /** Id del control; casa con el `htmlFor` del `Label`. */
  id: string;
  /** `true` cuando el campo tiene error (si no, se omite). */
  "aria-invalid": true | undefined;
  /** Ids de la ayuda y/o el error asociados (si no hay, se omite). */
  "aria-describedby": string | undefined;
  /** `true` cuando el campo es obligatorio (si no, se omite). */
  "aria-required": true | undefined;
}

export type FormFieldChildren =
  | ReactNode
  | ((control: FormFieldControlProps) => ReactNode);

export interface FormFieldProps {
  /** Id del control; enlaza `Label htmlFor`, control y `FieldError`. */
  id: string;
  /** Etiqueta visible del campo (texto o nodo; listo para i18n). */
  label: ReactNode;
  /** Mensaje(s) de error de validación del campo. */
  error?: string | string[];
  /** Texto de ayuda/descripción del campo, enlazado por `aria-describedby`. */
  hint?: ReactNode;
  /** Marca el campo como obligatorio (indicador visual + `aria-required`). */
  required?: boolean;
  /** Clases extra para el contenedor del campo. */
  className?: string;
  /** Clases extra para el `Label`. */
  labelClassName?: string;
  /**
   * El control del campo. Como elemento (se le inyecta la accesibilidad por
   * clonación) o como render-prop que recibe `{ id, "aria-invalid",
   * "aria-describedby", "aria-required" }` para cablearla a mano (útil con
   * `Select`, `Checkbox` o controles compuestos).
   */
  children: FormFieldChildren;
}

/** Combina el `aria-describedby` que aporta `FormField` con el que ya tuviera el control. */
function mergeControlProps(
  previous: Record<string, unknown>,
  control: FormFieldControlProps,
): Record<string, unknown> {
  const previousDescribedBy = previous["aria-describedby"];
  const describedBy =
    [
      control["aria-describedby"],
      typeof previousDescribedBy === "string" ? previousDescribedBy : undefined,
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  return {
    id: control.id,
    "aria-invalid": control["aria-invalid"],
    "aria-describedby": describedBy,
    "aria-required": control["aria-required"],
  };
}

/** Aplica la accesibilidad al control: llama la render-prop o clona el elemento hijo. */
function renderControl(
  children: FormFieldChildren,
  control: FormFieldControlProps,
): ReactNode {
  if (typeof children === "function") {
    return children(control);
  }
  if (isValidElement(children)) {
    const element = children as ReactElement<Record<string, unknown>>;
    return cloneElement(element, mergeControlProps(element.props, control));
  }
  return children;
}

/**
 * Patrón único de campo de formulario (DESIGN.md): `Label` + control +
 * `FieldError`, con la accesibilidad cableada. El `Label` apunta al control por
 * `htmlFor`; ante error, el control recibe `aria-invalid="true"` y un
 * `aria-describedby` que apunta al `FieldError` (y a la ayuda, si la hay).
 * Funciona con los controles del repo (`Input`, `Select`, `Checkbox`,
 * `textarea`), sea clonando el elemento hijo o vía render-prop.
 */
export function FormField({
  id,
  label,
  error,
  hint,
  required = false,
  className,
  labelClassName,
  children,
}: FormFieldProps) {
  const hasError = Array.isArray(error) ? error.length > 0 : Boolean(error);
  const errorId = `${id}-error`;
  const hintId = hint != null && hint !== false ? `${id}-hint` : undefined;
  const describedBy =
    [hintId, hasError ? errorId : undefined].filter(Boolean).join(" ") ||
    undefined;

  const control: FormFieldControlProps = {
    id,
    "aria-invalid": hasError ? true : undefined,
    "aria-describedby": describedBy,
    "aria-required": required ? true : undefined,
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} className={labelClassName}>
        <span>
          {label}
          {required ? (
            <span aria-hidden="true" className="ml-0.5 text-destructive">
              *
            </span>
          ) : null}
        </span>
      </Label>
      {hintId ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {renderControl(children, control)}
      <FieldError id={errorId} messages={Array.isArray(error) ? error : undefined}>
        {Array.isArray(error) ? undefined : error}
      </FieldError>
    </div>
  );
}
