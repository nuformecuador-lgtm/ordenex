// FICHA 345 — LA CONSULTA PREPARADA DEL ANALISIS DE PRODUCTOS.
//
// La septima vertical VIVA de la seccion de entregas de `/analitica`, con la misma forma que las
// seis anteriores: filtro compartido, alcance resuelto en el servidor, tipo opaco y clave de
// cache con prefijo propio.
//
// QUE SE REUSA Y POR QUE. El filtro (`conteoEntregasFiltroSchema`, seis facetas + rango
// opcional), la resolucion de rango y el recorte del filtro salen TAL CUAL de
// `entregas-conteo.ts`. Compartir el filtro ES el punto: la barra de entregas mueve las siete
// lecturas a la vez, y una segunda copia del esquema divergeria en la primera faceta nueva.
// Su `.strict()` es ademas lo que hace de R8 un error de validacion: una clave desconocida
// —`{ rol: "maestro" }`, `{ tienda_id_real: … }`— es un rechazo, no un extra inocuo. **El
// alcance NUNCA entra por el filtro.**
//
// QUE NO SE REUSA, Y ES LA RAZON DE SER DE ESTE ARCHIVO. El ALCANCE diverge: en el conteo de
// entregas un `adminSatelite` obtiene `{tipo:"zona"}`; aqui esta PROHIBIDO (decision humana:
// esta lectura es de maestro, admin y la tienda sobre lo suyo). Con el tipo compartido, pasar una
// consulta de entregas al repositorio de productos COMPILARIA, y eso es exactamente la fuga que
// la decision cierra. Con dos tipos opacos, no compila.
//
// R1 (modulo puro, vigilado por `tests/unit/analytics/modulo-puro.guardia.test.ts`, que barre el
// directorio entero): sin `'use server'`, sin `@/lib/db`, sin repositorios ni servicios —ni
// siquiera como `import type`—, sin `next/*`, sin `process.env` y sin efectos al importarse.

import { esRolAnalitica, rolTieneAccesoTotal } from "@/lib/analytics/alcance";
import type {
  ActorAnalitica,
  AlcanceDatos,
  MotivoDenegacion,
  ResolucionAlcance,
} from "@/lib/analytics/alcance";
import {
  claveConPrefijo,
  entradaDeRango,
  parseFiltroConteoEntregas,
  recortarFiltroConteoEntregas,
} from "@/lib/analytics/entregas-conteo";
import type { FiltroConteoEntregas, RecorteDeOrdenes } from "@/lib/analytics/entregas-conteo";
import { ALCANCE_PRODUCTOS } from "@/lib/analytics/metrics";
import { resolverRango } from "@/lib/analytics/ranges";
import type { RolAnalitica } from "@/lib/analytics/types";

/* -------------------------------------------------------------------------- */
/* 1. El alcance                                                               */
/* -------------------------------------------------------------------------- */

function denegado(motivo: MotivoDenegacion): ResolucionAlcance {
  return { estado: "denegado", motivo };
}

function concedido(alcance: AlcanceDatos): ResolucionAlcance {
  return { estado: "ok", alcance };
}

/** Un id util es una cadena no vacia. `null`, `""` y cualquier otra cosa NO lo son. */
function idUtil(valor: unknown): valor is string {
  return typeof valor === "string" && valor.length > 0;
}

/**
 * El recorte de los roles que la tabla declara `acotado`.
 *
 * `switch` EXHAUSTIVO sobre los cinco roles lectores y SIN `default`: un sexto rol de analitica
 * no compilaria aqui, en vez de heredar por accidente el alcance de otro. En una frontera
 * multi-tenant la unica direccion segura del fallo es CERRADO.
 *
 * En este esquema el `adminTienda` ES la tienda: `orden.tienda_id` es FK a `usuario`
 * (`db/schema.prisma:573`), el mismo criterio que ya usan `alcance.ts` y `entregas-conteo.ts`.
 *
 * Las otras cuatro ramas son INALCANZABLES con la tabla vigente (`ALCANCE_PRODUCTOS` solo declara
 * `acotado` para `adminTienda`) y se escriben igual: si alguien cambiara la tabla, esto deniega
 * en vez de conceder «lo que se parezca».
 */
