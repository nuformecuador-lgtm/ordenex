# Feature 454 — El estado real se pone al aprobar el cierre; la gestión se ve al instante

> Base medida: `specs/454-estado-al-aprobar-cierre/medicion.md` (censo del 2026-09-23, HEAD `849bc012`).
> Modelo **aprobado por el humano** el 2026-09-23 (ver §0). Diseño en `design.md`, desglose en `tasks.md`.
> Zona `fullstack`, se implementa backend → frontend. Sale a `prod` **junto con SF-001 y solo cuando el
> humano lo ordene**.

## 0. El modelo aprobado, en cinco líneas

1. Al gestionar, la orden **se queda en `en_reparto`**. La gestión se publica **al instante** como
   *pendiente de confirmación* (tienda, rastreo público, API, webhooks, notificaciones).
2. Al **aprobar el cierre** se aplica el estado real **en la misma transacción** de la aprobación
   (generalización del anclaje de la 239). Si el cierre corrige la gestión, la corrección queda como
   evento visible.
3. Se **eliminan** los estados `devolucion_por_confirmar` y `ayuda_tienda`. La ayuda a la tienda pasa a ser
   un evento sobre una orden que sigue en reparto.
4. `sin_gestionar` y `reprogramada` conservan **exactamente** su comportamiento actual. Esta ficha **no**
   cambia nombres ni códigos de ningún estado (eso es la 455).
5. Contrato de webhooks nuevo (el humano acepta romper integraciones; el aviso va en la release).

## 1. Glosario (los términos que usan los requisitos)

- **Gestión de calle**: gestión registrada por el mensajero desde su portal, o por la tienda dueña desde una
  ayuda abierta (la vía de la 237). Las gestiones sintéticas (escalado del plazo, rechazo por tope,
  reprogramación y rechazo de escritorio de la tienda) **no** son gestiones de calle.
- **Gestión pendiente de confirmar**: gestión de calle registrada después del despliegue de esta ficha, no
  anulada, cuyo cierre no está aprobado (sin cierre, `solicitado`, `vencido` o `rechazado`).
- **Orden con gestión pendiente**: orden en `en_reparto` que tiene una gestión pendiente de confirmar.
- **Orden en mano del mensajero**: orden en `en_reparto` **sin** gestión pendiente de confirmar.
- **Ayuda abierta**: la orden está en mano del mensajero, su último evento de ayuda es una solicitud y no ha
  habido ninguna transición de estado de la orden posterior a esa solicitud.
- **Gestión legada**: gestión registrada antes del despliegue de esta ficha (ya transicionó la orden al
  registrarse).
- **Aplicar una gestión**: llevar la orden de `en_reparto` al estado destino de su resultado (`entregada`,
  `reprogramada`, `rechazada`, `incidente`, `devuelta`).

---

## A. Registro de la gestión (sin cambio de estado)

- **R1** — CUANDO el mensajero registre una gestión sobre una orden gestionable, el sistema DEBE persistir la
  gestión con sus datos (resultado, motivo, causa, evidencias, desglose de pagos, ubicación) y DEBE dejar la
  orden en `en_reparto`, sin escribir ninguna fila en `orden_historial_estado`.
- **R2** — CUANDO se registre una gestión de calle, el sistema DEBE registrar en la misma transacción un
  evento *gestión registrada* con la orden, la gestión, el resultado, el motivo, el actor, el rol del actor
  congelado en ese instante y el instante.
- **R3** — El sistema DEBE considerar gestionable por el mensajero una orden solo si está en `en_reparto`,
  está asignada a ese mensajero, no tiene gestión pendiente de confirmar y no tiene ayuda abierta, además de
  las condiciones que ya exige hoy (bloqueo por cierres N/V, día de reparto, tope de intentos).
- **R4** — SI llegan dos registros de gestión concurrentes sobre la misma orden (doble envío, dos pestañas,
  mensajero y tienda), ENTONCES el sistema DEBE persistir exactamente uno y DEBE responder conflicto al otro
  sin dejar gestión, evidencia enlazada, evento ni job.
