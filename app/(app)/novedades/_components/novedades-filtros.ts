import { CAUSA_DEVOLUCION_LABEL } from "@/app/(app)/mis-asignaciones/_components/causa-devolucion-options";
import type { FilterDef, FilterSelection } from "@/components/shared/FilterComponent";
import { stripDiacritics } from "@/lib/geo/normalize";
import type { NovedadDTO } from "@/lib/types/novedad";
import type { GrupoNovedad } from "@/lib/types/novedad-grupo";
import { soloDigitosSiPareceNumero } from "@/lib/utils/busqueda-orden";

// FICHA 325 — LO ESPECIFICO DE `/novedades` EN LA BARRA DE BUSQUEDA Y FILTROS.
//
// Modulo PURO: sin React, sin DOM, sin Server Actions. Declara QUE se ofrece en cada pestaña y
// APLICA lo elegido sobre un conjunto de novedades. Las dos mitades viven juntas a proposito: la
// unica forma de que un filtro declarado no acote nada es que alguien declare una clave y se olvide
// de aplicarla, y con las dos tablas en el mismo archivo esa omision es un `Record` incompleto que
// no compila (mismo mecanismo que `ACCIONES_POR_GRUPO` usa para el panel de acciones).
//
// ⚠️ POR QUE ESTA PANTALLA NO HEREDA LA BARRA. `/novedades` NO monta un `DataTable` —son cards en
// `<ul>/<li>`, y su propio modulo lo dice—, asi que el control no llega heredado como en los
// consumidores de la tabla: se monta aparte, igual que el `DescargarDatasetButton` que ya vive ahi
// por el mismo motivo. Lo que SI se reusa son los componentes de la casa (`BuscadorFiltros` +
// `FilterComponent`), tal cual, sin variantes.
//
// ⚠️ POR QUE LOS FILTROS NO SON LOS DE `/ordenes`. Aquella barra se declara sobre un CATALOGO del
// servidor (`CatalogoFiltrosOrdenesDTO`: zonas, tiendas, mensajeros y las tres capas de geografia).
// Aqui no hay catalogo —ni se pide uno, que seria backend nuevo— y no hace falta: las opciones se
// derivan DEL PROPIO CONJUNTO cargado, asi que solo se ofrece lo que de verdad existe en la lista
// de esta tienda. Efecto secundario buscado: ninguna opcion lleva a una lista vacia, que es
// precisamente el modo de fallo que esta ficha viene a evitar.
//
// Y una consecuencia de privacidad que conviene dejar escrita: `/ordenes` NO le ofrece al
// `adminTienda` el filtro por mensajero, porque «el directorio de mensajeros es del personal
// interno y el catalogo tampoco se lo entrega». Aqui SI se ofrece, y no es una contradiccion: los
// nombres salen de las propias novedades de SU tienda y la card ya los pinta uno por uno desde la
// ficha 296. No se expone ni un nombre que la pantalla no estuviera mostrando ya.

/** Claves de los filtros de esta pantalla. Union cerrada: es lo que hace exhaustiva la tabla. */
export type ClaveFiltroNovedad =
  | "mensajero"
  | "zona"
  | "provincia"
  | "canton"
  | "causa"
  | "sin_contacto";

export const CLAVE_MENSAJERO = "mensajero" satisfies ClaveFiltroNovedad;
export const CLAVE_ZONA = "zona" satisfies ClaveFiltroNovedad;
export const CLAVE_PROVINCIA = "provincia" satisfies ClaveFiltroNovedad;
export const CLAVE_CANTON = "canton" satisfies ClaveFiltroNovedad;
export const CLAVE_CAUSA = "causa" satisfies ClaveFiltroNovedad;
export const CLAVE_SIN_CONTACTO = "sin_contacto" satisfies ClaveFiltroNovedad;

/**
 * Valor de la opcion «sin dato» de los filtros cuyo campo es NULLABLE. Se necesita un valor
 * porque la salida de `FilterComponent` es siempre una lista de cadenas (R19) y `null` no lo es;
 * sin el, las filas sin mensajero —o sin causa— quedarian fuera del alcance del filtro y por tanto
 * inalcanzables desde la barra.
 *
 * Los dos literales llevan marcas a los lados para que no puedan colisionar con un nombre real de
 * mensajero ni con una etiqueta de causa.
 */
export const SIN_MENSAJERO = "__sin_mensajero__";
export const SIN_CAUSA = "__sin_causa__";

/** Etiqueta visible de esas dos opciones. La de causa es la MISMA que la card pinta. */
export const ETIQUETA_SIN_MENSAJERO = "Sin mensajero asignado";
export const ETIQUETA_SIN_CAUSA = "Sin causa registrada";

