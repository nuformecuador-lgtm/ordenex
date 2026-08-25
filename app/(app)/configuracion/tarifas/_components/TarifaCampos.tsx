"use client";

import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/FormField";

/**
 * Campos numéricos que pueblan la tabla `tarifas`, OMITIENDO `nombre`, `zona_id`
 * y `tienda_id` (el acotado lo decide quien usa el formulario, no los campos).
 * `monto` valida >= 0; `porcentaje` valida 0..100. Obligatorios salvo los
 * marcados `opcional` (hoy las dos tarifas especiales, las únicas columnas nullable de
 * la tabla: vacío = sin pacto especial, que no es lo mismo que 0).
 *
 * Vive aparte porque los usan DOS formularios: el de tarifa por tienda
 * (`CrearTiendaForm`) y la sección "Tarifas de zona" del formulario de zona
 * (`CrearZonaForm`). Es el mismo formulario salvo por la selección de tienda.
 */
export const TARIFA_CAMPOS = [
  { key: "valorFlete", label: "Valor flete", tipo: "monto" },
  { key: "valorFleteDevuelto", label: "Valor flete devuelto", tipo: "monto" },
  { key: "valorFleteGam", label: "Valor flete GAM", tipo: "monto" },
  { key: "valorFleteDevueltoGam", label: "Valor flete devuelto GAM", tipo: "monto" },
  { key: "fulfillment", label: "Fulfillment", tipo: "monto" },
  { key: "comisionCod", label: "Comisión COD (%)", tipo: "porcentaje" },
  { key: "ivaFlete", label: "IVA flete (%)", tipo: "porcentaje" },
  { key: "ivaComisionCod", label: "IVA comisión COD (%)", tipo: "porcentaje" },
  {
    key: "tarifaEspecial",
    label: "Tarifa especial",
    tipo: "monto",
    opcional: true,
  },
  {
    key: "tarifaEspecialDevuelta",
    label: "Tarifa especial devuelta",
    tipo: "monto",
    opcional: true,
  },
] as const;

export type TarifaCampoKey = (typeof TARIFA_CAMPOS)[number]["key"];

/** Valores del formulario como strings (lo que teclea el usuario). */
export type TarifaValores = Record<TarifaCampoKey, string>;

export type TarifaFieldErrors = Record<string, string[]>;

export const tarifaValoresVacios = (): TarifaValores =>
  TARIFA_CAMPOS.reduce((acc, c) => {
    acc[c.key] = "";
    return acc;
  }, {} as TarifaValores);

/**
 * Deriva los valores del formulario (strings) desde una fila ya guardada de
 * `tarifas`. Un `null` —hoy sólo las dos `tarifaEspecial*`— se convierte en cadena
 * vacía, que es como el formulario representa "sin pacto especial": el ida y
 * vuelta con `validarTarifaCampos` lo devuelve a `null`, no a 0.
 */
export function tarifaValoresDesde(
  row: Partial<Record<TarifaCampoKey, unknown>>,
): TarifaValores {
  const valores = tarifaValoresVacios();
  for (const campo of TARIFA_CAMPOS) {
    const v = row[campo.key];
    valores[campo.key] = v == null ? "" : String(v);
  }
  return valores;
}

/** true si el usuario escribió ALGO en la sección (aunque sea un solo campo). */
export function hayAlgunValor(valores: TarifaValores): boolean {
  return TARIFA_CAMPOS.some((c) => valores[c.key].trim() !== "");
}

/**
 * Valida los campos en cliente (todos obligatorios salvo los `opcional`, más
 * rangos) y devuelve el bloque numérico del payload. No conoce `tiendaId` ni
 * `zonaId`: eso lo añade cada formulario según a qué acota la tarifa.
 */
export function validarTarifaCampos(
  valores: TarifaValores,
):
  | { ok: true; numericos: Record<string, number | null> }
  | { ok: false; errors: TarifaFieldErrors } {
  const errors: TarifaFieldErrors = {};
  const numericos: Record<string, number | null> = {};

  for (const campo of TARIFA_CAMPOS) {
    const raw = valores[campo.key].trim();
    if (raw === "") {
      // Un opcional vacío no es un error: viaja como `null` para que el backend
      // pueda LIMPIAR un pacto especial que existía antes.
      if ("opcional" in campo && campo.opcional) {
        numericos[campo.key] = null;
        continue;
      }
      errors[campo.key] = ["Este campo es obligatorio."];
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      errors[campo.key] = ["Debe ser un número válido."];
      continue;
    }
    if (n < 0) {
      errors[campo.key] = ["No puede ser negativo."];
      continue;
    }
    if (campo.tipo === "porcentaje" && n > 100) {
      errors[campo.key] = ["Debe estar entre 0 y 100."];
      continue;
    }
    numericos[campo.key] = n;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, numericos };
}

/**
 * Rejilla de los campos numéricos. `idPrefix` evita colisión de ids cuando la
 * rejilla convive con otro formulario en la misma página.
 */
export function TarifaCamposGrid({
  idPrefix,
  valores,
  errors,
  onChange,
}: {
  idPrefix: string;
  valores: TarifaValores;
  errors: TarifaFieldErrors;
  onChange: (key: TarifaCampoKey, value: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {TARIFA_CAMPOS.map((campo) => (
        <FormField
          key={campo.key}
          id={`${idPrefix}-${campo.key}`}
          label={campo.label}
          error={errors[campo.key]}
          required={!("opcional" in campo && campo.opcional)}
        >
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            max={campo.tipo === "porcentaje" ? 100 : undefined}
            step="0.01"
            value={valores[campo.key]}
            onChange={(e) => onChange(campo.key, e.target.value)}
          />
        </FormField>
      ))}
    </div>
  );
}