- **R5** — CUANDO se registre una gestión del mensajero, el sistema DEBE liberar su puntero de gestión en
  curso y DEBE encolar la reoptimización inmediata de su ruta en la misma transacción, igual que hoy.
- **R6** — MIENTRAS una orden tenga gestión pendiente de confirmar, el sistema NO DEBE listarla en «por
  gestionar» ni en «con ayuda» del portal del mensajero, NO DEBE pintarla en su mapa y NO DEBE incluirla como
  parada de su ruta optimizada.

## B. Aplicación del estado al aprobar el cierre

- **R7** — CUANDO se apruebe un cierre de día, el sistema DEBE aplicar, dentro de la transacción de la
  aprobación, cada gestión de calle vigente de ese cierre cuya orden esté en `en_reparto` y que sea la gestión
  de calle vigente más reciente de su orden.
- **R8** — CUANDO se aplique una gestión, el sistema DEBE escribir la transición por el punto único de
  historial enlazando la gestión, con esta familia y este actor: resultado `devuelta` → familia
  `anclaje_devolucion`, actor el aprobador; resultado `incidente` → familia `incidente`, actor el mensajero de
  la gestión; gestión del mensajero con otro resultado → familia `gestion`, actor el mensajero; gestión de la
  tienda desde ayuda → familia `gestion_tienda_ayuda`, actor la persona de la tienda que la registró.
- **R9** — SI la orden de una gestión del cierre ya no está en `en_reparto`, o esa gestión no es la gestión de
  calle vigente más reciente de su orden, ENTONCES el sistema NO DEBE mover la orden ni escribir historial de
  aplicación para ella, y la aprobación DEBE continuar sin error.
- **R10** — El sistema DEBE aplicar las gestiones después de los asientos de dinero de la aprobación y antes
  de la devolución de rechazadas (139), de modo que una orden que queda `rechazada` en esa aprobación llegue a
  `por_devolver` o `por_devolver_a_tienda` en esa misma aprobación.
- **R11** — SI cualquier paso de la aprobación falla, ENTONCES el sistema NO DEBE persistir ningún efecto de
  ella: ni el estado del cierre, ni dinero, ni estados de orden, ni historial, ni eventos, ni jobs.
- **R12** — CUANDO se intente aprobar de nuevo un cierre ya aprobado, el sistema NO DEBE aplicar ninguna
  gestión por segunda vez ni escribir historial adicional.
- **R13** — CUANDO se rechace un cierre, el sistema NO DEBE cambiar el estado de ninguna orden; sus órdenes
  con gestión pendiente DEBEN seguir en `en_reparto` con la gestión pendiente hasta que el cierre se vuelva a
  solicitar y se apruebe.
- **R14** — CUANDO se apruebe un cierre que contiene gestiones legadas, el sistema NO DEBE volver a aplicarlas
  y DEBE conservar para ellas el comportamiento de aprobación actual.

## C. Deshacer, corregir y gestiones legadas

- **R15** — CUANDO el mensajero deshaga una gestión pendiente de confirmar que aún no pertenece a ningún
  cierre, el sistema DEBE anularla, DEBE registrar un evento *gestión anulada* y NO DEBE escribir transición
  de estado; la orden DEBE volver a ser gestionable.
- **R16** — SI la gestión que el mensajero intenta deshacer fue registrada por la tienda, ENTONCES el sistema
  DEBE rechazar el deshacer con el mensaje actual («Esta orden la resolvió la tienda…»).
- **R17** — SI la gestión que se intenta deshacer ya pertenece a un cierre, ENTONCES el sistema DEBE
  rechazarlo como hoy.
- **R18** — CUANDO un maestro o admin corrija de `entregada` a `rechazada` una gestión pendiente de confirmar
  dentro de un cierre abierto de su alcance, el sistema DEBE sellar el nuevo resultado en la gestión, borrar su
  desglose de pagos, recalcular los seis totales del cierre, escribir la bitácora como hoy y registrar un
  evento *gestión corregida* con el resultado anterior y el nuevo, sin escribir transición de estado.
