import type { BloqueoDetalle } from "@/lib/utils/bloqueo-cierre";
import { estaBloqueadoPorCierres } from "@/lib/utils/bloqueo-cierre";

/**
 * FEATURE 271 — fabrica de `BloqueoDetalle` para los dobles de test.
 *
 * ⚠️ QUE MIDE UN DOBLE COMO ESTE Y QUE NO. Este objeto dice «bloqueado» porque se lo hemos dicho:
 * NO prueba la regla N/V ni el `WHERE` que la deriva. Sirve para los tests de GUARDA —«el servicio
 * corta antes de cualquier efecto»—, que es otra pregunta.
 *
 * La regla en si se prueba en `tests/unit/utils/bloqueo-cierre.test.ts` (las 7 filas de la tabla de
 * verdad) y el `WHERE` que la alimenta contra Postgres real en
 * `tests/integration/db/cierre-bloqueo-nv-sql-real.test.ts`, con contraprueba por mutacion. Este
 * repo ya midio cuatro veces que una mutacion de un `WHERE` sobrevive en verde por arriba.
 *
 * `bloqueado` NO se pasa a mano: lo calcula `estaBloqueadoPorCierres` a partir de N y V, para que un
 * doble no pueda afirmar un estado que la regla no produce.
 */
export function bloqueoDe(opciones: {
  /** N — cierres abiertos. */
  n: number;
  /** V — cuantos de esos son re-solicitables. */
  v: number;
  /** Jornada del mas viejo (`YYYY-MM-DD`), o `null` si no es fiable (R60). */
  jornadaCR?: string | null;
  cierreId?: string;
}): BloqueoDetalle {
  const { n, v, jornadaCR = null, cierreId = "c-viejo" } = opciones;
  const bloqueado = estaBloqueadoPorCierres({ n, v });
  if (n === 0) {
    return { bloqueado, cierresAbiertos: 0, cierresPorReenviar: 0, aResolverPrimero: null };
  }
  // El mas viejo es re-solicitable solo si TODOS los abiertos lo son; con la mezcla habitual
  // (`solicitado` viejo + `vencido` nuevo) el que toca primero lo resuelve la administracion.
  const estado = v >= n ? ("vencido" as const) : ("solicitado" as const);
  return {
    bloqueado,
    cierresAbiertos: n,
    cierresPorReenviar: v,
    aResolverPrimero: {
      cierreId,
      estado,
      solicitadoAt: "2026-08-21T18:00:00.000Z",
      jornadaCR,
      resuelve: estado === "vencido" ? "mensajero" : "administracion",
    },
  };
}

/** El caso 5 de la tabla de verdad: un solo cierre y esta `vencido` (N=1, V=1). */
export function bloqueoConVencido(jornadaCR: string | null = null): BloqueoDetalle {
  return bloqueoDe({ n: 1, v: 1, jornadaCR });
}

/** El caso 4: dos cierres `solicitado`, bloqueado por ACUMULAR (N=2, V=0). */
export function bloqueoPorAcumular(jornadaCR: string | null = null): BloqueoDetalle {
  return bloqueoDe({ n: 2, v: 0, jornadaCR });
}
