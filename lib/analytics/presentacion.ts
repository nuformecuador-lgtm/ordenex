// Feature 133 (T1.1 / D5) — RECORTE DE PRESENTACION por rol.
//
// QUE ES Y QUE NO ES. Esto decide QUE CONTROL SE DIBUJA. No recorta ni una fila: el
// recorte de DATOS es de la 122 (`alcance.ts` + `alcance-columnas.ts`) y ocurre en el
// borde, antes de tocar la base. Un panel que no se pinta no es un dato que no se
// filtra (aviso literal de `specs/122-.../design.md:466-468`, y R20/R21/R27 de esta
// feature). Si algun dia este modulo fuese lo unico que impide ver algo, el agujero ya
// estaria abierto en el borde.
//
// R1 (modulo puro, heredado de la 135 y vigilado por
// `tests/unit/analytics/modulo-puro.guardia.test.ts`): sin React, sin `next/headers`,
// sin `@/lib/db`, sin repositorios ni servicios, sin `process.env`, sin efectos al
// importarse. Sus unicas aristas son `lib/analytics/alcance` y `lib/analytics/metrics`,
// que ya estan dentro del arbol censado.
//
// R18 / D5 — de donde sale "que faceta esta fijada": del alcance resuelto por la 122.
// NO se escribe un `Record<rol, facetas>`: R8 y R37 de la 122 prohiben por escrito una
// segunda tabla rol -> dimension, y el guardia de fuente unica
// (`alcance-fuente-unica.guardia.test.ts`) la censa en todo el repo. Aqui no se nombra
// ni un solo rol: se pregunta a `resolverAlcance` y se razona sobre el `tipo`.

import { esRolAnalitica, resolverAlcance } from "@/lib/analytics/alcance";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import { ALCANCE_PRODUCTOS, listarMetricas } from "@/lib/analytics/metrics";
import type { MetricaDominio } from "@/lib/analytics/types";

/**
 * El dominio se nombra en una constante y no se escribe en linea dentro del filtro por
 * una razon concreta: el guardia de fuente unica del catalogo (R2,
 * `modulo-puro.guardia.test.ts:342`) reconoce una DECLARACION de metrica por el par
 * `dominio: "operativa"`, y un `listarMetricas({ dominio: "operativa" })` escrito asi lo
 * haria pasar por una metrica declarada fuera de `metrics.ts`. El guardia no se relaja
 * (R29): se evita el patron que censa. Aqui no se declara ninguna metrica; se consulta
 * el catalogo.
 */
const DOMINIO_OPERATIVO: MetricaDominio = "operativa";

/** Las tres dimensiones que la barra de filtros puede ofrecer ademas del rango. */
export type Faceta = "zona" | "tienda" | "mensajero";

export interface RecortePresentacion {
  /** el `tipo` del alcance resuelto por la 122, o `denegado` */
  readonly alcance: "global" | "zona" | "tienda" | "mensajero" | "denegado";
  /** las facetas que la barra DEBE ofrecer (nunca contiene la fijada por el alcance) */
  readonly facetas: readonly Faceta[];
  /**
   * FICHA 345 (R5) — si la seccion de PRODUCTOS se pinta o no se pinta.
   *
   * Es una ETIQUETA y no un `boolean` a proposito: el guardia de frontera de la ruta
   * (`tablero-operativo-frontera.guardia.test.ts`, bloque (b)) exige que TODO campo de este
   * contrato sea una etiqueta o una lista de etiquetas, y esa exigencia es lo que mantiene
   * fuera de aqui cualquier campo de datos. Un enum de dos valores cumple la regla sin
   * tocarla; un `boolean` habria obligado a ensanchar el predicado del guardia, que es
   * exactamente lo que no se hace por una comodidad de escritura.
   *
   * ⚠ POR QUE ESTA DECISION VIVE AQUI Y NO EN `app/(app)/analitica/page.tsx`, que es donde
   * `specs/345-analitica-productos/design.md §7.2` la escribio: porque la pagina NO PUEDE
   * importar `@/lib/analytics/metrics`. Ese mismo guardia lleva una ALLOWLIST NOMINAL de
   * aristas de la ruta hacia `lib/analytics/` y `metrics` esta fuera —hasta con un caso
   * sintetico que lo declara infractor—, igual que `alcance`. Las dos vias que quedaban eran
   * relajar la allowlist o razonar en la pagina sobre `recorte.alcance`, que seria una
   * SEGUNDA regla del mismo permiso. Se elige la tercera: la decision se toma donde el
   * guardia dice que se toman las decisiones de «que control se dibuja», leyendo la MISMA
   * tabla que usa el borde para denegar. Precedente escrito en la propia pagina: «el guardia
   * manda sobre la prosa del diseño».
   *
   * Y no sustituye a nada: la Server Action deniega igual para esos roles (R4 de la 345). Un
   * panel que no se pinta no es un dato que no se sirve — el aviso de la cabecera de este
   * modulo se aplica aqui palabra por palabra.
   */
  readonly productos: "visible" | "oculta";
}