/**
 * Que se puede teclear ahi. El placeholder ES la documentacion del buscador: enumera los cinco
 * campos que alcanza, que son exactamente los que las DOS descargas de esta pantalla publican como
 * identidad de la orden (`numGuia`, `numRemision`, `destinatario`, `telefono`, `producto`).
 *
 * No se reusa el de `/ordenes` a pesar de decir casi lo mismo: aquel enumera lo que indexa la
 * columna generada `orden.busqueda_texto`, y atarlos haria que un cambio en ESE indice reescribiera
 * la promesa de esta pantalla, que busca en memoria y no lo consulta.
 */
export const PLACEHOLDER_BUSQUEDA_NOVEDADES =
  "Guía, remisión, teléfono, destinatario o producto";

/**
 * SIN minimo de caracteres, y es una decision.
 *
 * `/ordenes` exige tres porque su `minChars` sale de `BUSQUEDA_MIN_CHARS`, la MISMA constante con
 * la que el borde valida el termino: por debajo de ese minimo el servidor responde
 * `validation_error`, asi que el control no manda lo que ya sabe que va a ser rechazado. Aqui no
 * hay borde que espejar —las acciones de novedades no aceptan ningun termino— y el conjunto ya esta
 * en memoria, asi que un minimo de tres solo conseguiria que teclear una guia de dos digitos no
 * hiciera nada y sin decir por que.
 */
export const BUSQUEDA_MIN_CHARS_NOVEDADES = 0;

/** Rotulos de los controles. Aparte del JSX para que un dia se puedan traducir en un solo sitio. */
export const ETIQUETAS_FILTRO: Record<ClaveFiltroNovedad, string> = {
  mensajero: "Mensajero",
  zona: "Zona",
  provincia: "Provincia",
  canton: "Cantón",
  causa: "Causa de devolución",
  sin_contacto: "Sin intentos de contacto",
};

/** Normalizacion de comparacion: sin acentos y en minusculas. */
function normalizar(texto: string): string {
  return stripDiacritics(texto).toLowerCase();
}

/**
 * Los cinco campos sobre los que busca el campo de texto, concatenados y normalizados.
 *
 * SON LOS QUE LA PANTALLA YA ENSEÑA, ni uno mas: guia, remision, destinatario, telefono y
 * producto. La direccion, las notas y la ubicacion quedan fuera a proposito — son textos largos que
 * generan coincidencias que quien busca no entiende («¿por que sale esta orden si escribi Ana?»).
 *
 * El TELEFONO entra dos veces, tal cual y en su forma solo-digitos, por la misma razon por la que
 * la columna generada de `/ordenes` lo indexa dos veces: el dato puede estar guardado con o sin
 * separadores y quien busca no sabe de que forma.
 */
function textoBuscable(novedad: NovedadDTO): string {
  return normalizar(
    [
      novedad.numGuia === null ? "" : String(novedad.numGuia),
      novedad.numRemision,
      novedad.destinatario,
      novedad.telefonoDest,
      novedad.telefonoDest.replace(/\D/g, ""),
      novedad.producto,
    ].join(" "),
  );
}

/**
 * ¿Esta novedad casa con el termino tecleado? Subcadena en cualquier posicion, sin comodines.
 *
 * Un termino que parece un numero de telefono (digitos y separadores) se prueba TAMBIEN en su forma
 * solo-digitos, para que teclear `8888-0000` encuentre un telefono guardado como `88880000`. Es un
 * añadido, nunca un sustituto: el termino tal cual se sigue probando, que es lo que mantiene viva
 * la busqueda por remision (`REM-2026-0912` no sobrevive a quitarle los guiones).
 */
export function coincideBusqueda(novedad: NovedadDTO, termino: string): boolean {
  const buscado = normalizar(termino.trim());
  if (buscado === "") return true;
  const texto = textoBuscable(novedad);
  if (texto.includes(buscado)) return true;
  const digitos = soloDigitosSiPareceNumero(buscado);
  return digitos !== null && texto.includes(digitos);
}

/**
 * LA TABLA: como acota cada clave. Exhaustiva por `Record<ClaveFiltroNovedad, …>` — una clave nueva
 * en la union no compila hasta que alguien diga que hace, en vez de quedarse como un control que se
 * pinta, se marca y no filtra nada.
 *
 * `sin_contacto` es un INTERRUPTOR y se lee por PRESENCIA de la clave, no por su literal: un
 * `boolean` marcado emite un unico valor y desmarcado hace desaparecer la clave entera (R18/R19 del
 * componente). Comprobar la presencia evita importar `BOOLEAN_MARCADO` desde `FilterComponent`, que
 * es un modulo cliente y arrastraria React entero a este archivo puro.
 */
const PREDICADOS: Record<
  ClaveFiltroNovedad,
  (novedad: NovedadDTO, valores: readonly string[]) => boolean
