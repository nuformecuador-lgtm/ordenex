import { startOfDayCR } from "@/lib/utils/fecha-cr";

// Feature 84 — logica PURA de la periodicidad de las plantillas de gasto fijo. Sin Prisma, sin
// HTTP y sin `Date.now()` interno: `now` SIEMPRE se recibe (testeable con reloj inyectable).
//
// Modelo: unidad + cantidad + fecha de cobro.
//   - `fechaCobro` es la fecha del PRIMER cobro y el ANCLA del ciclo: los cobros siguientes caen
//     cada `cantidad` x `unidad` a partir de ella. Antes del ancla NO se cobra nunca.
//   - Equivalencias del pedido: diaria = 1 dias; semanal = 1 semanas; quincenal = 2 semanas;
//     mensual = 1 meses. Admite cualquier otra (cada 3 dias, cada 6 meses).
//
// Toda la aritmetica es UTC sobre fechas YA normalizadas a medianoche UTC del dia calendario de
// Costa Rica (`startOfDayCR`, UTC-6 fijo). Nunca se suman "30 dias" para representar un mes.

/** Unidades de periodicidad (espejo del enum `PeriodicidadUnidad` de Prisma). */
export type PeriodicidadUnidad = "dias" | "semanas" | "meses";

/** Lo minimo que la logica pura necesita de una plantilla (subset del DTO). */
export interface PlantillaPeriodica {
  periodicidadUnidad: PeriodicidadUnidad;
  periodicidadCantidad: number;
  /** Fecha calendario CR del PRIMER cobro, `YYYY-MM-DD` (columna `@db.Date`). */
  fechaCobro: string;
}

const UN_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * `YYYY-MM-DD` -> medianoche UTC de ese dia. Misma convencion que `startOfDayCR`, asi que ambos
 * lados de las comparaciones viven en la misma escala (sin off-by-one por el desfase de -6h).
 */
function fechaADiaUTC(fecha: string): Date {
  return new Date(`${fecha}T00:00:00.000Z`);
}

/** Diferencia en dias enteros entre dos fechas a medianoche UTC (exacta: no hay DST en UTC). */
function diffEnDias(hoy: Date, ancla: Date): number {
  return Math.round((hoy.getTime() - ancla.getTime()) / UN_DIA_MS);
}

/** Diferencia en meses calendario (ignora el dia): 31/ene -> 1/mar = 2. */
function diffEnMeses(hoy: Date, ancla: Date): number {
  return (
    (hoy.getUTCFullYear() - ancla.getUTCFullYear()) * 12 + (hoy.getUTCMonth() - ancla.getUTCMonth())
  );
}

