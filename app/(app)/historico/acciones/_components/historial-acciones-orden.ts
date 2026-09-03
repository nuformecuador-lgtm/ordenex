import type { SegmentedOption } from "@/components/shared/SegmentedToggle";
import type { HistorialSortField } from "@/lib/types/historial-accion";
import type {
  DireccionOrden,
  OrdenamientoListado,
} from "@/lib/types/ordenamiento-listado";

import { OPCIONES_ORDEN_CREACION } from "@/app/(app)/ordenes/_components/ordenamiento-creacion";

// FICHA 362 / T5.4 (design §5.3, R26/R27) — el control de ORDEN de la tabla del registro, en
// declaraciones. Modulo de DATOS: no renderiza —lo hace `SegmentedToggle`, el conmutador que
// ya usan el portal del mensajero, la pantalla de cierres y la barra de `/ordenes`— y no
// guarda estado.
//
// ⚠️ DESVIACION DECLARADA DE `design.md §5.3`, que pedia «la cabecera ordenable por Fecha».
// Se implementa como CONMUTADOR en la barra, y no como cabecera pulsable, por dos razones
// medidas:
//
//   1. `components/shared/DataTable` no tiene hoy ningun soporte de ordenacion: `Column`
//      admite `renderHeader`, que sustituye el CONTENIDO del `<th>` pero no permite poner el
//      `aria-sort` que una cabecera ordenable necesita para ser accesible. Darselo obliga a
//      tocar el componente que montan 33 tablas, por una pantalla.
//   2. La ficha 356 ya resolvio esta misma peticion del humano —«no veo un boton con el cual
//      organizar los datos de las tablas por su fecha de creacion»— con este conmutador, y
//      con el motivo escrito: un desplegable de dos valores esconde la mitad del control
//      detras de un clic, y las dos opciones a la vista dicen que va a pasar antes de
//      pulsarlas. Dos controles distintos para «ordena esta tabla por fecha» es la divergencia
//      que este repo lleva pagando en otras seis piezas.
//
// Las ETIQUETAS se IMPORTAN de la 356 (`OPCIONES_ORDEN_CREACION`) y no se reescriben: son
// datos sobre la DIRECCION, no sobre las ordenes, y dos tablas que dicen «Mas recientes» de
// dos sitios distintos acaban diciendo cosas distintas.

/**
 * El UNICO campo por el que este registro se ordena, y la lista blanca del servidor tambien
 * tiene uno solo (`HISTORIAL_SORT_FIELDS`). Un registro de auditoria se lee en el tiempo.
 */
export const CAMPO_ORDEN_HISTORIAL: HistorialSortField = "created_at";

/**
 * Direccion con la que arranca la pantalla: LO MAS RECIENTE PRIMERO, que es tambien el
 * defecto del contrato (`filtroHistorialAccionSchema`, R26).
 *
 * Se declara aqui como literal y NO se deriva del schema A PROPOSITO: asi la pantalla y el
 * servidor son dos fuentes independientes que un test compara. Derivarla haria que ese test
 * se comparase consigo mismo y no pudiera ponerse rojo nunca —la leccion «asercion contra su
 * propia fuente», que en este repo ya dejo pasar un tope que la app rechazaba—. Si el defecto
 * del servidor cambiara, el test lo dice; sin el, el conmutador diria «Mas recientes»
 * mientras el listado llega al reves.
 */
export const DIRECCION_ORDEN_INICIAL_HISTORIAL: DireccionOrden = "desc";

/**
 * Nombre accesible del grupo de botones. La barra tiene ADEMAS un filtro llamado «Fecha» (el
 * rango del calendario), asi que el verbo es lo que los distingue para quien navega con
 * lector de pantalla: uno ACOTA por fecha, este ORDENA por ella.
 */
export const ETIQUETA_ORDEN_HISTORIAL = "Ordenar por fecha";

/** Las dos opciones, con el sentido en el TEXTO y no solo en una flecha (356). */
export const OPCIONES_ORDEN_HISTORIAL: readonly SegmentedOption<DireccionOrden>[] =
  OPCIONES_ORDEN_CREACION;

/** El ordenamiento vigente, tal como lo espera el contrato del listado. */
export function ordenamientoHistorial(
  sortDir: DireccionOrden,
): OrdenamientoListado<HistorialSortField> {
  return { sortBy: CAMPO_ORDEN_HISTORIAL, sortDir };
}
