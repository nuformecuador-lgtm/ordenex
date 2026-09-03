import type { FilterDef } from "@/components/shared/FilterComponent";
import {
  ACCION_LABELS,
  CATEGORIAS_ACCION,
  CATEGORIA_LABELS,
  ENTIDAD_LABELS,
  HISTORIAL_ACCION_ENTIDADES,
  HISTORIAL_ACCION_TIPOS,
  type ActorHistorialDTO,
} from "@/lib/types/historial-accion";
import { BUSQUEDA_MIN_CHARS } from "@/lib/types/orden";
import { ultimosNDiasCalendarioCR } from "@/lib/utils/fecha-cr";

import { ATAJOS_CREACION } from "@/app/(app)/ordenes/_components/ordenes-filtros-def";

// FICHA 362 / T5.3 (design §5.2, R28/R29/R32) — declaracion de los CINCO filtros de la barra
// del historial de acciones, mas el campo de busqueda libre.
//
// Funcion PURA: catalogo -> declaraciones. El componente generico
// (`components/shared/FilterComponent.tsx`) no sabe que es una categoria ni que es una
// entidad; aqui se declara, y en `seleccion-a-filtro.ts` se traduce lo que el usuario elige
// al `filtro` que valida el borde. Es el mismo reparto que en `/ordenes` y que en el
// historico de conversaciones (321/T5.1), y es lo que hace que esta barra NO sea una barra
// nueva: las piezas que la pintan son `BuscadorFiltros` + `FilterComponent`, las de siempre.
//
// LAS ETIQUETAS NO SE ESCRIBEN AQUI. `ACCION_LABELS`, `CATEGORIA_LABELS` y `ENTIDAD_LABELS`
// se IMPORTAN del contrato (`lib/types/historial-accion.ts`), que es la misma fuente que usa
// el servidor para congelar `accionLabel` en la fila. Copiarlas aqui produciria el fallo mas
// desconcertante posible en un registro de auditoria: el filtro diciendo una cosa y la fila
// que devuelve, otra.
//
// Lo que esta barra NO tiene, y es deliberado:
//   - ningun `dependsOn`: `categoria` y `accion` se INTERSECAN en el servidor (R17), no se
//     encadenan en el control. Encadenarlas escondera las acciones al elegir una categoria y
//     volveria imposible pedir «cualquier accion de estas dos categorias»;
//   - ningun interruptor de escritura: la pantalla es SOLO LECTURA (R21).

/** Clave del BUSCADOR libre. Viaja ESCALAR al `filtro`, nunca como lista. */
export const CLAVE_BUSQUEDA = "q";

/** Clave del filtro por CATEGORIA (R29). Lista; el servidor la traduce a `accion IN (…)`. */
export const CLAVE_CATEGORIA = "categoria";

/** Clave del filtro por TIPO DE ACCION (R29). Lista de los 42 tipos. */
export const CLAVE_ACCION = "accion";

/** Clave del filtro por ACTOR (R29). Lista de ids del catalogo de actores. */
export const CLAVE_ACTOR = "actor_id";

/** Clave del filtro por TIPO DE ENTIDAD (R29). Lista de las 17 entidades. */
export const CLAVE_ENTIDAD = "entidad_tipo";

/** Clave del filtro de FECHA (R29). Posicional `[atajo, desde, hasta]`, como en `/ordenes`. */
export const CLAVE_FECHA = "fecha";

/**
 * Las CINCO claves que el selector ofrece, EN SU ORDEN (design §5.2). Se exporta para que la
 * prueba las afirme con `toEqual` contra esta lista y no contra una copia escrita en el test:
 * retirar un filtro de la barra tiene que poner el caso rojo (R29), no cambiar dos sitios a
 * la vez.
 *
 * `q` NO esta: la busqueda libre es el CAMPO de la barra, no un filtro que se pide (leccion
 * de la 321).
 */
export const CLAVES_OFRECIDAS = [
  CLAVE_CATEGORIA,
  CLAVE_ACCION,
  CLAVE_ACTOR,
  CLAVE_ENTIDAD,
  CLAVE_FECHA,
] as const;