> = {
  mensajero: (n, v) => v.includes(n.mensajeroNombre ?? SIN_MENSAJERO),
  zona: (n, v) => v.includes(n.zonaNombre),
  provincia: (n, v) => v.includes(n.provinciaNombre),
  canton: (n, v) => v.includes(n.cantonNombre),
  causa: (n, v) => v.includes(n.causa ?? SIN_CAUSA),
  sin_contacto: (n) => n.intentosContacto === 0,
};

/** Las claves de la tabla, para recorrerlas sin escribirlas dos veces. */
const CLAVES = Object.keys(PREDICADOS) as ClaveFiltroNovedad[];

/**
 * ¿Hay algun valor elegido? Una clave presente con lista VACIA no es un filtro puesto: es un
 * control montado y sin marcar, y tratarlo como filtro dejaria la lista vacia en cuanto alguien
 * pidiera «Mensajero» desde el selector sin llegar a elegir a nadie.
 */
export function hayValoresSeleccionados(seleccion: FilterSelection): boolean {
  return CLAVES.some((clave) => (seleccion[clave] ?? []).length > 0);
}

/**
 * Aplica el termino y la seleccion sobre el conjunto. Conserva el ORDEN de entrada: el de la
 * pestaña de ayuda lo decide el servicio (la que lleva mas esperando primero) y filtrar no es
 * reordenar.
 *
 * Las claves se combinan en Y (todas se cumplen) y los valores dentro de una clave en O (cualquiera
 * vale), que es el mismo trato que da la barra de `/ordenes` a su seleccion.
 */
export function filtrarNovedades(
  items: readonly NovedadDTO[],
  termino: string,
  seleccion: FilterSelection,
): NovedadDTO[] {
  const activos = CLAVES.filter((clave) => (seleccion[clave] ?? []).length > 0);
  return items.filter(
    (novedad) =>
      coincideBusqueda(novedad, termino) &&
      activos.every((clave) => PREDICADOS[clave](novedad, seleccion[clave] ?? [])),
  );
}

/** Opcion de un `multi`, tal como la espera `FilterComponent`. */
interface Opcion {
  value: string;
  label: string;
  parentValue?: string;
}

/**
 * Valores distintos de un campo de texto, ordenados por su etiqueta en español. Determinista: dos
 * cargas del mismo conjunto ofrecen las opciones en el mismo orden, asi que los controles no bailan.
 */
function opcionesDe(
  items: readonly NovedadDTO[],
  leer: (novedad: NovedadDTO) => string,
): Opcion[] {
  const vistos = new Set<string>();
  for (const item of items) {
    const valor = leer(item);
    if (valor !== "") vistos.add(valor);
  }
  return [...vistos]
    .sort((a, b) => a.localeCompare(b, "es"))
    .map((valor) => ({ value: valor, label: valor }));
}

/** Opciones de mensajero, con «Sin mensajero asignado» AL FINAL y solo si alguna fila lo esta. */
function opcionesMensajero(items: readonly NovedadDTO[]): Opcion[] {
  const opciones = opcionesDe(items, (n) => n.mensajeroNombre ?? "");
  const haySinAsignar = items.some((n) => n.mensajeroNombre === null);
  return haySinAsignar
    ? [...opciones, { value: SIN_MENSAJERO, label: ETIQUETA_SIN_MENSAJERO }]
    : opciones;
}

/** Cantones ofrecidos, cada uno colgado de su provincia (`parentValue`) para el encadenado. */
function opcionesCanton(items: readonly NovedadDTO[]): Opcion[] {
  const porCanton = new Map<string, string>();
  for (const item of items) {
    if (item.cantonNombre !== "") porCanton.set(item.cantonNombre, item.provinciaNombre);
  }
  return [...porCanton.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "es"))
    .map(([canton, provincia]) => ({
      value: canton,
      label: canton,
      parentValue: provincia,
    }));
}

/**
 * Opciones de causa: solo las presentes en el conjunto.
 *
 * El VALOR emitido es el SLUG del enum y la etiqueta el texto en español (R11 de la 87: la
 * pantalla nunca enseña el slug crudo). Filtrar por la etiqueta funcionaria hoy y se rompería el
 * dia que dos causas compartan texto; el slug es la identidad.
 */
