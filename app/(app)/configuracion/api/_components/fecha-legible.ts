/**
 * Ficha 403/T14 — helper compartido de fecha legible de la pantalla `Configuración › API`.
 *
 * El formato (es-EC, fecha corta + hora corta) ya existía dentro de `api-keys-columns.tsx`
 * para la columna «Fecha de creación». Al necesitarlo también el aviso de envíos espaciados
 * de `WebhookAccionCell`, se saca a un único origen en vez de copiarlo: dos copias del mismo
 * formato acaban divergiendo, y la pantalla debe decir las fechas de UNA sola forma.
 *
 * Coacciona a `Date` defensivamente: según el borde de serialización (Server Action →
 * cliente) el dato llega unas veces como `Date` y otras como string ISO.
 */

/**
 * Fecha + hora tal como las lee una persona (es-EC), o `null` si el valor no es una fecha
 * interpretable. Devolver `null` —y no un guion— deja que cada llamador decida qué pintar en
 * ese hueco: la tabla pone su `—`, el aviso de pausa se calla la frase de la fecha entera.
 */
export function formatFechaHoraLegible(value: Date | string): string | null {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("es-EC", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}
