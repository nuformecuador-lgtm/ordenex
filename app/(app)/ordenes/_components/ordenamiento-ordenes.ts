// FICHA 356 + FICHA 423 — EL CONTROL DE ORDEN DE `/ordenes`, EN DECLARACIONES.
//
// La 352 llevo el ordenamiento hasta la consulta (`sortBy`/`sortDir` en `listarOrdenes`,
// `prioridad DESC` delante y el desempate por `id`). La 356 construyo el control, pero con UNA
// sola dimension —la direccion— y lo dejo escrito: «el dia que se pidan [los otros campos], el
// contrato ya los acepta y esto pasa a ser una segunda dimension del mismo control». Ese dia
// llego: pedido humano del 2026-09-14, «en las tablas de ordenes quieren ordenar las columnas
// no solo por antiguedad sino tambien por numero de remision».
//
// POR QUE ESTE ARCHIVO SE LLAMA ASI Y NO `ordenamiento-creacion`. El nombre viejo pasaria a
// mentir el mismo dia que el modulo declarase tambien la remision, y un archivo cuyo nombre
// miente es la forma barata de que el siguiente agente monte un tercer modulo paralelo. No se
// llama `ordenamiento-listado` para no colisionar de un vistazo con
// `lib/types/ordenamiento-listado`, que es OTRA cosa: el contrato compartido.
//
// Sigue siendo un modulo de DATOS: las opciones, sus etiquetas, los nombres accesibles de los
// dos grupos y las dos notas de la tabla. No renderiza —lo hace `SegmentedToggle`, el
// conmutador que ya usan el portal del mensajero, la pantalla de cierres y el registro del
// historico— y no guarda estado. Vive junto a la pantalla por el mismo motivo que
// `ordenes-filtros-def.ts`: lo especifico de `/ordenes` no sube a `components/shared`.

import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CalendarDays,
  Hash,
} from "lucide-react";

import type { SegmentedOption } from "@/components/shared/SegmentedToggle";
import type { SortField } from "@/lib/types/orden";
import type {
  DireccionOrden,
  OrdenamientoListado,
} from "@/lib/types/ordenamiento-listado";

/**
 * Los campos que este control OFRECE, como tipo.
 *
 * Se escribe con `Extract` sobre `SortField` y no como una union suelta a proposito: si alguna
 * de las dos claves saliera de la lista blanca del servidor, esto se volveria `never` y el
 * build lo dice. Una union suelta seguiria compilando y la pantalla pediria un `sortBy` que el
 * borde rechaza con `validation_error` — la tabla entera en error, por un literal huerfano.
 *
 * `num_guia` esta en `SORT_FIELDS` y NO se ofrece: nadie lo ha pedido (R1).
 */
export type CampoOrdenOfrecido = Extract<
  SortField,
  "created_at" | "num_remision"
>;

/**
 * Campo con el que arranca la pantalla, y direccion con la que arranca: los MISMOS defaults
 * del contrato (`listarOrdenesSchema`, pedido humano del 2026-08-19 «de la mas nueva a la mas
 * antigua»). Entrar a `/ordenes` sigue enseñando exactamente el listado de siempre.
 *
 * Se declaran aqui como LITERALES y no se derivan del schema a proposito: asi la pantalla y el
 * servidor son dos fuentes independientes que un test compara
 * (`tests/unit/components/ordenamiento-ordenes.test.ts`). Derivarlos haria que ese test se
 * comparase consigo mismo y no pudiera ponerse rojo nunca (memoria del repo: «asercion contra
 * su propia fuente»). Si el default del servidor cambia, ese test lo dice; sin el, la barra
 * diria «Mas recientes» mientras el listado llega al reves.
 */
export const CAMPO_ORDEN_INICIAL: CampoOrdenOfrecido = "created_at";
export const DIRECCION_ORDEN_INICIAL: DireccionOrden = "desc";

/**
 * Nombre accesible del grupo de CAMPO. Corto a proposito: lo que ordena lo dicen sus dos
 * botones, que estan a la vista.
 */
export const ETIQUETA_CAMPO_ORDEN = "Ordenar por";

/**
 * LOS DOS CAMPOS, y ninguno mas (R1). Ambos a la vista, sin desplegar nada: un desplegable
 * esconderia la mitad del control detras de un clic, que es exactamente lo que la 356 vino a
 * arreglar («no veo un boton con el cual organizar los datos de las tablas»).
 */
