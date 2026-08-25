import type { FilterDef, FilterSelection } from "@/components/shared/FilterComponent";
import {
  ESTADOS_BODEGA_SATELITE,
  type EstadoBodegaSatelite,
} from "@/lib/utils/estados-bodega-satelite";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";
import {
  CLAVE_BUSQUEDA,
  construirFiltrosOrdenes,
} from "@/app/(app)/ordenes/_components/ordenes-filtros-def";
import { seleccionAFilter } from "@/app/(app)/ordenes/_components/seleccion-a-filter";

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
// Feature 170 — FASE 2 (T K.3): los filtros los resuelve EL SERVIDOR (T K.1) y las opciones
// de la geografía vienen de un catálogo, no de las órdenes cargadas (T K.2, R46).
//
// Pedido humano (2026-08-19): la barra deja de ser «como la del admin» y pasa a ser LA del
// admin — los controles salen de `construirFiltrosOrdenes`, el módulo de `/ordenes`—, sin
// zona ni tienda y con la geografía de la zona del actor. Ver `construirFiltrosSatelite`.
//
// Feature 184 — Tanda A (T A.4): la descarga también los resuelve en el servidor, así que
// este módulo se queda SOLO con lo que es de presentación: declarar los filtros a partir del
// catálogo, traducir la selección de la barra al input de la Server Action y serializarla
// para la caché. Ya no filtra nada (ver el bloque del final).

/**
 * Clave del filtro de estado dentro de la selección de `FilterComponent`.
 *
 * Es la ÚNICA clave propia que le queda a esta barra: los cinco estados de la bodega no son
 * los del catálogo `order_status` que ofrece `/ordenes`, así que este filtro no puede salir
 * de allí. Geografía, tiempo y buscador sí (ver `construirFiltrosSatelite`).
 */
export const CLAVE_ESTADO = "estado";

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
 * Pedido humano (2026-08-19) — la barra de la bodega satélite ES la barra de `/ordenes`.
 *
 * No se parece: es la misma. Los controles salen de `construirFiltrosOrdenes` (el mismo
 * módulo que monta la barra del maestro), así que buscador, geografía encadenada y filtro de
 * creación —con sus mismos atajos, sus mismos límites y sus mismas etiquetas— llegan aquí sin
 * una segunda declaración que pueda quedarse atrás.
 *
 * Lo que CAE, y por qué:
 *   - **Zona** (`incluirZona: false`): el adminSatelite opera UNA zona y el servidor la toma
 *     siempre del actor. Ofrecer el control sería ofrecer el alcance como entrada.
 *   - **Tienda** (`incluirTienda: false`): no ve el directorio de cuentas tienda; el servicio
 *     del catálogo tampoco se lo entrega, así que el control se quedaría sin opciones.
 *   - **Reasignables**: es un filtro de despacho de la bodega CENTRAL (allí sin mensajero),
 *     un estado que este listado no contiene.
 *
 * Lo que SE QUEDA, y no es obvio: el filtro por **Mensajero** (pedido humano 2026-08-25). El
 * adminSatelite reparte por mensajeros y quiere la misma pregunta que el maestro; las opciones
 * salen de su catálogo, que para este rol trae SOLO los mensajeros de su zona, y el listado
 * sigue acotado por la zona del actor, así que el control no puede ampliar nada. El encadenado
 * a `zona_id` queda inerte aquí —ese control no se declara— y el motor de dependencias trata
 * un padre no declarado como «sin acotar», que es justo lo que corresponde: su catálogo YA
 * viene recortado a la zona.
 *
 * Lo que SE AÑADE: el filtro de ESTADO con los cinco estados de esta pantalla, delante del
 * resto — la misma posición que ocupa en `/ordenes`.
 *
 * La GEOGRAFÍA llega ya acotada a la zona del actor: el catálogo se pide con
 * `obtenerCatalogoFiltrosOrdenes`, que para este rol devuelve la geografía de SU zona (y ni
 * zonas ni tiendas). Antes las opciones se derivaban de las órdenes cargadas y se comparaban
 * por NOMBRE, con lo que «Central» —que existe en cuatro provincias— no podía encadenarse a su
 * provincia; ahora son ids, y la cadena provincia → cantón → distrito funciona como en
 * `/ordenes`.
 *
 * El BUSCADOR se declara pero se descarta aquí por su CLAVE: lo pinta `BuscadorFiltros`, la
 * barra permanente de arriba, igual que en `/ordenes`.
 */