- **R19** — CUANDO se apruebe el cierre de una gestión corregida, el sistema DEBE aplicar el resultado
  corregido.
- **R20** — CUANDO la corrección o el deshacer recaigan sobre una gestión legada, el sistema DEBE conservar
  exactamente el comportamiento actual (incluidas las transiciones #31, #32, #33, #53 y #69).

## D. La ayuda a la tienda como evento

- **R21** — CUANDO el mensajero asignado pida ayuda sobre una orden gestionable, el sistema DEBE publicar la
  nota del hilo como hoy, DEBE registrar un evento *ayuda solicitada*, NO DEBE cambiar el estado de la orden y
  DEBE liberar su puntero de gestión en curso.
- **R22** — MIENTRAS una orden tenga ayuda abierta, el sistema DEBE: listarla en la pestaña de ayuda de
  `/novedades` de la tienda dueña; listarla en el grupo «con ayuda» del mensajero sin posición de ruta;
  excluirla de las paradas de la ruta; impedir que el mensajero la gestione; contarla como pendiente para
  solicitar el cierre; contarla en los KPI de «en mano» del mensajero; y abrir al `adminTienda` dueño la
  ventana de escritura del hilo y el contacto de chat que hoy abre `ayuda_tienda`.
- **R23** — CUANDO el mensajero pulse «Recuperar» o la tienda pulse «Habilitar» sobre una orden con ayuda
  abierta, el sistema DEBE registrar un evento *ayuda rescatada* y la orden DEBE volver a ser gestionable.
- **R24** — CUANDO un integrador habilite por API key una orden con ayuda abierta, el sistema DEBE registrar
  el evento de cierre de la ayuda y la fila de `orden_habilitacion_api`, y DEBE responder indicando que no
  hubo cambio de estado y que la ayuda quedó cerrada.
- **R25** — CUANDO la tienda dueña registre reprogramar o rechazar desde una ayuda abierta, el sistema DEBE
  registrar una gestión pendiente de confirmar atribuida al mensajero de la orden, y la ayuda DEBE dejar de
  estar abierta.
- **R26** — SI después de la solicitud de ayuda la orden sufre cualquier transición de estado, ENTONCES la
  ayuda DEBE dejar de estar abierta sin que ninguna operación tenga que cerrarla, también si la orden vuelve
  más tarde a `en_reparto`.
- **R27** — CUANDO el corte nocturno encuentre una orden con ayuda abierta, el sistema DEBE barrerla a
  `sin_gestionar` y vincularla al cierre `vencido` exactamente como hoy barre una orden en `ayuda_tienda`.
- **R28** — CUANDO se traspase a otro mensajero una orden con ayuda abierta, la ayuda DEBE seguir abierta,
  como hoy sigue en `ayuda_tienda`.

## E. Publicación al instante y al aprobar

- **R29** — MIENTRAS una orden tenga gestión pendiente de confirmar, el sistema DEBE mostrar a maestro,
  admin, adminSatelite de la zona y adminTienda dueña, en el listado y en el detalle de la orden, el estado
  «En reparto» junto con la señal «<resultado> — pendiente de confirmación».
- **R30** — El sistema DEBE mostrar en la línea de tiempo de la orden los eventos *gestión registrada*,
  *gestión anulada*, *gestión corregida*, *ayuda solicitada* y *ayuda rescatada/habilitada*, con actor e
  instante, a los mismos roles que hoy ven esa línea de tiempo.
- **R31** — MIENTRAS una orden tenga gestión pendiente de confirmar, el rastreo público DEBE mostrar como hito
  vigente «<resultado> — pendiente de confirmación», sin exponer actor, motivo libre ni datos personales.
  CUANDO la gestión se anule, el hito pendiente DEBE desaparecer; CUANDO se corrija, DEBE mostrar el resultado
  corregido; CUANDO se apruebe, DEBE mostrar el hito confirmado como hoy.
- **R32** — El detalle de orden por API key DEBE incluir en `gestiones[]` las gestiones pendientes, con
  `estadoResultante = null` y una marca de pendiente de confirmación; tras la aprobación, `estadoResultante`
  DEBE ser el estado aplicado.
- **R33** — DONDE el dueño de la orden tenga una suscripción de webhook activa, el sistema DEBE emitir:
  `orden.gestion_registrada` al registrar una gestión de calle; `orden.gestion_anulada` al deshacerla;
  `orden.gestion_corregida` al corregirla; `orden.estado_actualizado` al aplicarse el estado en la
  aprobación; `orden.ayuda_solicitada` y `orden.ayuda_resuelta` en la ida y la vuelta de la ayuda. Cada
  evento DEBE encolarse en la misma transacción que el hecho, con firma, reintentos, pausa por circuito e
  idempotencia iguales a los del canal actual, y sin datos personales en el payload del job.
- **R34** — El sistema NO DEBE emitir `orden.estado_actualizado` con los valores `ayuda_tienda` ni
  `devolucion_por_confirmar`.
- **R35** — CUANDO el mensajero registre una gestión `rechazada`, el sistema DEBE emitir el aviso in-app
  «orden rechazada por el destinatario» en ese instante, una sola vez, y NO DEBE emitirlo de nuevo al aprobar.
  Una gestión `rechazada` registrada por la tienda, un rechazo de escritorio y una corrección a `rechazada`
  NO DEBEN emitirlo, como hoy.
- **R36** — La documentación pública (OpenAPI y la referencia de webhooks) DEBE describir los eventos nuevos,
  la marca de pendiente de `gestiones[]`, la respuesta nueva de la habilitación por API y la desaparición de
  los dos estados.

## F. Retiro de los dos estados y migración

- **R37** — El sistema NO DEBE producir, aceptar como destino, listar como opción de filtro ni declarar en el
  grafo de transiciones los estados `devolucion_por_confirmar` y `ayuda_tienda`.
- **R38** — CUANDO se aplique la migración, el sistema DEBE llevar a `en_reparto` toda orden en
  `ayuda_tienda` o `devolucion_por_confirmar` (incluidas las borradas lógicamente), escribiendo por cada una
  una fila de historial con un motivo que identifique la migración; las que estaban en `ayuda_tienda` DEBEN
  quedar con ayuda abierta y la que estaba en `devolucion_por_confirmar` DEBE quedar con su gestión
  `devuelta` pendiente de confirmar.
- **R39** — CUANDO se aplique la migración, el sistema DEBE borrar del catálogo cada uno de los dos valores
  solo si ninguna orden, fila de historial ni vínculo de cierre lo referencia.
- **R40** — El sistema DEBE seguir mostrando las filas históricas que referencian los dos valores (línea de
  tiempo, rastreo público, cierres barridos) con la misma lectura que hoy.
- **R41** — CUANDO se aplique el `down.sql` de la migración, el sistema DEBE devolver a su estado de origen
  las órdenes movidas por la migración que sigan intactas, reponer los valores del catálogo y retirar las
  estructuras nuevas, dejando todas las gestiones pendientes de confirmar aplicadas según el modelo anterior.
- **R42** — La migración NO DEBE encolar webhooks, notificaciones ni jobs.

## G. No-regresión (los puntos delicados del censo)

- **R43 (D4, corte nocturno)** — CUANDO corra el corte nocturno, el sistema NO DEBE barrer a `sin_gestionar`
  ninguna orden con gestión pendiente de confirmar, NO DEBE vincularla en `cierre_sin_gestion` y NO DEBE
  crearle una gestión sintética de rechazo; y DEBE seguir barriendo, con el mismo filtro de día de reparto que
  hoy, las órdenes en mano del mensajero.
- **R44 (D4, concurrencia)** — SI el corte nocturno y un registro de gestión (o una solicitud de ayuda)
  concurren sobre la misma orden, ENTONCES el sistema DEBE producir exactamente uno de los dos desenlaces:
  o la orden queda barrida y el registro responde conflicto, o la gestión queda registrada y la orden no se
  barre.
- **R45 (D3, intentos)** — El sistema DEBE contar como intento de entrega, una vez por cierre aprobado
  distinto, toda gestión de calle vigente `devuelta`, `reprogramada` o `rechazada` de un cierre aprobado,
  y NO DEBE contar ninguna gestión sintética, ninguna gestión de un cierre no aprobado ni ninguna gestión
  anulada; para una misma historia de gestiones y aprobaciones el número DEBE ser igual al de hoy.
- **R46 (D3, tope 276)** — CUANDO se apruebe un cierre con órdenes barridas, el sistema DEBE decidir entre
  liberar a bodega y terminar en `rechazada` con gestión sintética que cobra exactamente con el mismo umbral,
  el mismo conteo y el mismo efecto de dinero que hoy.
- **R47 (D8, plazo de la tienda)** — El reloj del plazo de una devolución DEBE arrancar en el instante de la
  aprobación que la aplica, y el cron de devoluciones DEBE liberar o escalar (con su cobro) en los mismos casos
  y momentos que hoy.
- **R48 (D9, reprogramadas)** — CUANDO se apruebe un cierre con gestiones `reprogramada`, la liberación por
  timbre (315) y la del reloj de las 00:00 DEBEN liberar las mismas órdenes y en los mismos momentos que hoy,
  incluida la sonda de visita real.
- **R49 (D1/D2, dinero)** — Para un mismo conjunto de gestiones, el sistema DEBE congelar al solicitar el
  cierre los mismos totales y pagos, y DEBE emitir al aprobar exactamente los mismos movimientos de caja,
  ledger de tienda, contra-entrega, pago al mensajero e indemnización que hoy.
- **R50 (D5)** — CUANDO se apruebe un cierre, el sistema DEBE liberar o terminar solo las órdenes barridas
  por ese cierre (`cierre_sin_gestion`), como hoy.
- **R51 (D6)** — CUANDO se apruebe un cierre, el sistema DEBE llevar a `por_devolver`/`por_devolver_a_tienda`
  las órdenes `rechazada` del mensajero de ese cierre cuya gestión `rechazada` vigente más reciente pertenece a
  ese cierre, no pertenece a ningún cierre o pertenece a un cierre ya aprobado, y NO DEBE mover las que la
  tengan en otro cierre aún no aprobado.
- **R52 (U3)** — El sistema DEBE permitir solicitar el cierre si y solo si el mensajero no tiene órdenes en
  `por_recoger` ni órdenes en mano (incluidas las de ayuda abierta) dentro del predicado de día de reparto
  actual; las órdenes con gestión pendiente de confirmar NO DEBEN bloquearlo.
- **R53 (D11)** — Para una misma jornada, los KPI del portal del mensajero («pendientes», «entregadas»,
  «por cobrar» y «Total a cobrar») DEBEN dar los mismos valores que hoy.
- **R54 (U5)** — El sistema NO DEBE permitir traspasar una orden con gestión pendiente de confirmar y DEBE
  seguir permitiendo traspasar las órdenes en mano, con o sin ayuda abierta.
- **R55 (U6)** — El sistema NO DEBE permitir cambiar el día de reparto de una orden con gestión pendiente de
  confirmar y DEBE conservar para el resto las reglas actuales.
- **R56 (U7/U8)** — El sistema NO DEBE contar las órdenes con gestión pendiente de confirmar como carga
  pendiente del mensajero (aviso de mensajero ocupado, «Generar guía», aviso de reparto de mañana).
- **R57 (dos gestiones vivas)** — SI una orden tiene más de una gestión de calle vigente, ENTONCES la
  aprobación DEBE aplicar solo la más reciente y NO DEBE mover la orden al aprobar el cierre de la otra.
- **R58 (cierre rechazado)** — CUANDO un cierre rechazado se vuelva a solicitar y se apruebe, el sistema DEBE
  aplicar sus gestiones una sola vez y emitir su dinero una sola vez.
- **R59 (cierre vencido / multi-día, 271)** — MIENTRAS un mensajero tenga varios cierres abiertos, la
  aprobación de uno NO DEBE aplicar gestiones, liberar barridas ni devolver rechazadas que pertenezcan a otro.
- **R60 (238)** — La confirmación física de la aprobación DEBE exigir y marcar exactamente las mismas
  gestiones que hoy.
- **R61 (satélite y SF-001)** — CUANDO un adminSatelite apruebe un cierre de su zona, el sistema DEBE aplicar
  las gestiones con el mismo comportamiento que en la central; los cierres de bodega (431, `cierre_bodega`)
  NO DEBEN cambiar de comportamiento.
- **R62 (tablero y analítica)** — Las medidas de gestión del tablero del día y de la analítica (contadas por
  gestión) DEBEN dar los mismos valores que hoy; las medidas por estado de la orden DEBEN reflejar el estado
  aplicado al aprobar.
- **R63 (425)** — La incorporación de rechazos de tienda como material de revisión del cierre DEBE seguir
  igual.
- **R64 (roles)** — Ningún rol DEBE ganar ni perder acceso a pantallas, acciones o datos por esta ficha,
  salvo la visibilidad de la gestión pendiente descrita en R29-R32.
- **R65 (avisos diarios)** — El aviso diario de novedades DEBE contar las ayudas abiertas donde hoy cuenta las
  órdenes en `ayuda_tienda`.

---

## Supuestos operativos (medidos o declarados)

- Producción se vació el 2026-08-25; el historial con el que se contrasta empieza ahí.
- Conteo del 2026-09-23 en producción: 27 órdenes en `ayuda_tienda`, 1 en `devolucion_por_confirmar`, 116 en
  `en_reparto`, 0 en `sin_gestionar`. Hay que re-medirlo el día del despliegue.
- El retraso de la visibilidad del estado es el de la aprobación del cierre (dato de la 239: mediana 8,2 h,
  p90 22,1 h, máximo 48,2 h). La gestión se ve al instante; el **estado** no. Es la semántica pedida.

## Fuera de alcance

- Cambiar nombres o códigos de estados (455) y los textos de ayuda por estado (456).
- Cerrar el agujero de intentos de `sin_gestionar` que la 215 declaró abierto.
- Retirar las ramas legadas (deshacer #31-#33/#53, corrección #69 sobre órdenes ya aplicadas): se miden y
  se retiran en otra ficha cuando su población sea cero.

## Preguntas abiertas

1. **Nombre del evento de cambio de estado.** El `status_note` de la ficha dice `estado_cambiado`. El diseño
   conserva `orden.estado_actualizado` (el evento que ya existe) para no romper sin ganancia a quien ya lo
   consume; la 455 es la que renombra códigos. ¿Se confirma, o se renombra aquí?
2. **Audiencia del cambio de contrato.** No medido: cuántas suscripciones de webhook activas y cuántas keys con
   tráfico en los últimos 30 días. Se mide antes de la release (tarea T5.1); no bloquea el código.
3. **Texto visible de la señal.** Se propone literal «<resultado> — pendiente de confirmación» (decidido por
   el humano para el rastreo). ¿Vale el mismo texto para las pantallas internas, o prefiere otro para
   maestro/admin?
4. **Lectores de `cierre_sin_gestion.estatus_origen_id`.** Tras la ficha, una orden barrida con ayuda abierta
   queda con origen `en_reparto`, no `ayuda_tienda`. No está confirmado si alguna pantalla distingue ese
   origen; la tarea T1.21 lo mide y, si alguna lo hace, lo deriva del evento de ayuda.