export const OPCIONES_CAMPO_ORDEN: readonly SegmentedOption<CampoOrdenOfrecido>[] =
  [
    { valor: "created_at", etiqueta: "Fecha de creación", Icono: CalendarDays },
    { valor: "num_remision", etiqueta: "Número de remisión", Icono: Hash },
  ];

/**
 * Nombre accesible del grupo de DIRECCION, uno por campo.
 *
 * Son DOS grupos con nombre propio y no uno solo porque son dos decisiones distintas: qué se
 * ordena y en qué sentido. El nombre nombra el campo vigente para que un lector de pantalla
 * anuncie «Dirección del orden por número de remisión → Más altas», que se entiende sin haber
 * oido antes el otro grupo. La barra tiene ADEMAS un filtro llamado «Fecha de creación» (el
 * rango de `FilterComponent`), asi que el verbo sigue siendo lo que distingue a los dos: uno
 * ACOTA por fecha, estos ORDENAN por ella.
 */
export const ETIQUETA_DIRECCION: Record<CampoOrdenOfrecido, string> = {
  created_at: "Dirección del orden por fecha de creación",
  num_remision: "Dirección del orden por número de remisión",
};

/**
 * LAS DIRECCIONES, CON EL TEXTO QUE CORRESPONDE AL CAMPO.
 *
 * El sentido va en el TEXTO y no solo en una flecha: «Mas recientes» dice qué va a pasar; una
 * flecha sola obliga a pulsarla para averiguarlo, y `asc`/`desc` es vocabulario del servidor.
 * Los iconos acompañan, no informan solos.
 *
 * Y para la remision NO se reutiliza el vocabulario temporal, deliberadamente: «Mas recientes»
 * sugeriria que un numero mayor es mas nuevo, y con cuatro series conviviendo en esta base eso
 * es falso —una remision de la serie con letras no es posterior a una puramente numerica solo
 * por tener un numero mas alto—. Se describe el NUMERO, que es lo que el control ordena.
 *
 * La opcion por defecto va PRIMERA en las dos listas: el control abre enseñando, en su sitio
 * de siempre, lo que se esta viendo.
 */
export const OPCIONES_DIRECCION: Record<
  CampoOrdenOfrecido,
  readonly SegmentedOption<DireccionOrden>[]
> = {
  created_at: [
    { valor: "desc", etiqueta: "Más recientes", Icono: ArrowDownWideNarrow },
    { valor: "asc", etiqueta: "Más antiguas", Icono: ArrowUpNarrowWide },
  ],
  num_remision: [
    { valor: "desc", etiqueta: "Más altas", Icono: ArrowDownWideNarrow },
    { valor: "asc", etiqueta: "Más bajas", Icono: ArrowUpNarrowWide },
  ],
};

/**
 * El nombre del campo TAL COMO SE LEE EN UNA FRASE, para la nota de prioridad.
 *
 * Cubre los TRES campos de `SORT_FIELDS` —no los dos ofrecidos— porque quien consume esta nota
 * recibe el ordenamiento del contrato (`OrdenamientoListado<SortField>`), no el estado del
 * conmutador. Nombrar `num_guia` aqui no es ofrecerlo: lo que se ofrece lo dice
 * `OPCIONES_CAMPO_ORDEN` y nada mas. A cambio, el dia que el contrato gane un cuarto campo
 * este `Record` rompe el build en vez de dejar la nota diciendo «undefined».
 */
const NOMBRE_CAMPO_ORDEN: Record<SortField, string> = {
  created_at: "fecha de creación",
  num_guia: "número de guía",
  num_remision: "número de remisión",
};

/**
 * LA NOTA QUE EVITA QUE EL CONTROL PAREZCA ROTO.
 *
 * El servidor ordena `prioridad DESC` ANTES del criterio elegido (feature 101/R6, decision de
 * producto previa y vigente: una orden prioritaria tiene que flotar a la primera pagina, no
 * quedarse atrapada en la 2). Es correcto, pero se LEE como un fallo: se pide «mas antiguas»,
 * arriba aparecen las prioritarias —que pueden ser de hoy— y la conclusion natural es que el
 * boton no hizo nada.
 *
 * FICHA 423 (R14): la nota nombra el campo VIGENTE y ya no la fecha fija. Con el orden por
 * remision puesto, una nota que siguiera diciendo «el resto sigue el orden por fecha de
 * creacion» describiria un listado que no es el que hay delante — y una explicacion falsa es
 * peor que ninguna.
 *
 * El aviso NO es permanente: quien lo monta solo lo pinta cuando la pagina visible trae al
 * menos una orden prioritaria, que es el unico caso en que el fenomeno se puede observar.
 */
