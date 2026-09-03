import type { FilterSelection } from "@/components/shared/FilterComponent";
import type { FiltroHistorialAccionInput } from "@/lib/types/historial-accion";
import { BUSQUEDA_MIN_CHARS } from "@/lib/types/orden";
import { ultimosNDiasCalendarioCR } from "@/lib/utils/fecha-cr";

import { ATAJOS_CREACION } from "@/app/(app)/ordenes/_components/ordenes-filtros-def";

import {
  CLAVE_ACCION,
  CLAVE_ACTOR,
  CLAVE_BUSQUEDA,
  CLAVE_CATEGORIA,
  CLAVE_ENTIDAD,
  CLAVE_FECHA,
} from "./historial-acciones-filtros-def";

// FICHA 362 / T5.3 (design §5.2) — traduccion de la seleccion agregada del componente
// GENERICO al `filtro` que valida `filtroHistorialAccionSchema`.
//
// La traduccion es responsabilidad de la SUPERFICIE, no del componente (R58 de la 144): el
// control emite `Record<string, string[]>` y aqui se decide que significa cada clave. Las
// claves del control (`actor_id`, `entidad_tipo`, `fecha`) NO son las del contrato
// (`actorId`, `entidadTipo`, `desde`/`hasta`) y ese salto ocurre exactamente aqui.
//
// Las reglas duras, y ninguna es de estilo — cada una corresponde a un rechazo del borde:
//
//   1. una lista vacia se OMITE, jamas viaja `[]` (todas las listas son `.nonempty()`);
//   2. el atajo y el rango son EXCLUYENTES: el contrato no tiene clave de atajo, asi que el
//      atajo se RESUELVE aqui a sus dos fechas y nunca se manda ademas del rango;
//   3. las fechas viajan `YYYY-MM-DD` — son fechas de CALENDARIO de Costa Rica, no
//      instantes, y `esFechaCalendarioValida` rechaza cualquier otra forma;
//   4. `q` por debajo del minimo NO viaja (R32) — no es un error, es «todavia no hay
//      busqueda»;
//   5. las claves DESCONOCIDAS se descartan AQUI. El esquema del borde es `.strict()`: una
//      clave que el contrato no conoce no es un filtro que se ignora, es un
//      `validation_error` que dejaria la pantalla en blanco sin decir por que.
//
// LO QUE ESTE MODULO NO HACE, y es deliberado: NO valida los VALORES. Un tipo de accion que
// no este en la union cerrada viaja tal cual y el borde responde `validation_error` (R15).
// Filtrarlo aqui seria el descarte mudo que la ficha prohibe: el usuario habria pedido algo
// y se le devolveria un listado que no es el suyo, sin aviso.

/**
 * El trozo del contrato que la BARRA produce. Se DERIVA del tipo del borde en vez de
 * escribirse a mano: si el filtro gana o pierde una clave, este tipo se entera solo.
 * `page`, `pageSize` y el ordenamiento no salen de la barra — los pone el modulo.
 */
export type FiltroHistorialAccionUI = Omit<
  FiltroHistorialAccionInput,
  "page" | "pageSize" | "sortBy" | "sortDir"
>;

/** Los atajos del control, indexados por su `value`, para resolverlos a un rango. */
const DIAS_POR_ATAJO = new Map<string, number>(
  ATAJOS_CREACION.map((a) => [a.value, a.dias]),
);

/**
 * `FilterSelection` -> `filtro` de `listarHistorialAccionesPaginado`.
 *
 * @param sel Seleccion emitida por `FilterComponent`.
 * @param opts.ahora Instante desde el que se resuelven los atajos de fecha. Inyectable para
 *   fijar los rangos en los tests; en produccion es `new Date()`.
 */
export function seleccionAFiltroHistorialAcciones(
  sel: FilterSelection,
  opts: { ahora?: Date } = {},
): FiltroHistorialAccionUI {
  const ahora = opts.ahora ?? new Date();
  const out: FiltroHistorialAccionUI = {};

  for (const [key, values] of Object.entries(sel)) {
    // Regla 1: la clave se OMITE, nunca se manda `[]`.
    if (!values || values.length === 0) continue;

    if (key === CLAVE_FECHA) {
      const [atajo = "", desde = "", hasta = ""] = values;
      const dias = atajo !== "" ? DIAS_POR_ATAJO.get(atajo) : undefined;
      if (dias !== undefined) {
        // Regla 2: el atajo GANA la terna y se resuelve a sus dos fechas. No se emite
        // ninguna marca del atajo: el borde no la conoce y la rechazaria.
        const rango = ultimosNDiasCalendarioCR(dias, ahora);
        out.desde = rango.desde;
        out.hasta = rango.hasta;
        continue;
      }
      // Un atajo que no esta en la tabla se ignora y manda el rango escrito a mano: es
      // preferible filtrar por lo que el calendario muestra que inventar un rango.
      if (desde !== "") out.desde = desde;
      if (hasta !== "") out.hasta = hasta;
      continue;
    }

    if (key === CLAVE_BUSQUEDA) {
      // Regla 4 (R32). El `trim` va ANTES de medir, igual que en el esquema del borde:
      // `"  ma  "` son 2 caracteres, no 6. El control ya omite la clave por debajo del
      // minimo; esta guarda es por si la seleccion se construye a mano.
      const termino = (values[0] ?? "").trim();
      if (termino.length >= BUSQUEDA_MIN_CHARS) out.q = termino;
      continue;
    }

    // Las cuatro listas viajan TAL CUAL. El aserto de tipo es el precio de que el contrato
    // las declare `.nonempty()` (una tupla, no un array) y de que el control emita
    // `string[]`: la regla 1 ya garantizo que no esta vacia, y los VALORES los valida el
    // borde con su union cerrada (ver la cabecera).
    if (key === CLAVE_ACTOR) {
      out.actorId = [...values] as FiltroHistorialAccionUI["actorId"];
      continue;
    }
    if (key === CLAVE_ACCION) {
      out.accion = [...values] as FiltroHistorialAccionUI["accion"];
      continue;
    }
    if (key === CLAVE_CATEGORIA) {
      out.categoria = [...values] as FiltroHistorialAccionUI["categoria"];
      continue;
    }
    if (key === CLAVE_ENTIDAD) {
      out.entidadTipo = [...values] as FiltroHistorialAccionUI["entidadTipo"];
      continue;
    }

    // Regla 5 — clave desconocida: se descarta. Sin `default` silencioso: el `continue` es
    // explicito para que anadir una clave a la barra sin traducirla se note al leer.
    continue;
  }

  return out;
}

/**
 * Clave de cache/refetch del filtro vigente, hermana de `serializarFiltro` (144/R61) y de
 * `claveDeOrden` (352).
 *
 * Es un ESCALAR ESTABLE: ordena las claves y los valores, asi que dos selecciones
 * equivalentes construidas en distinto orden comparten cache en vez de disparar una consulta
 * nueva en cada render. Sin esto, el objeto del filtro cambia de identidad en cada render y
 * SWR vuelve a pedir lo mismo indefinidamente.
 */
export function claveDeFiltroHistorial(filtro: FiltroHistorialAccionUI): string {
  const entradas = Object.entries(filtro as Record<string, unknown>)
    .filter(([, valor]) => valor !== undefined)
    .map(([clave, valor]): [string, string] => [
      clave,
      Array.isArray(valor) ? [...(valor as string[])].sort().join(",") : String(valor),
    ])
    .sort(([a], [b]) => a.localeCompare(b));
  return entradas.map(([clave, valor]) => `${clave}=${valor}`).join("|");
}
