import type { RolValue } from "@prisma/client";
import type { OrderStatusValue } from "@/lib/types/order-status";

// Feature 227 (T2.3, design §2.2, decision D1) — LA VENTANA DE ESCRITURA DEL HILO, en un solo
// sitio del arbol.
//
// La regla es ASIMETRICA POR ROL y esa asimetria es el corazon de la feature (R14/R35):
//
//   - `adminTienda` publica y borra SOLO mientras la orden esta en `devuelta`  — que es
//     EXACTAMENTE lo que lista `/novedades` (`OrdenRepository.novedadWhere`).
//   - `mensajero`  publica y borra SOLO mientras la orden esta en `en_reparto` y asignada a el
//     — uno de los dos estatus que lee `MisAsignacionesService.listarMisAsignaciones`
//     (feature 167/R34, corte que esta feature NO toca, R36).
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
 * R14/R35/D1 — el UNICO punto de decision de la ventana. El `satisfies` obliga a que ambos
 * valores existan en el catalogo real de estatus (`ORDER_STATUS_SEED`): un typo o un estatus
 * retirado rompen el typecheck aqui, no en produccion.
 */
export const VENTANA_ESCRITURA = {
  adminTienda: "devuelta", // lo que `/novedades` lista
  mensajero: "en_reparto", // uno de los dos estatus que lee el panel del mensajero (167/R34)
} as const satisfies Record<RolConHilo, OrderStatusValue>;

/** R12: `true` si el rol es uno de los dos con acceso al hilo (estrecha el tipo). */
export function esRolConHilo(rol: RolValue): rol is RolConHilo {
  return rol === "adminTienda" || rol === "mensajero";
}

/**
 * R14/R35 — `true` si `estatusValue` cae DENTRO de la ventana DEL ROL indicado. Es una
 * comparacion contra la tabla de arriba, no una re-derivacion de la regla: quien quiera saber
 * si un actor puede escribir pregunta aqui.
 */
export function estaEnVentanaDeEscritura(rol: RolConHilo, estatusValue: string): boolean {
  return estatusValue === VENTANA_ESCRITURA[rol];
}
