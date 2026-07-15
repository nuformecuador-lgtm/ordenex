/**
 * Normaliza la entrada a un número finito. Devuelve 0 si el valor no existe, es
 * cadena vacía/en blanco o no representa un número válido (contrato: fallback a 0).
 */
export function toValidNumber(value?: string | number | null): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}