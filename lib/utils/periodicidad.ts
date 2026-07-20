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
