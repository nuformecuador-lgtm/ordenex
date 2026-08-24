// Feature 46 (R2/R3, decision F1.4-c) — motivo TIPADO y compartido del bloqueo por
// reprogramacion. Una orden en estatus `reprogramada` esta bloqueada hasta su
// `fecha_reprogramacion`: no es reasignable por ningun rol. Se usa como `motivo` en el
// `detalle` de `conflict` de los servicios de asignacion (maestro y adminSatelite) para
// que el rechazo sea accionable y testeable (defensa en profundidad: `reprogramada` ya
// no es un origen valido de asignacion, este guardia lo hace explicito).
export const MSG_ORDEN_REPROGRAMADA_BLOQUEADA =
  "orden reprogramada: bloqueada hasta la fecha de reprogramacion";

/**
 * FEATURE 271 (R28/R29/R30/R31, 2026-08-23) — motivo TIPADO y COMPARTIDO del rechazo cuando el
 * mensajero destino esta BLOQUEADO por cierres. Lo emiten las TRES escrituras que ponen trabajo en
 * la mano de un mensajero, y a proposito el MISMO texto en las tres: son la misma regla.
 *
 *   · `GuiaAsignacionService.asignarDesdeBodega`   — reparto desde la bodega central
 *   · `AsignacionSateliteService.asignar`          — reparto desde la bodega satelite
 *   · `GuiaAsignacionService.asignarRecoleccion`   — recoleccion en tienda
 *
 * ⚠️ ESTE MOTIVO VUELVE A EXISTIR, Y ESO ES UN CAMBIO DE REGLA. La feature 241 lo retiro junto con
 * sus guardas —la regla 2, que declaraba la asignacion exenta de todo bloqueo, firmada el
 * 2026-08-20— y llego a decir que
 * «ya no hay camino por el que este servicio pueda emitirlo». El humano revirtio esa mitad el
 * 2026-08-23: «un mensajero no puede hacer las dos gestiones, solo una a la vez». Lo que SOBREVIVE
 * de la 241 es que un cierre `solicitado` a secas (N=1, V=0) NO bloquea.
 *
 * Dice QUE pasa y QUE hacer, sin PII y sin nombrar a nadie: el detalle por orden se pinta junto a la
 * guia, y quien asigna no es quien resuelve el cierre.
 */
export const MSG_MENSAJERO_BLOQUEADO_POR_CIERRES =
  "el mensajero tiene cierres sin resolver: no puede recibir trabajo nuevo hasta que se aprueben";