/** Las tres, en el orden en que la barra las dibuja hoy (`FiltrosOperativos.tsx:152-203`). */
const FACETAS: readonly Faceta[] = ["zona", "tienda", "mensajero"];

/**
 * El `tipo` de alcance se resuelve sobre UNA metrica operativa del catalogo, y da igual
 * cual: por eso se toma la primera que el catalogo declare en vez de escribir su id a
 * mano (un literal se queda obsoleto en silencio el dia que esa metrica se renombre o
 * se retire, y ademas fijaria la respuesta a una metrica concreta).
 *
 * Por que el `tipo` NO depende de la elegida: las 15 operativas declaran el MISMO
 * alcance por rol — acotado para los tres roles acotados y total para maestro/admin
 * (`metrics.ts:50-56`), y el guardia de R3 de la 122 comprueba para las 23 metricas que
 * el conjunto de roles con acceso total es exactamente `ROLES_ACCESO_TOTAL`. Como
 * `resolverAlcance` deriva el `tipo` UNICAMENTE de `metrica.alcance[rol]` y de la
 * dimension del propio actor, la respuesta es identica para todas ellas.
 * `presentacion.test.ts` lo recorre y lo afirma: si una operativa se saliera del patron,
 * ese test cae aqui y no en produccion.
 *
 * Si el catalogo no declarase ninguna operativa, `resolverAlcance` recibe un id que no
 * existe y deniega: se falla CERRADO (cero facetas), nunca se concede por defecto.
 */
function metricaOperativaDeReferencia(): string {
  return listarMetricas({ dominio: DOMINIO_OPERATIVO })[0]?.id ?? "";
}

/**
 * Que necesita UNA faceta para ofrecerse, expresado por FACETA y sobre el ALCANCE ya
 * resuelto — nunca por rol.
 *
 * (a) Su catalogo de backend tiene que responderle algo. Verificado, con linea:
 *     `lib/services/FiltrosOrdenesService.ts:28` (zonas y tiendas) autoriza
 *     maestro/admin/adminTienda y devuelve `forbidden` al resto;
 *     `lib/services/UsuariosPorRolService.ts:15` (mensajeros) autoriza exactamente el
 *     mismo trio. Ese trio es, sobre el alcance de la 122, {global, tienda}: los dos
 *     roles de acceso total resuelven `global` y el adminTienda resuelve `tienda`. Se
 *     expresa asi —sobre el alcance— y no enumerando roles, para no crear la segunda
 *     tabla que R8/R37 de la 122 prohiben. Ofrecer un selector cuyo catalogo responde
 *     `forbidden` dejaria el control muerto (deshabilitado + nota de degradado), que es
 *     justo lo que R16 prohibe. Consecuencia asumida y visible (Q4): adminSatelite y
 *     mensajero se quedan sin facetas hasta que backend amplie esos servicios; el dia
 *     que lo haga, se vuelven a ofrecer cambiando SOLO este modulo.
 *
 *     ACTUALIZACION (2026-08-19): `FiltrosOrdenesService` ya NO le responde `forbidden` al
 *     adminSatelite — le entrega la geografia de SU zona, sin zonas ni cuentas tienda. Eso
 *     no cambia lo de arriba, y por eso el alcance `zona` sigue fuera de
 *     `ALCANCES_CON_CATALOGO`: las dos facetas que ese catalogo alimentaria le llegan
 *     VACIAS a proposito (su zona esta fijada; las cuentas tienda no son suyas), asi que
 *     ofrecer el control seguiria dejandolo muerto. Lo que su catalogo alimenta es la
 *     CADENA GEOGRAFICA, que no es una faceta de este recorte y se ofrece siempre.
 *
 * (b) La faceta «Mensajero» exige ademas alcance global. Motivo (R15, D4): su catalogo
 *     sirve nombre real + uuid de cada mensajero, que es exactamente lo que R38/R39 de
 *     la 122 (identidad seudonima) existen para impedir a quien ve el grano mensajero
 *     seudonimizado. Y ojo (R27): quitar el selector NO cierra el oraculo residual M-4;
 *     la prohibicion efectiva sigue siendo del borde.
 *
 * Estos dos requisitos son de la FACETA, no del rol: no dicen quien es el actor, dicen
 * que hace falta para que ese control tenga sentido.
 */
