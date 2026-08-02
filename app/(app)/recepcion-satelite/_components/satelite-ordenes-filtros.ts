import type { FilterDef, FilterSelection } from "@/components/shared/FilterComponent";
import {
  ESTADOS_BODEGA_SATELITE,
  type EstadoBodegaSatelite,
} from "@/lib/utils/estados-bodega-satelite";
import { normalizeName } from "@/lib/utils/normalize";
import type {
  CatalogoFiltrosSateliteDTO,
  RecepcionSateliteDTO,
} from "@/lib/interfaces/services/IRecepcionSateliteService";

// Barra de filtros del listado de la bodega satélite (pedido humano: "el mismo diseño
// que en el admin"). Declaración PURA de los filtros que ofrece `FilterComponent`,
// separada del componente para poder probarla sin montar nada.
//
// El filtro de ESTADO se limita a los estados que el adminSatelite ve en su pantalla;
// ofrecer el catálogo completo de estatus mentiría (ninguna orden suya puede estar en
// `entregada`). El listado, además, solo recibe órdenes de esos grupos, así que la
// restricción es de coherencia, no una defensa: el scope real lo impone el servicio,
// acotado a la zona del actor.
//
// Feature 170 — FASE 2 (T K.3): los tres filtros los resuelve AHORA EL SERVIDOR (T K.1) y
// las opciones de cantón y distrito vienen del catálogo del conjunto (T K.2, R46), no de
// las órdenes cargadas. Este módulo pasa a hacer tres cosas: declarar los filtros a partir
// de ese catálogo, traducir la selección de la barra al input de la Server Action y —solo
// para la descarga (R52, Q-K4)— conservar el filtro EN MEMORIA que la pantalla aplicaba
// antes de paginar.

/** Clave del filtro de estado dentro de la selección de `FilterComponent`. */
export const CLAVE_ESTADO = "estado";
/** Clave del filtro de cantón. */
export const CLAVE_CANTON = "canton";
/** Clave del filtro de distrito (depende del cantón elegido). */
export const CLAVE_DISTRITO = "distrito";

/**
 * Etiqueta visible de cada uno de los cinco estados del listado.
 *
 * Feature 170 — FASE 2 (T K.3, traspaso §9.2): el desplegable ya NO declara sus `value`.
 * Los toma de `ESTADOS_BODEGA_SATELITE` (`lib/utils/estados-bodega-satelite.ts`), que es la
 * MISMA lista que gobierna la lista blanca del filtro en el servidor (R44) y el rango de
 * grupo del `ORDER BY` (R51). Aquí solo quedan las etiquetas, que son de presentación: así
 * el orden de los grupos y el del desplegable no pueden divergir. El `Record` es
 * exhaustivo, de modo que añadir un estado a la constante sin darle etiqueta no compila.
 */
const ETIQUETA_ESTADO: Record<EstadoBodegaSatelite, string> = {
  en_bodega_satelite: "Recibidas",
  por_recoger: "Asignadas (por recoger)",
  por_devolver: "Por devolver",
  devolviendo_a_bodega_central: "En tránsito a central",
  devuelta: "Devueltas",
};

/**
 * Los CINCO estados del listado, en el orden del flujo de la bodega: lo que está guardado,
 * lo que ya tiene mensajero pero sigue aquí, lo que sale, lo que va en camino y lo que
 * volvió. Feature 149 (R35) añadió `por_recoger`: la orden asignada NO ha salido de la
 * bodega, así que se ve en el listado y admite "Deshacer asignación".
 */
export const ESTADOS_SATELITE: readonly {
  value: EstadoBodegaSatelite;
  label: string;
}[] = ESTADOS_BODEGA_SATELITE.map((value) => ({
  value,
  label: ETIQUETA_ESTADO[value],
}));

/** `value` de cada estado del listado, para acotar tipos y validar la selección. */
export type EstadoSatelite = EstadoBodegaSatelite;

/** Etiqueta legible de un estado del listado; el propio value si no es de los cinco. */
export function etiquetaEstado(value: string): string {
  return ESTADOS_SATELITE.find((e) => e.value === value)?.label ?? value;
}

/**
 * Filtros de la barra: estado (los cinco de arriba) + cantón y distrito del CATÁLOGO del
 * conjunto del actor (T K.2, R46). El distrito declara `dependsOn` para que
 * `FilterComponent` solo ofrezca los del cantón elegido y pode la selección al cambiarlo;
 * el encadenamiento (`parentValue`) viaja en el propio catálogo.
 *
 * Feature 170 — FASE 2 (T K.3): antes recibía las ÓRDENES y derivaba las opciones de ellas.
 * Con la tabla paginada ese array es la PÁGINA visible, así que derivar de él reduciría el
 * desplegable a los cantones de la página — justo lo que R46 prohíbe. Cambia el ORIGEN, no
 * el contrato: el catálogo trae la misma forma (`{ value, label }` y
 * `{ value, label, parentValue }`) porque el servidor la produce con las mismas funciones
 * (`derivarCantones` / `derivarDistritos`).
 */