export function notaPrioridad(campo: SortField): string {
  return `Las órdenes prioritarias se muestran primero; el resto sigue el orden por ${NOMBRE_CAMPO_ORDEN[campo]}.`;
}

/**
 * FICHA 423 / R20 — EL AVISO DE AGRUPACION POR SERIE.
 *
 * El orden ascendente por remision deja juntas las remisiones que comparten prefijo, y los
 * bloques con letra detras de las puramente numericas. Es correcto y NO es evidente: quien
 * pidio «ordenar por remision» ve primero un bloque de numeros sueltos y despues bloques con
 * letra, y la conclusion natural es que el control hizo algo raro. Es el mismo fenomeno que
 * obligo a escribir la nota de prioridad —un orden correcto que se lee como un fallo— y se
 * resuelve con el mismo criterio.
 *
 * NO ENUMERA las series concretas: cuales hay depende de que haya cargado cada tienda y el
 * censo caducaria solo. Dice el CRITERIO. Y no dice cual va primero, porque eso depende de la
 * direccion puesta y la nota es la misma en las dos.
 */
export const NOTA_AGRUPACION_SERIE =
  "Las remisiones se agrupan por serie: las que comparten prefijo van juntas, y dentro de cada serie manda el número, no el texto.";

/**
 * La serie de una remision: su prefijo, o sea lo que queda al quitarle los digitos del final.
 * `NA-107` → `"NA-"`, `72912` → `""`, `BS-00001` → `"BS-"`.
 *
 * DE DONDE SALE, Y DE DONDE NO. Sale del `numRemision` que `OrdenListItemDTO` YA trae. La base
 * tiene calculada una clave de orden que lleva la serie ya resuelta por Postgres, y mandarla al
 * cliente seria la via obvia — y esta prohibida (R16): convertiria una decision de presentacion
 * en un contrato de datos nuevo, y dejaria sin sentido el `omit` global que existe justamente
 * para que ningun DTO futuro pueda filtrarla. Hay una guardia que pone rojo cualquier archivo
 * de `app/` que la nombre. Con el `numRemision` que ya viaja alcanza de sobra para contar
 * cuantas series distintas hay en una pagina de 25 filas.
 *
 * COSTE ASUMIDO, dicho en voz alta: la regla del prefijo vive en dos sitios —la expresion SQL
 * de la columna generada y esta funcion— y podrian desincronizarse. Se acepta porque hacen
 * cosas DISTINTAS: alla se produce una clave de ORDEN, aqui una etiqueta para CONTAR. No se
 * comparan en ningun punto y un desacuerdo no desordena nada: como mucho pinta o no pinta una
 * linea.
 *
 * La clase de digitos va ENUMERADA y no como rango por simetria con la expresion de la base,
 * donde un rango si depende de la collation. Aqui no cambia el resultado; que las dos se lean
 * igual es lo que hace que un lector pueda compararlas.
 */
export function serieDeRemision(numRemision: string): string {
  return numRemision.replace(/[0123456789]+$/, "");
}

/**
 * El texto del aviso de series, o `undefined` si no hay nada que explicar (R20).
 *
 * Las DOS condiciones, y las dos son mitad del requisito:
 *   · el orden vigente es por numero de remision —con el orden por fecha la agrupacion no
 *     existe, asi que anunciarla seria describir otro listado—;
 *   · la pagina visible trae MAS DE UNA serie —con una sola no hay agrupacion que observar, y
 *     anunciar ahi una regla invisible es ruido que ademas obliga a preguntar «¿que es una
 *     serie?»—.
 *
 * Se calcula sobre las filas que la pagina esta enseñando, no sobre el conjunto: es lo unico
 * que el cliente tiene, y es exactamente el criterio de la nota de prioridad.
 */
export function notaAgrupacionPorSerie(
  campo: SortField,
  remisionesVisibles: readonly string[],
): string | undefined {
  if (campo !== "num_remision") return undefined;
  const series = new Set<string>();
  for (const remision of remisionesVisibles) {
    series.add(serieDeRemision(remision));
    if (series.size > 1) return NOTA_AGRUPACION_SERIE;
  }
  return undefined;
}

/** El ordenamiento vigente, tal como lo espera el contrato del listado. */
export function ordenamientoDe(
  campo: CampoOrdenOfrecido,
  sortDir: DireccionOrden,
): OrdenamientoListado<SortField> {
  return { sortBy: campo, sortDir };
}