/**
 * Que se puede teclear en el buscador. El placeholder ES la documentacion del control
 * (leccion de la 321): R31 exige que la busqueda alcance EXACTAMENTE lo que este texto
 * enumera y nada mas, asi que cambiarlo sin cambiar el servidor es prometer de mas.
 *
 * Lo que alcanza, segun `design.md §4.5`: el nombre del actor (congelado en la fila Y el
 * vivo de la relacion) y la etiqueta congelada de la entidad, que es donde viven la guia, la
 * remision y los nombres de zona/tarifa/plantilla. Lo que NO alcanza: nada del destinatario
 * (R5: en esta tabla no hay ni un dato de cliente), y por eso el texto no lo nombra.
 */
export const PLACEHOLDER_BUSQUEDA = "Persona, guía, remisión o nombre de lo afectado";

/** Placeholder del filtro de fecha, mismo texto que la barra de ordenes. */
export const PLACEHOLDER_FECHA = "Cualquier fecha";

/**
 * Declara el campo de busqueda y los cinco filtros de la barra del historial.
 *
 * @param actores Catalogo ya autorizado por su servicio (`obtenerCatalogoActoresHistorial`).
 *   Un catalogo vacio declara el filtro IGUAL, con `options: []` (R64 de la 144).
 * @param opts.ahora Instante desde el que se calculan los rangos de los atajos. Inyectable
 *   para poder fijarlos en los tests; en produccion es `new Date()`.
 */
export function construirFiltrosHistorialAcciones(
  actores: readonly ActorHistorialDTO[],
  opts: { ahora?: Date } = {},
): FilterDef[] {
  const ahora = opts.ahora ?? new Date();

  return [
    {
      // R32: `minChars` sale de la MISMA constante que valida el borde
      // (`filtroHistorialAccionSchema.q` usa `BUSQUEDA_MIN_CHARS` de `lib/types/orden.ts`).
      // Si el minimo cambiara alli, el control dejaria de mandar terminos que el servidor ya
      // rechazaba SIN tocar esta linea. Escribir un `3` aqui es exactamente la mutacion que
      // R32 prohibe.
      key: CLAVE_BUSQUEDA,
      label: "Buscar",
      kind: "text",
      minChars: BUSQUEDA_MIN_CHARS,
      placeholder: PLACEHOLDER_BUSQUEDA,
    },
    {
      // PRIMERO del selector, y no por orden alfabetico: la categoria es la pregunta que
      // trae a alguien a esta pantalla («que movio dinero», «que se hizo desaparecer»).
      // Tres opciones, sin buscador.
      key: CLAVE_CATEGORIA,
      label: "Categoría",
      kind: "multi",
      options: CATEGORIAS_ACCION.map((c) => ({ value: c, label: CATEGORIA_LABELS[c] })),
    },
    {
      // 42 opciones: con buscador, o se vuelve una lista para bajar con la rueda.
      key: CLAVE_ACCION,
      label: "Acción",
      kind: "multi",
      searchPlaceholder: "Buscar acción…",
      options: HISTORIAL_ACCION_TIPOS.map((t) => ({ value: t, label: ACCION_LABELS[t] })),
    },
    {
      // ⚠️ Los nombres son los VIVOS, no los congelados en la fila (impl_362 §7.5): si
      // alguien se corrige el apellido, el filtro lo ofrece con el nuevo y las filas viejas
      // siguen mostrando el de entonces. Es lo correcto —un selector no es historia— pero
      // conviene saberlo al leer una fila que no coincide con la opcion que se marco.
      key: CLAVE_ACTOR,
      label: "Persona",
      kind: "multi",
      searchPlaceholder: "Buscar persona…",
      options: actores.map((a) => ({ value: a.id, label: a.nombre })),
    },
    {
      key: CLAVE_ENTIDAD,
      label: "Tipo",
      kind: "multi",
      searchPlaceholder: "Buscar tipo…",
      options: HISTORIAL_ACCION_ENTIDADES.map((e) => ({
        value: e,
        label: ENTIDAD_LABELS[e],
      })),
    },
    {
      // UN solo control de tiempo, con los atajos dentro del propio calendario.
      // `ATAJOS_CREACION` y `ultimosNDiasCalendarioCR` se IMPORTAN, no se reescriben: dos
      // tablas de atajos gemelas divergirian en silencio (misma leccion que A5 de la 129 y
      // que la barra del historico de conversaciones).
      key: CLAVE_FECHA,
      label: "Fecha",
      kind: "dateRange",
      placeholder: PLACEHOLDER_FECHA,
      options: ATAJOS_CREACION.map((a) => ({
        value: a.value,
        label: a.label,
        defaultRange: ultimosNDiasCalendarioCR(a.dias, ahora),
      })),
    },
  ];
}
