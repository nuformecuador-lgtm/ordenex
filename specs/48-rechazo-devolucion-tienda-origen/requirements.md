# Feature 48 — Rechazo: devolución a la tienda de origen — requirements.md

> FASE 2 / detalle. Cuando una orden llega a RECHAZO (estado `rechazada`, final del
> proceso de entrega: por escalado tras N intentos fallidos — feature 47 — o por rechazo
> DIRECTO del mensajero — feature 36), la orden debe VOLVER a la tienda (admin de tienda)
> que la cargó originalmente en la carga masiva. Esta feature modela el RETORNO
> (`rechazada → devuelta_origen`) y la VISIBILIDAD de ese retorno para la tienda de origen.
>
> Notación EARS. Cada `R<n>` es testeable y mapea a un test (ver `tasks.md`).
> Zona: fullstack. Complejidad: high. Depende de la feature 47 (escalado a rechazo, done)
> y de la feature 36 (gestión / rechazo directo, done). Se apoya en la feature 49
> (trazabilidad, YA en esta rama): TODA transición pasa por su choke point de escritura de
> estado (`appendCambioEstado`) y su test de cobertura enumera los puntos de escritura.
> Se apoya en las features 6/26 (autorización por rol que ya filtra las órdenes del
> `adminTienda` a SU tienda) para la visibilidad.

## Glosario

- **`rechazada`:** estado FINAL del proceso de ENTREGA de una orden (la orden no se
  entregará). Se alcanza por DOS caminos, ambos ya implementados: rechazo DIRECTO del
  mensajero en la gestión (feature 36) y ESCALADO automático tras alcanzar el umbral de
  intentos fallidos (feature 47). En ambos, la orden conserva su `mensajero_asignado_id`
  (rastro del último mensajero) y su `num_guia`.
- **`devuelta_origen`:** estado que representa que el paquete físico RETORNÓ a la tienda
  (admin de tienda) que cargó originalmente la orden. Es el terminal real del ciclo de vida
  de una orden rechazada. Ya está sembrado en el catálogo (no requiere estado nuevo).
- **Tienda de origen:** el usuario `adminTienda` que cargó la orden en la carga masiva
  (features 15/16/27) o la creó (feature 6). Es `orden.tienda_id` (FK NOT NULL a `Usuario`).
- **Bodega responsable:** la bodega que administra la orden según su zona: la bodega
  central (rol `maestro`/`admin`) si la zona de la orden es la central, o la bodega satélite
  (rol `adminSatelite` de esa zona) en caso contrario (misma regla de las features 41/30/33).
- **Choke point (feature 49):** el único punto de append al historial de estados
  (`appendCambioEstado`), invocado en la MISMA transacción que cambia `orden.estatus_id`.

---

## Elegibilidad: ambos caminos a rechazo

**R1** — El sistema DEBE considerar elegible para el retorno a la tienda de origen a TODA
orden cuyo estado sea `rechazada`, con independencia del camino por el que llegó a
`rechazada`: rechazo DIRECTO del mensajero (feature 36) o ESCALADO automático tras el umbral
de intentos fallidos (feature 47). El criterio de elegibilidad DEBE ser el estado
`rechazada`, no el camino de origen.

**R2** — El sistema NO DEBE exigir ningún dato adicional en la orden para hacerla elegible:
la orden `rechazada` conserva su `tienda_id`, su `num_guia` y su `mensajero_asignado_id`
(ninguno de ellos se altera al llegar a `rechazada`).

## Disparo del retorno (acción explícita de la bodega responsable)

**R3** — MIENTRAS una orden esté en `rechazada`, el sistema DEBE tratar `rechazada` como el
resultado final del proceso de entrega en el que la orden REPOSA: el retorno a la tienda de
origen NO DEBE ocurrir de forma automática dentro de la misma transacción que registra el
rechazo o el escalado (features 36/47 quedan intactas, R14).

**R4** — CUANDO la bodega responsable de una orden ejecuta la acción "Devolver a la tienda"
sobre una orden en `rechazada`, el sistema DEBE transicionar la orden de `rechazada` a
`devuelta_origen`, representando que el paquete físico retornó a la tienda de origen.

**R5** — SI la acción "Devolver a la tienda" se solicita sobre una orden que NO está en
`rechazada`, ENTONCES el sistema DEBE rechazar la operación sin modificar el estado (guardia
de estado de origen). SI la orden ya está en `devuelta_origen`, ENTONCES la operación DEBE
ser idempotente (no re-transiciona ni duplica historial) y no DEBE producir error.

