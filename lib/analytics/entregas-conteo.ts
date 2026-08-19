// CONTEO DE ENTREGAS — el contrato PURO del anillo de la seccion Entregas.
//
// Decision humana del 2026-08-17: este conteo NO sale de `analytics_daily`. Sale de la tabla
// `orden` VIVA, y por eso no entra en el catalogo `METRICAS` ni pasa por
// `prepararConsultaAnalitica`. Es una vertical propia, y aqui esta el porque de cada pieza:
//
//  - **El catalogo esta congelado en 25 metricas** por una decision humana fechada
//    (`lib/analytics/metrics.ts`, `progress/decision_F2_173.md`), y `metrics.test.ts` lo
//    atornilla. Colar una 26.ª entrada para reusar `resolverAlcance` habria movido ese
//    numero y con el media docena de guardias del lote 122-135, a cambio de nada: la
//    definicion de esta cifra —universo `orden`, fecha efectiva por COALESCE, seis
//    dimensiones de recorte— no es expresable como `Metrica` (aquellas describen columnas
//    del rollup).
//  - **El filtro tampoco es `analiticaFiltroSchema`**: aquel es `.strict()` y solo conoce
//    zona/tienda/mensajero, porque el grano de `analytics_daily` no tiene la cadena
//    geografica. Aflojarlo para meter provincia/canton/distrito degradaria la validacion de
//    las 25 metricas que si viven de ese esquema. Se copia el PATRON —listas no vacias,
//    fechas calendario de ancho fijo, conflictos cerrados con `.refine`— y no el objeto, que
//    es exactamente lo que la 135 hizo con `ordenFilterSchema`.
//
// Lo que SI se reutiliza, y a proposito, es la frontera de seguridad: `AlcanceDatos`,
// `MotivoDenegacion` y `esRolAnalitica` salen de `lib/analytics/alcance.ts`, y la traduccion
// alcance -> columnas la sigue haciendo `whereOrden` (`alcance-columnas.ts`) en la capa de
// repositorio. Aqui no se escribe ni un nombre de columna ni una segunda lista de roles.
//
// R1 (modulo puro, heredado del lote 122-135 y vigilado por
// `tests/unit/analytics/modulo-puro.guardia.test.ts`): sin `'use server'`, sin `@/lib/db`,
// sin repositorios ni servicios —ni siquiera como `import type`—, sin `next/*`, sin
// `process.env` y sin efectos al importarse.

import { z } from "zod";

import { rolTieneAccesoTotal, esRolAnalitica } from "@/lib/analytics/alcance";
import type {
  ActorAnalitica,
  AlcanceDatos,
  MotivoDenegacion,
  ResolucionAlcance,
} from "@/lib/analytics/alcance";
import { resolverRango } from "@/lib/analytics/ranges";
import { RANGO_PRESETS, RANGO_TOPE_DIAS } from "@/lib/analytics/types";
import type { EntradaRango, RangoResuelto } from "@/lib/analytics/types";

/* -------------------------------------------------------------------------- */
/* 1. El filtro                                                                */
/* -------------------------------------------------------------------------- */

/** Lista NO VACIA de ids no vacios. Copiado de `filters.ts`: una `[]` es un rechazo, no
 *  un "sin filtro" silencioso. Falla CERRADO. */
const idList = z.array(z.string().min(1, "Id vacio")).nonempty("La lista no puede estar vacia");

/** El cliente manda fechas CALENDARIO, nunca instantes: los bordes UTC en hora de Costa
 *  Rica los calcula `resolverRango` en el servidor. Anclado y de ancho fijo. */
const fechaCalendario = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado YYYY-MM-DD");

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Dias entre dos fechas calendario contando AMBOS extremos: el mismo dia es 1, no 0.
 *  `NaN` para una fecha que pasa el regex pero no existe (`2026-13-45`), y el `.refine`
 *  lo trata como rechazo. */
function diasInclusive(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00.000Z`);
  const b = Date.parse(`${hasta}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  return Math.round((b - a) / MS_POR_DIA) + 1;
}

