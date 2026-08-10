// Feature 180 (T1.1) — troceo de un rango en CUBOS TEMPORALES.
//
// Que hace: responde UNA sola pregunta —dado un `RangoResuelto`, ¿cuales son los cubos,
// con que clave y con que fronteras?— y decide la granularidad (`dia` o `semana`) segun
// el tamano del rango y el tope de puntos del servidor (`TOPE_PUNTOS_SERIE`, ⟨D2⟩).
//
// Por que existe: el borde admite rangos de hasta `RANGO_TOPE_DIAS` = 366 dias, y el
// paquete de graficas LANZA por encima de 62 puntos por serie. Q3 de la 180 decidio que
// la agregacion la hace el SERVIDOR, no el consumidor; el troceo es la mitad de esa
// decision que no sabe nada de lo que se agrega.
//
// Lo que este modulo NO hace, y no es un olvido:
//   - NO conoce dinero, tasas, importes ni metricas. No hay una sola referencia a la
//     analitica financiera aqui: recibe un rango y devuelve cubos.
//   - NO lee la base, NO agrega nada y NO decide que se suma dentro de cada cubo. Eso es
//     de los repositorios (⟨D4⟩: las fronteras viajan a SQL como PARAMETROS) y del
//     servicio (la clave publicable la pone el servicio a partir de `trocear(rango)`).
//   - NO recorta series ni aplica el tope de presentacion: para eso esta
//     `components/private/analytics/topes.ts`, que vive en la otra capa.
//
// R29 (modulo PURO): sin Prisma —ni siquiera como `import type`—, sin repositorios, sin
// servicios, sin `next/headers`, sin `@/lib/db`, sin variables de entorno y sin efectos
// al importarse. Lo vigila `tests/unit/analytics/modulo-puro.guardia.test.ts`.
//
// R11 (una sola definicion del dia CR): TODA frontera sale EXCLUSIVAMENTE de
// `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc` de `@/lib/utils/fecha-cr`. Aqui
// no hay offset horario propio, ni `AT TIME ZONE`, ni una constante de seis horas, ni
// siquiera la duracion de un dia escrita a mano: se DERIVA de los propios helpers, igual
// que `lib/analytics/ranges.ts` hace con `FECHA_ANCLA`. Es lo que impide reintroducir por
// la puerta de atras el off-by-one de seis horas del que avisa `ranges.ts`.
//
// ---------------------------------------------------------------------------
// INTERACCION DECLARADA CON LA FEATURE 176 (⟨D8⟩ del design de la 180)
// ---------------------------------------------------------------------------
// Este contrato se disena COMPARTIDO con la feature 176 (modo agregado de tasas y tiempos
// en la analitica operativa). Lo que las dos features comparten no es la carga util —la
// 176 necesita numerador/denominador por cubo y la 180 necesita importes— sino la
// pregunta previa. Por eso el modulo no conoce ninguna de las dos.
// Si la 176 acaba necesitando otra forma de cubo, la contradiccion aparece **en ESTE
// archivo** y no como dos contratos incompatibles descubiertos en la pantalla.

import {
  fechaCalendarioCR,
  inicioDelDiaCREnUtc,
  inicioDelDiaSiguienteCREnUtc,
} from "@/lib/utils/fecha-cr";
import { TOPE_PUNTOS_SERIE, type RangoResuelto } from "@/lib/analytics/types";

/** ⟨D2⟩ — las dos granularidades que el servidor sabe producir. Dominio cerrado. */
export type GranularidadTemporal = "dia" | "semana";

/** Un cubo del troceo: su clave publicable y su ventana SEMIABIERTA `[desde, hasta)`. */
export interface CuboTemporal {
  /** Clave publicable: fecha calendario CR del PRIMER dia incluido (`YYYY-MM-DD`). */
  readonly clave: string;
  /** Instante UTC inclusivo de inicio (de `inicioDelDiaCREnUtc`). */
  readonly desde: Date;
  /** Instante UTC exclusivo de fin (de `inicioDelDiaSiguienteCREnUtc`). */
  readonly hasta: Date;
}

/**
 * Duracion de un dia, DERIVADA de los propios helpers en vez de escrita a mano (R11):
 * `inicioDelDiaSiguienteCREnUtc(f) - inicioDelDiaCREnUtc(f)` es, por definicion, un dia.
 * Misma tecnica y misma razon que `ranges.ts`: si algun dia Costa Rica adoptase horario
 * de verano, solo habria que tocar `lib/utils/fecha-cr.ts`.
 */
const FECHA_ANCLA = "2000-01-01";
const UN_DIA_MS =
  inicioDelDiaSiguienteCREnUtc(FECHA_ANCLA).getTime() - inicioDelDiaCREnUtc(FECHA_ANCLA).getTime();

/**
 * Fecha calendario CR `dias` dias DESPUES de `fecha`, sin aritmetica de calendario propia:
 * se ancla la fecha a su instante real de las 00:00 CR, se avanza y se vuelve a leer la
 * fecha calendario CR. Cruza fin de mes y fin de anio sola. Es la version hacia delante de
 * `restarDiasCalendarioCR` de `ranges.ts`.
 */
