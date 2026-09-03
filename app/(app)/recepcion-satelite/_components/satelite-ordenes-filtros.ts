import type { FilterDef, FilterSelection } from "@/components/shared/FilterComponent";
import {
  ESTADOS_BODEGA_SATELITE,
  type EstadoBodegaSatelite,
} from "@/lib/utils/estados-bodega-satelite";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";
import type { SalioARepartoValor } from "@/lib/types/orden";
import type { OrderStatusLiteRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import {
  CLAVE_BUSQUEDA,
  construirFiltrosOrdenes,
} from "@/app/(app)/ordenes/_components/ordenes-filtros-def";
import { filtroEstado } from "@/app/(app)/ordenes/_components/filtro-estado-def";
import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import { seleccionAFilter } from "@/app/(app)/ordenes/_components/seleccion-a-filter";

// Barra de filtros del listado de la bodega satélite (pedido humano: "el mismo diseño
// que en el admin"). Declaración PURA de los filtros que ofrece `FilterComponent`,
// separada del componente para poder probarla sin montar nada.
//
// FICHA 355 (2026-09-02) — EL FILTRO DE ESTADO PASA A SER EL DE LA CENTRAL.
//
// Aquí decía: «El filtro de ESTADO se limita a los estados que el adminSatelite ve en su
// pantalla; ofrecer el catálogo completo de estatus mentiría (ninguna orden suya puede estar
// en `entregada`)». El humano puso las dos capturas lado a lado y pidió lo contrario: «las
// satélite deberían poder filtrar por estado igual que la central, solo que con sus órdenes
// nada más». Así que el control se monta ahora con `filtroEstado`, la MISMA declaración de
// `/ordenes`: mismas opciones (del catálogo `order_status`), mismas etiquetas y mismos textos.
//
// Lo que NO cambia, y es lo que sostiene la ficha: el ALCANCE. La selección sigue INTERSECANDO
// la lista blanca de los cinco estados y no puede ampliarla nunca (`estadosDelListado`, en el
// servicio); un `entregada` elegido aquí no trae entregadas, no trae nada. Ver
// `seleccionAFiltroSatelite`, que es donde esa intersección se hace del lado del cliente, y la
// nota sobre por qué el vacío se explica en pantalla en vez de esconder la opción.
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
 * Sigue siendo propia —`/ordenes` emite `status_id` (el id de catálogo) y esta barra emite
 * `estado` (el `value`), porque es lo que espera `listarOrdenesBodegaPaginado` y lo que valida
 * su `z.enum`—, pero YA NO es una declaración aparte: el control lo declara `filtroEstado`, y
 * la clave es sólo el sobre en el que viaja la selección.
 */
export const CLAVE_ESTADO = "estado";

/*
 * ── FICHA 355: AQUÍ VIVÍAN `ETIQUETA_ESTADO` Y `ESTADOS_SATELITE` ────────────────────────────
 *
 * Un `Record` con los cinco nombres propios de esta pantalla —«Recibidas», «Asignadas (por
 * recoger)», «Por devolver», «En tránsito a central», «Devueltas»— y la lista de opciones
 * construida sobre él. Los dos se RETIRAN.
 *
 * El motivo no es que estuvieran mal escritos, sino que eran un SEGUNDO nombre para un estado
 * que ya tenía el suyo: `en_bodega_satelite` se llamaba «Recibidas» aquí y «En bodega satélite»
 * en `/ordenes`, y el humano lo señaló con las dos pantallas delante. Las etiquetas salen ahora
 * de `ORDER_STATUS_LABELS` vía `estatusLabel`, el mismo mapa que pinta el chip de cada fila de
 * esta misma tabla desde la ficha 349.
 *
 * Lo que se pierde con eso está medido y se acepta: los nombres viejos decían el ROL del estado
 * dentro del flujo de la bodega («Asignadas (por recoger)» es más explícito que «Por recoger»).
 * A cambio, el desplegable, el chip de la fila y la pantalla del maestro dicen todos lo mismo.
 */

/** `value` de cada estado del listado, para acotar tipos y validar la selección. */
export type EstadoSatelite = EstadoBodegaSatelite;

/**
 * Etiqueta legible de un estado; el propio value si el catálogo no lo conoce.
 *
 * FICHA 355: es `estatusLabel` —el catálogo compartido— y ya no un mapa propio. Se conserva la
 * función (y no se llama a `estatusLabel` desde el componente) porque su firma es la del
 * listado: un `value` que SIEMPRE existe, sin el caso `null` que aquel resuelve con «—».
 */
export function etiquetaEstado(value: string): string {
  return estatusLabel(value);
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
 * Lo que SE AÑADE por la ficha 370: «Salida a reparto» (`incluirSalioAReparto: true`). Es la
 * MISMA declaración de la central, con las mismas tres opciones, y aquí es donde de verdad hace
 * falta: las órdenes que sólo tienen la guía generada están casi todas en bodegas satélite.
 *
 * Lo que SE AÑADE: el filtro de ESTADO, delante del resto — la misma posición que ocupa en
 * `/ordenes`. FICHA 355: ya no son «los cinco estados de esta pantalla» sino el catálogo
 * `order_status` entero, declarado por `filtroEstado`. Las opciones llegan por parámetro
 * (`estatus`) porque el catálogo lo pide el componente con SWR, igual que en `/ordenes`; sin
 * él —el primer render, o un fallo de la lectura— el control se declara con cero opciones, que
 * es lo mismo que hace la central mientras su catálogo viaja.
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
  opts?: {
    /** Catálogo `order_status` para el desplegable de estado (`listarOrderStatus`). */
    estatus?: readonly OrderStatusLiteRow[] | null;
    ahora?: Date;
  },
): FilterDef[] {
  const declarados = construirFiltrosOrdenes(catalogo, {
    incluirZona: false,
    incluirTienda: false,
    incluirReasignables: false,
    // FICHA 370: aquí SÍ. Medido el día de la ficha, 44 de las 48 órdenes que sólo tienen la
    // guía generada están en bodegas satélite (contra 2 de 21 en la central), así que ésta es
    // la pantalla donde la pregunta se hace de verdad. No es una clave de alcance: PARTE lo
    // que el adminSatelite ya puede ver —su bodega—, no lo ensancha, y el servicio la atiende
    // en los tres caminos del listado (página, descarga y vigencia de la selección).
    incluirSalioAReparto: true,
    ahora: opts?.ahora,
  }).filter((f) => f.key !== CLAVE_BUSQUEDA);

  return [
    // FICHA 355: la MISMA declaración que monta `/ordenes`. Lo único propio es la clave y el
    // `valor: "value"` —lo que esta Server Action espera—; etiqueta, textos, orden y opciones
    // salen del módulo compartido y no pueden divergir de los de la central.
    filtroEstado(opts?.estatus, { key: CLAVE_ESTADO, valor: "value" }),
    ...declarados,
  ];
}

/**
 * Los filtros tal como los pide la Server Action paginada (T K.1). Clave AUSENTE significa
 * «todos», igual que un desplegable sin nada marcado.
 */
export interface FiltroBodegaSatelite {
  /**
   * Estados elegidos, YA INTERSECADOS con los cinco del listado.
   *
   * ⚠️ FICHA 355 — la lista VACÍA no significa «todos», significa NADA, y por eso este filtro
   * NO se le pasa al servidor tal cual: el borde trata `estados: []` igual que la clave
   * ausente (`estadosDelListado([])` devuelve los cinco), así que enviarlo diría «todas» justo
   * cuando el usuario pidió lo contrario. Quien la produce es `seleccionAFiltroSatelite`
   * —selección no vacía cuya intersección con la lista blanca queda en cero, p. ej. sólo
   * `entregada`— y quien la atiende es `filtroSinResultados`, que corta la consulta antes de
   * salir. Ausente ⇒ sin filtro de estado; con elementos ⇒ ésos y sólo ésos.
   */
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
  /**
   * FICHA 370 — «salida a reparto»: la MISMA clave pública y los MISMOS dos valores que
   * `/ordenes` (`SALIO_A_REPARTO_VALORES`), y la misma semántica de ausencia (no filtra,
   * salen los dos grupos). Viaja ESCALAR, no como lista, y la produce `seleccionAFilter`
   * —la traducción compartida—, no una rama propia de esta barra.
   */
  salio_a_reparto?: SalioARepartoValor;
}

/** `true` si el valor es uno de los cinco estados del listado. */
function esEstadoDelListado(value: string): value is EstadoBodegaSatelite {
  return (ESTADOS_BODEGA_SATELITE as readonly string[]).includes(value);
}

/**
 * FICHA 355 — los estados ELEGIDOS que este listado no puede devolver nunca.
 *
 * Desde que el desplegable ofrece el catálogo entero, elegir `entregada` es posible y da
 * cero: la orden entregada ya salió de la bodega. Esta función nombra esos estados para que
 * la pantalla pueda EXPLICAR el vacío en vez de dejarlo pasar por un fallo. Devuelve los
 * `value` crudos; la etiqueta la pone `etiquetaEstado`.
 */
export function estadosFueraDelListado(seleccion: FilterSelection): string[] {
  return (seleccion[CLAVE_ESTADO] ?? []).filter(
    (value) => !esEstadoDelListado(value),
  );
}

/**
 * Traduce la selección de la barra al input de la Server Action.
 *
 * Pedido humano (2026-08-19): todo lo que esta barra comparte con `/ordenes` lo traduce
 * `seleccionAFilter`, la MISMA función que usa allí — incluido lo que no es una identidad: la
 * clave posicional del calendario (`[atajo, desde, hasta]`) que se abre en `created_preset` o
 * en `created_desde`/`created_hasta`, y el término, que baja de lista a escalar. Aquí sólo
 * queda lo propio: los ESTADOS.
 *
 * LA INTERSECCIÓN, que es el corazón de la ficha 355 y no se toca: la selección se CRUZA con
 * los cinco estados del listado y nunca los amplía. Ya era así —el borde los valida con
 * `z.enum` y un valor ajeno tumbaría la consulta entera en vez de ignorarse— pero antes era una
 * precaución teórica, porque el desplegable sólo ofrecía los cinco. Ahora ofrece el catálogo
 * entero, así que la intersección se ejecuta de verdad en cada selección.
 *
 * Y CON ELLA, EL CASO QUE ANTES NO EXISTÍA: que la intersección quede VACÍA con una selección
 * que no lo estaba (elegir sólo `entregada`). Eso NO puede caer a «todos» —sería convertir el
 * listado en una ventana al resto de las órdenes de la zona, exactamente lo contrario de lo
 * que el usuario pidió—, así que se emite `estados: []`, la marca de «nada puede casar», y
 * `filtroSinResultados` corta la consulta. Con la lista de opciones anterior este camino era
 * inalcanzable desde la UI, pero NO desde la URL: `?estado=entregada` ya llegaba aquí, y como
 * el valor no estaba declarado, `seleccionDesdeUrl` lo descartaba y el listado salía COMPLETO.
 *
 * Una lista vacía de las claves COMPARTIDAS se OMITE en vez de viajar como `[]`, para que «sin
 * filtros» tenga una sola clave de caché y siga aprovechando la página que pre-cargó el
 * servidor.
 */
export function seleccionAFiltroSatelite(
  seleccion: FilterSelection,
): FiltroBodegaSatelite {
  const compartidos: FilterSelection = { ...seleccion };
  delete compartidos[CLAVE_ESTADO]; // la unica clave que `seleccionAFilter` no conoce
  const filtro = seleccionAFilter(compartidos) as FiltroBodegaSatelite;
  const elegidos = seleccion[CLAVE_ESTADO] ?? [];
  if (elegidos.length > 0) filtro.estados = elegidos.filter(esEstadoDelListado);
  return filtro;
}

/**
 * FICHA 355 — `true` si el filtro NO PUEDE devolver ninguna fila, y por tanto no hay ninguna
 * consulta que hacer.
 *
 * Hoy tiene una sola causa: el usuario eligió estados y ninguno es de este listado. La
 * consulta se corta EN EL CLIENTE, y eso sólo puede quitar filas, nunca añadirlas —el alcance
 * lo sigue imponiendo el servicio, acotado a la zona y a los cinco estados—. Si algún día este
 * corte se olvidara, el peor caso sería enseñar las órdenes de la bodega en vez de ninguna: el
 * borde nunca deja salir de ahí.
 */
export function filtroSinResultados(filtro: FiltroBodegaSatelite): boolean {
  return filtro.estados !== undefined && filtro.estados.length === 0;
}

/**
 * Clave ESCALAR y estable del filtro, para la caché de SWR: dos selecciones equivalentes
 * (en distinto orden o de distinta identidad de objeto) comparten caché en vez de
 * refetchear en cada render. Molde: `serializarFiltro` de `/ordenes` (feature 144).
 *
 * FICHA 355: `{ estados: [] }` serializa a `"estados="`, que NO es `FILTRO_SATELITE_VACIO`
 * (`""`). Importa: si las dos claves colisionaran, la selección imposible reutilizaría la
 * página sin filtros que pre-cargó el servidor y el listado saldría entero.
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