/**
 * Las SEIS dimensiones de recorte del conteo, mas la ventana temporal.
 *
 * ⚠ `rango` es OPCIONAL, y su ausencia significa SIN FILTRO DE FECHA — no un preset por
 * defecto (decision humana del 2026-08-18). La pantalla NO arranca con una ventana que nadie
 * pidio: los filtros los manda la barra, y mientras la barra no mande nada el conteo es el de
 * TODAS las ordenes. Un preset implicito es peor que ninguno, porque la cifra sale recortada
 * y la barra no ensena por que — el usuario ve «sin filtrar» y un numero de una semana.
 *
 * Los `desde`/`hasta` sueltos siguen PROHIBIDOS sin `rango: "personalizado"` (refine 2): sin
 * rango no hay ventana que describir, y media terna no es una.
 *
 * La cadena geografica (provincia/canton/distrito) SI viaja aqui —al reves que en
 * `analiticaFiltroSchema`— porque el universo es `orden`, que tiene esas tres columnas
 * NOT NULL / NULL declaradas (`db/schema.prisma`), no el rollup, que no las tiene.
 *
 * `.strict()`: una clave de mas es un `validation_error`, no un extra inocuo. Es lo que
 * hace que `{ rol: "maestro" }` o `{ usuario_id: "u1" }` sean un rechazo y no un vector de
 * escalada — el alcance NUNCA entra por el filtro.
 */
export const conteoEntregasFiltroSchema = z
  .object({
    rango: z.enum(RANGO_PRESETS).optional(),
    desde: fechaCalendario.optional(),
    hasta: fechaCalendario.optional(),
    zona_id: idList.optional(),
    provincia_id: idList.optional(),
    canton_id: idList.optional(),
    distrito_id: idList.optional(),
    tienda_id: idList.optional(),
    mensajero_id: idList.optional(),
  })
  .strict()
  .refine((f) => f.rango !== "personalizado" || (Boolean(f.desde) && Boolean(f.hasta)), {
    path: ["desde"],
    message: "El rango personalizado exige desde y hasta",
  })
  .refine((f) => f.rango === "personalizado" || (!f.desde && !f.hasta), {
    path: ["desde"],
    message: "desde y hasta solo valen con el rango personalizado",
  })
  .refine((f) => !f.desde || !f.hasta || f.desde <= f.hasta, {
    path: ["hasta"],
    message: "El rango de fechas esta invertido",
  })
  .refine(
    (f) => {
      if (!f.desde || !f.hasta || f.desde > f.hasta) return true; // lo cierra el refine anterior
      const dias = diasInclusive(f.desde, f.hasta);
      return Number.isFinite(dias) && dias <= RANGO_TOPE_DIAS;
    },
    { path: ["hasta"], message: `La ventana no puede superar ${RANGO_TOPE_DIAS} dias` },
  );

export type FiltroConteoEntregas = z.infer<typeof conteoEntregasFiltroSchema>;

export type ParseoFiltroConteoEntregas =
  | { readonly status: "ok"; readonly filtro: FiltroConteoEntregas }
  | { readonly status: "validation_error"; readonly fieldErrors: Record<string, string[]> };

/** Parseo TOTAL: no lanza con `null`, `undefined`, un numero ni una cadena. */
export function parseFiltroConteoEntregas(raw: unknown): ParseoFiltroConteoEntregas {
  const parseado = conteoEntregasFiltroSchema.safeParse(raw);
  if (parseado.success) return { status: "ok", filtro: parseado.data };
  return {
    status: "validation_error",
    fieldErrors: parseado.error.flatten().fieldErrors as Record<string, string[]>,
  };
}

/* -------------------------------------------------------------------------- */
/* 2. El alcance                                                               */
/* -------------------------------------------------------------------------- */

function denegado(motivo: MotivoDenegacion): ResolucionAlcance {
  return { estado: "denegado", motivo };
}

function idUtil(valor: unknown): valor is string {
  return typeof valor === "string" && valor.length > 0;
}