function sumarDiasCalendarioCR(fecha: string, dias: number): string {
  return fechaCalendarioCR(new Date(inicioDelDiaCREnUtc(fecha).getTime() + dias * UN_DIA_MS));
}

/**
 * Dias calendario CR INCLUSIVOS del rango (`desdeFecha`..`hastaFecha`): un rango de un
 * solo dia mide 1. Se cuenta sobre los instantes de las 00:00 CR de ambas fechas, no
 * sobre `hasta - desde`, para que la respuesta sea de calendario y no de duracion.
 */
function diasCalendarioInclusivos(rango: RangoResuelto): number {
  const primerDia = inicioDelDiaCREnUtc(rango.desdeFecha).getTime();
  const ultimoDia = inicioDelDiaCREnUtc(rango.hastaFecha).getTime();
  return Math.round((ultimoDia - primerDia) / UN_DIA_MS) + 1;
}

/**
 * Dias a avanzar desde `fecha` hasta el comienzo del cubo SIGUIENTE.
 *
 * - `dia`: siempre 1.
 * - `semana` (⟨D6⟩ / R21): hasta el proximo LUNES de Costa Rica, ESTRICTAMENTE posterior
 *   (si `fecha` ya es lunes, avanza una semana entera). El dia de la semana se lee con
 *   `getUTCDay()` sobre el instante `...T06:00:00.000Z`, que cae en la MISMA fecha en UTC:
 *   asi el resultado no depende del huso del proceso. Misma convencion que
 *   `lunesDeLaSemanaCR` de `ranges.ts`. `getUTCDay()`: 0 = domingo ... 6 = sabado.
 */
function saltoAlCuboSiguiente(fecha: string, granularidad: GranularidadTemporal): number {
  if (granularidad === "dia") return 1;
  const diaDeLaSemana = inicioDelDiaCREnUtc(fecha).getUTCDay();
  const hastaElLunes = (1 - diaDeLaSemana + 7) % 7;
  return hastaElLunes === 0 ? 7 : hastaElLunes;
}

/**
 * R18 — la granularidad que corresponde al rango: `dia` mientras quepa dentro del tope de
 * puntos del servidor, `semana` en cuanto lo supere.
 *
 * El numero NO se escribe aqui: viene de `TOPE_PUNTOS_SERIE` (`lib/analytics/types.ts`),
 * que a su vez esta atado por test a `MAX_PUNTOS_SERIE` del paquete de graficas (R20).
 *
 * Es funcion PURA del rango: no mira el reloj, no recibe `now` y no puede recibirlo.
 */
export function granularidadDe(rango: RangoResuelto): GranularidadTemporal {
  return diasCalendarioInclusivos(rango) <= TOPE_PUNTOS_SERIE ? "dia" : "semana";
}

/**
 * Trocea el rango en cubos contiguos, en orden cronologico ascendente y sin claves
 * repetidas (R6 aguas abajo depende de las dos cosas).
 *
 * Invariantes que los tests fijan y de los que depende la conservacion (R12):
 *   - `trocear(r)[0].desde` es `r.desde` y `trocear(r).at(-1).hasta` es `r.hasta`;
 *   - `cubo[i].hasta === cubo[i + 1].desde` (contiguos, sin solape y sin hueco);
 *   - `clave` es `fechaCalendarioCR(desde)`, derivada del PROPIO instante frontera y no
 *     de una variable paralela, de modo que la clave no pueda divergir de la ventana que
 *     dice describir (R10).
 *
 * Con granularidad `semana` (⟨D6⟩ / R21) los cubos se anclan al LUNES de Costa Rica, PERO
 * el primero empieza en `rango.desde` aunque no sea lunes y su clave es ESE dia: si su
 * clave fuera el lunes anterior, la fila afirmaria contener dinero de dias que el rango
 * excluye. Por la misma razon el ultimo cubo se trunca en `rango.hasta`.
 */
export function trocear(rango: RangoResuelto): readonly CuboTemporal[] {
  const granularidad = granularidadDe(rango);
  const cubos: CuboTemporal[] = [];

  let fecha = rango.desdeFecha;
  while (inicioDelDiaCREnUtc(fecha).getTime() < rango.hasta.getTime()) {
    const desde = inicioDelDiaCREnUtc(fecha);
    const fechaSiguiente = sumarDiasCalendarioCR(fecha, saltoAlCuboSiguiente(fecha, granularidad));
    const finNatural = inicioDelDiaCREnUtc(fechaSiguiente);
    // Truncado al rango: el ultimo cubo nunca desborda `rango.hasta`, que ya es una
    // frontera de dia CR (`inicioDelDiaSiguienteCREnUtc(hastaFecha)`).
    const hasta =
      finNatural.getTime() < rango.hasta.getTime() ? finNatural : new Date(rango.hasta.getTime());

    cubos.push({ clave: fechaCalendarioCR(desde), desde, hasta });
    fecha = fechaSiguiente;
  }

  return cubos;
}