## Resolución de la tienda de origen

**R6** — El sistema DEBE resolver la tienda de origen a partir del campo existente
`orden.tienda_id` (el `adminTienda` que cargó/creó la orden), sin introducir ningún campo
nuevo en `orden`. La orden en `devuelta_origen` DEBE permanecer asociada a esa misma tienda.

## Transición atómica vía el choke point de la feature 49

**R7** — CUANDO el sistema transiciona una orden de `rechazada` a `devuelta_origen`, DEBE
persistir el cambio de `orden.estatus_id` y su fila de historial a través del choke point de
la feature 49 (`appendCambioEstado`) dentro de la MISMA transacción de base de datos. SI el
cambio de estado o su rastro falla, ENTONCES ambos DEBEN revertirse (atómico).

**R8** — CUANDO se registra la transición `rechazada → devuelta_origen` en el historial, el
sistema DEBE registrar como actor al usuario que ejecutó la acción (el administrador de la
bodega responsable), y clasificar la transición con un `origen_tipo` apropiado del catálogo
de la feature 49.

**R9** — El sistema NO DEBE permitir que ninguna escritura de `orden.estatus_id` de esta
feature se salte el choke point ni quede fuera del inventario cerrado de puntos de escritura
de estado de la feature 49 (`orden-historial-cobertura.test.ts`); el test de cobertura DEBE
actualizarse para reflejar el punto de escritura de `devuelta_origen` como CONOCIDO y
mantener sus invariantes (conjunto cerrado, un punto por familia de `origen_tipo`).

## Autorización del retorno

**R10** — El sistema DEBE autorizar la acción "Devolver a la tienda" ÚNICAMENTE al
administrador de la bodega responsable de la orden: `maestro`/`admin` (bodega central) para
órdenes de la zona central, y `adminSatelite` de la zona de la orden para las demás zonas
(misma derivación de bodega responsable de la feature 41). Un `adminTienda`, un `mensajero` o
un `adminSatelite` de otra zona NO DEBEN poder ejecutar el retorno.

**R11** — SI un actor sin permiso solicita el retorno, ENTONCES el sistema DEBE denegar la
operación (sin modificar estado ni historial) reutilizando el modelo de autorización por rol
ya existente, sin introducir un permiso nuevo.

## Visibilidad del retorno para la tienda de origen

**R12** — El sistema DEBE permitir que el `adminTienda` vea sus órdenes en estado `rechazada`
y `devuelta_origen` dentro de su módulo de órdenes (features 6/7/26), con el alcance acotado
SERVER-SIDE a su propia tienda (`orden.tienda_id = usuario`), reutilizando el filtrado por
rol que ya existe. Un `adminTienda` NO DEBE ver órdenes de otra tienda.

**R13** — El sistema DEBE presentar los estados `rechazada` y `devuelta_origen` con etiquetas
legibles (mapa `estatus-label` existente: "Rechazada" y "Devuelta a origen"), nunca con
valores crudos ni UUIDs.

**R14** — El sistema DEBE conservar la visibilidad ya definida para los demás roles: `maestro`
y `admin` ven todas las órdenes (incluidas las `rechazada`/`devuelta_origen` sobre las que
operan); el `adminSatelite` ve las de SU zona (necesario para ejecutar el retorno de su
bodega); el `mensajero` ve las asignadas/actuadas (línea de tiempo de la feature 49). No DEBE
introducirse un modelo de permisos nuevo.

**R15** — DONDE exista la línea de tiempo de la feature 49 (`HistorialOrdenTimeline` /
`HistorialOrdenSheet`), el sistema DEBE reflejar la transición `rechazada → devuelta_origen`
como una entrada más del historial de la orden (con su timestamp y actor), sin lógica de
presentación nueva más allá de la etiqueta del estado.

## No regresión y catálogo

**R16** — El sistema NO DEBE introducir regresión en las transiciones existentes (features
36/47/49). El rechazo directo (`en_reparto → rechazada`) y el escalado
(`devuelta → rechazada`) DEBEN conservar su comportamiento observable (estado destino,
atomicidad, conservación de `mensajero_asignado_id`, autz); esta feature SOLO añade la
transición `rechazada → devuelta_origen`. Los tests previos DEBEN seguir pasando.

