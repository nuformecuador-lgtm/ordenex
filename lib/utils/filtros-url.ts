// Feature 335 (T1.1) — el CODEC de filtros que viven en la query string.
//
// Modulo PURO: sin React, sin DOM, sin router. Traduce en UNA sola direccion
// —`URLSearchParams -> { termino, seleccion, activos }`— contra el catalogo declarado por
// el consumidor, y ademas RESTA (`queryTrasLimpiar`). Aqui viven R4 y R8-R16, y por eso
// son verificables sin renderizar nada.
//
// Se modela sobre el precedente ya escrito del repo
// (`app/(app)/analitica/_components/operativo/filtro-tablero.ts`), del que se copian dos
// cosas y no se inventa ninguna: el separador COMA y la interfaz minima de lectura. Aqui
// se amplia con `getAll` (R9) y con el recorrido de la query entera (R20).
//
// LIMITE CONOCIDO (decision A2 de requirements): el separador NO se escapa. Los valores
// del catalogo son ids y enums, asi que un valor que contenga una coma sencillamente no
// es expresable desde la URL; al partirse, sus trozos no casan con ninguna opcion
// declarada y caen por R14 (se descartan, no rompen). Se documenta como limite en vez de
// introducir un esquema de escapado que hoy no necesita nadie.

import { BOOLEAN_MARCADO } from "@/components/shared/FilterComponent";
import type {
  FilterDef,
  FilterSelection,
} from "@/components/shared/FilterComponent";

/**
 * Lo minimo de `URLSearchParams` que se necesita.
 *
 * Lo cumplen tanto `URLSearchParams` como el `ReadonlyURLSearchParams` de
 * `next/navigation` (que extiende `URLSearchParams`), asi que el codec se prueba con el
 * primero y se usa en produccion con el segundo sin adaptadores.
 *
 * `entries()` esta aqui porque `queryTrasLimpiar` (R20) necesita recorrer TODOS los pares
 * conservando su orden: `get`/`getAll` solo saben responder por una clave que ya conoces,
 * y los params AJENOS son precisamente los que no conocemos.
 */
export interface LectorParams {
  get(name: string): string | null;
  getAll(name: string): string[];
  entries(): IterableIterator<[string, string]>;
}

/** Param por defecto del termino libre de la barra (decision A1). */
export const PARAM_TERMINO_DEFAULT = "q";

/** Separador de valores dentro de un param (precedente: `filtro-tablero.ts`). */
export const SEPARADOR_VALORES = ",";

/** Posiciones de la terna de un `dateRange`: `atajo,desde,hasta` (decision A3). */
const POSICIONES_RANGO = 3;

/**
 * `kind`s que este codec sabe leer. Espeja el `KINDS_SOPORTADOS` de `FilterComponent`
 * —que no se exporta— a proposito de forma explicita: un `kind` nuevo alli no se cuela
 * aqui por descuido, se descarta hasta que alguien escriba su regla de validacion.
 */
const KINDS_CON_REGLA = new Set<string>([
  "multi",
  "single",
  "dateRange",
  "boolean",
  "text",
]);

/** Fecha calendario `YYYY-MM-DD` que ademas EXISTE (`2026-13-45` no la pasa). */
function esFechaCalendario(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  // `Date` normaliza en silencio (`2026-02-31` -> 3 de marzo), asi que la unica forma de
  // detectar un dia inexistente es comprobar que la fecha vuelve a serializarse igual.
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(valor);
}

function valoresDeOpciones(filtro: FilterDef): Set<string> {
  return new Set((filtro.options ?? []).map((opcion) => opcion.value));
}

/**
 * Trozos NO vacios de todas las apariciones del param, en el orden en que aparecen
 * (R8 + R9). Param ausente -> `[]`.
 */
export function valoresDeParam(params: LectorParams, clave: string): string[] {
  return params
    .getAll(clave)
    .flatMap((aparicion) => aparicion.split(SEPARADOR_VALORES))
    .map((trozo) => trozo.trim())
    .filter((trozo) => trozo !== "");
}

/**
 * Terna CRUDA de un `dateRange`, con sus tres posiciones intactas.
 *
 * No puede apoyarse en `valoresDeParam` porque este descarta los trozos vacios y en un
 * `dateRange` la POSICION es el significado: `?fecha=30d,,` y `?fecha=,2026-07-01,`
 * dicen cosas distintas y ambos tienen huecos. Mas de tres posiciones es una terna
 * malformada: se devuelve tal cual y la validacion la descarta entera.
 */
function ternaCruda(params: LectorParams, clave: string): string[] {
  const apariciones = params.getAll(clave);
  if (apariciones.length === 0) return [];
  const trozos = apariciones
    .join(SEPARADOR_VALORES)
    .split(SEPARADOR_VALORES)
    .map((trozo) => trozo.trim());
  while (trozos.length < POSICIONES_RANGO) trozos.push("");
  return trozos;
}