/**
 * QUE FILAS de `orden` puede contar `actor` (decision humana del 2026-08-17):
 *
 *   maestro / admin  -> `global`  (los dos roles de `esAccesoTotal`)
 *   adminTienda      -> `tienda`  acotado a SU cuenta
 *   adminSatelite    -> `zona`    acotado a SU zona
 *   mensajero        -> DENEGADO. «El mensajero no tiene seccion de analitica, no debe ver
 *                       nada relacionado con analitica.» No es `acotado` a lo suyo: es
 *                       prohibido, que es una respuesta distinta y no un cero.
 *   apiKey           -> DENEGADO por el mismo criterio que `ROLES_SIN_ANALITICA`.
 *
 * TOTAL y FALLA CERRADO, igual que `resolverAlcance`: no lanza con entrada basura, no tiene
 * rama `default` que conceda, y todo camino que no sepa decir QUE ve el actor deniega. Sin
 * policies RLS debajo (Prisma se conecta con credenciales de servicio) esta capa es la
 * UNICA separacion entre inquilinos: un fallo aqui no da una cifra equivocada, filtra las
 * ordenes de una tienda a otra.
 */
export function resolverAlcanceConteoEntregas(
  actor: ActorAnalitica | null | undefined,
): ResolucionAlcance {
  if (actor === null || typeof actor !== "object") return denegado("sin_sesion");
  const { usuarioId, rol, zonaId } = actor as {
    usuarioId?: unknown;
    rol?: unknown;
    zonaId?: unknown;
  };
  if (!idUtil(usuarioId)) return denegado("sin_sesion");
  if (typeof rol !== "string") return denegado("rol_desconocido");
  // Un rol que ni siquiera es lector de analitica (hoy `apiKey`, o cualquier rol inventado
  // o el label `"Admin Tienda"` de la DB) no llega ni a la tabla de abajo.
  if (!esRolAnalitica(rol)) return denegado("rol_desconocido");

  // Acceso total: se le PREGUNTA a `esAccesoTotal` a traves de `rolTieneAccesoTotal`, que es
  // la fuente unica del repo. Aqui no se declara una segunda lista de roles totales.
  if (rolTieneAccesoTotal(rol)) return { estado: "ok", alcance: { tipo: "global" } };

  // Los tres roles lectores que quedan. El `default` DENIEGA, y esa es toda su razon de ser:
  // hoy es inalcanzable —maestro y admin salieron arriba por `rolTieneAccesoTotal`— pero el
  // dia que exista un SEXTO rol de analitica, caera aqui y sera denegado en vez de heredar
  // por accidente el alcance de otro. En una frontera multi-tenant la unica direccion segura
  // del fallo es CERRADO.
  switch (rol) {
    case "adminTienda":
      return { estado: "ok", alcance: { tipo: "tienda", tiendaId: usuarioId } };
    case "adminSatelite":
      // La `zona_id` de `usuario` es NULLABLE en el esquema: el `null` es real, y un
      // adminSatelite sin zona no tiene recorte que aplicar. Denegar es lo unico correcto
      // — `global` seria una escalada y `zona: ""` un recorte vacio silencioso.
      return idUtil(zonaId)
        ? { estado: "ok", alcance: { tipo: "zona", zonaId } }
        : denegado("sin_zona_asignada");
    case "mensajero":
      return denegado("metrica_prohibida");
    default:
      return denegado("rol_desconocido");
  }
}

/* -------------------------------------------------------------------------- */
/* 3. Precedencia del alcance sobre el filtro                                  */
/* -------------------------------------------------------------------------- */

/**
 * Interseca UNA lista del cliente con el id que le concede el alcance.
 *
 * - el cliente no nombro la dimension -> se ESCRIBE el recorte igualmente, para que el
 *   consumidor reciba el filtro ya acotado aunque ignorase `alcance`;
 * - la nombro y el id concedido esta dentro -> queda solo ese id;
 * - la nombro y NO esta -> `null` = interseccion vacia, y el llamador falla cerrado con
 *   403. No se devuelve `ok` con conjunto vacio: un tablero vacio se reporta como bug de
 *   datos y esconde el intento, y el id ajeno lo aporto el propio solicitante.
 */
