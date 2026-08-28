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
   * Alinea el campo con sus VECINOS DE FILA. Sólo tiene sentido si el padre es una rejilla
   * (`grid`): el campo pasa a ser `subgrid` de ella y ancla cada trozo —etiqueta, ayuda,
   * control y error— a una franja compartida por toda la fila (ver `FILAS_ALINEADAS`).
   *
   * Por defecto `false`: un campo suelto se apila con `flex` y no necesita nada de esto.
   */
  rowAligned?: boolean;
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
 * Feature 310 — las CUATRO franjas de un campo alineado, en orden y siempre las mismas.
 *
 * EL DEFECTO QUE ARREGLAN. Apilado con `flex`, cada campo empieza donde acabó su etiqueta: si
 * la del vecino ocupa dos renglones, o si uno tiene ayuda («Sin configurar…») y el otro no,
 * los controles de una misma fila caen a distinta altura y la rejilla se descuadra. La 303 lo
 * destapó al alargar los rótulos, pero el desajuste estaba en el apilado, no en los textos.
 *
 * CÓMO. El campo se declara `subgrid` de la rejilla que lo contiene y ocupa 4 franjas; cada
 * trozo se ancla a la SUYA (`row-start-*`), esté o no presente. La altura de cada franja la
 * fija el más alto de la fila entera, así que el control cae a la misma altura en todas las
 * columnas aunque una etiqueta ocupe dos renglones y el vecino no tenga ayuda. Que aguante
 * también los rótulos de TRES renglones sale gratis: nada aquí supone una altura concreta.
 *
 * El espaciado interno NO puede venir del `gap` de la rejilla (ese separa filas de campos,
 * y es mucho mayor): la separación entre franjas se anula (`gap-y-0`) y la pone cada trozo
 * con su propio margen, para que una franja vacía —una fila sin ayuda ni error— no deje un
 * hueco muerto.
 */
const FILAS_ALINEADAS = {
  campo: "grid grid-rows-subgrid row-span-4 gap-y-0",
  /** `leading-tight` porque `Label` viene con `leading-none`: dos renglones se tocarían. */
  label: "row-start-1 mb-1.5 leading-tight",
  hint: "row-start-2 mb-1.5",
  control: "row-start-3",
  /** `empty:mt-0`: sin error el hueco desaparece, con error se separa del control. */
  error: "row-start-4 mt-1.5 empty:mt-0",
} as const;

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
  rowAligned = false,
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

  const controlNode = renderControl(children, control);
  const errorNode = (
    <FieldError id={errorId} messages={Array.isArray(error) ? error : undefined}>
      {Array.isArray(error) ? undefined : error}
    </FieldError>
  );

  return (
    <div
      className={cn(
        rowAligned ? FILAS_ALINEADAS.campo : "flex flex-col gap-1.5",
        className,
      )}
    >
      <Label
        htmlFor={id}
        className={cn(rowAligned && FILAS_ALINEADAS.label, labelClassName)}
      >
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
        <p
          id={hintId}
          className={cn(
            "text-sm text-muted-foreground",
            rowAligned && FILAS_ALINEADAS.hint,
          )}
        >
          {hint}
        </p>
      ) : null}
      {/* Alineado, cada trozo va en su franja: el control y el error se envuelven porque no
          se les pueden poner clases (el control se clona; el error puede no existir). */}
      {rowAligned ? (
        <div className={FILAS_ALINEADAS.control}>{controlNode}</div>
      ) : (
        controlNode
      )}
      {rowAligned ? (
        <div className={FILAS_ALINEADAS.error}>{errorNode}</div>
      ) : (
        errorNode
      )}
    </div>
  );
}
