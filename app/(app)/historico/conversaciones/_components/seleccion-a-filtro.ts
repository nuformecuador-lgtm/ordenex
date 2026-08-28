import type { FilterSelection } from "@/components/shared/FilterComponent";
import type { FiltroHilosHistorico } from "@/lib/types/historico-conversaciones";
import { BUSQUEDA_MIN_CHARS } from "@/lib/types/orden";
import { ultimosNDiasCalendarioCR } from "@/lib/utils/fecha-cr";

import { ATAJOS_CREACION } from "@/app/(app)/ordenes/_components/ordenes-filtros-def";

import {
  CLAVE_BUSQUEDA,
  CLAVE_FECHA,
  CLAVE_MENSAJERO,
  CLAVE_ORDEN,
} from "./historico-filtros-def";

// Feature 318 / T5.2 (design §5.3, R32/R38) — traduccion de la seleccion agregada del
// componente GENERICO al `filtro` que valida `filtroHilosHistoricoSchema`.
//
// La traduccion es responsabilidad de la SUPERFICIE, no del componente (R58 de la 144):
// el control emite `Record<string, string[]>` y aqui se decide que significa cada clave.
//
// Las reglas duras son las mismas de `seleccion-a-filter.ts:23-32`, y no son de estilo:
// cada una corresponde a un rechazo del borde (R38), asi que violarlas no produce un
// listado raro sino un `validation_error`.
//
//   1. una lista vacia se OMITE, jamas viaja `[]` (`idList` es `.nonempty()`);
//   2. el atajo y el rango son EXCLUYENTES: el contrato no tiene clave de atajo, asi que
//      el atajo se RESUELVE aqui a sus dos fechas y nunca se manda ademas del rango;
//   3. las fechas viajan `YYYY-MM-DD`, sin hora (`fechaCalendario` rechaza instantes);
//   4. `q` por debajo del minimo NO viaja (R37) — no es un error, es «todavia no hay
//      busqueda»;
//   5. `orden` viaja ESCALAR, no lista (R35).
//
// Y una regla propia de esta barra: las claves DESCONOCIDAS se descartan. El esquema del
// borde es `.strict()`, asi que dejarlas pasar —como hace la barra de `/ordenes`, cuyo
// esquema no lo es— convertiria cualquier clave suelta en `validation_error`.

/** Los atajos del control, indexados por su `value`, para resolverlos a un rango. */
const DIAS_POR_ATAJO = new Map<string, number>(
  ATAJOS_CREACION.map((a) => [a.value, a.dias]),
);

/**
 * `FilterSelection` -> `filtro` de `listarHilosHistorico`.
 *
 * @param sel Seleccion emitida por `FilterComponent`.
 * @param opts.ahora Instante desde el que se resuelven los atajos de fecha. Inyectable
 *   para fijar los rangos en los tests; en produccion es `new Date()`.
 */
export function seleccionAFiltroHistorico(
  sel: FilterSelection,
  opts: { ahora?: Date } = {},
): FiltroHilosHistorico {
  const ahora = opts.ahora ?? new Date();
  const out: FiltroHilosHistorico = {};

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
        out.fecha_desde = rango.desde;
        out.fecha_hasta = rango.hasta;
        continue;
      }
      // Un atajo que no esta en la tabla se ignora y manda el rango escrito a mano: es
      // preferible filtrar por lo que el calendario muestra que inventar un rango.
      if (desde !== "") out.fecha_desde = desde;
      if (hasta !== "") out.fecha_hasta = hasta;
      continue;
    }

    if (key === CLAVE_BUSQUEDA) {
      // Regla 4 (R37). El `trim` va ANTES de medir, igual que en el esquema del borde:
      // `"  ma  "` son 2 caracteres, no 6. El control ya omite la clave por debajo del
      // minimo; esta guarda es por si la seleccion se construye a mano.
      const termino = (values[0] ?? "").trim();
      if (termino.length >= BUSQUEDA_MIN_CHARS) out.q = termino;
      continue;
    }

    if (key === CLAVE_ORDEN) {
      // Regla 5 (R35): ESCALAR. Es UN numero de orden, no un conjunto de ids; el borde lo
      // declara `z.string()` y una lista seria `validation_error`. La IGUALDAD la impone
      // el servidor: aqui el valor solo se transporta.
      const numero = (values[0] ?? "").trim();
      if (numero !== "") out.orden = numero;
      continue;
    }

    if (key === CLAVE_MENSAJERO) {
      // Lista de ids, tal cual. Ya se sabe no vacia por la regla 1.
      out.mensajero_id = [...values];
      continue;
    }

    // Clave desconocida: se descarta (ver cabecera). Sin `default` silencioso: el `continue`
    // es explicito para que anadir una clave a la barra sin traducirla se note al leer.
  }

  return out;
}
