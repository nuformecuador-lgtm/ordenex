import type { FiltroDisponible } from "@/components/shared/BuscadorFiltros";
import type { FilterDef, FilterOption, FilterSelection } from "@/components/shared/FilterComponent";

import { LIBRO_CAJA_FILTROS_TEXTO } from "./libro-caja-labels";
import type { FiltrosLibro, FiltrosWallet } from "./wallet-filtros-input";

// FICHA 467 (T4, design §3.1; R6, R9, R19, R20, R27) — las DECLARACIONES de la barra única del libro de
// la caja (`/wallet`). Módulo puro, sin JSX: qué casillas ofrece «Filtros», qué control monta cada una y
// la traducción entre lo que emite el orquestador (`FilterSelection`) y los filtros de la caja
// (`FiltrosWallet` / `FiltrosLibro`, de `wallet-filtros-input.ts`).
//
// Las claves del orquestador para Entra/Sale y Concepto son las MISMAS palabras que ya usa
// `FiltrosLibro` (`tipo`, `categoria`), así que la traducción es directa.

/** Las claves de las casillas. `aQuien` no es del orquestador: lo monta `SelectorBuscable` (§2). */
export const CASILLA = {
  periodo: "periodo",
  aQuien: "aQuien",
  direccion: "tipo",
  concepto: "categoria",
} as const;

/** R6 — las casillas de la caja, EN ESTE ORDEN: es también el orden de sus controles en la barra (R9). */
export const CASILLAS_CAJA: FiltroDisponible[] = [
  { key: CASILLA.periodo, label: LIBRO_CAJA_FILTROS_TEXTO.periodo },
  { key: CASILLA.aQuien, label: LIBRO_CAJA_FILTROS_TEXTO.aQuien },
  { key: CASILLA.direccion, label: LIBRO_CAJA_FILTROS_TEXTO.direccion },
  { key: CASILLA.concepto, label: LIBRO_CAJA_FILTROS_TEXTO.concepto },
];

/** R19 — Entra/Sale: las dos direcciones, sin «Todo» (sin elección ya son las dos; lo dice el placeholder). */
export const OPCIONES_DIRECCION_CAJA: FilterOption[] = [
  { value: "ingreso", label: LIBRO_CAJA_FILTROS_TEXTO.entra },
  { value: "egreso", label: LIBRO_CAJA_FILTROS_TEXTO.sale },
];

/** El control del Periodo: un rango de fechas sin atajos, que se aplica solo (R17). */
export const DECLARACION_PERIODO: FilterDef = {
  key: CASILLA.periodo,
  label: LIBRO_CAJA_FILTROS_TEXTO.periodo,
  kind: "dateRange",
};

/**
 * Las declaraciones de los controles del ORQUESTADOR, en el orden de las casillas: Periodo (rango de
 * fechas), Entra/Sale y Concepto (`single`, con el nombre dentro del disparador). Las opciones de
 * Concepto son las que el servidor dice que tienen movimientos (R20), ya rotuladas.
 */
export function declaracionesCaja(conceptos: FilterOption[]): FilterDef[] {
  return [
    DECLARACION_PERIODO,
    {
      key: CASILLA.direccion,
      label: LIBRO_CAJA_FILTROS_TEXTO.direccion,
      kind: "single",
      options: OPCIONES_DIRECCION_CAJA,
      placeholder: LIBRO_CAJA_FILTROS_TEXTO.direccionTodo,
    },
    {
      key: CASILLA.concepto,
      label: LIBRO_CAJA_FILTROS_TEXTO.concepto,
      kind: "single",
      options: conceptos,
      placeholder: LIBRO_CAJA_FILTROS_TEXTO.conceptoTodos,
    },
  ];
}

/** El periodo como selección del orquestador (la terna `[atajo, desde, hasta]`); sin periodo, `{}`. */
export function seleccionDePeriodo(desde: string, hasta: string): FilterSelection {
  return desde === "" && hasta === "" ? {} : { [CASILLA.periodo]: ["", desde, hasta] };
}

/** La selección emitida, de vuelta a `desde`/`hasta` (vacío = sin ese extremo). */
export function periodoDeSeleccion(seleccion: FilterSelection): { desde: string; hasta: string } {
  const [, desde = "", hasta = ""] = seleccion[CASILLA.periodo] ?? [];
  return { desde, hasta };
}

/** Lo vigente de la caja como selección del orquestador: lo que la `siembra` repone (R28). */
export function seleccionDeCaja(fw: FiltrosWallet, fl: FiltrosLibro): FilterSelection {
  return {
    ...seleccionDePeriodo(fw.desde, fw.hasta),
    ...(fl.tipo === "" ? {} : { [CASILLA.direccion]: [fl.tipo] }),
    ...(fl.categoria !== "" ? { [CASILLA.concepto]: [fl.categoria] } : {}),
  };
}

/** Lo emitido por el orquestador, de vuelta a los campos de la caja (ausente = vacío). */
export function deSeleccion(seleccion: FilterSelection): {
  desde: string;
  hasta: string;
  tipo: string;
  categoria: string;
} {
  return {
    ...periodoDeSeleccion(seleccion),
    tipo: seleccion[CASILLA.direccion]?.[0] ?? "",
    categoria: seleccion[CASILLA.concepto]?.[0] ?? "",
  };
}

/**
 * R27 — las casillas cuyo filtro TIENE valor en lo vigente. Lo que filtra tiene que verse: tras un fallo
 * el módulo marca, como mínimo, estas casillas.
 */
export function casillasConValor(fw: FiltrosWallet, fl: FiltrosLibro): string[] {
  const conValor = new Set<string>();
  if (fw.desde !== "" || fw.hasta !== "") conValor.add(CASILLA.periodo);
  if (fw.aQuien !== undefined) conValor.add(CASILLA.aQuien);
  if (fl.tipo !== "") conValor.add(CASILLA.direccion);
  if (fl.categoria !== "") conValor.add(CASILLA.concepto);
  // En el orden de las casillas, no en el de las comprobaciones.
  return CASILLAS_CAJA.map((c) => c.key).filter((k) => conValor.has(k));
}
