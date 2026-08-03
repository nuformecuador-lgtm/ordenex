// Feature 131 (T1.1) — el filtro del tablero, en los tres formatos en los que vive.
//
// Modulo PURO (sin React, sin DOM): traduce en los dos sentidos
// `URLSearchParams <-> FiltroTablero <-> raw`. Aqui viven R11, R13 y R14, y por eso son
// verificables sin renderizar nada.
//
// El estado compartido va a la URL (design §4.2): los dos slots del shell —`filtros` y
// `operativo`— son HERMANOS y no hay envoltorio comun donde colgar un provider sin
// editar `AnaliticaShell.tsx`, que es de la 132. Ademas el filtro queda compartible y
// recuperable al recargar, con lo que R13 se vuelve comprobable: mismo URL, mismo filtro.
//
// R11 — lo que se emite es EXACTAMENTE lo que valida `analiticaFiltroSchema`
// (`lib/analytics/filters.ts`), que es `.strict()`: una clave de mas no es un silencio,
// es un `validation_error`. Aqui NO se declara un esquema propio (eso es de la 135) ni se
// anade rol, sesion ni `usuario_id`: un filtro no es un canal de alcance.

import { RANGO_PRESETS, type RangoPreset } from "@/lib/analytics/types";

/* -------------------------------------------------------------------------- */
/* La forma de UI                                                              */
/* -------------------------------------------------------------------------- */

export interface FiltroTablero {
  readonly rango: RangoPreset;
  /** Solo con `personalizado` (R14). Cadena vacia = el usuario no lo ha fijado. */
  readonly desde: string;
  readonly hasta: string;
  readonly zonaIds: readonly string[];
  readonly tiendaIds: readonly string[];
  readonly mensajeroIds: readonly string[];
}

/**
 * R13 — estado inicial DECLARADO (design §5.1). `semana` es borde de calendario
 * (lunes -> hoy), asi que produce entre 1 y 7 puntos —muy por debajo del techo de 62— y
 * no obliga a agregar nada en el arranque; e incluye el dia en curso, con lo que el
 * marcador `parcial` es visible desde el primer render y no es una rama que solo se
 * ejercite en tests.
 *
 * Es el punto de mutacion de R13: cambiar este preset debe poner rojo su test.
 */
export const FILTRO_INICIAL: FiltroTablero = {
  rango: "semana",
  desde: "",
  hasta: "",
  zonaIds: [],
  tiendaIds: [],
  mensajeroIds: [],
};

/* -------------------------------------------------------------------------- */
/* R11 / R14 — el `raw` que viaja a la Server Action                           */
/* -------------------------------------------------------------------------- */

/**
 * Lo que se le pasa a `consultarAnaliticaOperativa` como `raw`.
 *
 * Se declara con claves opcionales y NADA mas: el tipo mismo hace que anadir `rol` o
 * `usuario_id` no compile. Las listas VACIAS omiten su clave —el esquema exige lista no
 * vacia (`filters.ts:27`) y mandar `[]` seria un `validation_error` provocado por
 * nosotros—; y `desde`/`hasta` solo viajan con `personalizado`, y con `personalizado`
 * viajan siempre (R14).
 */
export interface RawFiltroAnalitica {
  rango: RangoPreset;
  desde?: string;
  hasta?: string;
  zona_id?: string[];
  tienda_id?: string[];
  mensajero_id?: string[];
}

function listaOOmitida(ids: readonly string[]): string[] | undefined {
  const limpias = ids.filter((id) => id !== "");
  return limpias.length > 0 ? limpias : undefined;
}

