import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// 💰 Feature 240 (design §5, D1/D5/D9) — contrato del servicio del RECHAZO MANUAL DE LA TIENDA: la
// administracion de la tienda dueña de una orden que reposa en la DEVOLUCION ANCLADA (`devuelta`,
// feature 239) decide que ese paquete no se reintenta y lo cierra como `rechazada`.
//
// HASTA HOY esa arista la producia UN SOLO sitio, el cron de plazo vencido
// (`DevolucionSlaRepository.escalarDevueltaSla`, 99). Abrirla a una persona cambia QUIEN puede
// mover dinero, y por eso la ficha lo trata como requisito de dinero y no como un boton mas.
//
// PARIDAD CON EL CRON (D1, firmada): la accion se modela como una GESTION SINTETICA
// `resultado = rechazada` con `cierre_id NULL` y el `mensajero_id` de la ultima gestion `devuelta`
// vigente — exactamente lo que escribe el cron—. Asi el rechazo manual y el rechazo por plazo
// vencido facturan LO MISMO, sin una linea de aritmetica nueva. Sin esa gestion, rechazar a mano
// saldria GRATIS y esperar al plazo costaria, sobre el mismo paquete: una asimetria que invita a
// usar el camino equivocado.
//
// Logica de negocio pura (sin HTTP ni Prisma); el borde (Server Action) la traduce a resultado
// tipado.

/**
 * Maquina de resultados de dominio (patron `ReprogramarNovedadResult`). Todos los rechazos son SIN
 * efectos en datos.
 *   - `ok`: transiciono `devuelta -> rechazada` + gestion sintetica + fila de historial (R1/R8/R11).
 *   - `forbidden`: el actor no es el adminTienda dueño (R2). NO revela el estado de la orden: es el
 *     mismo valor para «otro rol» y «otra tienda», y va ANTES de mirar el estatus.
 *   - `not_found`: orden inexistente o borrada.
 *   - `conflict`: la orden ya no esta en la devolucion anclada (el cron se adelanto, la bodega la
 *     recupero, o es un segundo envio). Idempotente, sin efectos (R3/R5).
 *   - `config_error`: el catalogo no tiene `devuelta` o `rechazada`. Fallo CERRADO: sin los dos
 *     ids no hay guarda que poner en el `where`, y escribir sin guarda es justo lo que R4 prohibe.
 *   - `sin_gestion_origen`: la orden esta en la devolucion anclada pero NO tiene ninguna gestion
 *     `devuelta` vigente de la que derivar el mensajero (R10). SIN EFECTOS: la transaccion aborto.
 *
 * ⚠️ POR QUE `sin_gestion_origen` ES UN ESTADO PROPIO Y NO UN `conflict`, que es lo que parecia a
 * primera vista y seria mas corto. La pantalla NO PINTA el `motivo` de un `conflict` — lo dice su
 * propio codigo, y con razon: ese motivo es una cadena tecnica («la orden ya no esta en devuelta»),
 * pensada para un registro—. Asi que un `conflict` aqui le ensenaria a la tienda el texto fijo de la
 * carrera perdida, «esta orden ya no estaba en devolucion», que es FALSO: la orden SI sigue en
 * devolucion; lo que falta es su gestion. Un dato que miente con formato de dato, que es
 * exactamente lo que este repo lleva media sesion cazando.
 *
 * Y con estado propio el `Record<Exclude<status, "ok" | "conflict">, string>` de la pantalla DEJA DE
 * COMPILAR hasta que alguien le escriba su mensaje: la omision se vuelve imposible en vez de
 * silenciosa, que es el mecanismo que esa pantalla ya tenia montado para justo esto.
 */
export type RechazarNovedadResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "conflict"; motivo: string }
  | { status: "sin_gestion_origen" }
  | { status: "config_error" };

export interface IRechazoTiendaService {
  /**
   * R1/R2/R3/R12/R25: rechaza una orden en la devolucion anclada. Autoriza SOLO al `adminTienda`
   * dueño (`orden.tienda_id === actor.usuarioId`, la MISMA identidad que usa el listado de
   * novedades: no se escribe una segunda tabla de permisos). Guardia de estado (solo desde
   * `devuelta`; otro estado -> `conflict`). Persiste la transicion + la gestion sintetica
   * `rechazada` via el choke point de la feature 49, en la MISMA transaccion y guardada por
   * `estatus_id = devuelta` (R4/R15).
   *
   * `motivo` es OBLIGATORIO y ya viene validado del borde (R12/D5). El actor NUNCA viaja en el
   * input de la accion: lo fija la sesion.
   *
   * ⚠️ NO se comprueba si el plazo de la devolucion vencio (R25/D9), y es una decision: el plazo
   * existe para que el sistema decida CUANDO NADIE DECIDE. Exigirlo dejaria a la tienda con un
   * boton que falla las primeras 23 horas de cada 24, y la obligaria a descubrir el limite
   * pulsandolo.
   *
   * ⚠️ NO se comprueba el bloqueo del cierre del mensajero, igual que `rescatarOrdenAyuda` y que
   * `GestionDesdeAyudaService`: añadirlo crearia un interbloqueo — la tienda no podria resolver su
   * orden porque el mensajero no ha cerrado su dia.
   *
   * ⚠️ NO se puede deshacer (D6): la gestion que crea queda protegida por la guarda del deshacer
   * del mensajero. Quien llame a este metodo tiene que haberselo dicho antes al usuario.
   */
  rechazar(ordenId: string, motivo: string, actor: Actor): Promise<RechazarNovedadResult>;
}