function opcionesCausa(items: readonly NovedadDTO[]): Opcion[] {
  const slugs = new Set<NonNullable<NovedadDTO["causa"]>>();
  let haySinCausa = false;
  for (const item of items) {
    if (item.causa === null) haySinCausa = true;
    else slugs.add(item.causa);
  }
  const opciones = [...slugs]
    .map((slug) => ({ value: slug as string, label: CAUSA_DEVOLUCION_LABEL[slug] }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
  return haySinCausa
    ? [...opciones, { value: SIN_CAUSA, label: ETIQUETA_SIN_CAUSA }]
    : opciones;
}

/**
 * LAS DECLARACIONES DE LA BARRA, por grupo.
 *
 * ⚠️ **QUE ES COMPARTIDO Y QUE ES DE CADA PESTAÑA**, que es la decision de fondo de esta ficha.
 *
 * Compartidos (mensajero + las tres capas de ubicacion) porque los DOS grupos los traen en el DTO y
 * las DOS cards los pintan: en `ayuda` el mensajero es quien pidio la ayuda, en `devolucion` quien
 * trae el paquete de vuelta (ficha 296, en el JSX comun a proposito).
 *
 * `causa` SOLO en `devolucion`: sobre una orden en ayuda la causa es SIEMPRE `null` por contrato
 * (R26 de la 236 — seria la de una devolucion anterior ya deshecha, y prohibe mostrarla e incluso
 * anunciar su ausencia). Declararla ahi seria un control que, marcado, deja la lista vacia siempre.
 *
 * `sin_contacto` SOLO en `ayuda`: `intentosContacto` es «la columna propia de esa pestaña» —lo dice
 * su archivo de descarga— y el boton «+1 intento de contacto» esta declarado unicamente en
 * `ACCIONES_POR_GRUPO.ayuda`. La pestaña de devolucion ni lo pinta ni lo publica, asi que filtrar
 * ahi por un dato invisible dejaria al usuario sin forma de entender el resultado.
 *
 * NO se declara DISTRITO, y `/ordenes` si lo tiene: `distritoNombre` es nullable en el DTO y estas
 * dos listas son colas de excepcion de UNA tienda — provincia y canton ya localizan de sobra, y una
 * tercera capa encadenada sobre un campo que puede faltar añade un modo de fallo por nada.
 *
 * NO hay filtro de FECHA, y por eso `DateRangeFilter` no aparece: `NovedadDTO` (y el
 * `MiAsignacionDTO` que extiende) no traen NI UNA fecha. No es que el control no encaje con una
 * lista de cards —encajaria—, es que no hay dato que filtrar. Ofrecerlo exigiria ampliar el DTO y
 * el servicio, que es backend y otra ficha.
 *
 * `conjunto === null` (todavia no se ha leido el listado completo): se declaran LOS MISMOS filtros,
 * sin opciones y deshabilitados. El selector ofrece siempre lo mismo — una lista que crece bajo el
 * cursor es peor que una que espera— y el control se enciende solo al llegar el conjunto.
 */
export function construirFiltrosNovedades(
  grupo: GrupoNovedad,
  conjunto: readonly NovedadDTO[] | null,
): FilterDef[] {
  const items = conjunto ?? [];
  const cargando = conjunto === null;

  const propios: FilterDef[] =
    grupo === "devolucion"
      ? [
          {
            key: CLAVE_CAUSA,
            label: ETIQUETAS_FILTRO.causa,
            kind: "multi",
            placeholder: "Todas",
            searchPlaceholder: "Buscar causa…",
            emptyMessage: "Ninguna causa coincide",
            options: opcionesCausa(items),
          },
        ]
      : [
          {
            key: CLAVE_SIN_CONTACTO,
            label: ETIQUETAS_FILTRO.sin_contacto,
            kind: "boolean",
          },
        ];

  const filtros: FilterDef[] = [
    {
      key: CLAVE_MENSAJERO,
      label: ETIQUETAS_FILTRO.mensajero,
      kind: "multi",
      placeholder: "Todos",
      searchPlaceholder: "Buscar mensajero…",
      emptyMessage: "Ningún mensajero coincide",
      options: opcionesMensajero(items),
    },
    {
      key: CLAVE_ZONA,
      label: ETIQUETAS_FILTRO.zona,
      kind: "multi",
      placeholder: "Todas",
      searchPlaceholder: "Buscar zona…",
      emptyMessage: "Ninguna zona coincide",
      options: opcionesDe(items, (n) => n.zonaNombre),
    },
    {
      key: CLAVE_PROVINCIA,
      label: ETIQUETAS_FILTRO.provincia,
      kind: "multi",
      placeholder: "Todas",
      searchPlaceholder: "Buscar provincia…",
      emptyMessage: "Ninguna provincia coincide",
      options: opcionesDe(items, (n) => n.provinciaNombre),
    },
    {
      key: CLAVE_CANTON,
      label: ETIQUETAS_FILTRO.canton,
      kind: "multi",
      // La cadena se DECLARA, no se programa: elegida una provincia, el control solo ofrece sus
      // cantones. Mismo encadenado que la barra de `/ordenes`.
      dependsOn: CLAVE_PROVINCIA,
      placeholder: "Todos",
      searchPlaceholder: "Buscar cantón…",
      emptyMessage: "Ningún cantón coincide",
      options: opcionesCanton(items),
    },
    ...propios,
  ];

  return cargando ? filtros.map((filtro) => ({ ...filtro, disabled: true })) : filtros;
}
