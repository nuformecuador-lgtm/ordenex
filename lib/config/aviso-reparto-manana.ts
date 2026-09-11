// FICHA 413 (T1.2, design §4.1, R9/R10) — LA HORA DEL AVISO, CON SU MEDICION AL LADO DEL VALOR.
//
// R9 pide que la hora este DECLARADA y sea la misma todo el año; R10 pide que la expresion de
// `vercel.json` —que va en UTC— corresponda a esta hora CR y que la correspondencia sea
// VERIFICABLE SIN EJECUTAR EL CRON. Este archivo es la FUENTE; `vercel.json` es lo que se VERIFICA
// contra el, en `tests/unit/guards/cron-hora-cr.guardia.test.ts`.
//
// Dos sitios que dicen la misma hora en unidades distintas es justo como se acaba con dos
// verdades. Aqui uno de los dos manda y el otro se comprueba.
//
// ---------------------------------------------------------------------------------------------
// ⚠️ POR QUE LAS 19:00 CR — MEDIDO EL 2026-09-11 (ultimos 14 dias), NO ESTIMADO
// ---------------------------------------------------------------------------------------------
//
//   | franja (hora CR) | asignaciones |      |
//   | ---------------- | -----------: | ---- |
//   | 06:00-11:00      |    **3.183** | 89 % |
//   | 12:00-18:00      |          262 |  7 % |
//   | **19:00 en adelante** |   **148** | **~4 %** (unas 10 al dia) |
//
// **A LAS 19:00 YA ESTA ASIGNADO EL ~96 % DEL VOLUMEN DEL DIA.** Eso es lo que convierte esta hora
// de «parece razonable» en una decision con numero: a las 19:00 FALTA POR ASIGNAR EL 4 %, y ese
// 4 % son ~10 asignaciones repartidas entre 18 mensajeros.
//
// Y las tres razones de forma, que la medida confirma:
//   1. despues de la jornada de bodega y ANTES de la noche — R11 prohibe explicitamente la franja
//      22:00-06:00 CR, porque este aviso llega tambien al telefono (410);
//   2. cinco horas antes del corte diario (`0 6 * * *` = 00:00 CR), que no toca las ordenes
//      reservadas para un dia futuro (246): no hay interaccion, y emitir DESPUES del corte habria
//      dejado el aviso llegando de madrugada;
//   3. le deja la tarde entera al mensajero para organizarse, que es literalmente para lo que
//      sirve el aviso.
//
// SEGUNDA CORRIDA (21:00 CR) DESCARTADA, decision del humano del 2026-09-11, CON EL NUMERO
// DELANTE: compraria ~10 asignaciones tardias al dia entre 18 mensajeros y pagaria la regla que
// mas importa de la 409 —UNO AL DIA POR TIPO—. Se reconsidera SOLO si la franja de 19:00 en
// adelante deja de ser marginal: del orden del 15-20 % de las asignaciones del dia, o mas de una
// asignacion tardia por mensajero y noche. Se mide repitiendo la consulta de arriba.
//
// ---------------------------------------------------------------------------------------------
// LA CONVERSION, ESCRITA PARA QUE NADIE LA «CORRIJA»
// ---------------------------------------------------------------------------------------------
// `vercel.json` va en **UTC**. Costa Rica es **UTC-6 fijo, sin horario de verano**. Por tanto:
//
//     19:00 CR = 01:00 UTC DEL DIA SIGUIENTE  =>  "0 1 * * *"
//
// Escribir `0 19 * * *` pondria el aviso a LA 1:00 DE LA MADRUGADA CR, que es exactamente la hora
// a la que la 410 no debe empujar nada al telefono de nadie. Los crons vecinos usan `0 6 * * *`,
// que NO es «las seis»: es MEDIANOCHE CR.
//
// MODULO PURO: sin Prisma, sin React, sin `next/*`, sin reloj y sin DB.

export interface AvisoRepartoMananaConfig {
  /**
   * Hora de pared de Costa Rica a la que corre la emision, 0-23. Ver la medicion de arriba antes
   * de moverla: no es una preferencia, es un percentil.
   */
  readonly HORA_CR: number;
  /**
   * Ruta del cron. Vive aqui —y no como literal en la guardia— para que la entrada de
   * `vercel.json` y el route handler no puedan referirse a rutas distintas sin que nada se rompa.
   */
  readonly RUTA_CRON: string;
}

export const avisoRepartoMananaConfig: AvisoRepartoMananaConfig = {
  HORA_CR: 19,
  RUTA_CRON: "/api/cron/aviso-reparto-manana",
};

/** Costa Rica es UTC-6 fijo, sin horario de verano. Es la unica constante de la conversion. */
export const OFFSET_CR_HORAS = 6;

/**
 * R10 — la hora UTC que corresponde a una hora CR. `(hora + 6) mod 24`.
 *
 * Se declara como FUNCION y no como segundo numero a propósito: un numero tendria que mantenerse
 * a mano y podria divergir del primero, que es el fallo que esta ficha existe para no cometer.
 */
export function horaUtcDeHoraCR(horaCR: number): number {
  return (horaCR + OFFSET_CR_HORAS) % 24;
}

/**
 * R11 — la franja NOCTURNA prohibida, en hora de pared CR: de las 22:00 (incluida) a las 06:00
 * (excluida). Este aviso llega tambien al telefono, y esa franja es de noche.
 */
export const FRANJA_NOCTURNA_CR = { desde: 22, hasta: 6 } as const;

/** `true` si esa hora CR cae en la franja nocturna prohibida por R11. */
export function esHoraNocturnaCR(horaCR: number): boolean {
  return horaCR >= FRANJA_NOCTURNA_CR.desde || horaCR < FRANJA_NOCTURNA_CR.hasta;
}