export function construirFiltrosSatelite(
  catalogo: CatalogoFiltrosOrdenesDTO,
  opts?: { ahora?: Date },
): FilterDef[] {
  const declarados = construirFiltrosOrdenes(catalogo, {
    incluirZona: false,
    incluirTienda: false,
    incluirReasignables: false,
    ahora: opts?.ahora,
  }).filter((f) => f.key !== CLAVE_BUSQUEDA);

  return [
    {
      key: CLAVE_ESTADO,
      label: "Estado",
      kind: "multi",
      options: ESTADOS_SATELITE.map((e) => ({ value: e.value, label: e.label })),
      placeholder: "Todos los estados",
      emptyMessage: "Sin estados",
    },
    ...declarados,
  ];
}

/**
 * Los tres filtros tal como los pide la Server Action paginada (T K.1). Lista vacía —o
 * ausente— significa «todos», igual que un desplegable sin nada marcado.
 */
export interface FiltroBodegaSatelite {
  estados?: EstadoBodegaSatelite[];
  /** Mensajeros asignados elegidos: la MISMA clave que el `filter` de `/ordenes`. */
  mensajero_id?: string[];
  /** Geografía por ID, tiempo y término: las MISMAS claves que el `filter` de `/ordenes`. */
  provincia_id?: string[];
  canton_id?: string[];
  distrito_id?: string[];
  created_preset?: string;
  created_desde?: string;
  created_hasta?: string;
  q?: string;
}

/** `true` si el valor es uno de los cinco estados del listado. */
function esEstadoDelListado(value: string): value is EstadoBodegaSatelite {
  return (ESTADOS_BODEGA_SATELITE as readonly string[]).includes(value);
}

/**
 * Traduce la selección de la barra al input de la Server Action.
 *
 * Pedido humano (2026-08-19): todo lo que esta barra comparte con `/ordenes` lo traduce
 * `seleccionAFilter`, la MISMA función que usa allí — incluido lo que no es una identidad: la
 * clave posicional del calendario (`[atajo, desde, hasta]`) que se abre en `created_preset` o
 * en `created_desde`/`created_hasta`, y el término, que baja de lista a escalar. Aquí sólo
 * queda lo propio: los ESTADOS, que se acotan a los cinco de esta pantalla porque el borde los
 * valida con `z.enum` y un valor ajeno tumbaría la consulta entera en vez de ignorarse.
 *
 * Una lista vacía se OMITE en vez de viajar como `[]`, para que «sin filtros» tenga una sola
 * clave de caché y siga aprovechando la página que pre-cargó el servidor.
 */
export function seleccionAFiltroSatelite(
  seleccion: FilterSelection,
): FiltroBodegaSatelite {
  const compartidos: FilterSelection = { ...seleccion };
  delete compartidos[CLAVE_ESTADO]; // la unica clave que `seleccionAFilter` no conoce
  const filtro = seleccionAFilter(compartidos) as FiltroBodegaSatelite;
  const estados = (seleccion[CLAVE_ESTADO] ?? []).filter(esEstadoDelListado);
  if (estados.length > 0) filtro.estados = estados;
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
      if (valor === undefined) return null;
      // Desde que la barra es la de `/ordenes` no todas las claves son listas: el término y
      // las tres del calendario son ESCALARES. Ordenar sólo lo que es lista mantiene la
      // propiedad que da sentido a esta función —dos selecciones equivalentes, una sola
      // clave— sin inventarle un `sort` a un string (que lo partiría en caracteres).
      return `${clave}=${Array.isArray(valor) ? [...valor].sort().join(",") : valor}`;
    })
    .filter((parte): parte is string => parte !== null)
    .join("&");
}

/** Clave de «sin ningún filtro marcado»: la única página que el servidor pre-carga. */
export const FILTRO_SATELITE_VACIO = serializarFiltroSatelite({});

// Feature 184 — Tanda A (T A.4, R16): aquí vivía `filtrarOrdenesSatelite`, el filtro
// compuesto en AND que la DESCARGA aplicaba en el navegador sobre el listado sin recorte,
// porque ninguna acción devolvía «el conjunto filtrado». Ya existe
// (`listarOrdenesBodegaCompleto`), así que la segunda declaración del criterio se retira en
// vez de quedarse muerta: este listado era el ÚNICO del Anexo A que lo tenía escrito dos
// veces —una en SQL y otra aquí, con dos formas de comparar (exacta contra normalizada)—, y
// dos declaraciones del mismo criterio es exactamente lo que R16 prohíbe.