export function aRaw(filtro: FiltroTablero): RawFiltroAnalitica {
  const raw: RawFiltroAnalitica = { rango: filtro.rango };

  // R14 — el `si y solo si`. Las dos direcciones importan: con un preset, `desde`/`hasta`
  // estan PROHIBIDOS por el esquema (`filters.ts`, refine 2), no son un extra inocuo.
  if (filtro.rango === "personalizado") {
    raw.desde = filtro.desde;
    raw.hasta = filtro.hasta;
  }

  const zona = listaOOmitida(filtro.zonaIds);
  if (zona) raw.zona_id = zona;
  const tienda = listaOOmitida(filtro.tiendaIds);
  if (tienda) raw.tienda_id = tienda;
  const mensajero = listaOOmitida(filtro.mensajeroIds);
  if (mensajero) raw.mensajero_id = mensajero;

  return raw;
}

/* -------------------------------------------------------------------------- */
/* URL <-> filtro                                                              */
/* -------------------------------------------------------------------------- */

export const PARAM_RANGO = "rango";
export const PARAM_DESDE = "desde";
export const PARAM_HASTA = "hasta";
export const PARAM_ZONA = "zona";
export const PARAM_TIENDA = "tienda";
export const PARAM_MENSAJERO = "mensajero";

/** Lo minimo de `URLSearchParams` que se necesita (tambien lo cumple el de `next/navigation`). */
export interface LectorParams {
  get(name: string): string | null;
}

function esPreset(valor: string | null): valor is RangoPreset {
  return valor !== null && (RANGO_PRESETS as readonly string[]).includes(valor);
}

function listaDesde(valor: string | null): string[] {
  if (!valor) return [];
  return valor
    .split(",")
    .map((parte) => parte.trim())
    .filter((parte) => parte !== "");
}

/**
 * R13 — sin nada en la URL, el filtro es EXACTAMENTE `FILTRO_INICIAL`. Un valor de rango
 * fuera del dominio cerrado tampoco se cuela: cae al inicial en vez de viajar al borde y
 * volver como `validation_error` por culpa de un enlace mal copiado.
 */
export function desdeSearchParams(params: LectorParams): FiltroTablero {
  const rangoCrudo = params.get(PARAM_RANGO);
  const rango = esPreset(rangoCrudo) ? rangoCrudo : FILTRO_INICIAL.rango;
  return {
    rango,
    desde: rango === "personalizado" ? (params.get(PARAM_DESDE) ?? "") : "",
    hasta: rango === "personalizado" ? (params.get(PARAM_HASTA) ?? "") : "",
    zonaIds: listaDesde(params.get(PARAM_ZONA)),
    tiendaIds: listaDesde(params.get(PARAM_TIENDA)),
    mensajeroIds: listaDesde(params.get(PARAM_MENSAJERO)),
  };
}

/**
 * Filtro -> query string. Solo escribe lo que se aparta del inicial, para que la URL por
 * defecto siga siendo `/analitica` a secas y un enlace compartido diga solo lo que el
 * usuario eligio.
 */
export function aSearchParams(filtro: FiltroTablero): URLSearchParams {
  const params = new URLSearchParams();
  if (filtro.rango !== FILTRO_INICIAL.rango) params.set(PARAM_RANGO, filtro.rango);
  if (filtro.rango === "personalizado") {
    if (filtro.desde !== "") params.set(PARAM_DESDE, filtro.desde);
    if (filtro.hasta !== "") params.set(PARAM_HASTA, filtro.hasta);
  }
  if (filtro.zonaIds.length > 0) params.set(PARAM_ZONA, filtro.zonaIds.join(","));
  if (filtro.tiendaIds.length > 0) params.set(PARAM_TIENDA, filtro.tiendaIds.join(","));
  if (filtro.mensajeroIds.length > 0) params.set(PARAM_MENSAJERO, filtro.mensajeroIds.join(","));
  return params;
}

/**
 * R12 — clave estable del filtro para SWR. Cambiar cualquier filtro cambia esta cadena,
 * y con ella la clave de todos los paneles: no hay forma de que el resultado del filtro
 * anterior se quede en pantalla como si correspondiera al nuevo.
 */
export function serializarFiltro(filtro: FiltroTablero): string {
  return JSON.stringify(aRaw(filtro));
}