function validarTerna(filtro: FilterDef, crudos: string[]): string[] {
  const trozos = [...crudos];
  while (trozos.length < POSICIONES_RANGO) trozos.push("");
  if (trozos.length > POSICIONES_RANGO) return [];

  const [atajo, desde, hasta] = trozos;
  if (atajo === "" && desde === "" && hasta === "") return [];
  if (atajo !== "" && !valoresDeOpciones(filtro).has(atajo)) return [];
  if (desde !== "" && !esFechaCalendario(desde)) return [];
  if (hasta !== "" && !esFechaCalendario(hasta)) return [];
  // Rango invertido: la terna entera se descarta, no se "arregla" intercambiando los
  // extremos. Un enlace que pide lo imposible no debe acotar el listado a otra cosa.
  if (desde !== "" && hasta !== "" && desde > hasta) return [];

  return [atajo, desde, hasta];
}

/**
 * Valores YA validados contra el catalogo de ese filtro (R10-R14, R16). `[]` = el filtro
 * se trata como AUSENTE.
 *
 * `crudos` llega tal como lo produce la lectura del param para ese `kind`: trozos no
 * vacios en el caso general, la terna posicional en `dateRange` y el valor entero del
 * param en `text`.
 */
export function valoresValidos(filtro: FilterDef, crudos: string[]): string[] {
  if (!KINDS_CON_REGLA.has(filtro.kind)) return [];

  switch (filtro.kind) {
    case "multi": {
      const declarados = valoresDeOpciones(filtro);
      return crudos.filter((valor) => declarados.has(valor));
    }
    case "single": {
      const declarados = valoresDeOpciones(filtro);
      const primero = crudos.find((valor) => declarados.has(valor));
      return primero === undefined ? [] : [primero];
    }
    case "boolean":
      // Un `boolean` desmarcado no viaja como `false`: la clave desaparece. Aceptar
      // cualquier otra cosa convertiria `?urgente=0` en "urgente marcado".
      return crudos.includes(BOOLEAN_MARCADO) ? [BOOLEAN_MARCADO] : [];
    case "text": {
      // EXCEPCION al separador: un termino de busqueda puede contener comas, asi que el
      // valor del param NO se parte. `crudos` trae aqui el valor entero.
      const termino = (crudos[0] ?? "").trim();
      if (termino === "") return [];
      return termino.length >= (filtro.minChars ?? 0) ? [termino] : [];
    }
    case "dateRange":
      return validarTerna(filtro, crudos);
    default:
      return [];
  }
}

/** Lo que se lee del param para ese `kind`, antes de validar. */
function crudosDeParam(params: LectorParams, filtro: FilterDef): string[] {
  if (filtro.kind === "dateRange") return ternaCruda(params, filtro.key);
  if (filtro.kind === "text") {
    const valor = params.get(filtro.key);
    return valor === null ? [] : [valor];
  }
  return valoresDeParam(params, filtro.key);
}

/**
 * R3, R16 — la seleccion precargada, SOLO con las claves que sobrevivieron la validacion.
 *
 * El nombre del param es exactamente `FilterDef.key`, sin prefijo ni transformacion (R4).
 */
export function seleccionDesdeUrl(
  params: LectorParams,
  filtros: readonly FilterDef[],
): FilterSelection {
  const seleccion: FilterSelection = {};
  for (const filtro of filtros) {
    const valores = valoresValidos(filtro, crudosDeParam(params, filtro));
    if (valores.length > 0) seleccion[filtro.key] = valores;
  }
  return seleccion;
}

/**
 * R2 — claves OFRECIDAS que aparecen en la URL, en el orden en que se OFRECEN (no el de
 * la URL) y una sola vez cada una.
 *
 * Aqui no se valida contra el catalogo: quien ofrece los filtros solo declara su clave
 * (`{ key }`), no sus opciones. La validacion de valores es cosa de `seleccionDesdeUrl`;
 * si un valor no sobrevive, el control se monta vacio, que es lo mismo que hoy pasa
 * cuando el usuario pide un filtro desde el selector.
 */
export function activosDesdeUrl(
  params: LectorParams,
  ofrecidos: readonly { key: string }[],
): string[] {
  const activos: string[] = [];
  const vistas = new Set<string>();
  for (const { key } of ofrecidos) {
    if (vistas.has(key)) continue;
    vistas.add(key);
    if (valoresDeParam(params, key).length > 0) activos.push(key);
  }
  return activos;
}

/** R1 — termino libre precargado, ya recortado, o `""`. */
export function terminoDesdeUrl(params: LectorParams, terminoKey: string): string {
  return (params.get(terminoKey) ?? "").trim();
}

/**
 * R19/R20/R21 — la query resultante de quitar SOLO los params propios.
 *
 * Los ajenos sobreviven con su valor y su orden: no es una precaucion teorica, la
 * pantalla de `cierres-admin` monta la barra y a la vez lee `?cierre=` para abrir un
 * detalle. Devuelve `""` cuando no queda ningun par, para que la ruta pueda ir sin `?`.
 */
export function queryTrasLimpiar(
  params: LectorParams,
  clavesPropias: readonly string[],
): string {
  const propias = new Set(clavesPropias);
  const restantes = new URLSearchParams();
  for (const [clave, valor] of params.entries()) {
    if (propias.has(clave)) continue;
    restantes.append(clave, valor);
  }
  return restantes.toString();
}
