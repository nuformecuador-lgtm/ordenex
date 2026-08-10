"use client";

// Feature 192 (F2.3/F2.5, R34) — cabecera del tablero: la fecha CR del dia representado y
// la ANTIGUEDAD DEL DATO.
//
// ⛔ La antiguedad se calcula contra `generadoAt` —el instante en que los conteos se
// LEYERON de la base—, NUNCA contra el momento de la respuesta ni contra el del render. Con
// una cache de 15 s sobre un refresco de 30 s, el peor caso real que ve el operador es de
// ~45 s: si la pantalla dijera "hace 0 s" sobre ese dato, alguien tomaria una decision con
// un numero viejo creyendolo fresco. Por eso `generadoAt` entra por props y el reloj tambien.

import { useEffect, useState } from "react";

const PREFIJO_ANTIGUEDAD = "Actualizado hace";
const ANTIGUEDAD_DESCONOCIDA = "Antigüedad del dato desconocida";
const ETIQUETA_FECHA = "Día representado";

/** Segundos transcurridos desde que el dato se leyo de la base. `null` si no es medible. */
export function segundosDesdeGenerado(generadoAt: string, ahora: Date): number | null {
  const generado = Date.parse(generadoAt);
  if (Number.isNaN(generado)) return null;
  // Un reloj de cliente adelantado no puede producir una antiguedad negativa.
  return Math.max(0, Math.floor((ahora.getTime() - generado) / 1000));
}

/** Texto legible de la antiguedad del DATO (R34). */
export function antiguedadTexto(generadoAt: string, ahora: Date): string {
  const segundos = segundosDesdeGenerado(generadoAt, ahora);
  if (segundos === null) return ANTIGUEDAD_DESCONOCIDA;
  if (segundos < 60) return `${PREFIJO_ANTIGUEDAD} ${segundos} s`;
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `${PREFIJO_ANTIGUEDAD} ${minutos} min`;
  return `${PREFIJO_ANTIGUEDAD} ${Math.floor(minutos / 60)} h`;
}

/**
 * Fecha calendario CR legible. Se formatea en UTC sobre el `YYYY-MM-DD` que ya viene
 * resuelto del servidor: convertirlo a la zona del navegador podria correrlo un dia.
 */
export function fechaLegibleCR(fecha: string): string {
  const instante = new Date(`${fecha}T00:00:00Z`);
  if (Number.isNaN(instante.getTime())) return fecha;
  return new Intl.DateTimeFormat("es-CR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(instante);
}

/**
 * Reloj de pared para la cabecera: se refresca solo para que la antiguedad avance sin
 * esperar al siguiente refresco de datos. Lo consume quien monta el tablero; la cabecera
 * sigue siendo pura (recibe `ahora` por props y es testeable con un reloj fijo).
 */
export function useAhoraCadaSegundo(intervaloMs = 1000): Date {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), intervaloMs);
    return () => clearInterval(id);
  }, [intervaloMs]);
  return ahora;
}

export function TableroDiaCabecera({
  fecha,
  generadoAt,
  ahora,
}: Readonly<{
  /** `YYYY-MM-DD` calendario de Costa Rica del dia representado. */
  fecha: string;
  /** ISO-8601 del instante en que los conteos se leyeron de la base (R34). */
  generadoAt: string;
  ahora: Date;
}>) {
  return (
    <div
      data-slot="tablero-dia-cabecera"
      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
    >
      <p className="font-heading text-lg" aria-label={ETIQUETA_FECHA}>
        {fechaLegibleCR(fecha)}
      </p>
      <p className="text-sm text-muted-foreground">
        <time dateTime={generadoAt}>{antiguedadTexto(generadoAt, ahora)}</time>
      </p>
    </div>
  );
}