function alcanceAcotadoDeProductos(rol: RolAnalitica, usuarioId: string): ResolucionAlcance {
  switch (rol) {
    case "adminTienda":
      return concedido({ tipo: "tienda", tiendaId: usuarioId });
    case "maestro":
    case "admin":
    case "adminSatelite":
    case "mensajero":
      return denegado("metrica_prohibida");
  }
}

/**
 * QUE FILAS de `orden` puede contar `actor` en el analisis de productos.
 *
 * La regla por rol NO se escribe aqui: se LEE de `ALCANCE_PRODUCTOS` (`lib/analytics/metrics.ts`),
 * que es el unico sitio del repo donde el censo de `alcance-fuente-unica.guardia` permite que
 * viva una tabla rol -> alcance. Este archivo la traduce a `AlcanceDatos` y nada mas.
 *
 * TOTAL y FALLA CERRADO, igual que `resolverAlcance` y `resolverAlcanceConteoEntregas`: no lanza
 * con entrada basura (`null`, `{}`, un rol numerico), no tiene rama `default` que conceda, y todo
 * camino que no sepa decir QUE ve el actor deniega. Sin policies RLS debajo (Prisma se conecta con
 * credenciales de servicio) esta capa es la UNICA separacion entre inquilinos: un fallo aqui no da
 * una cifra equivocada, filtra los productos de una tienda a otra.
 */
export function resolverAlcanceProductos(
  actor: ActorAnalitica | null | undefined,
): ResolucionAlcance {
  if (actor === null || typeof actor !== "object") return denegado("sin_sesion");
  const { usuarioId, rol } = actor as { usuarioId?: unknown; rol?: unknown };
  if (!idUtil(usuarioId)) return denegado("sin_sesion");
  if (typeof rol !== "string") return denegado("rol_desconocido");
  // Un rol que ni siquiera es lector de analitica (`apiKey`, un rol inventado, el label
  // "Admin Tienda" de la DB) no llega a la tabla.
  if (!esRolAnalitica(rol)) return denegado("rol_desconocido");

  // `switch` exhaustivo sobre los TRES valores de `AlcanceMetrica`, sin `default`: una cuarta
  // variante del dominio no compilaria.
  switch (ALCANCE_PRODUCTOS[rol]) {
    case "total":
      // El conjunto `total` se CONTRASTA contra la fuente unica del repo en vez de creerse la
      // tabla: si alguien le pusiera `total` a un rol que `esAccesoTotal` no reconoce, esto
      // deniega. Hoy es inalcanzable —y `productos-alcance.test.ts` (R6) lo atornilla—, pero la
      // rama existe para que ese error de edicion no se convierta en una escalada silenciosa.
      return rolTieneAccesoTotal(rol) ? concedido({ tipo: "global" }) : denegado("rol_desconocido");
    case "acotado":
      return alcanceAcotadoDeProductos(rol, usuarioId);
    case "prohibido":
      // R4 — `adminSatelite` y `mensajero`. NO es `acotado` a lo suyo ni un cero: es una
      // respuesta distinta, y el borde la traduce a 403.
      return denegado("metrica_prohibida");
  }
}

/* -------------------------------------------------------------------------- */
/* 2. La consulta preparada                                                    */
/* -------------------------------------------------------------------------- */

declare const marcaProductos: unique symbol;

/**
 * Lo que el repositorio de productos necesita, ya validado y ya recortado.
 *
 * OPACO por marca `unique symbol`, igual que `ConsultaAnalitica` y `ConsultaConteoEntregas`, y
 * por el mismo motivo, que no es estetico: **el unico modo de tener una de estas es pasar por
 * `prepararConsultaProductos`**, y por tanto por el resolutor de alcance de arriba. Sin la marca,
 * cualquiera podria construir `{ filtro, rango, alcance }` a mano con el alcance que le apeteciera
 * y saltarse entera la frontera multi-tenant escribiendo codigo que compila.
 *
 * TIPO PROPIO Y NO `ConsultaConteoEntregas` (alternativa A5 del diseño): el alcance DIVERGE, asi
 * que compartir el tipo dejaria COMPILAR el paso de una consulta de entregas a este repositorio
 * —donde un `adminSatelite` traeria `{tipo:"zona"}` a una lectura que le esta PROHIBIDA—.
 *
 * Lo que la marca NO impide es un `as unknown as ConsultaProductos`. Ese resto lo cubre el censo
 * de `tests/unit/analytics/alcance-obligatorio.guardia.test.ts`, que trata forjar el tipo como NO
 * recibirlo, y donde este tipo esta dado de alta por cumplir su criterio de admision declarado:
 * marca `unique symbol`.
 */