const ALCANCES_CON_CATALOGO: readonly RecortePresentacion["alcance"][] = ["global", "tienda"];
const ALCANCES_CON_DIRECTORIO_DE_MENSAJEROS: readonly RecortePresentacion["alcance"][] = ["global"];

function facetaSeOfrece(faceta: Faceta, alcance: RecortePresentacion["alcance"]): boolean {
  // La dimension que el alcance ya tiene fijada no se ofrece (R14): un selector con un
  // unico valor legal no informa, sugiere que hay algo que elegir.
  if (faceta === alcance) return false;
  if (!ALCANCES_CON_CATALOGO.includes(alcance)) return false;
  if (faceta === "mensajero" && !ALCANCES_CON_DIRECTORIO_DE_MENSAJEROS.includes(alcance)) {
    return false;
  }
  return true;
}

/**
 * Que se le PINTA a `actor`: el tipo de alcance con el que se calculan sus cifras y las
 * facetas de filtro que la barra debe ofrecerle.
 *
 * TOTAL como el resolutor del que deriva: no lanza, y todo camino que no sepa decir que
 * ve el actor devuelve `denegado` con cero facetas.
 *
 * Devuelve ENUMS y arrays de strings: ni filas, ni ids, ni nombres, ni uuids. El tipo de
 * retorno no tiene ningun campo de datos, y el guardia de frontera de la ruta lo
 * comprueba.
 */
export function recorteDePresentacion(actor: ActorAnalitica | null): RecortePresentacion {
  const resolucion = resolverAlcance(actor, metricaOperativaDeReferencia());

  if (resolucion.estado === "denegado") {
    return { alcance: "denegado", facetas: [], productos: "oculta" };
  }

  const alcance = resolucion.alcance.tipo;
  return {
    alcance,
    facetas: FACETAS.filter((f) => facetaSeOfrece(f, alcance)),
    productos: seccionDeProductos(actor),
  };
}

/**
 * FICHA 345 (R5) — se pinta la seccion de productos MIENTRAS `ALCANCE_PRODUCTOS` no diga
 * `prohibido` para el rol del actor.
 *
 * Aqui no se nombra ni un solo rol, igual que en el resto del modulo: se pregunta a la tabla
 * que el borde ya consulta (`lib/analytics/metrics.ts`, el unico archivo del repo donde el
 * censo de fuente unica permite que viva una regla por rol). Una lista de roles escrita en
 * este archivo seria la segunda regla del mismo permiso, y dos reglas para un permiso
 * divergen — es lo que R8/R37 de la 122 prohiben por escrito.
 *
 * Falla CERRADO: un rol que no es lector de analitica, o un actor sin sesion, no ve la
 * seccion. Nunca se concede por defecto.
 */
function seccionDeProductos(actor: ActorAnalitica | null): RecortePresentacion["productos"] {
  const rol = actor?.rol;
  if (rol === undefined || !esRolAnalitica(rol)) return "oculta";
  return ALCANCE_PRODUCTOS[rol] === "prohibido" ? "oculta" : "visible";
}