function intersecar(
  pedidos: readonly string[] | undefined,
  concedido: string,
): readonly string[] | null {
  if (pedidos === undefined) return [concedido];
  return pedidos.includes(concedido) ? [concedido] : null;
}

/**
 * El filtro del cliente YA INTERSECADO con el alcance. Cinturon y tirantes: aunque el
 * repositorio ignorase `alcance`, el filtro que lleva dentro ya viene recortado.
 *
 * La cadena geografica NO se recorta por alcance a proposito: ningun rol tiene un alcance
 * de provincia/canton/distrito, asi que no hay nada que intersecar. El unico recorte
 * geografico que existe es el de ZONA, y ese si va.
 */
export function recortarFiltroConteoEntregas(
  filtro: FiltroConteoEntregas,
  alcance: AlcanceDatos,
): FiltroConteoEntregas | null {
  switch (alcance.tipo) {
    case "global":
      return filtro;
    case "zona": {
      const zona = intersecar(filtro.zona_id, alcance.zonaId);
      return zona === null ? null : { ...filtro, zona_id: zona as FiltroConteoEntregas["zona_id"] };
    }
    case "tienda": {
      const tienda = intersecar(filtro.tienda_id, alcance.tiendaId);
      return tienda === null
        ? null
        : { ...filtro, tienda_id: tienda as FiltroConteoEntregas["tienda_id"] };
    }
    case "mensajero":
      // Inalcanzable HOY: `resolverAlcanceConteoEntregas` no emite `mensajero` por ninguna
      // via (el rol esta denegado). Se cubre igualmente porque `AlcanceDatos` la declara y
      // el `switch` es exhaustivo: si manana se concediera, esta rama tendria que
      // escribirse a conciencia y no aparecer sola como un `default` permisivo.
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* 4. La consulta preparada                                                    */
/* -------------------------------------------------------------------------- */

declare const marcaConteo: unique symbol;

/**
 * Lo que el repositorio necesita, ya validado y ya recortado.
 *
 * OPACO por marca `unique symbol`, igual que `ConsultaAnalitica` (`lib/analytics/consulta.ts`)
 * y por el mismo motivo, que no es estetico: **el unico modo de tener una de estas es
 * pasar por `prepararConteoEntregas`**, y por tanto por el resolutor de alcance. Sin la
 * marca, un repositorio o un servicio podria construir `{ filtro, rango, alcance }` a mano
 * con el alcance que le apeteciera y saltarse entera la frontera multi-tenant escribiendo
 * codigo que compila. Con ella, esa via no existe: se recibe, se lee y se usa; no se fabrica.
 *
 * Lo que la marca NO impide es un `as unknown as ConsultaConteoEntregas`, que es la salida
 * que alguien encuentra a los cinco minutos de pelearse con el compilador. Ese 10 % restante
 * lo cubre el censo de `tests/unit/analytics/alcance-obligatorio.guardia.test.ts`, que trata
 * forjar el tipo como NO recibirlo.
 */
export interface ConsultaConteoEntregas {
  readonly [marcaConteo]: true;
  readonly filtro: FiltroConteoEntregas;
  /**
   * La ventana resuelta, o `null` = SIN FILTRO DE FECHA (el usuario no eligió ninguna).
   *
   * `null` y no un rango «que lo abarca todo» a propósito: un rango centinela con fechas
   * inventadas seguiría escribiendo condiciones de fecha en el `where`, y con ellas dejaría
   * fuera las órdenes cuya fecha efectiva cayera fuera del centinela. «Sin ventana» y «una
   * ventana muy ancha» no son lo mismo, y el repositorio tiene que poder distinguirlas para
   * no escribir nada en vez de escribir algo enorme.
   */
  readonly rango: RangoResuelto | null;
  readonly alcance: AlcanceDatos;
}

export type PreparacionConteoEntregas =
  | { readonly status: "ok"; readonly consulta: ConsultaConteoEntregas }
  | { readonly status: "validation_error"; readonly fieldErrors: Record<string, string[]> }
  | { readonly status: "forbidden"; readonly motivo: MotivoDenegacion };

/**
 * La entrada de rango, o `null` si el filtro no trae ninguno.
 *
 * El filtro validado ya garantiza la coherencia preset/fechas (los cuatro `refine`), así que
 * aquí no se revalida nada: sólo se traduce.
 */
function entradaDeRango(filtro: FiltroConteoEntregas): EntradaRango | null {
  // Sin `rango` NO se inventa uno. Es la mitad de la decisión del 2026-08-18: caer aquí a
  // `"semana"` (o a cualquier otro preset) devolvería una cifra recortada mientras la barra
  // dice «sin filtrar», que es la clase de discrepancia que nadie detecta mirando la
  // pantalla.
  if (filtro.rango === undefined) return null;
  if (filtro.rango === "personalizado") {
    return { preset: "personalizado", desde: filtro.desde ?? "", hasta: filtro.hasta ?? "" };
  }
  return { preset: filtro.rango };
}

/**
 * Parsear -> resolver rango -> resolver alcance -> intersecar. EN ESE ORDEN y sin vias
 * alternativas: si el parseo falla NO se pregunta por el alcance y no se toca la base, para
 * que una entrada malformada no sirva para sondear permisos.
 *
 * `now` es inyectable y no hay ningun `Date.now()` escondido: misma entrada, mismo `now`,
 * mismo resultado.
 */
export function prepararConteoEntregas(
  raw: unknown,
  actor: ActorAnalitica | null,
  now?: Date,
): PreparacionConteoEntregas {
  const parseado = parseFiltroConteoEntregas(raw);
  if (parseado.status !== "ok") {
    return { status: "validation_error", fieldErrors: parseado.fieldErrors };
  }

  const entrada = entradaDeRango(parseado.filtro);
  const rango = entrada === null ? null : resolverRango(entrada, now);

  const resolucion = resolverAlcanceConteoEntregas(actor);
  if (resolucion.estado === "denegado") return { status: "forbidden", motivo: resolucion.motivo };

  const filtro = recortarFiltroConteoEntregas(parseado.filtro, resolucion.alcance);
  if (filtro === null) return { status: "forbidden", motivo: "filtro_fuera_de_alcance" };

  // El UNICO `as` hacia el tipo opaco de todo el repo, y vive aqui —al final de los cuatro
  // pasos— a proposito: es el punto donde la marca se GANA. Mismo patron que
  // `prepararConsultaAnalitica`.
  return {
    status: "ok",
    consulta: { filtro, rango, alcance: resolucion.alcance } as ConsultaConteoEntregas,
  };
}

/* -------------------------------------------------------------------------- */
/* 5. La clave de cache                                                        */
/* -------------------------------------------------------------------------- */

/** Separador de componentes: `US` (U+001F). No puede aparecer dentro de un uuid ni de una
 *  fecha `YYYY-MM-DD`, asi que dos claves distintas no colapsan en una. */
const SEP = String.fromCharCode(31);
const SEP_LISTA = ",";

/**
 * Una lista de ids ORDENADA y DEDUPLICADA: insensible al orden, sensible al contenido.
 * `undefined` (dimension sin filtrar) se distingue de la lista vacia con un centinela.
 */
function idsNormalizados(ids: readonly string[] | undefined): string {
  if (ids === undefined) return "*";
  return [...new Set(ids)].sort().join(SEP_LISTA);
}

/**
 * EL ALCANCE VA EN LA CLAVE, Y ESO ES SEGURIDAD, no higiene. `recortarFiltroConteoEntregas`
 * escribe el recorte DENTRO del filtro, asi que hoy dos consultas con el mismo filtro dan
 * las mismas filas; pero el `where` real se compone de dos piezas con `AND` en el
 * repositorio, y apoyarse en esa coincidencia es apoyarse en un detalle de implementacion
 * para sostener la frontera multi-tenant. Una clave que no distingue el alcance no da una
 * cifra equivocada: **filtra datos entre roles**.
 */
function claveDeAlcance(alcance: AlcanceDatos): string {
  switch (alcance.tipo) {
    case "global":
      return "global";
    case "zona":
      return `zona:${alcance.zonaId}`;
    case "tienda":
      return `tienda:${alcance.tiendaId}`;
    case "mensajero":
      return `mensajero:${alcance.mensajeroId}`;
  }
}

/**
 * La clave de cache de un conteo. Componentes en orden FIJO.
 *
 * El PRESET no entra, las fechas RESUELTAS si: `rango: "dia"` significa un dia distinto
 * cada dia, y si el preset fuera la clave, la consulta de hoy devolveria el conteo de ayer
 * durante los 15 minutos del TTL.
 *
 * SIN rango, los dos componentes valen el centinela `*` — el mismo que usa una dimensión no
 * filtrada. «Sin ventana» tiene así su propia entrada, distinta de la de cualquier ventana
 * concreta, y no puede compartir caché con ella.
 */
export function claveDeConteoEntregas(consulta: ConsultaConteoEntregas): string {
  return claveConPrefijo(TAG_CONTEO_ENTREGAS, consulta);
}

/**
 * La clave del desglose POR STATUS. Mismo filtro, mismo alcance... y por eso mismo hace falta
 * un prefijo distinto.
 *
 * ⚠ NO es cosmetica. Las dos lecturas comparten `ConsultaConteoEntregas` entera —el filtro es
 * identico a proposito— asi que sin el prefijo producirian LA MISMA CLAVE con valores de
 * forma distinta: quien pidiera el desglose recibiria el `{entregadas, noEntregadas}` que
 * dejo el otro endpoint, o al reves. No es una cifra equivocada, es un objeto de otro tipo
 * llegando a un consumidor que no lo espera.
 */
export function claveDeConteoPorStatus(consulta: ConsultaConteoEntregas): string {
  return claveConPrefijo(TAG_CONTEO_POR_STATUS, consulta);
}

/** El cuerpo comun de las dos claves: todo lo que RECORTA la consulta, en orden fijo. */
function claveConPrefijo(prefijo: string, consulta: ConsultaConteoEntregas): string {
  const { filtro, rango, alcance } = consulta;
  return [
    prefijo,
    `d=${rango === null ? "*" : rango.desdeFecha}`,
    `h=${rango === null ? "*" : rango.hastaFecha}`,
    `a=${claveDeAlcance(alcance)}`,
    `z=${idsNormalizados(filtro.zona_id)}`,
    `p=${idsNormalizados(filtro.provincia_id)}`,
    `c=${idsNormalizados(filtro.canton_id)}`,
    `s=${idsNormalizados(filtro.distrito_id)}`,
    `t=${idsNormalizados(filtro.tienda_id)}`,
    `x=${idsNormalizados(filtro.mensajero_id)}`,
  ].join(SEP);
}

/** Tag de invalidacion de TODA la vertical. Espacio propio: estas entradas no salen del
 *  rollup, asi que el job diario de `analytics_daily` no debe barrerlas ni al reves. */
export const TAG_CONTEO_ENTREGAS = "conteo-entregas";

/** Tag —y prefijo de clave— del desglose por status. Ver `claveDeConteoPorStatus`. */
export const TAG_CONTEO_POR_STATUS = "conteo-por-status";

/**
 * La clave de las ORDENES CARGADAS POR DIA. Tercer prefijo, por el mismo motivo exacto que el
 * segundo (`claveDeConteoPorStatus`): las tres lecturas comparten `ConsultaConteoEntregas`
 * entera —el filtro es identico a proposito, para que la barra las mueva a las tres a la vez—
 * asi que sin prefijo producirian LA MISMA CLAVE con valores de forma distinta, y quien pidiera
 * la serie recibiria el `porDesenlace` que dejo el anillo.
 *
 * Comparte el cuerpo de la clave —y por tanto el rango RESUELTO, no el preset— con las otras
 * dos: `rango: "dia"` es un dia distinto cada dia, y con el preset en la clave la serie de hoy
 * devolveria la de ayer durante los 15 minutos del TTL.
 */
export function claveDeConteoCargadasPorDia(consulta: ConsultaConteoEntregas): string {
  return claveConPrefijo(TAG_CONTEO_CARGADAS_POR_DIA, consulta);
}

/** Tag —y prefijo de clave— de la serie de cargadas por dia. Ver `claveDeConteoCargadasPorDia`. */
export const TAG_CONTEO_CARGADAS_POR_DIA = "conteo-cargadas-por-dia";

/**
 * La clave del CONTADOR DE HOY (cargadas del dia en curso, con gestion vs sin gestion).
 *
 * Cuarto prefijo, por el mismo motivo que el segundo y el tercero. Y con UN COMPONENTE MAS que
 * los otros tres: `hoy=<fecha CR>`, que es lo unico que impide que la entrada de ayer se sirva
 * despues de medianoche.
 *
 * ⚠ POR QUE HACE FALTA ESE COMPONENTE, si el cuerpo de la clave ya lleva `d=`/`h=`: esta lectura
 * IGNORA `consulta.rango` —no recibe filtro de fecha, su ventana es siempre el dia CR en curso—,
 * asi que los componentes `d=`/`h=` describen una ventana que la consulta no usa. Sin `hoy=`,
 * la peticion de las 23:55 y la de las 00:01 producirian la MISMA clave, y la segunda recibiria
 * el conteo del dia anterior durante lo que quedara del TTL de 15 minutos: un contador «de hoy»
 * que empieza el dia mostrando el cierre de ayer.
 *
 * `dia` viene YA RESUELTO (`resolverRango({ preset: "dia" }, now)`) y no se calcula aqui: este
 * modulo es puro y no mira el reloj.
 */
export function claveDeConteoHoyGestion(
  consulta: ConsultaConteoEntregas,
  dia: RangoResuelto,
): string {
  return [claveConPrefijo(TAG_CONTEO_HOY_GESTION, consulta), `hoy=${dia.desdeFecha}`].join(SEP);
}

/** Tag —y prefijo de clave— del contador de hoy. Ver `claveDeConteoHoyGestion`. */
export const TAG_CONTEO_HOY_GESTION = "conteo-hoy-gestion";

/**
 * La clave del DESGLOSE DE DEVOLUCIONES POR CAUSA.
 *
 * Quinto prefijo, por el mismo motivo que los tres anteriores: las cinco lecturas comparten
 * `ConsultaConteoEntregas` entera —el filtro es identico a proposito, para que la barra las
 * mueva a todas a la vez— asi que sin prefijo producirian LA MISMA CLAVE con valores de forma
 * distinta, y quien pidiera el desglose de causas recibiria el `porDesenlace` del anillo.
 */
export function claveDeConteoDevoluciones(consulta: ConsultaConteoEntregas): string {
  return claveConPrefijo(TAG_CONTEO_DEVOLUCIONES, consulta);
}

/** Tag —y prefijo de clave— del desglose de devoluciones. Ver `claveDeConteoDevoluciones`. */
export const TAG_CONTEO_DEVOLUCIONES = "conteo-devoluciones";

/**
 * La clave del CICLO DE VIDA (segundos entre creacion y cierre terminal).
 *
 * Sexto prefijo, por el mismo motivo que los anteriores: las seis lecturas comparten
 * `ConsultaConteoEntregas` entera, asi que sin prefijo colisionarian en la MISMA clave con
 * valores de forma distinta.
 */
export function claveDeCicloVida(consulta: ConsultaConteoEntregas): string {
  return claveConPrefijo(TAG_CICLO_VIDA, consulta);
}

/** Tag —y prefijo de clave— del ciclo de vida. Ver `claveDeCicloVida`. */
export const TAG_CICLO_VIDA = "ciclo-vida";
