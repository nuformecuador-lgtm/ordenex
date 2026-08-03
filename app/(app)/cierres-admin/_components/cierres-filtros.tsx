"use client";

import { DateRangeFilter } from "@/components/shared/DateRangeFilter";
import {
  MultiSelectFilter,
  type MultiSelectOption,
} from "@/components/shared/MultiSelectFilter";
import { fechaCalendarioCR, ultimosNDiasCalendarioCR } from "@/lib/utils/fecha-cr";

// Filtros de las pantallas de cierres (mensajero y bodega). Todo el acotado es CLIENTE:
// el Server Component ya trajo los cierres del alcance del actor, así que aquí no se
// vuelve a consultar nada ni se amplía ningún alcance — solo se esconde lo que no se
// está mirando. Los controles son los MISMOS que usa la barra de filtros de órdenes
// (`DateRangeFilter` + `MultiSelectFilter`).

/** Rango de fechas calendario (`YYYY-MM-DD`); `""` en un extremo = abierto por ese lado. */
export interface RangoFechas {
  desde: string;
  hasta: string;
}

/** Días de los atajos, los mismos que ofrece la barra de filtros de órdenes. */
const DIAS_ATAJOS = [7, 15, 30, 90] as const;

/**
 * Atajos del rango resueltos a fechas calendario de Costa Rica (misma regla que órdenes:
 * N días incluido hoy). Se calculan al cargar el módulo; una sesión abierta durante días
 * no se re-encuadra sola, igual que en órdenes.
 */
export const ATAJOS_FECHA = DIAS_ATAJOS.map((dias) => ({
  value: `${dias}d`,
  label: `Últimos ${dias} días`,
  ...ultimosNDiasCalendarioCR(dias),
}));

/** Selección por defecto de las listas de cierres: los últimos 7 días. */
export const RANGO_INICIAL: RangoFechas = ultimosNDiasCalendarioCR(7);

export const SIN_RESULTADOS_FILTRO =
  "Ningún cierre coincide con los filtros. Ampliá el rango de fechas o limpiá los filtros.";

/**
 * ¿El instante ISO cae en el rango? Se compara la fecha CALENDARIO de Costa Rica, no el
 * instante UTC: un cierre solicitado a las 22:00 en CR es del día 11 aunque su ISO diga
 * 12. Extremos inclusivos; rango vacío = no filtra.
 */
export function enRangoFecha(iso: string, rango: RangoFechas): boolean {
  const fecha = fechaCalendarioCR(new Date(iso));
  if (rango.desde !== "" && fecha < rango.desde) return false;
  if (rango.hasta !== "" && fecha > rango.hasta) return false;
  return true;
}

/** Sin nada marcado, el filtro no filtra (no es "ninguno", es "todos"). */
export function coincide(valor: string, marcados: string[]): boolean {
  return marcados.length === 0 || marcados.includes(valor);
}

/** Opciones de un multi-select derivadas de los propios cierres: únicas y ordenadas. */
export function opcionesDe(valores: string[]): MultiSelectOption[] {
  return [...new Set(valores)]
    .sort((a, b) => a.localeCompare(b, "es"))
    .map((v) => ({ value: v, label: v }));
}

/** Declaración de un multi-select de la barra (controlado por el módulo anfitrión). */
export interface FiltroMulti {
  key: string;
  label: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
}

export interface BarraFiltrosCierresProps {
  /** Emite el rango elegido. Ausente = la barra no ofrece filtro de fecha. */
  onRangoChange?: (rango: RangoFechas) => void;
  /** Multi-selects ofrecidos, en orden. */
  multis?: FiltroMulti[];
}

/**
 * Barra de filtros de una lista de cierres: el rango de fechas (arranca en los últimos 7
 * días) y los multi-selects que declare la pantalla. Las opciones las calcula el
 * anfitrión a partir de los cierres que tiene: no hay catálogo que pedir.
 */
export function BarraFiltrosCierres({
  onRangoChange,
  multis = [],
}: Readonly<BarraFiltrosCierresProps>) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      {onRangoChange ? (
        <DateRangeFilter
          label="Fecha del cierre"
          shortcuts={ATAJOS_FECHA}
          defaultRange={RANGO_INICIAL}
          onChange={([, desde, hasta]) => onRangoChange({ desde, hasta })}
        />
      ) : null}
      {multis.map((m) => (
        <MultiSelectFilter
          key={m.key}
          label={m.label}
          options={m.options}
          value={m.value}
          onChange={m.onChange}
        />
      ))}
    </div>
  );
}