export interface ConsultaProductos extends RecorteDeOrdenes {
  readonly [marcaProductos]: true;
}

export type PreparacionConsultaProductos =
  | { readonly status: "ok"; readonly consulta: ConsultaProductos }
  | { readonly status: "validation_error"; readonly fieldErrors: Record<string, string[]> }
  | { readonly status: "forbidden"; readonly motivo: MotivoDenegacion };

/**
 * Parsear -> resolver rango -> resolver alcance -> intersecar. EN ESE ORDEN y sin vias
 * alternativas: si el parseo falla NO se pregunta por el alcance y NO se toca la base (R53), para
 * que una entrada malformada no sirva para sondear permisos.
 *
 * `now` es inyectable y no hay ningun `Date.now()` escondido: misma entrada, mismo `now`, mismo
 * resultado.
 */
export function prepararConsultaProductos(
  raw: unknown,
  actor: ActorAnalitica | null,
  now?: Date,
): PreparacionConsultaProductos {
  const parseado = parseFiltroConteoEntregas(raw);
  if (parseado.status !== "ok") {
    return { status: "validation_error", fieldErrors: parseado.fieldErrors };
  }

  const entrada = entradaDeRango(parseado.filtro);
  const rango = entrada === null ? null : resolverRango(entrada, now);

  const resolucion = resolverAlcanceProductos(actor);
  if (resolucion.estado === "denegado") return { status: "forbidden", motivo: resolucion.motivo };

  // R7 — pedir una tienda que el alcance no concede es `null`, y el llamador lo traduce a 403.
  // NO se devuelve `ok` con conjunto vacio: un tablero vacio se reporta como bug de datos y
  // esconde el intento, y el id ajeno lo aporto el propio solicitante.
  const filtro: FiltroConteoEntregas | null = recortarFiltroConteoEntregas(
    parseado.filtro,
    resolucion.alcance,
  );
  if (filtro === null) return { status: "forbidden", motivo: "filtro_fuera_de_alcance" };

  // El UNICO `as ConsultaProductos` del repo, y vive aqui —al final de los cuatro pasos— a
  // proposito: es el punto donde la marca se GANA.
  return {
    status: "ok",
    consulta: { filtro, rango, alcance: resolucion.alcance } as ConsultaProductos,
  };
}

/* -------------------------------------------------------------------------- */
/* 3. La clave y el tag de cache                                               */
/* -------------------------------------------------------------------------- */

/**
 * Tag —y prefijo de clave— del analisis de productos. SEPTIMO prefijo de la seccion.
 *
 * ⚠ NO es cosmetico. Las siete lecturas comparten el mismo filtro a proposito (la barra las mueve
 * a la vez), asi que sin prefijo propio producirian LA MISMA CLAVE con valores de forma distinta:
 * quien pidiera los productos recibiria el `porDesenlace` del anillo. No es una cifra equivocada,
 * es un objeto de otro tipo llegando a un consumidor que no lo espera.
 */
export const TAG_CONTEO_PRODUCTOS = "conteo-productos";

/**
 * La clave de cache del analisis de productos.
 *
 * Comparte cuerpo con las otras seis (`claveConPrefijo`), y por tanto lleva DENTRO el alcance
 * resuelto: una clave que no distingue el alcance no da una cifra equivocada, **filtra datos entre
 * roles**. Y lleva el rango RESUELTO y no el preset: `rango: "dia"` es un dia distinto cada dia, y
 * con el preset en la clave la lectura de hoy devolveria la de ayer durante el TTL de 15 minutos.
 */
export function claveDeConteoProductos(consulta: ConsultaProductos): string {
  return claveConPrefijo(TAG_CONTEO_PRODUCTOS, consulta);
}
