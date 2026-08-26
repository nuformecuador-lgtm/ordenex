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

type TarifaCampo = (typeof TARIFA_CAMPOS)[number];

/**
 * Los campos que ve el formulario de ZONA: todos MENOS `fulfillment` (2026-08-26). Una tarifa
 * de zona dice lo que cuesta REPARTIR ahi, no si una tienda concreta guarda su producto en
 * nuestra bodega; pedir ese monto aquí era pedir un dato que quien edita la zona no tiene.
 * La columna es nullable (migración `tarifa_fulfillment_opcional`) justo para que la fila
 * pueda guardarse sin él: el formulario manda `fulfillment: null`, que aguas abajo significa
 * exactamente lo mismo que 0 —esta tarifa no lleva fulfillment—.
 */
export const TARIFA_CAMPOS_ZONA: readonly TarifaCampo[] = TARIFA_CAMPOS.filter(
  (c) => c.key !== "fulfillment",
);

/** Claves que NO están en `campos`, para mandarlas explícitamente como `null`. */
function clavesOmitidas(campos: readonly TarifaCampo[]): TarifaCampoKey[] {
  const presentes = new Set<TarifaCampoKey>(campos.map((c) => c.key));
  return TARIFA_CAMPOS.filter((c) => !presentes.has(c.key)).map((c) => c.key);
}

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

/**
 * true si el usuario escribió ALGO en la sección (aunque sea un solo campo). `campos` acota
 * la pregunta a los VISIBLES: un valor heredado en un campo que este formulario no muestra no
 * puede contar como "el usuario escribió algo", porque no pudo escribirlo.
 */
export function hayAlgunValor(
  valores: TarifaValores,
  campos: readonly TarifaCampo[] = TARIFA_CAMPOS,
): boolean {
  return campos.some((c) => valores[c.key].trim() !== "");
}

/**
 * Valida los campos en cliente (todos obligatorios salvo los `opcional`, más
 * rangos) y devuelve el bloque numérico del payload. No conoce `tiendaId` ni
 * `zonaId`: eso lo añade cada formulario según a qué acota la tarifa.
 */
export function validarTarifaCampos(
  valores: TarifaValores,
  campos: readonly TarifaCampo[] = TARIFA_CAMPOS,
):
  | { ok: true; numericos: Record<string, number | null> }
  | { ok: false; errors: TarifaFieldErrors } {
  const errors: TarifaFieldErrors = {};
  const numericos: Record<string, number | null> = {};

  // Un campo que este formulario NO muestra viaja como `null` EXPLÍCITO, no ausente: si se
  // omitiera, actualizar dejaría vivo un valor que la pantalla ya no enseña —lo que se ve
  // dejaría de ser lo que se cobra—. Sólo es omitible una columna nullable en la base; hoy
  // la única así fuera de las tarifas especiales es `fulfillment`.
  for (const key of clavesOmitidas(campos)) numericos[key] = null;

  for (const campo of campos) {
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
  campos = TARIFA_CAMPOS,
}: {
  idPrefix: string;
  valores: TarifaValores;
  errors: TarifaFieldErrors;
  onChange: (key: TarifaCampoKey, value: string) => void;
  /** Campos a mostrar; por defecto todos. El formulario de zona pasa `TARIFA_CAMPOS_ZONA`. */
  campos?: readonly TarifaCampo[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {campos.map((campo) => (
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
