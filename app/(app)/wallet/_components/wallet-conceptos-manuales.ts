import type {
  TipoEgresoManual,
  WalletMovimientoCategoria,
  WalletMovimientoTipo,
} from "@/lib/types/wallet";
import { TIPO_EGRESO_MANUAL_A_CATEGORIA } from "@/lib/types/wallet";

import {
  CATEGORIA_LABEL,
  DESCRIPCION_EGRESO_LABEL,
  DESCRIPCION_EGRESO_PLACEHOLDER,
} from "./wallet-labels";

// Ficha 334 (D1, design §9) — el CATÁLOGO de conceptos que una persona puede registrar a mano
// en la caja principal. Es la ÚNICA fuente de los cuatro, y por eso la regla del gasto FIJO se
// puede afirmar sobre él con un test (R11): lo que no está aquí no se puede elegir.
//
// POR QUÉ NO VIVE EN `wallet-labels.ts`. Ese archivo es texto de pantalla; esto además lleva el
// ENRUTADO —a qué Server Action va cada concepto y con qué payload—, que es lo que hace posible
// que el usuario vea UN formulario mientras la base sigue recibiendo dos escrituras distintas
// (design §6: `origen_tipo` decide qué es reversable, y fusionarlo cambiaría eso en silencio).
//
// Módulo PURO: sin React y sin leer ningún reloj. La fecha del movimiento la pone el diálogo.

/** Los CUATRO conceptos, en el orden en que se ofrecen. `gasto_fijo` NO está: lo emite el cron. */
export const CONCEPTO_MANUAL_IDS = [
  "gasto_variable",
  "sueldo",
  "ajuste_ingreso",
  "ajuste_egreso",
] as const;

export type ConceptoManualId = (typeof CONCEPTO_MANUAL_IDS)[number];

/**
 * A dónde va el concepto cuando se registra. Unión DISCRIMINADA a propósito: el diálogo no
 * elige action con un `if` sobre el id, sino sobre esta clase, así que un concepto nuevo que
 * olvidara declarar su destino no compila.
 */
export type DestinoConcepto =
  | { readonly clase: "egreso_administrativo"; readonly tipoEgreso: TipoEgresoManual }
  | { readonly clase: "ajuste_manual"; readonly tipo: WalletMovimientoTipo };

export interface ConceptoManual {
  readonly id: ConceptoManualId;
  /** Cómo se llama el concepto DENTRO del selector. */
  readonly label: string;
  /** La categoría del libro que se acaba escribiendo. */
  readonly categoria: WalletMovimientoCategoria;
  /** Etiqueta del campo de descripción, adaptada al concepto (R9). */
  readonly descripcionLabel: string;
  /** Ejemplo de descripción, para que el campo no arranque mudo. */
  readonly descripcionPlaceholder: string;
  readonly destino: DestinoConcepto;
}

export const CONCEPTOS_MANUALES: readonly ConceptoManual[] = [
  {
    id: "gasto_variable",
    label: "Gasto variable",
    categoria: TIPO_EGRESO_MANUAL_A_CATEGORIA.gasto_variable,
    // Las dos etiquetas de la ficha 45 se conservan BYTE A BYTE (R9): se derivan de su
    // `Record` en vez de copiarse, que es lo que impide que la fusión las cambie sin querer.
    descripcionLabel: DESCRIPCION_EGRESO_LABEL.gasto_variable,
    descripcionPlaceholder: DESCRIPCION_EGRESO_PLACEHOLDER.gasto_variable,
    destino: { clase: "egreso_administrativo", tipoEgreso: "gasto_variable" },
  },
  {
    id: "sueldo",
    label: "Sueldo",
    categoria: TIPO_EGRESO_MANUAL_A_CATEGORIA.sueldo,
    descripcionLabel: DESCRIPCION_EGRESO_LABEL.sueldo,
    descripcionPlaceholder: DESCRIPCION_EGRESO_PLACEHOLDER.sueldo,
    destino: { clase: "egreso_administrativo", tipoEgreso: "sueldo" },
  },
  {
    // R7 — el ajuste que SUMA. El nombre dice lo que le pasa al dinero, no el nombre del enum:
    // «ingreso_ajuste» no se le enseña a nadie.
    id: "ajuste_ingreso",
    label: "Ajuste que suma dinero",
    categoria: "ingreso_ajuste",
    descripcionLabel: "Motivo del ajuste",
    descripcionPlaceholder: "Ej. Devolución de un pago hecho de más",
    destino: { clase: "ajuste_manual", tipo: "ingreso" },
  },
  {
    id: "ajuste_egreso",
    label: "Ajuste que resta dinero",
    categoria: "egreso_ajuste",
    descripcionLabel: "Motivo del ajuste",
    descripcionPlaceholder: "Ej. Faltante encontrado al cuadrar la caja",
    destino: { clase: "ajuste_manual", tipo: "egreso" },
  },
];

/** Opciones del `Select` de concepto, en el orden del catálogo. */
export const CONCEPTO_MANUAL_OPTIONS = CONCEPTOS_MANUALES.map((concepto) => ({
  value: concepto.id,
  label: concepto.label,
}));

/**
 * R4 — con qué nombre aparecerá el movimiento EN EL LIBRO. Se DERIVA de `CATEGORIA_LABEL` y no
 * se copia: el día que alguien renombre una categoría, el diálogo lo sigue solo en vez de
 * prometer un nombre que el libro ya no usa.
 */
export function nombreEnElLibro(concepto: ConceptoManual): string {
  return CATEGORIA_LABEL[concepto.categoria];
}

/** El concepto con ese id. `undefined` si no existe: quien lo llame decide qué hacer. */
export function conceptoPorId(id: string): ConceptoManual | undefined {
  return CONCEPTOS_MANUALES.find((concepto) => concepto.id === id);
}
