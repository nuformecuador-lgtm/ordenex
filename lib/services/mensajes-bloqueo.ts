// Feature 46 (R2/R3, decision F1.4-c) — motivo TIPADO y compartido del bloqueo por
// reprogramacion. Una orden en estatus `reprogramada` esta bloqueada hasta su
// `fecha_reprogramacion`: no es reasignable por ningun rol. Se usa como `motivo` en el
// `detalle` de `conflict` de los servicios de asignacion (maestro y adminSatelite) para
// que el rechazo sea accionable y testeable (defensa en profundidad: `reprogramada` ya
// no es un origen valido de asignacion, este guardia lo hace explicito).
/**
 * Feature 21 (pedido humano 2026-08-26) — motivo TIPADO y COMPARTIDO del rechazo cuando el
 * mensajero destino NO tiene un vehiculo asociado. Lo emiten las DOS escrituras de
 * `mensajero_asignado_id` (`GuiaAsignacionService.asignarDesdeBodega` y
 * `AsignacionSateliteService.asignar`) con el MISMO texto, porque son la misma regla: quien
 * reparte necesita con que hacerlo. El alta/edicion del usuario ya lo exige, pero eso solo
 * cubre a los mensajeros creados DESPUES del cambio: los de antes pueden estar sin vehiculo,
 * y es aqui donde se les para.
 *
 * Dice QUE pasa y QUE hacer, sin PII: quien asigna no es quien edita el usuario.
 */
export const MSG_MENSAJERO_SIN_VEHICULO =
  "el mensajero no tiene un vehiculo asociado: asignaselo en Configuracion > Usuarios";

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

/**
 * FEATURE 276 (R6/R20/R38, 2026-08-24) — LOS DOS MOTIVOS DEL TOPE DE INTENTOS, en su punto UNICO.
 *
 * Son DOS textos y no uno porque son dos preguntas distintas del usuario: al mensajero (y a la
 * tienda desde la pestaña de ayuda) hay que decirle QUE SI PUEDE registrar; a quien asigna hay que
 * decirle que esa orden ya no sale a reparto. Lo que NO puede haber es dos COPIAS del mismo texto
 * en dos servicios: R20 exige que el de asignacion salga de un punto unico, y R4 que el de gestion
 * sea el mismo en las dos superficies que crean gestion.
 *
 * NINGUNO nombra guia, destinatario, direccion, id ni el VALOR del umbral (R38 y R10): son textos
 * fijos. `tests/unit/guards/tope-intentos-pii.guardia.test.ts` lo comprueba uno por uno.
 */

/**
 * R1/R6 — el rechazo de una gestion `reprogramada`/`devuelta` sobre una orden en el tope. Lo
 * emiten LAS DOS superficies que crean gestion, con el MISMO simbolo (R4):
 *
 *   · `MisAsignacionesService.gestionar`        — el panel del mensajero
 *   · `GestionDesdeAyudaService.gestionar`      — la pestaña de ayuda de la tienda (237)
 *
 * Dice QUE desenlaces siguen disponibles, que es lo que R6 pide («motivo accionable»). Enumera los
 * tres a mano y no desde `RESULTADOS_PERMITIDOS_EN_EL_TOPE` a proposito: el vocabulario del enum
 * (`entregada`, `incidente`) no es el de la pantalla, y una frase generada del enum diria
 * «incidente» donde la persona lee «Reportar incidente».
 */
export const MSG_TOPE_INTENTOS_GESTION =
  "esta orden ya agoto sus intentos de entrega: solo se puede registrar como entregada, " +
  "rechazada o como incidente";

/**
 * R18/R20 — el rechazo de la SALIDA A REPARTO de una orden que ya alcanzo el umbral. Punto UNICO,
 * y por eso lo emiten TRES sitios con el mismo simbolo:
 *
 *   · `GuiaAsignacionService.asignarDesdeBodega`  — asignacion desde la bodega central (R18)
 *   · `AsignacionSateliteService.asignar`         — asignacion desde la bodega satelite (R18)
 *   · `ReprogramacionTiendaService.reprogramar`   — la TERCERA via hacia la circulacion (Q2,
 *     FIRMADA el 2026-08-24): la tienda reprogramando desde una devolucion anclada. Sin ella la
 *     regla se cumpliria igual —R18 seria el tapon— pero el paquete quedaria en un callejon sin
 *     salida y la tienda no se enteraria hasta tres pasos despues.
 *
 * `asignarRecoleccion` queda FUERA (design §5.4): recolectar en tienda no es un intento de entrega
 * y una orden en `por_recolectar_en_tienda` tiene cero intentos. `deshacer_gestion` y
 * `recuperacion_manual` tambien quedan fuera (Q3): son movimientos correctivos o fisicos, no
 * salidas a reparto, y bloquearlos convierte la orden en algo que nadie puede tocar.
 */
export const MSG_TOPE_INTENTOS_ASIGNACION =
  "esta orden ya agoto sus intentos de entrega: no puede volver a salir a reparto";
