import type { FilterDef } from "@/components/shared/FilterComponent";
import {
  derivarCantones,
  derivarDistritos,
} from "@/lib/utils/filtro-canton-distrito";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

// Barra de filtros del listado de la bodega satélite (pedido humano: "el mismo diseño
// que en el admin"). Declaración PURA de los filtros que ofrece `FilterComponent`,
// separada del componente para poder probarla sin montar nada.
//
// El filtro de ESTADO se limita a los estados que el adminSatelite ve en su pantalla;
// ofrecer el catálogo completo de estatus mentiría (ninguna orden suya puede estar en
// `entregada`). El listado, además, solo recibe órdenes de esos grupos, así que la
// restricción es de coherencia, no una defensa: el scope real lo impone el servicio,
// acotado a la zona del actor.

/** Clave del filtro de estado dentro de la selección de `FilterComponent`. */
export const CLAVE_ESTADO = "estado";
/** Clave del filtro de cantón. */
export const CLAVE_CANTON = "canton";
/** Clave del filtro de distrito (depende del cantón elegido). */
export const CLAVE_DISTRITO = "distrito";

/**
 * Los CINCO estados del listado, en el orden del flujo de la bodega: lo que está guardado,
 * lo que ya tiene mensajero pero sigue aquí, lo que sale, lo que va en camino y lo que
 * volvió. Feature 149 (R35) añadió `por_recoger`: la orden asignada NO ha salido de la
 * bodega, así que se ve en el listado y admite "Deshacer asignación".
 */
export const ESTADOS_SATELITE = [
  { value: "en_bodega_satelite", label: "Recibidas" },
  { value: "por_recoger", label: "Asignadas (por recoger)" },
  { value: "por_devolver", label: "Por devolver" },
  { value: "devolviendo_a_bodega_central", label: "En tránsito a central" },
  { value: "devuelta", label: "Devueltas" },
] as const;

/** `value` de cada estado del listado, para acotar tipos y validar la selección. */
export type EstadoSatelite = (typeof ESTADOS_SATELITE)[number]["value"];

/** Etiqueta legible de un estado del listado; el propio value si no es de los cinco. */
export function etiquetaEstado(value: string): string {
  return ESTADOS_SATELITE.find((e) => e.value === value)?.label ?? value;
}

/**
 * Filtros de la barra: estado (los cuatro de arriba) + cantón y distrito derivados de
 * las órdenes CARGADAS (no del subconjunto ya filtrado, para que elegir uno no borre las
 * demás opciones). El distrito declara `dependsOn` para que `FilterComponent` solo
 * ofrezca los del cantón elegido y pode la selección al cambiarlo.
 */
export function construirFiltrosSatelite(
  ordenes: RecepcionSateliteDTO[],
): FilterDef[] {
  const cantones = derivarCantones(ordenes);
  return [
    {
      key: CLAVE_ESTADO,
      label: "Estado",
      kind: "multi",
      options: ESTADOS_SATELITE.map((e) => ({ value: e.value, label: e.label })),
      placeholder: "Todos los estados",
      emptyMessage: "Sin estados",
    },
    {
      key: CLAVE_CANTON,
      label: "Cantón",
      kind: "multi",
      options: cantones,
      placeholder: "Todos los cantones",
      searchPlaceholder: "Buscar cantón",
      emptyMessage: "Sin cantones",
    },
    {
      key: CLAVE_DISTRITO,
      label: "Distrito",
      kind: "multi",
      dependsOn: CLAVE_CANTON,
      // Cada distrito declara a qué cantón pertenece (`parentValue`); el control se
      // encarga de mostrar solo los del cantón elegido y de podar lo que deje de valer.
      options: cantones.flatMap((canton) =>
        derivarDistritos(ordenes, canton.value).map((distrito) => ({
          ...distrito,
          parentValue: canton.value,
        })),
      ),
      placeholder: "Todos los distritos",
      searchPlaceholder: "Buscar distrito",
      emptyMessage: "Elige un cantón primero",
    },
  ];
}
