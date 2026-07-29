import type { FilterSelection } from "@/components/shared/FilterComponent";
import type { OrdenFilterInput } from "@/lib/types/orden";

import { CLAVE_CREACION } from "./ordenes-filtros-def";

// Feature 144 / B3 (design.md §4.2, R58) — traduccion de la seleccion agregada del
// componente GENERICO a las claves del `filter` de `listarOrdenes`.
//
// Esta traduccion es responsabilidad de la SUPERFICIE, no del componente (R20): otro
// consumidor con otro transporte (query string, body REST) escribira la suya. Las
// claves de catalogo se eligieron IGUALES a las del `filter`, asi que ahi la
// traduccion es la identidad; la unica transformacion real es la del tiempo, que pasa
// de una clave posicional de tres huecos a `created_preset` O `created_desde`/
// `created_hasta`.

/**
 * `FilterSelection` -> `filter` de `listarOrdenes`.
 *
 * Reglas duras del borde server-side que esta funcion NO puede violar:
 * - **una lista vacia es `validation_error`** (R32): la clave se OMITE, nunca se
 *   manda `[]`;
 * - **preset + rango juntos es `validation_error`** (R40): el atajo gana la terna
 *   por construccion (el control ya los hace excluyentes, R10);
 * - las fechas viajan como `YYYY-MM-DD`, sin hora: los instantes se rechazan (R43).
 */
export function seleccionAFilter(sel: FilterSelection): Partial<OrdenFilterInput> {
  const out: Record<string, unknown> = {};

  for (const [key, values] of Object.entries(sel)) {
    if (!values || values.length === 0) continue; // R32: jamas una lista vacia

    if (key === CLAVE_CREACION) {
      const [atajo = "", desde = "", hasta = ""] = values;
      if (atajo !== "") {
        out.created_preset = atajo; // R40: excluyente con el rango
        continue;
      }
      if (desde !== "") out.created_desde = desde;
      if (hasta !== "") out.created_hasta = hasta;
      continue;
    }

    out[key] = values; // listas de ids, tal cual
  }

  return out as Partial<OrdenFilterInput>;
}
