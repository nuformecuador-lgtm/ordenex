import { z } from "zod";

import {
  esFechaCalendarioValida,
  inicioDelDiaCREnUtc,
  inicioDelDiaSiguienteCREnUtc,
} from "@/lib/utils/fecha-cr";

/**
 * FICHA 461 (R72, auditoria de la wallet T1) — el RANGO DE DIAS de Costa Rica con el que se
 * filtran los tres libros de dinero (caja, tiendas y mensajeros) y sus descargas.
 *
 * LO QUE ESTO ARREGLA, medido por la auditoria del 2026-09-25: los tres schemas hacian
 * `z.coerce.date()` sobre el `YYYY-MM-DD` del `<input type="date">`, que produce la MEDIANOCHE
 * UTC (18:00 del dia anterior en Costa Rica), y los repositorios comparaban `>= desde` y
 * `<= hasta`. Filtrar «hoy» devolvia 2 de 7 movimientos y filtrar «ayer» ninguno de 16: un rango
 * `desde–hasta` metia las 18:00–24:00 CR del dia anterior a `desde` y excluia casi todo `hasta`.
 *
 * LA REGLA, la misma que ya usa la analitica (`lib/analytics/ranges.ts`) y el listado de ordenes
 * (feature 144): `desde` es el INICIO de ese dia en Costa Rica (`${fecha}T06:00:00.000Z`) y
 * `hasta` es el inicio del dia CR SIGUIENTE, cota EXCLUSIVA (`<` en el repositorio). Asi
 * `hasta = 2026-09-25` cubre el 25 entero, hasta `2026-09-26T05:59:59.999Z`, y ni un instante mas.
 *
 * Los dos schemas TRANSFORMAN: la entrada es la cadena del formulario y la salida es el `Date`
 * que el repositorio compara. El tipo de salida no cambia respecto de `z.coerce.date()`, asi que
 * servicios y repositorios siguen recibiendo `Date | undefined`; lo que cambia es QUE instante.
 *
 * La fecha se valida ENTERA (`esFechaCalendarioValida`): `2026-02-31` no rueda al 3 de marzo, muere
 * en el borde con `validation_error`. Ningun helper nuevo de fechas: los tres son los de
 * `lib/utils/fecha-cr.ts`.
 */
const FORMATO_DIA = /^\d{4}-\d{2}-\d{2}$/;

export const diaCalendarioSchema = z
  .string()
  .regex(FORMATO_DIA, "La fecha debe tener el formato YYYY-MM-DD.")
  .refine((v) => !FORMATO_DIA.test(v) || esFechaCalendarioValida(v), "Esa fecha no existe en el calendario.");

/** `desde` de un filtro por dias CR: el instante en que EMPIEZA ese dia en Costa Rica. */
export const desdeDiaCRSchema = diaCalendarioSchema.transform(inicioDelDiaCREnUtc);

/** `hasta` de un filtro por dias CR: el instante en que EMPIEZA el dia siguiente (cota exclusiva). */
export const hastaDiaCRSchema = diaCalendarioSchema.transform(inicioDelDiaSiguienteCREnUtc);