export function construirFiltrosSatelite(
  catalogo: CatalogoFiltrosSateliteDTO,
): FilterDef[] {
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
      options: catalogo.cantones,
      placeholder: "Todos los cantones",
      searchPlaceholder: "Buscar cantón",
      emptyMessage: "Sin cantones",
    },
    {
      key: CLAVE_DISTRITO,
      label: "Distrito",
      kind: "multi",
      dependsOn: CLAVE_CANTON,
      options: catalogo.distritos,
      placeholder: "Todos los distritos",
      searchPlaceholder: "Buscar distrito",
      emptyMessage: "Elige un cantón primero",
    },
  ];
}

/**
 * Los tres filtros tal como los pide la Server Action paginada (T K.1). Lista vacía —o
 * ausente— significa «todos», igual que un desplegable sin nada marcado.
 */
export interface FiltroBodegaSatelite {
  estados?: EstadoBodegaSatelite[];
  cantones?: string[];
  distritos?: string[];
}

/** `true` si el valor es uno de los cinco estados del listado. */
function esEstadoDelListado(value: string): value is EstadoBodegaSatelite {
  return (ESTADOS_BODEGA_SATELITE as readonly string[]).includes(value);
}

/**
 * Traduce la selección de la barra al input de la Server Action.
 *
 * Cantón y distrito viajan como NOMBRES —son exactamente los `value` que el catálogo
 * ofrece, que es lo que el filtro de cliente comparaba (traspaso §9.3)—, así que no hay
 * nada que traducir. Los estados SÍ se acotan a los cinco: el schema del borde los valida
 * con `z.enum` y un valor ajeno tumbaría la consulta entera en vez de ignorarse.
 *
 * Una lista vacía se OMITE en vez de viajar como `[]`, para que «sin filtros» tenga una
 * sola clave de caché y siga aprovechando la página que pre-cargó el servidor.
 */
export function seleccionAFiltroSatelite(
  seleccion: FilterSelection,
): FiltroBodegaSatelite {
  const filtro: FiltroBodegaSatelite = {};
  const estados = (seleccion[CLAVE_ESTADO] ?? []).filter(esEstadoDelListado);
  const cantones = seleccion[CLAVE_CANTON] ?? [];
  const distritos = seleccion[CLAVE_DISTRITO] ?? [];
  if (estados.length > 0) filtro.estados = estados;
  if (cantones.length > 0) filtro.cantones = [...cantones];
  if (distritos.length > 0) filtro.distritos = [...distritos];
  return filtro;
}

/**
 * Clave ESCALAR y estable del filtro, para la caché de SWR: dos selecciones equivalentes
 * (en distinto orden o de distinta identidad de objeto) comparten caché en vez de
 * refetchear en cada render. Molde: `serializarFiltro` de `/ordenes` (feature 144).
 */
export function serializarFiltroSatelite(filtro: FiltroBodegaSatelite): string {
  return (Object.keys(filtro) as (keyof FiltroBodegaSatelite)[])
    .sort()
    .map((clave) => {
      const valor = filtro[clave];
      return valor === undefined ? null : `${clave}=${[...valor].sort().join(",")}`;
    })
    .filter((parte): parte is string => parte !== null)
    .join("&");
}

/** Clave de «sin ningún filtro marcado»: la única página que el servidor pre-carga. */
export const FILTRO_SATELITE_VACIO = serializarFiltroSatelite({});

/**
 * Filtro compuesto en AND —estado ∧ cantón ∧ distrito— aplicado EN MEMORIA, conservando el
 * orden de entrada.
 *
 * Feature 170 — FASE 2 (T K.3, R52 / Q-K4): esto es lo que el listado hacía dentro de un
 * `useMemo` cuando recibía el conjunto entero. La TABLA ya no lo usa (filtra el servidor),
 * pero la DESCARGA sí: tiene que entregar el conjunto COMPLETO con los filtros vigentes y
 * hoy no existe un listado de servidor que devuelva «todo el conjunto filtrado»
 * (`listarRecepcionSatelite()` no acepta filtros). Mientras no exista —deuda declarada para
 * la tanda M—, la descarga relee ese listado y aplica AQUÍ los mismos tres filtros, que es
 * exactamente lo que la pantalla hacía antes de paginar: no es una regresión.
 *
 * La comparación es NORMALIZADA (sin acentos ni caso) porque así comparaba el filtro de
 * cliente; el servidor compara por igualdad exacta del nombre. Los dos coinciden para todo
 * valor que el catálogo puede ofrecer —sale de la misma columna— y el catálogo sembrado no
 * tiene dos nombres que colisionen al normalizar (medido y vigilado por test en T K.1, Q-K1).
 */
export function filtrarOrdenesSatelite<T extends RecepcionSateliteDTO>(
  ordenes: readonly T[],
  filtro: FiltroBodegaSatelite,
): T[] {
  const estados = new Set<string>(filtro.estados ?? []);
  const cantones = new Set((filtro.cantones ?? []).map(normalizeName));
  const distritos = new Set((filtro.distritos ?? []).map(normalizeName));
  return ordenes.filter((orden) => {
    if (estados.size > 0 && !estados.has(orden.estatusValue)) return false;
    if (cantones.size > 0 && !cantones.has(normalizeName(orden.cantonNombre))) {
      return false;
    }
    if (distritos.size > 0) {
      if (orden.distritoNombre === null) return false;
      if (!distritos.has(normalizeName(orden.distritoNombre))) return false;
    }
    return true;
  });
}