**R17** — El sistema NO DEBE requerir un `order_status` nuevo: `rechazada` y `devuelta_origen`
YA existen en `ORDER_STATUS_SEED`. SI el diseño elegido añadiera un valor nuevo al enum
`orden_historial_origen_tipo` (para autodescribir el retorno) o una columna de auditoría del
retorno en `orden`, ENTONCES esa variante DEBE entregar una migración Prisma versionada con
su `down.sql` y demostrar el round-trip (`db:migrate` → `db:rollback` → `db:migrate`). El
diseño RECOMENDADO evita toda migración (ver `design.md §7`).

## Criterios de aceptación (no funcionales / verificación)

**R18** — El sistema DEBE mantener `./init.sh` en verde: `typecheck` 0 errores, `lint` 0
errores y la suite de tests pasando, incluyendo los nuevos tests de esta feature y el test de
cobertura de la feature 49 actualizado (R9).

**R19** — Cada `R<n>` DEBE mapear a al menos un test concreto (unit de la guardia de estado
de origen y la decisión de bodega responsable; integración de la transición atómica
`rechazada → devuelta_origen` por el choke point; autorización por rol/zona; visibilidad
server-side de la tienda; actualización del test de cobertura), documentado en
`progress/impl_48-*.md`.

---

## Preguntas abiertas (F1.4)

> Cada una con la RECOMENDACIÓN del spec_author + la alternativa. El humano decide en la
> puerta de aprobación. Nada se implementa hasta un "aprobado". La redacción EARS de arriba
> asume la opción RECOMENDADA de cada punto; si el humano elige otra, se ajustan los `R<n>`
> señalados.

