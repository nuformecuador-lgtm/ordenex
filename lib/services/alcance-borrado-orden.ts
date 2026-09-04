import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// FICHA 358 (2026-09-02) — LA REGLA DE DUEÑO DEL BORRADO DE ORDENES, EN UN SOLO SITIO.
//
// QUE PROBLEMA RESUELVE. Hasta hoy el borrado tenia DOS autorizaciones escritas a mano y sin
// nada en comun:
//   - por PANTALLA (`EliminarOrdenService`): `if (actor.rol !== "maestro") forbidden`, y despues
//     NINGUNA frontera de tienda —el maestro puede borrar cualquier orden, asi que no hacia
//     falta—;
//   - por API KEY (`ApiOrdenEliminacionService`, ficha 320): sin comprobacion de rol, y el dueño
//     derivado a mano como `actor.usuarioId`, forzado dentro del `where` de las dos sentencias.
// Lo unico que compartian era el predicado de ESTADO (`esEstadoEliminable`). El 2026-09-02 el
// humano abrio el borrado por pantalla A LA TIENDA, acotado a lo suyo: eso obligaba a escribir
// «el dueño es `actor.usuarioId`» por SEGUNDA vez. Dos copias de una regla de frontera entre
// inquilinos es exactamente como divergen, asi que la regla se muda aqui y los dos caminos
// preguntan al MISMO sitio. El precedente es `esEstadoEliminable`: la otra mitad de la decision
// ya vivia en un modulo unico por este mismo motivo.
//
// LO QUE ESTE MODULO **NO** ES. No es la frontera. Responder «propias» no impide nada por si
// solo: lo que impide que una tienda borre lo ajeno es el `tienda_id` dentro del `where` de
// `softDelete`/`softDeleteViaApi`. Esto es la funcion que DICE cual es el dueño; aplicarlo donde
// no se pueda saltar sigue siendo responsabilidad de cada camino, y esta medido contra Postgres
// (`tests/integration/db/eliminar-orden-*-frontera-tienda.test.ts`).
//
// PURO: sin Prisma, sin `next/`, sin lecturas de entorno — como `order-status-eliminables.ts`,
// y por la misma razon (lo importan tres servicios y tiene que poder correr con dobles).

/**
 * Hasta donde alcanza el borrado de ordenes de este actor.
 *
 * Union discriminada de TRES casos y no un `string | null`: obliga a cada llamador a decidir
 * explicitamente que hace con «todas» y con «denegado». Un `ownerId` nullable se olvida en
 * silencio y falla ABIERTO; esto no compila si te lo saltas.
 */
export type AlcanceBorradoOrden =
  /** No puede borrar ninguna orden por ningun canal. */
  | { alcance: "denegado" }
  /** Puede borrar CUALQUIER orden del sistema, sin frontera de tienda. Solo el `maestro`. */
  | { alcance: "todas" }
  /** Solo las ordenes cuya `tienda_id` sea `ownerId`. */
  | { alcance: "propias"; ownerId: string };

/**
 * LA REGLA, y la unica copia de ella.
 *
 * `maestro` -> **todas**. Sin cambio: es quien retira una orden del sistema entero, y borrar la
 * saca tambien de los listados de la tienda dueña y del mensajero asignado. La ficha 319 y el
 * pedido del 2026-08-27 estrecharon esto de `maestro`/`admin` a solo `maestro` para que el
 * rastro de quien borro fuera UNA persona; eso NO se toca aqui.
 *
 * `adminTienda` y `apiKey` -> **propias**, con el dueño en `actor.usuarioId`. Son las dos formas
 * que tiene UNA tienda de dirigirse al sistema —la sesion de su pantalla y la credencial de su
 * integracion— y la ficha 320 ya decidio, a sabiendas, que en los estados eliminables el
 * paquete esta quieto y el autor esta identificado. La 358 le da a la pantalla la MISMA regla
 * que la tienda ya tenia por API: no es un permiso nuevo, es la misma con otra forma. Que las
 * dos salgan de esta linea es lo que impide que una se amplie sin la otra.
 *
 * `admin`, `adminSatelite`, `mensajero` y cualquier rol futuro -> **denegado**. Es una lista de
 * INCLUSION, como la de estados: un `RolValue` nuevo nace sin poder borrar hasta que alguien lo
 * añada aqui a proposito.
 *
 * `actor.usuarioId` ES el `tienda_id` de sus ordenes: el mismo hecho sobre el que se apoyan
 * `OrdenService.construirWhere` (`if (actor.rol === "adminTienda") where.tiendaId = actor.usuarioId`)
 * y todo el canal por API key desde la 88.
 */
export function resolverAlcanceBorradoOrden(actor: Actor): AlcanceBorradoOrden {
  if (actor.rol === "maestro") return { alcance: "todas" };
  if (actor.rol === "adminTienda" || actor.rol === "apiKey") {
    return { alcance: "propias", ownerId: actor.usuarioId };
  }
  return { alcance: "denegado" };
}
