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
  /**
   * Puede borrar CUALQUIER orden del sistema, sin frontera de tienda: el `maestro` y —desde la
   * ficha 424 (2026-09-14)— el `admin`.
   */
  | { alcance: "todas" }
  /** Solo las ordenes cuya `tienda_id` sea `ownerId`. */
  | { alcance: "propias"; ownerId: string };

/**
 * LA REGLA, y la unica copia de ella.
 *
 * `maestro` -> **todas**. Sin cambio: es quien retira una orden del sistema entero, y borrar la
 * saca tambien de los listados de la tienda dueña y del mensajero asignado.
 *
 * ⭑ `admin` -> **todas**. FICHA 424 — **2026-09-14, PEDIDO HUMANO (Carlos Restrepo). Se REVIERTE
 * el estrechamiento del 2026-08-27.** El capitulo viejo NO se tacha, se conserva para que el
 * siguiente lector sepa que se rompio a proposito:
 *
 *   La ficha 319 y el pedido del 2026-08-27 estrecharon esta misma linea de `maestro`/`admin` a
 *   solo `maestro`, y el motivo fue este: «con dos roles capaces de borrar, el rastro de quien
 *   lo hizo deja de ser una sola persona». La ficha 358 (2026-09-02) abrio el borrado a la
 *   TIENDA y conservo expresamente aquel estrechamiento.
 *
 * El humano lo revierte CON ESA CONSECUENCIA SOBRE LA MESA. Lo que la sostiene es la ficha 362:
 * cada orden borrada deja una fila en `historial_accion` con el NOMBRE y el ROL **congelados** de
 * quien la borro, una por orden EFECTIVAMENTE borrada, agrupadas por acto (`lote_id`) y
 * consultables en `/historico/acciones`. El rastro ya no es «una persona»: es «que persona, con
 * que rol, sobre que orden y en que acto». Medido el 2026-09-14: de 2 personas capaces de borrar
 * (2 `maestro`) se pasa a 6 (mas 4 `admin` activos en produccion).
 *
 * Lo que la reversion NO abre, y es decision del MISMO dia (424/D1): el `admin` **no recupera**
 * una orden eliminada (`RecuperarOrdenService` sigue cortando por `maestro`), **no ve** el
 * interruptor «Eliminadas» y **no lee** `/historico/acciones` —genera filas en ese registro y no
 * puede leerlas; quien audita es el `maestro`—. Si se equivoca, se lo pide al `maestro`. El
 * debate no se reabre aqui.
 *
 * `adminTienda` y `apiKey` -> **propias**, con el dueño en `actor.usuarioId`. Son las dos formas
 * que tiene UNA tienda de dirigirse al sistema —la sesion de su pantalla y la credencial de su
 * integracion— y la ficha 320 ya decidio, a sabiendas, que en los estados eliminables el
 * paquete esta quieto y el autor esta identificado. La 358 le da a la pantalla la MISMA regla
 * que la tienda ya tenia por API: no es un permiso nuevo, es la misma con otra forma. Que las
 * dos salgan de esta linea es lo que impide que una se amplie sin la otra.
 *
 * `adminSatelite`, `mensajero` y cualquier rol futuro -> **denegado**. Es una lista de
 * INCLUSION, como la de estados: un `RolValue` nuevo nace sin poder borrar hasta que alguien lo
 * añada aqui a proposito. Que la 424 haya movido UN rol de cubeta no cambia la DIRECCION de la
 * lista: el default sigue siendo `denegado` y un rol nuevo sigue naciendo sin poder borrar.
 *
 * `actor.usuarioId` ES el `tienda_id` de sus ordenes: el mismo hecho sobre el que se apoyan
 * `OrdenService.construirWhere` (`if (actor.rol === "adminTienda") where.tiendaId = actor.usuarioId`)
 * y todo el canal por API key desde la 88.
 */
export function resolverAlcanceBorradoOrden(actor: Actor): AlcanceBorradoOrden {
  // FICHA 424 (2026-09-14): el `admin` entra AQUI, junto al `maestro`. Es LA linea de la ficha:
  // todo lo demas del borrado —el predicado de estado, los intentos, el todo-o-nada, el `where`
  // de la escritura y el rastro— se queda exactamente como estaba.
  if (actor.rol === "maestro" || actor.rol === "admin") return { alcance: "todas" };
  if (actor.rol === "adminTienda" || actor.rol === "apiKey") {
    return { alcance: "propias", ownerId: actor.usuarioId };
  }
  return { alcance: "denegado" };
}
