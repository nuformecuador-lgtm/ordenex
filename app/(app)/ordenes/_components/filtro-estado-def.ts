import type {
  FilterDef,
  FilterOption,
} from "@/components/shared/FilterComponent";
import type { OrderStatusLiteRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

import { estatusLabel } from "./estatus-label";

/*
 * FICHA 355 (2026-09-02) — EL FILTRO DE ESTADO, DECLARADO UNA SOLA VEZ.
 *
 * Pedido humano, con las dos pantallas delante: «quiero que veas la diferencia del filtro de
 * estados: esto es lo que filtra la central y esto lo que filtran las satélite. Las satélite
 * deberían poder filtrar por estado igual que la central, solo que con sus órdenes nada más».
 * Y su criterio general: «los filtros de las órdenes de la central son los que están casi
 * perfectos» — la central es el patrón, no al revés.
 *
 * Lo que divergía, medido en el código antes de esta ficha:
 *
 *   |                 | `/ordenes` (central)          | `/recepcion-satelite`         |
 *   |-----------------|-------------------------------|-------------------------------|
 *   | opciones        | catálogo `order_status`       | `ESTADOS_BODEGA_SATELITE` (5) |
 *   | etiquetas       | `ORDER_STATUS_LABELS`         | un `Record` propio            |
 *   | buscador        | «Filtrar estados…»            | «Buscar…» (el default)        |
 *   | resumen         | «Todos»                       | «Todos los estados»           |
 *   | sin coincidir   | «Ningún estado coincide»      | «Sin estados»                 |
 *
 * Las etiquetas eran lo grave: `en_bodega_satelite` se llamaba «Recibidas» en una pantalla y
 * «En bodega satélite» en la otra, `por_recoger` era «Asignadas (por recoger)» aquí y «Por
 * recoger» allá. El mismo estado con dos nombres en dos pantallas es justo lo que el humano
 * viene señalando en toda esta tanda de fichas.
 *
 * De ahí este módulo: el control se declara UNA vez —etiqueta, textos y opciones— y lo montan
 * las dos superficies. No es «parecido»: es el mismo. Añadir un estado al catálogo aparece en
 * las dos a la vez, y cambiarle el nombre no puede quedarse a medias.
 *
 * ⚠️ LO QUE ESTE MÓDULO NO HACE, Y ES LO IMPORTANTE: no acota nada. Que el desplegable ofrezca
 * un estado NO amplía lo que un rol alcanza — el recorte real lo impone el servicio, acotado a
 * su zona y a sus estados. En la bodega satélite eso significa que la selección INTERSECA su
 * lista blanca y nunca la amplía (`estadosDelListado`, `lib/utils/estados-bodega-satelite.ts`);
 * aquí sólo se decide QUÉ SE OFRECE.
 *
 * Módulo de PRESENTACIÓN puro: catálogo -> declaración. Sin React, sin fetch, sin dominio.
 */

/** Etiqueta visible del control y su nombre accesible. La MISMA en las dos superficies. */
export const ETIQUETA_ESTADO = "Estado";

/** Resumen del botón cuando no hay nada marcado. */
export const PLACEHOLDER_ESTADO = "Todos";

/**
 * Placeholder del buscador interno del desplegable.
 *
 * Dice SOBRE QUÉ se busca, y por eso no es «Buscar…» a secas: dentro de un panel con seis o
 * siete controles abiertos, una caja que sólo dice «Buscar» se confunde con el buscador de
 * órdenes de arriba. Era una de las tres diferencias que el humano señaló en las capturas.
 */
export const BUSCADOR_ESTADO = "Filtrar estados…";

/** Texto cuando lo tecleado en el buscador interno no casa con ningún estado. */
export const SIN_ESTADOS_COINCIDENTES = "Ningún estado coincide";

/**
 * Exclusión por defecto, por `value`: el borrador transitorio recién sembrado.
 *
 * Es el mismo default que `EXCLUDE_POR_ROL` aplica a un rol sin override
 * (`app/(app)/ordenes/exclude-por-rol.ts`), escrito aquí para que una superficie que monta el
 * control sin pasar `exclude` obtenga exactamente lo que obtiene maestro/admin.
 */
export const EXCLUDE_ESTADO_DEFAULT: readonly string[] = ["pendiente"];

/**
 * Values que el código RECONOCE hoy.
 *
 * La tabla `order_status` conserva values ya RETIRADOS del seed: su migración de retiro sólo
 * borra la fila si nadie la referencia, y el historial pasado —inmutable— la referencia para
 * siempre (caso del estado interno de fulfillment, retirado por la feature 155). Esa fila
 * sobrevive huérfana y ninguna orden viva puede volver a tenerla, así que ofrecerla como filtro
 * sería ofrecer un estado que nunca devuelve nada. El catálogo de la BD manda sobre los ids;
 * `ORDER_STATUS_SEED` manda sobre QUÉ existe.
 *
 * FICHA 355: vivía dentro de `OrdenesListado.tsx`, donde sólo alcanzaba a la central.
 */
const VALUES_VIGENTES: ReadonlySet<string> = new Set(ORDER_STATUS_SEED);

/** Qué se emite como `value` de cada opción: el id de catálogo o el `value` del estado. */
export type ValorDeEstado = "id" | "value";

export interface OpcionesEstadoOpts {
  /**
   * Qué viaja en la selección.
   *
   * `/ordenes` emite el **id** de catálogo (`filter.status_id`, lo que espera `listarOrdenes`);
   * la bodega satélite emite el **value** (`estados`, lo que espera `listarOrdenesBodegaPaginado`
   * y valida su `z.enum`). Es la única diferencia entre las dos superficies y por eso es un
   * parámetro explícito y cerrado, no una función que cada llamador escriba a su manera.
   */
  valor?: ValorDeEstado;
  /** Estados que NO se ofrecen, por `value`. Default: `EXCLUDE_ESTADO_DEFAULT`. */
  exclude?: readonly string[];
}

/**
 * Los estados OFRECIBLES: catálogo − retirados − `exclude`, en el orden determinista del
 * catálogo (R5 de la feature 63). Un estado que no figure en `exclude` AUTO-APARECE.
 *
 * Se exporta aparte de `filtroEstado` porque `/ordenes` necesita las filas (no las opciones)
 * para traducir el id marcado de vuelta a su `value` y decidir columnas.
 */
export function estadosOfrecidos(
  catalogo: readonly OrderStatusLiteRow[] | null | undefined,
  exclude: readonly string[] = EXCLUDE_ESTADO_DEFAULT,
): OrderStatusLiteRow[] {
  return (catalogo ?? []).filter(
    (s) => VALUES_VIGENTES.has(s.value) && !exclude.includes(s.value),
  );
}

/** Las opciones del desplegable, con la etiqueta del catálogo compartido. */
export function opcionesEstado(
  catalogo: readonly OrderStatusLiteRow[] | null | undefined,
  opts: OpcionesEstadoOpts = {},
): FilterOption[] {
  return estadosOfrecidos(catalogo, opts.exclude).map((s) => ({
    value: opts.valor === "value" ? s.value : s.id,
    // La etiqueta sale de `ORDER_STATUS_LABELS` vía `estatusLabel`, el MISMO mapa que pinta el
    // chip de la tabla: el desplegable y la fila no pueden llamar distinto al mismo estado.
    label: estatusLabel(s.value),
  }));
}

export interface FiltroEstadoOpts extends OpcionesEstadoOpts {
  /** Clave con la que la selección viaja: `status_id` en `/ordenes`, `estado` en la bodega. */
  key: string;
}

/**
 * El control de ESTADO tal cual lo monta `FilterComponent`. Mismo `kind`, mismos textos y
 * mismas opciones en cualquier superficie que lo declare.
 */
export function filtroEstado(
  catalogo: readonly OrderStatusLiteRow[] | null | undefined,
  opts: FiltroEstadoOpts,
): FilterDef {
  return {
    key: opts.key,
    label: ETIQUETA_ESTADO,
    kind: "multi",
    placeholder: PLACEHOLDER_ESTADO,
    searchPlaceholder: BUSCADOR_ESTADO,
    emptyMessage: SIN_ESTADOS_COINCIDENTES,
    options: opcionesEstado(catalogo, opts),
  };
}
