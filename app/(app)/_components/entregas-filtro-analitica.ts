// La traduccion de la barra de ENTREGAS al filtro que acepta el conteo de entregas.
//
// Modulo PURO (sin React, sin DOM, sin red): `FilterSelection -> RawFiltroConteoEntregas`.
// Vive aparte del proveedor y de la barra a proposito — es donde se decide QUE numero se
// pide, y eso se comprueba sin montar nada.
//
// Lo que hay que saber antes de tocarlo:
//
//  - El destino es `conteoEntregasFiltroSchema` (`lib/analytics/entregas-conteo.ts`), que es
//    `.strict()`: **una clave de mas no es un extra inocuo, es un `validation_error`**. Por
//    eso esta funcion no reenvia la seleccion tal cual como hace `seleccionAFilter` en
//    ordenes, sino que construye el objeto entero clave por clave. Una faceta que aparezca
//    manana en la barra no se cuela aqui por accidente: hay que escribirla.
//  - **La cadena geografica SI viaja** (2026-08-17). Antes no lo hacia, y estaba bien: la
//    cifra salia de `analytics_daily`, que no tiene provincia/canton/distrito en su grano.
//    Ahora sale de la tabla `orden`, que si los tiene como columnas. Cambio la fuente, no el
//    criterio.
//  - Las listas VACIAS se omiten, nunca se mandan como `[]`: el esquema exige lista no vacia
//    y un `[]` seria un `validation_error` provocado por nosotros.
//  - El rango: la barra emite la terna posicional `[atajo, desde, hasta]` con los atajos YA
//    resueltos a fechas (`DateRangeFilter`), asi que aqui solo se ven fechas `YYYY-MM-DD`.
//    Con las DOS se pide `personalizado`; con una sola o con ninguna se conserva el preset
//    inicial, porque el esquema exige el par completo (refine 1) y media terna no describe
//    ninguna ventana.

import type { FilterSelection } from "@/components/shared/FilterComponent";
import type { RangoPreset } from "@/lib/analytics/types";

import {
  CLAVE_CANTON,
  CLAVE_CREACION,
  CLAVE_DISTRITO,
  CLAVE_MENSAJERO,
  CLAVE_PROVINCIA,
  CLAVE_TIENDA,
  CLAVE_ZONA,
} from "./entregas-filtros-def";

/**
 * Lo que se le pasa a `consultarConteoEntregas` como `raw`.
 *
 * Se declara con claves opcionales y NADA mas: el tipo mismo hace que anadir `rol` o
 * `usuario_id` no compile, que es la mitad cliente de lo que el `.strict()` del esquema
 * defiende en el servidor.
 */
export interface RawFiltroConteoEntregas {
  /** Ausente = SIN filtro de fecha. Ver `FILTRO_ENTREGAS_INICIAL`. */
  rango?: RangoPreset;
  desde?: string;
  hasta?: string;
  zona_id?: string[];
  provincia_id?: string[];
  canton_id?: string[];
  distrito_id?: string[];
  tienda_id?: string[];
  mensajero_id?: string[];
}

/**
 * Lo que se consulta cuando el usuario no ha filtrado nada: **VACÍO**.
 *
 * ⚠ CAMBIÓ EL 2026-08-18 y merece decirse, porque antes valía `{ rango: "semana" }` y había
 * un motivo escrito para ello (igualar el preset inicial del tablero operativo). El motivo no
 * sobrevivió al pedido: **los filtros los manda la barra, y la pantalla no arranca con
 * ninguno puesto**. Un preset implícito hace que la primera cifra salga recortada a una
 * ventana que nadie eligió mientras la barra dice «sin filtrar» — el usuario ve un número de
 * los últimos siete días creyendo que ve el total, y no hay nada en pantalla que lo delate.
 *
 * El objeto vacío es un filtro VÁLIDO en el borde: `rango` es opcional en
 * `conteoEntregasFiltroSchema` y su ausencia significa «sin ventana», no «rango inválido».
 */
export const FILTRO_ENTREGAS_INICIAL: RawFiltroConteoEntregas = {};

/** Ids no vacios, o `undefined` si no queda ninguno (la clave se omite). */
function idsOOmitidos(valores: readonly string[] | undefined): string[] | undefined {
  const limpios = (valores ?? []).filter((v) => v !== "");
  return limpios.length > 0 ? limpios : undefined;
}

/**
 * Seleccion de la barra de entregas -> `raw` de `consultarConteoEntregas`.
 *
 * Las claves se escriben SIEMPRE en el mismo orden porque el resultado se serializa como
 * clave de SWR: dos objetos con las mismas parejas en distinto orden darian dos claves
 * distintas y una consulta de mas.
 */
export function seleccionAFiltroAnalitica(seleccion: FilterSelection): RawFiltroConteoEntregas {
  const terna = seleccion[CLAVE_CREACION] ?? [];
  const desde = terna[1] ?? "";
  const hasta = terna[2] ?? "";
  const conFechas = desde !== "" && hasta !== "";

  // Sin las DOS fechas NO se manda rango: ni `personalizado` a medias (el esquema exige el
  // par completo) ni un preset de relleno. Media terna no describe ninguna ventana, y la
  // ausencia de ventana es una respuesta legítima — «no he filtrado por fecha».
  const raw: RawFiltroConteoEntregas = conFechas
    ? { rango: "personalizado", desde, hasta }
    : {};

  const zona = idsOOmitidos(seleccion[CLAVE_ZONA]);
  if (zona) raw.zona_id = zona;
  const provincia = idsOOmitidos(seleccion[CLAVE_PROVINCIA]);
  if (provincia) raw.provincia_id = provincia;
  const canton = idsOOmitidos(seleccion[CLAVE_CANTON]);
  if (canton) raw.canton_id = canton;
  const distrito = idsOOmitidos(seleccion[CLAVE_DISTRITO]);
  if (distrito) raw.distrito_id = distrito;
  const tienda = idsOOmitidos(seleccion[CLAVE_TIENDA]);
  if (tienda) raw.tienda_id = tienda;
  const mensajero = idsOOmitidos(seleccion[CLAVE_MENSAJERO]);
  if (mensajero) raw.mensajero_id = mensajero;

  return raw;
}

/**
 * Clave estable del filtro para SWR. Cambiar cualquier filtro cambia esta cadena y con ella
 * la clave del anillo: sin esto, en pantalla quedaria la cifra del filtro anterior como si
 * fuera la del nuevo.
 */
export function serializarFiltroEntregas(raw: RawFiltroConteoEntregas): string {
  return JSON.stringify(raw);
}
