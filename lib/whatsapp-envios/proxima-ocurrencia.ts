// Ficha 474 (design §4.1/§6.1, R20/R22) — la PROXIMA ocurrencia de un envio a hora fija.
//
// Modulo PURO: sin red, sin base, sin reloj propio (el `desde` lo da quien llama). Costa Rica es
// UTC-6 fijo (sin horario de verano); la unica pieza del repo que sabe de ese desfase es
// `lib/utils/fecha-cr.ts`, y aqui se usa a traves de ella, sin aritmetica horaria propia.
import { fechaCalendarioCR, inicioDelDiaCREnUtc } from "@/lib/utils/fecha-cr";

const UN_DIA_MS = 24 * 60 * 60 * 1000;
const HORA_RE = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

export interface Ocurrencia {
  /** Dia calendario CR de la ocurrencia, `YYYY-MM-DD`. Es la clave de idempotencia (R23). */
  readonly fechaCr: string;
  /** Instante UTC en que toca enviar. */
  readonly instante: Date;
}

/** ISO 8601: 1 = lunes … 7 = domingo, de una fecha `YYYY-MM-DD`. */
export function diaIsoDe(fechaCr: string): number {
  const dow = new Date(`${fechaCr}T12:00:00.000Z`).getUTCDay(); // 0 = domingo
  return dow === 0 ? 7 : dow;
}

/** Suma `n` dias calendario a `YYYY-MM-DD`. */
function sumarDias(fechaCr: string, n: number): string {
  const d = new Date(`${fechaCr}T12:00:00.000Z`);
  return new Date(d.getTime() + n * UN_DIA_MS).toISOString().slice(0, 10);
}

/** Instante UTC de `hora` (HH:mm de pared CR) en el dia `fechaCr`. */
export function instanteDe(fechaCr: string, hora: string): Date {
  const m = HORA_RE.exec(hora);
  if (m === null) throw new Error(`hora invalida: ${hora}`);
  const minutos = Number(m[1]) * 60 + Number(m[2]);
  return new Date(inicioDelDiaCREnUtc(fechaCr).getTime() + minutos * 60_000);
}

/**
 * El primer instante CR ESTRICTAMENTE posterior a `desde` cuyo dia ISO esta en `dias`.
 *
 * «Estrictamente» es la mitad de R20: guardar a las 05:00 un envio de las 05:00 no envia ahora; y
 * una hora ya pasada hoy cae en la proxima ocurrencia, sin «recuperar» lo pasado. `null` si `dias`
 * no tiene ningun dia valido (un envio asi no se puede guardar: lo impide el service).
 */
export function proximaOcurrencia(
  dias: readonly number[],
  hora: string,
  desde: Date,
): Ocurrencia | null {
  const validos = new Set(dias.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7));
  if (validos.size === 0) return null;
  const hoy = fechaCalendarioCR(desde);
  // 8 vueltas: hoy (si la hora no paso) y los 7 dias siguientes cubren cualquier combinacion.
  for (let i = 0; i <= 7; i++) {
    const fechaCr = sumarDias(hoy, i);
    if (!validos.has(diaIsoDe(fechaCr))) continue;
    const instante = instanteDe(fechaCr, hora);
    if (instante.getTime() > desde.getTime()) return { fechaCr, instante };
  }
  return null;
}