/** Ultimo dia del mes de `dia` (28/29/30/31). `Date.UTC(y, m+1, 0)` = ultimo dia del mes m. */
function ultimoDiaDelMes(dia: Date): number {
  return new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * ¿La plantilla dispara HOY (dia calendario CR de `now`)?
 *
 * - `hoy < ancla` -> false (nunca antes del primer cobro).
 * - `dias`:    diffEnDias(hoy, ancla) % cantidad === 0
 * - `semanas`: diffEnDias(hoy, ancla) % (7 * cantidad) === 0
 * - `meses`:   diffEnMeses(hoy, ancla) % cantidad === 0 Y hoy.dia === diaEfectivo, con
 *   `diaEfectivo = min(ancla.dia, ultimoDiaDelMes(hoy))`. El CLAMPING de fin de mes es
 *   obligatorio: un ancla dia 31 cobra el 28 en febrero (29 en bisiesto) y el 30 en abril, NO se
 *   saltea el mes. Idem ancla 29/30.
 *
 * El dia exacto del ancla siempre dispara (diff 0 % n === 0).
 */
export function aplicaHoy(plantilla: PlantillaPeriodica, now: Date): boolean {
  const hoy = startOfDayCR(now);
  const ancla = fechaADiaUTC(plantilla.fechaCobro);
  if (hoy.getTime() < ancla.getTime()) return false;

  const cantidad = plantilla.periodicidadCantidad;
  if (!Number.isInteger(cantidad) || cantidad < 1) return false; // defensa: CHECK >= 1 en la DB

  switch (plantilla.periodicidadUnidad) {
    case "dias":
      return diffEnDias(hoy, ancla) % cantidad === 0;
    case "semanas":
      return diffEnDias(hoy, ancla) % (7 * cantidad) === 0;
    case "meses": {
      if (diffEnMeses(hoy, ancla) % cantidad !== 0) return false;
      const diaEfectivo = Math.min(ancla.getUTCDate(), ultimoDiaDelMes(hoy));
      return hoy.getUTCDate() === diaEfectivo;
    }
  }
}

/**
 * Clave de PERIODO de la corrida — parte derecha de la clave de idempotencia
 * `origen_id = "<plantillaId>:<periodo>"`, que cae bajo el indice unico parcial
 * (origen_tipo, origen_id, categoria).
 *
 * TRAMPA PRINCIPAL DE LA FEATURE — NO cambiar el formato de las MENSUALES.
 * `meses` -> `YYYY-MM` (el MISMO formato que usaba el cron mensual pre-84). Esto NO es opcional:
 * si a las mensuales se les cambiara la clave (p.ej. a `YYYY-MM-DD`), en el mes del deploy la
 * clave vieja (`:2026-07`) y la nueva (`:2026-07-01`) NO colisionarian en el indice unico, el
 * `skipDuplicates` no filtraria nada y se COBRARIA DOS VECES. Mantener `YYYY-MM` preserva la
 * idempotencia a traves del deploy. Sigue siendo unica porque una plantilla `meses` dispara como
 * maximo una vez por mes (`aplicaHoy` exige el dia efectivo exacto).
 *
 * `dias`/`semanas` -> `YYYY-MM-DD` (fecha CR del disparo). Unica porque disparan como maximo una
 * vez por dia. No hay colision con el formato mensual: son plantillas distintas (id distinto) y
 * ademas los formatos difieren en longitud.
 */
export function periodoDe(plantilla: PlantillaPeriodica, now: Date): string {
  const hoy = startOfDayCR(now);
  const anio = hoy.getUTCFullYear();
  const mes = String(hoy.getUTCMonth() + 1).padStart(2, "0");
  if (plantilla.periodicidadUnidad === "meses") return `${anio}-${mes}`;
  const dia = String(hoy.getUTCDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}

/** Fecha a medianoche UTC -> `YYYY-MM-DD`. Misma construccion manual que `periodoDe`. */
function aFechaCalendario(dia: Date): string {
  const anio = dia.getUTCFullYear();
  const mes = String(dia.getUTCMonth() + 1).padStart(2, "0");
  const numero = String(dia.getUTCDate()).padStart(2, "0");
  return `${anio}-${mes}-${numero}`;
}

/**
 * El cobro que cae `mesesDesplazados` meses despues del ancla, con el MISMO clamping de fin de
 * mes que `aplicaHoy`: dia = min(dia del ancla, ultimo dia del mes destino). Ancla 31 -> 28/feb
 * (29 en bisiesto), 30/abr. `Date.UTC` normaliza el desbordamiento de mes (13 -> enero del ano
 * siguiente), asi que no hace falta aritmetica de anos aparte.
 */
function cobroDelMes(ancla: Date, mesesDesplazados: number): Date {
  const primeroDelMesDestino = new Date(
    Date.UTC(ancla.getUTCFullYear(), ancla.getUTCMonth() + mesesDesplazados, 1),
  );
  const dia = Math.min(ancla.getUTCDate(), ultimoDiaDelMes(primeroDelMesDestino));
  return new Date(
    Date.UTC(primeroDelMesDestino.getUTCFullYear(), primeroDelMesDestino.getUTCMonth(), dia),
  );
}

/**
 * Feature 85 (R7-R12) — fecha calendario CR (`YYYY-MM-DD`) del PROXIMO cobro: la PRIMERA fecha,
 * igual o posterior al dia calendario CR de `now`, en la que esta plantilla cobra.
 *
 * Es la hermana en cerrado de `aplicaHoy` —misma regla, sin barrer dias— y por eso su test la
 * contrasta contra ella (barrido diferencial de 400 dias): dos implementaciones independientes de
 * la misma regla son un oraculo de verdad, y una asercion contra la propia fuente no lo es.
 *
 *  - `hoy <= ancla` -> el ancla (R8: antes del primer cobro no se cobra; el dia del ancla SI, R9).
 *  - `dias`/`semanas`: paso fijo en dias; `k = ceil(diff / paso)`, resultado `ancla + k * paso`.
 *    Con `hoy` justo sobre un disparo, `diff % paso === 0` y `k` no avanza -> devuelve HOY (R9).
 *  - `meses`: `k = ceil(diffEnMeses / cantidad)` y el candidato es el cobro de ese mes ya
 *    clampeado (R10). Si cae ANTES que hoy (ancla dia 5, hoy dia 20 del mismo mes) se reintenta
 *    con `k + 1`, y UN reintento basta: `k * cantidad >= diffEnMeses` garantiza que el candidato
 *    nunca queda en un mes anterior al de hoy, asi que el siguiente ya cae en un mes posterior.
 *
 * Reloj INYECTADO como sus dos hermanas: sin `Date.now()`, sin Prisma, sin HTTP, y toda la
 * aritmetica en la escala "medianoche UTC del dia calendario CR" (R12). NO sabe si la plantilla
 * esta activa: eso es presentacion (R19), no aritmetica del ciclo.
 */
export function proximoCobro(plantilla: PlantillaPeriodica, now: Date): string {
  const hoy = startOfDayCR(now);
  const ancla = fechaADiaUTC(plantilla.fechaCobro);
  if (hoy.getTime() <= ancla.getTime()) return aFechaCalendario(ancla);

  const cantidad = plantilla.periodicidadCantidad;
  // Defensa (CHECK >= 1 en la DB): con cantidad 0 el paso seria 0 y la division daria Infinity,
  // o sea un `Invalid Date` emitido como fecha. Para esa plantilla `aplicaHoy` es false SIEMPRE,
  // asi que no existe "proximo cobro" que devolver: se falla fuerte y con contexto.
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    throw new RangeError(
      `proximoCobro: periodicidadCantidad invalida (${String(cantidad)}); debe ser un entero >= 1`,
    );
  }

  if (plantilla.periodicidadUnidad === "meses") {
    const k = Math.ceil(diffEnMeses(hoy, ancla) / cantidad);
    const candidato = cobroDelMes(ancla, k * cantidad);
    if (candidato.getTime() >= hoy.getTime()) return aFechaCalendario(candidato);
    return aFechaCalendario(cobroDelMes(ancla, (k + 1) * cantidad));
  }

  const paso = plantilla.periodicidadUnidad === "dias" ? cantidad : 7 * cantidad;
  const k = Math.ceil(diffEnDias(hoy, ancla) / paso);
  return aFechaCalendario(new Date(ancla.getTime() + k * paso * UN_DIA_MS));
}
