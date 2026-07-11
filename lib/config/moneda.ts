// Configuracion de formato de moneda de la capa de presentacion. El backend NO
// emite simbolo ni moneda (feature 32/R5: `montoCobrar` es un `number|null`
// crudo); el formato/moneda se resuelve aqui por configuracion, sobreescribible
// por variable de entorno para no hardcodear el contexto (patron de
// lib/config/ordenes.ts, docs/architecture.md "Sin hardcode de contexto").

function readNonEmpty(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw;
}

export interface MonedaConfig {
  /** Locale BCP 47 usado por `Intl.NumberFormat` (p. ej. "es-CR"). */
  locale: string;
  /** Codigo ISO 4217 de la moneda (p. ej. "CRC"). */
  currency: string;
}

export function loadMonedaConfig(): MonedaConfig {
  return {
    locale: readNonEmpty("MONEDA_LOCALE", "es-CR"),
    currency: readNonEmpty("MONEDA_CURRENCY", "CRC"),
  };
}

export const monedaConfig: MonedaConfig = loadMonedaConfig();

/** Marcador cuando no hay monto a cobrar (R5: `montoCobrar` null). */
export const SIN_MONTO = "-";

/**
 * Formatea un monto a cobrar con la moneda configurada (R5, sin hardcodear
 * simbolo ni moneda en el codigo). `null` -> `SIN_MONTO`.
 */
export function formatMonto(monto: number | null): string {
  if (monto == null) return SIN_MONTO;
  return new Intl.NumberFormat(monedaConfig.locale, {
    style: "currency",
    currency: monedaConfig.currency,
  }).format(monto);
}
