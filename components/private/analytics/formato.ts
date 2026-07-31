// Formato por unidad (R20, R21) y total por columna (R23). Modulo PURO: se
// invoca y se prueba sin renderizar ningun componente, que es donde vive la
// logica que de verdad puede equivocarse (design.md §6.2).
//
// Ni un simbolo de moneda ni un codigo ISO escritos aqui (R13): la moneda sale
// de `lib/config/moneda.ts`. Ni un literal de idioma (R20): el locale sale del
// mismo modulo de configuracion y las unidades de tiempo las nombra `Intl`.

import type { MetricaUnidad } from "@/lib/analytics/types";
import { formatMonto, monedaConfig, SIN_MONTO } from "@/lib/config/moneda";

const SEGUNDOS_POR_MINUTO = 60;
const SEGUNDOS_POR_HORA = 3600;

function numero(valor: number, opciones: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(monedaConfig.locale, opciones).format(valor);
}

/**
 * Un `porcentaje` llega como FRACCION (0,842 = 84,2 %), no en puntos.
 *
 * Es coherente con como lo define el catalogo de la 135 —una razon
 * numerador/denominador (`lib/analytics/types.ts`, `DefinicionMetrica.razon`)—
 * y con `Intl`, que multiplica por 100 en `style: "percent"`. El tablero (131)
 * pasa la razon cruda; no la pre-multiplica.
 */
function formatearPorcentaje(valor: number): string {
  return numero(valor, { style: "percent", maximumFractionDigits: 1 });
}

/**
 * Duracion legible sin literal de idioma: `Intl` con `style: "unit"` nombra la
 * unidad en el locale configurado. Se elige la unidad por magnitud para que
 * "5400 s" no se lea como ruido cuando son hora y media.
 */
function formatearSegundos(valor: number): string {
  const absoluto = Math.abs(valor);
  if (absoluto < SEGUNDOS_POR_MINUTO) {
    return numero(valor, { style: "unit", unit: "second", unitDisplay: "short", maximumFractionDigits: 0 });
  }
  if (absoluto < SEGUNDOS_POR_HORA) {
    return numero(valor / SEGUNDOS_POR_MINUTO, {
      style: "unit",
      unit: "minute",
      unitDisplay: "short",
      maximumFractionDigits: 1,
    });
  }
  return numero(valor / SEGUNDOS_POR_HORA, {
    style: "unit",
    unit: "hour",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  });
}

/**
 * Formatea un valor segun la unidad declarada por la metrica (R20).
 *
 * `null` es DATO AUSENTE y se marca con `SIN_MONTO` (`lib/config/moneda.ts`),
 * nunca con `0` (R11, R14): un cero es una afirmacion sobre el dato y aqui no
 * hay dato que afirmar.
 */
export function formatearValor(valor: number | null, unidad: MetricaUnidad): string {
  if (valor === null || !Number.isFinite(valor)) return SIN_MONTO;
  switch (unidad) {
    case "moneda":
      return formatMonto(valor);
    case "porcentaje":
      return formatearPorcentaje(valor);
    case "segundos":
      return formatearSegundos(valor);
    case "conteo":
      return numero(valor, { maximumFractionDigits: 0 });
  }
}

/**
 * Total de una columna (R23), calculado en una funcion pura y NUNCA sumando
 * dentro del JSX.
 *
 * Los ausentes se ignoran en vez de contar como cero; si TODOS lo son, el total
 * tambien es ausente: sumar nada da `null`, no `0`.
 */
export function totalizar(valores: readonly (number | null)[]): number | null {
  const presentes = valores.filter((v): v is number => v !== null && Number.isFinite(v));
  if (presentes.length === 0) return null;
  return presentes.reduce((acumulado, actual) => acumulado + actual, 0);
}
