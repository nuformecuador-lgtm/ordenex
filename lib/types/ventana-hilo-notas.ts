import type { RolValue } from "@prisma/client";
import type { OrderStatusValue } from "@/lib/types/order-status";

// Feature 227 (T2.3, design §2.2, decision D1) — LA VENTANA DE ESCRITURA DEL HILO, en un solo
// sitio del arbol.
//
// La regla es ASIMETRICA POR ROL y esa asimetria es el corazon de la feature (R14/R35):
//
//   - `adminTienda` publica y borra mientras la orden esta en `devuelta` o en `ayuda_tienda` —
//     que es EXACTAMENTE lo que lista `/novedades` (`OrdenRepository.novedadWhere`).
//   - `mensajero`  publica y borra mientras la orden esta en `en_reparto` o en `ayuda_tienda` y
//     asignada a el — dos de los tres estatus que lee
//     `MisAsignacionesService.listarMisAsignaciones` (feature 167/R34, corte que la 227 no tocaba
//     y que la 235 ensancha con su estado nuevo, por la puerta y con su requisito delante).
//
// FEATURE 235 (T5.1, R34/R36) — LA VENTANA PASA DE UN VALOR POR ROL A UNA LISTA POR ROL, y con eso
// MUERE LA SEGUNDA PUERTA que la bandera `orden.ayuda` abria (ver abajo). `ayuda_tienda` entra en
// las DOS listas, y que sean las dos es el requisito, no una cortesia: si el mensajero no pudiera
// escribir, LA TIENDA LE HABLARIA A UN HILO MUDO —le pregunta «¿el cliente esta?» y no hay quien
// conteste—. Es literalmente el fallo que la guardia `hilo-ventana-alcanzable` existe para impedir.
//
// La LECTURA no pasa por aqui: se puede leer el hilo en CUALQUIER estatus (R15). Una version
// SIMETRICA («solo en devuelta» para los dos) dejaria al mensajero sin ningun estado alcanzable
// en el que publicar, y el hilo «bidireccional» seria unidireccional de hecho (R38). Ya se
// escribio asi una vez en el spec y se corrigio: no se reintroduce.
//
// `por_recoger` NO abre ventana, deliberadamente (design §2.2): la orden aun no salio a reparto.
// Si el negocio lo pidiera, es cambiar un valor de esta tabla y su test, y nada mas.
//
// POR QUE ESTE MODULO EXISTE Y POR QUE EXPORTA VALORES, NO UNA FUNCION QUE LOS TAPE:
// la guardia `tests/unit/guards/hilo-ventana-alcanzable.guardia.test.ts` (otra tanda, R36/R38)
// cruza ESTOS valores con el conjunto de estatus que lista la pantalla de cada rol —
// `OrdenRepository.novedadWhere` para la tienda y la lista de
// `MisAsignacionesService.listarMisAsignaciones` para el mensajero— y falla si alguna
// interseccion queda vacia. Para poder hacerlo necesita leer los valores en crudo; por eso
// `VENTANA_ESCRITURA` y `ROLES_CON_HILO` se exportan con sus tipos literales (`as const`) y no
// detras de un `puedeEscribir()` que los esconda.

/** Los DOS unicos roles con acceso al hilo (R12: nadie mas, tampoco maestro/admin/adminSatelite). */
export type RolConHilo = "adminTienda" | "mensajero";

/** El mismo par, como VALORES: la guardia de R38 itera esta lista. */
export const ROLES_CON_HILO = ["adminTienda", "mensajero"] as const satisfies readonly RolConHilo[];

/**
 * R14/R35/D1 — el UNICO punto de decision de la ventana. El `satisfies` obliga a que TODOS los
 * valores existan en el catalogo real de estatus (`ORDER_STATUS_SEED`): un typo o un estatus
 * retirado rompen el typecheck aqui, no en produccion.
 *
 * Feature 235: era `Record<RolConHilo, OrderStatusValue>` (UN valor por rol) y pasa a ser una
 * LISTA por rol. El cambio de forma es lo que permite que un estado nuevo entre en la ventana sin
 * inventarse una segunda puerta al lado, que es exactamente lo que habia que deshacer.
 */
export const VENTANA_ESCRITURA = {
  // `devuelta` = la devolucion ANCLADA (239). `ayuda_tienda` = la solicitud de ayuda viva (235).
  // Las DOS ramas de lo que `/novedades` lista, y ninguna mas.
  adminTienda: ["devuelta", "ayuda_tienda"],
  // `en_reparto` = la orden en la calle. `ayuda_tienda` = la misma orden, con auxilio pedido: el
  // paquete sigue en su moto y tiene que poder contestarle a la tienda (R34). Ademas, sin este
  // valor la SEGUNDA solicitud de ayuda sobre la misma orden se rechazaria y el boton quedaria
  // muerto — lo que el mensajero suele necesitar la segunda vez es AÑADIR contexto.
  mensajero: ["en_reparto", "ayuda_tienda"],
} as const satisfies Record<RolConHilo, readonly OrderStatusValue[]>;

/** R12: `true` si el rol es uno de los dos con acceso al hilo (estrecha el tipo). */
export function esRolConHilo(rol: RolValue): rol is RolConHilo {
  return rol === "adminTienda" || rol === "mensajero";
}

/**
 * R14/R35 — `true` si el actor cae DENTRO de la ventana DE SU ROL. Es una pertenencia a la tabla de
 * arriba, no una re-derivacion de la regla: quien quiera saber si un actor puede escribir pregunta
 * aqui.
 *
 * ⚰️ AQUI VIVIA LA «SEGUNDA PUERTA, SOLO PARA adminTienda» (2026-08-18 → 2026-08-19), y se cuenta
 * porque el motivo por el que existio sigue siendo valido y el mecanismo NO. Aquel dia
 * `novedadWhere` gano una rama que NO miraba el estatus (`ayuda: true`), asi que la pantalla de la
 * tienda listaba ordenes fuera de la ventana y la tienda leia un auxilio que no podia contestar. Se
 * parcheo con un TERCER PARAMETRO booleano —la bandera `orden.ayuda`— que abria la ventana del
 * adminTienda EN CUALQUIER ESTATUS. La 239 midio la consecuencia y la dejo escrita como deuda con
 * dueño: `estaEnVentanaDeEscritura("adminTienda", "devolucion_por_confirmar", true)` devolvia
 * `true`, una bandera vieja abriendo la ventana sobre el pre-estado de la devolucion.
 *
 * LA FEATURE 235 CIERRA ESA DEUDA POR CONSTRUCCION: la bandera se retira, el estatus la sustituye y
 * el tercer parametro DESAPARECE de la firma. La ventana vuelve a depender SOLO del estado de la
 * orden (R36), que es lo que la hacia auditable. Lo que se conserva del parche es su leccion: si la
 * pantalla de un rol crece, la ventana crece CON ELLA y en esta misma tabla — no al lado.
 *
 * La LECTURA sigue sin pasar por aqui (R15). Y esto no concede acceso a ninguna orden: la
 * pertenencia se comprueba antes y por separado (`autorizarSobreHilo`), asi que lo unico que abre
 * es la ventana TEMPORAL sobre una orden que ya era de ese actor.
 */
export function estaEnVentanaDeEscritura(rol: RolConHilo, estatusValue: string): boolean {
  return (VENTANA_ESCRITURA[rol] as readonly string[]).includes(estatusValue);
}
