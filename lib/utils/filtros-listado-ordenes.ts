import {
  inicioDeUltimosNDiasCREnUtc,
  inicioDelDiaCREnUtc,
  inicioDelDiaSiguienteCREnUtc,
} from "@/lib/utils/fecha-cr";
import {
  normalizarTerminoBusqueda,
  soloDigitosSiPareceNumero,
} from "@/lib/utils/busqueda-orden";
import type { CreatedPreset } from "@/lib/types/orden";

/**
 * Pedido humano (2026-08-19) — las DOS traducciones que comparten las superficies que montan
 * la barra de filtros de ordenes: `/ordenes` (maestro, admin, adminTienda) y el listado
 * «Ordenes de la bodega» del adminSatelite.
 *
 * Por que aqui y no copiadas en cada servicio: las dos convierten una entrada PUBLICA (un
 * atajo de antiguedad, un termino tecleado) en algo que toca la base, y las dos tienen una
 * regla que no se ve en el resultado — el huso de Costa Rica en una, la paridad con la
 * expresion de la columna generada en la otra—. Dos copias divergen sin que nada falle: la
 * bodega satelite empezaria a cortar el dia a medianoche UTC, o a «no encontrar» lo que
 * `/ordenes` encuentra. Modulo PURO: sin Prisma, sin React, sin acceso a datos.
 */

/** Dias de cada atajo de antiguedad (R41). El dominio lo cierra `CREATED_PRESETS`. */
const PRESET_DIAS: Record<CreatedPreset, number> = {
  "7d": 7,
  "15d": 15,
  "30d": 30,
  "90d": 90,
};

/** Las tres claves temporales de la barra, tal como llegan del borde. */
export interface FiltroCreacionInput {
  created_preset?: CreatedPreset;
  created_desde?: string;
  created_hasta?: string;
}

/**
 * Feature 144 (R41/R42/R43) — bordes temporales del filtro de creacion, calculados
 * SERVER-SIDE en horario de Costa Rica (UTC-6 fijo). Nunca se aceptan instantes del reloj del
 * cliente: solo fechas calendario o un atajo de dominio cerrado.
 *
 *   - atajo "Nd"  -> `gte` = 00:00 CR de hace N-1 dias (N dias calendario incl. hoy).
 *   - `desde: D`  -> `gte` = 00:00 CR de D.
 *   - `hasta: H`  -> `lt`  = 00:00 CR del dia SIGUIENTE a H  => H es INCLUSIVO.
 *   - un solo extremo -> rango abierto por el otro lado.
 *
 * Atajo y rango no pueden coexistir: el borde lo rechaza antes (R40, `conRefinesDeCreacion`).
 * Devuelve `undefined` si no hay ninguna clave temporal (sin filtro, R45).
 */
export function rangoCreacion(
  filtro: FiltroCreacionInput | undefined,
  ahora: Date,
): { gte?: Date; lt?: Date } | undefined {
  if (!filtro) return undefined;
  if (filtro.created_preset) {
    return { gte: inicioDeUltimosNDiasCREnUtc(PRESET_DIAS[filtro.created_preset], ahora) };
  }
  const rango: { gte?: Date; lt?: Date } = {};
  if (filtro.created_desde) rango.gte = inicioDelDiaCREnUtc(filtro.created_desde);
  if (filtro.created_hasta) rango.lt = inicioDelDiaSiguienteCREnUtc(filtro.created_hasta);
  return rango.gte || rango.lt ? rango : undefined;
}

/** El termino tecleado, en la UNA o las DOS formas que se comparan con la columna generada. */
export interface TerminoBusqueda {
  /** El termino normalizado (espejo TypeScript de `orden.busqueda_texto`). */
  busqueda: string;
  /** Su forma SOLO-DIGITOS, solo cuando DIFIERE de la anterior («8888-0000» -> «88880000»). */
  busquedaDigitos?: string;
}

/**
 * Feature 169 (design §4.2) — el termino en sus formas comparables, SIN la ruta rapida por
 * `num_guia`.
 *
 * Las dos formas y por que (M1 del review de la 169): la columna indexa el telefono tal cual y
 * en su forma solo-digitos, pero la REMISION va tal cual. Buscando solo los digitos,
 * `2026-0912` no encontraria `REM-2026-0912`; buscando solo el texto tecleado, `8888-0000` no
 * encontraria un telefono guardado como `88880000`. Se emiten las dos y el repositorio las une
 * con un `OR` sobre la MISMA columna: el resultado es un SUPERCONJUNTO, nunca menos filas.
 *
 * La segunda forma aparece solo cuando difiere de la primera, de modo que un termino ya limpio
 * produce una sola condicion.
 *
 * La ruta rapida por `num_guia` NO esta aqui a proposito: es una decision de PLAN de consulta
 * de `/ordenes` (igualdad contra el indice unico, con su fallback si no casa nada), no parte
 * del criterio. La columna generada ya incluye la guia, asi que quien no la use encuentra lo
 * mismo — por otro camino.
 */
export function terminoDeBusqueda(termino: string): TerminoBusqueda {
  const digitos = soloDigitosSiPareceNumero(termino);
  const busqueda = normalizarTerminoBusqueda(termino);
  return digitos !== null && digitos !== busqueda
    ? { busqueda, busquedaDigitos: digitos }
    : { busqueda };
}
