// FICHA 356 — EL CONTROL DE ORDEN POR FECHA DE CREACION, EN DECLARACIONES.
//
// La ficha 352 llevo el ordenamiento hasta la consulta (`sortBy`/`sortDir` en
// `listarOrdenes`, `prioridad DESC` delante y el desempate por `id`), pero NUNCA construyo la
// interfaz. Dicho por el humano el 2026-09-02: «no veo un boton con el cual organizar los
// datos de las tablas por su fecha de creacion, que fue lo que finalmente te pedi». Una
// capacidad sin control no existe para quien la pidio.
//
// Este modulo es solo DATOS: las dos opciones, sus etiquetas, el nombre accesible del grupo y
// la nota de la prioridad. No renderiza —lo hace `SegmentedToggle`, el conmutador que ya usan
// el portal del mensajero y la pantalla de cierres— y no guarda estado. Vive aqui, junto a la
// pantalla, por el mismo motivo que `ordenes-filtros-def.ts`: lo especifico de `/ordenes` no
// sube a `components/shared`.

import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";

import type { SegmentedOption } from "@/components/shared/SegmentedToggle";
import type { SortField } from "@/lib/types/orden";
import type {
  DireccionOrden,
  OrdenamientoListado,
} from "@/lib/types/ordenamiento-listado";

/**
 * El UNICO campo que este control ordena. La lista blanca del backend admite tres
 * (`created_at`, `num_guia`, `num_remision`), pero lo pedido —y lo medido como faltante— es la
 * fecha de creacion. Ofrecer los otros dos sin que nadie los haya pedido llenaria la barra de
 * opciones que nadie eligio; el dia que se pidan, el contrato ya los acepta y esto pasa a ser
 * una segunda dimension del mismo control.
 */
export const CAMPO_ORDEN_CREACION: SortField = "created_at";

/**
 * Direccion con la que arranca la pantalla: la MISMA que el default del contrato
 * (`listarOrdenesSchema`, pedido humano del 2026-08-19 «de la mas nueva a la mas antigua»).
 *
 * Se declara aqui como literal y NO se deriva del schema a proposito: asi la pantalla y el
 * servidor son dos fuentes independientes que un test compara
 * (`tests/unit/components/ordenamiento-creacion.test.ts`). Derivarla haria que el test se
 * comparase consigo mismo y no pudiera ponerse rojo nunca. Si el default del servidor cambia,
 * ese test lo dice; sin el, la barra diria «Mas recientes» mientras el listado llega al reves.
 */
export const DIRECCION_ORDEN_INICIAL: DireccionOrden = "desc";

/**
 * Nombre accesible del grupo de botones. La barra tiene ADEMAS un filtro llamado «Fecha de
 * creacion» (el rango de `FilterComponent`), asi que el verbo es lo que distingue a los dos
 * para quien navega con lector de pantalla: uno ACOTA por fecha, este ORDENA por ella.
 */
export const ETIQUETA_ORDEN_CREACION = "Ordenar por fecha de creación";

/**
 * Las dos opciones, con el sentido en el TEXTO y no solo en una flecha. «Mas recientes» /
 * «Mas antiguas» dice que va a pasar; una flecha sola obliga a pulsarla para averiguarlo, y
 * `asc`/`desc` es vocabulario del servidor. Los iconos acompanan, no informan solos.
 *
 * El conmutador ENSENA las dos: la opcion que no esta puesta sigue a la vista, que es
 * justamente lo que faltaba —«no veo un boton»—. Un desplegable de dos valores esconde la
 * mitad del control detras de un clic.
 */
export const OPCIONES_ORDEN_CREACION: readonly SegmentedOption<DireccionOrden>[] = [
  { valor: "desc", etiqueta: "Más recientes", Icono: ArrowDownWideNarrow },
  { valor: "asc", etiqueta: "Más antiguas", Icono: ArrowUpNarrowWide },
];

/**
 * LA NOTA QUE EVITA QUE EL CONTROL PAREZCA ROTO.
 *
 * El servidor ordena `prioridad DESC` ANTES del criterio elegido (feature 101/R6, decision de
 * producto previa y vigente: una orden prioritaria tiene que flotar a la primera pagina, no
 * quedarse atrapada en la 2). Es correcto, pero se LEE como un fallo: se pide «mas antiguas»,
 * arriba aparecen las prioritarias —que pueden ser de hoy— y la conclusion natural es que el
 * boton no hizo nada.
 *
 * Por eso el aviso NO es permanente: solo se pinta cuando la pagina visible trae al menos una
 * orden prioritaria, que es el unico caso en que el fenomeno se puede observar. En el resto de
 * los listados `prioridad` es `false` en todas las filas y el desempate booleano no mueve
 * nada; anunciar ahi una regla invisible seria ruido que ademas obliga a preguntar «¿que es
 * una prioritaria?».
 */
export const NOTA_PRIORIDAD =
  "Las órdenes prioritarias se muestran primero; el resto sigue el orden por fecha de creación.";

/** El ordenamiento vigente, tal como lo espera el contrato del listado. */
export function ordenamientoCreacion(
  sortDir: DireccionOrden,
): OrdenamientoListado<SortField> {
  return { sortBy: CAMPO_ORDEN_CREACION, sortDir };
}