**(a) Relación `rechazada` ↔ `devuelta_origen` y QUIÉN/CUÁNDO dispara el retorno (pregunta central).**
- **Recomendado — ACCIÓN MANUAL de la bodega responsable (afecta R3/R4/R8/R10).**
  `rechazada` es el estado FINAL del proceso de entrega en el que la orden REPOSA (la orden no
  se entregará). Una ACCIÓN explícita del administrador de la bodega responsable ("Devolver a
  la tienda") transiciona `rechazada → devuelta_origen` cuando el paquete físico se entrega de
  vuelta a la tienda de origen. Razones: (i) HAY un paso FÍSICO de devolución del paquete (el
  paquete queda en poder del mensajero/bodega tras el rechazo — `mensajero_asignado_id` se
  conserva — y debe viajar físicamente de vuelta a la tienda), análogo a la RECEPCIÓN física
  por escaneo de la feature 33; (ii) la propia descripción de la feature dice "llega a RECHAZO
  (estado final) ... la orden debe VOLVER", lo que implica que reposa en `rechazada` y LUEGO
  se retorna; (iii) deja un ACTOR auditable (quién ejecutó el retorno) en el historial de la
  49; (iv) preserva la distinción semántica `rechazada` (falló la entrega) vs `devuelta_origen`
  (paquete de vuelta en la tienda). Es coherente con la feature 47/R12 ("`rechazada` es
  FINAL"): sigue siendo el final del proceso de ENTREGA; `devuelta_origen` es el terminal de
  LOGÍSTICA de retorno.
- **Alternativa — AUTOMÁTICO al llegar a `rechazada`.** En la misma transacción que alcanza
  `rechazada` (dentro de `crearGestionYTransicionar`, reusando el patrón de seguimiento de la
  47 con `origen_tipo=gestion`, actor=null) se emite de una vez `rechazada → devuelta_origen`.
  Más barato (sin acción/endpoint nuevo, sin migración, el test de cobertura de la 49 sigue en
  11 puntos). Se descarta como default: la orden NUNCA reposaría en `rechazada`, lo que
  contradice "llega a RECHAZO (estado final)" y afirmaría el retorno FÍSICO antes de que
  ocurra. Queda a mano si el negocio prefiere no modelar el paso físico.

**(b) Cobertura de AMBOS caminos a rechazo.**
- **Recomendado — SÍ (afecta R1/R2).** Cualquier orden que llegue a `rechazada` es elegible
  para volver a la tienda, sin importar si llegó por rechazo directo (36) o por escalado (47).
  Confirmado contra el código: ambos caminos terminan en `rechazada` vía
  `GestionOrdenRepository.crearGestionYTransicionar` (#9 del mapa 49) y ambos conservan
  `mensajero_asignado_id`. La elegibilidad se define por el ESTADO (`rechazada`), no por el
  camino → un único flujo de retorno cubre ambos.

**(c) Resolución de la tienda de origen.**
- **Recomendado — reusar `orden.tienda_id`, NADA nuevo (afecta R6).** `orden.tienda_id`
  existe hoy como FK NOT NULL a `Usuario` (relación "OrdenTienda"), fijado en la carga masiva
  (feature 15) / creación (feature 6). La orden ya "sabe" a qué tienda pertenece. NO se
  requiere campo nuevo ni migración por este concepto. Sin riesgo: el campo es real y NOT
  NULL (verificado en `schema.prisma`).

**(d) Visibilidad para la tienda (y otros roles).**
- **Recomendado — reusar vista y autz existentes, alcance server-side por tienda (afecta
  R12/R14).** El `adminTienda` ya ve SOLO sus órdenes porque `OrdenService.listar` fuerza
  `where.tienda_id = actor.usuarioId`; basta con que su módulo de órdenes muestre las
  `rechazada` y `devuelta_origen` (p. ej. un apartado/badge "Devueltas/Rechazadas" o el filtro
  por estado ya soportado). Otros roles: `maestro`/`admin` ven todas (y ejecutan el retorno de
  la bodega central); `adminSatelite` ve las de su zona (y ejecuta el retorno de su bodega);
  `mensajero` ve las asignadas/actuadas. NOTA/sub-riesgo: `adminSatelite` NO está hoy en
  `KNOWN_ROLES` de `OrdenService`, por lo que el listado/acción para la bodega satélite puede
  requerir una superficie acotada por zona (reusando el patrón de las features 33/34), no el
  listado genérico de órdenes. Se resuelve en el diseño sin ampliar el modelo de permisos.

**(e) Transición vía choke point 49 + cobertura.**
- **Recomendado — reusar el choke point con `origen_tipo=ajuste_estado`, SIN migración
  (afecta R8/R9/R17).** La transición `rechazada → devuelta_origen` se persiste con
  `appendCambioEstado` en la misma tx que el `UPDATE` de estado, encaminada por el punto de
  escritura genérico existente (`OrdenRepository.update`, #11 del mapa 49, `origen_tipo =
  ajuste_estado`, actor = usuario autenticado), pero envuelta en un servicio DEDICADO que
  impone la guardia (origen = `rechazada`) y la autz (bodega responsable). Así NO se añade un
  call-site nuevo ni un `origen_tipo` nuevo: el test de cobertura de la 49 sigue en 11 puntos
  y sólo se DOCUMENTA que #11 (`ajuste_estado`) también sirve el retorno a tienda (igual que
  la 47 documentó que #9 sirve el seguimiento). Actor = el administrador de la bodega que
  ejecuta el retorno.
- **Alternativa — `origen_tipo` dedicado `devolucion_origen`.** Historial autodescriptivo,
  pero exige migración `ALTER TYPE "orden_historial_origen_tipo" ADD VALUE 'devolucion_origen'`
  con `down.sql` que RECREA el enum (reversibilidad frágil, mismo coste que la 47 §7), y el
  test de cobertura crece a 12 puntos (12 familias). Se descarta como default por el coste de
  la migración de enum frente a un beneficio marginal (el retorno ya es identificable por el
  par `rechazada → devuelta_origen`).

**(f) ¿Migración?**
- **Recomendado — NO (afecta R17).** `rechazada` y `devuelta_origen` ya están sembrados en
  `ORDER_STATUS_SEED`; la tienda de origen ya vive en `orden.tienda_id`; con la sub-decisión
  (e) de reutilizar `origen_tipo = ajuste_estado`, TAMPOCO hay migración de enum → **esta
  feature no requiere ninguna migración**.
- **Alternativa (declararla si se elige).** SI se prefiere (e)-alternativa (`origen_tipo`
  dedicado) O una columna de AUDITORÍA del retorno en `orden` (p. ej. `devuelta_origen_at`
  y/o `devuelta_origen_por`), ENTONCES esa variante DEBE incluir una migración aditiva con su
  `down.sql` inverso exacto y demostrar el round-trip (R17). No se recomienda: el instante y
  el actor del retorno ya quedan capturados por el historial de la feature 49.

**(g) ¿Superficie de la acción "Devolver a la tienda"?**
- **Recomendado — reusar las superficies existentes, sin nueva navegación mayor.** Para la
  bodega central (`maestro`/`admin`), la acción cabe en la vista de órdenes (filtrando/apartado
  de `rechazada`) o en un apartado de "Por devolver a tienda". Para la bodega satélite
  (`adminSatelite`), cabe en su módulo de bodega (patrón features 33/34), acotada a su zona.
  Sin página nueva dedicada salvo que el humano la pida (follow-up).
