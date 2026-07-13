# Feature 47 — Reintentos de entrega y escalado a rechazo — requirements.md

> FASE 2 / detalle. Una DEVOLUCIÓN (gestión `devuelta`) hace que la orden vuelva a la
> bodega para cumplir OTRO intento de entrega. Por ley se hacen MÍNIMO 3 intentos; la
> orden lleva un CONTADOR DE INTENTOS (derivado, no materializado). Al alcanzar el umbral
> de intentos fallidos, la orden ESCALA automáticamente a RECHAZO (estado final). Las
> devoluciones muestran cuántos intentos lleva la orden.
>
> Notación EARS. Cada `R<n>` es testeable y mapea a un test (ver `tasks.md`).
> Zona: fullstack. Complejidad: high. Depende de la feature 36 (gestión, done). Se apoya
> en la feature 49 (trazabilidad, YA en esta rama): CONSUME su derivador de conteo
> (`contarIntentos`, R24/R25 de la 49) y su choke point de escritura de estado
> (`registrar-cambio-estado`); NO crea columna materializada de contador.

## Glosario

- **Intento de entrega fallido:** una gestión del mensajero con `resultado = devuelta`.
  NO cuentan `entregada`, `reprogramada` ni `rechazada` directa.
- **Contador de intentos:** número de intentos fallidos de una orden, DERIVADO del
  historial (conteo de transiciones cuyo destino es `devuelta`), sin columna materializada.
- **Umbral (mínimo de intentos):** número mínimo de intentos de entrega que exige la ley
  antes de dar la orden por rechazada. Configurable, default 3.
- **Escalado:** transición automática de la orden a `rechazada` (estado final) cuando el
  intento fallido en curso alcanza el umbral.
- **Bodega responsable:** `en_bodega` si la zona de la orden es la central, `en_bodega_satelite`
  en caso contrario (misma regla de ruteo de las features 30/33/46).
- **Choke point (feature 49):** el único punto de append al historial de estados
  (`appendCambioEstado`), invocado en la MISMA transacción que cambia `orden.estatus_id`.

---

## Derivador de conteo (consumir la feature 49)

**R1** — El sistema DEBE derivar el número de intentos de entrega fallidos de una orden
del historial de estados (conteo de transiciones cuyo destino es `devuelta`), reutilizando
el derivador que entregó la feature 49 (`OrdenHistorialService.contarIntentos` /
`OrdenHistorialRepository.contarPorDestino`), SIN introducir una columna materializada en
`orden` ni una segunda fuente de verdad del contador.

**R2** — El sistema DEBE CONSUMIR ese derivador, no reimplementarlo: la feature 47 lee el
conteo y aplica la regla de escalado; la definición del conteo y su índice viven en la
feature 49. SI el catálogo aún no tiene el estado `devuelta` sembrado, el conteo DEBE ser 0
(comportamiento ya provisto por el derivador), sin lanzar error.

## Regla de umbral configurable

**R3** — El sistema DEBE resolver el mínimo de intentos de entrega ("umbral") por
configuración, con default 3 ("mínimo por ley"), sobreescribible por variable de entorno
sin cambiar código (patrón `lib/config/*`). El umbral DEBE ser un entero positivo ≥ 1; un
valor inválido o ausente DEBE caer al default 3.

**R4** — El sistema DEBE contar como intento de entrega fallido ÚNICAMENTE las gestiones
con `resultado = devuelta`. CUANDO un mensajero registra una gestión `reprogramada`, el
sistema NO DEBE incrementar el contador de intentos (la reagenda no es un intento fallido).

## Devolución NO terminal: retorno a la bodega responsable (intentos < umbral)

**R5** — CUANDO un mensajero registra una gestión `devuelta` Y el número de intentos
resultante queda POR DEBAJO del umbral, el sistema DEBE devolver la orden a su bodega
responsable (`en_bodega` si su zona es la central, `en_bodega_satelite` en caso contrario),
derivada de la zona de la orden reutilizando el ruteo existente (features 30/33/46,
`resolverDestinoCierre` + `findCentralZonaId`), para cumplir otro intento de entrega.

**R6** — CUANDO una orden vuelve a la bodega para reintentar, el sistema DEBE limpiar su
mensajero asignado (handoff limpio a la bodega, patrón de la liberación de la feature 46),
conservando su `num_guia` y sus datos.

**R7** — MIENTRAS una orden lleve intentos por debajo del umbral, la orden NO DEBE quedar
en reposo en `devuelta`: `devuelta` es una transición intermedia REINTENTABLE que se
resuelve, en la misma operación, hacia la bodega responsable.

## Escalado automático a rechazo (intento = umbral), atómico y por el choke point

**R8** — CUANDO un mensajero registra la gestión `devuelta` cuyo número de intento
resultante ALCANZA el umbral (la N-ésima devolución, con N = umbral), el sistema DEBE
escalar la orden a `rechazada` (estado FINAL) en la MISMA transacción de base de datos que
registra esa gestión, en vez de devolverla a la bodega. El escalado DEBE ser síncrono y
determinista (sin job/cron).

**R9** — El sistema DEBE hacer que la N-ésima devolución (N = umbral) sea la que escala: las
devoluciones 1ª..(N-1)-ésima DEBEN devolver la orden a la bodega para reintentar, y sólo la
N-ésima DEBE escalar a `rechazada`.

**R10** — CUANDO el sistema escala una orden a `rechazada`, DEBE persistir el cambio de
`orden.estatus_id` y su fila de historial a través del choke point de la feature 49
(`appendCambioEstado`) dentro de la MISMA transacción, con actor = sistema (nulo, no es una
persona) y una clasificación de origen apropiada. SI el cambio de estado o su rastro falla,
ambos DEBEN revertirse (atómico).

**R11** — CUANDO se registra una gestión `devuelta`, el sistema DEBE registrar primero la
transición hacia `devuelta` en el historial (para que el derivador la cuente) y, en la MISMA
transacción, registrar la transición de seguimiento (hacia la bodega responsable o hacia
`rechazada`); ambas transiciones DEBEN pasar por el choke point de la feature 49.

## Relación entre `devuelta`, `rechazada` y `devuelta_origen`

**R12** — El sistema DEBE tratar `devuelta` como intermedia/reintentable y `rechazada` como
FINAL. Tanto una gestión `rechazada` directa del mensajero (feature 36, `en_reparto →
rechazada`) como el escalado automático (`devuelta → rechazada`) DEBEN dejar la orden en
`rechazada` (final).

**R13** — El sistema NO DEBE escribir `devuelta_origen` en esta feature. `devuelta_origen`
(retorno a la tienda de origen) queda RESERVADO para la feature 48; la feature 47 no lo
invade.

## Actualización del test de cobertura de la feature 49

**R14** — El sistema DEBE actualizar el inventario/test de cobertura de escritura de estado
de la feature 49 (`orden-historial-cobertura.test.ts`, design §2 de la 49) para incluir la
transición de seguimiento del escalado/reintento como un punto de escritura de estado
CONOCIDO que atraviesa el choke point. Ninguna escritura de `orden.estatus_id` de esta
feature DEBE saltarse el choke point ni quedar fuera del inventario cerrado.

## Interfaz: nº de intentos en devoluciones

**R15** — CUANDO un actor autorizado ve una orden/devolución, el sistema DEBE mostrar
cuántos intentos de entrega lleva acumulados (conteo derivado), reutilizando la tabla de
órdenes existente y la línea de tiempo de la feature 49 (`HistorialOrdenTimeline` /
`HistorialOrdenSheet`).

**R16** — DONDE una orden tenga al menos una devolución, la UI DEBE presentar el conteo de
intentos en relación con el umbral (p. ej. "intento X de N"), con etiquetas legibles
reutilizando `estatus-label` (no UUIDs).

**R17** — El sistema DEBE autorizar la visualización del conteo de intentos reutilizando las
MISMAS reglas de visibilidad de la orden ya existentes (feature 49/R27): maestro/admin ven
todas; `adminTienda` sólo las de su tienda; `mensajero` sólo las asignadas/actuadas;
`adminSatélite` sólo las de su zona. Un actor sin visibilidad NO DEBE ver el conteo.

## Autorización del flujo

**R18** — El sistema DEBE conservar la autorización del flujo de gestión de la feature 36
(sólo el mensajero asignado gestiona su orden). El escalado a `rechazada` lo dispara el
SISTEMA como consecuencia síncrona de la N-ésima devolución; NO DEBE requerir ningún actor
adicional ni un permiso nuevo.

## Criterios de aceptación (no funcionales / verificación)

**R19** — El sistema NO DEBE introducir regresión en las transiciones ya existentes
(features 36/46/49). Las ramas `entregada`, `reprogramada` y `rechazada` directa DEBEN
conservar su comportamiento observable (estado destino, atomicidad, autz); SÓLO la rama
`devuelta` gana la transición de seguimiento. Los tests previos DEBEN seguir pasando.

**R20** — El sistema DEBE mantener `./init.sh` en verde: `typecheck` 0 errores, `lint` 0
errores y la suite de tests pasando, incluyendo los nuevos tests de esta feature.

**R21** — El sistema NO DEBE requerir un `order_status` nuevo (`devuelta`, `rechazada`,
`en_bodega`, `en_bodega_satelite` YA existen en `ORDER_STATUS_SEED`) ni una columna
materializada de contador. SI el diseño elegido añadiera valores nuevos al enum
`orden_historial_origen_tipo`, ENTONCES DEBE entregar una migración Prisma versionada con su
`down.sql` y demostrar el round-trip (`db:migrate` → `db:rollback` → `db:migrate`). El
diseño RECOMENDADO evita toda migración (ver `design.md §7` y F1.4-h).

**R22** — Cada `R<n>` DEBE mapear a al menos un test concreto (unit de la regla de umbral y
la decisión reintento/escalado; integración de la transición `devuelta → bodega` y
`devuelta → rechazada`; conteo derivado; actualización del test de cobertura; UI del
conteo; autorización), documentado en `progress/impl_47-*.md`.

---

## Preguntas abiertas (F1.4)

> Cada una con la RECOMENDACIÓN del spec_author + la alternativa. El humano decide en la
> puerta de aprobación. Nada se implementa hasta un "aprobado".

**(a) ¿Mínimo de intentos fijo o configurable?**
- **Recomendado:** CONFIGURABLE vía un módulo `lib/config/reintentos.ts` (patrón del flag
  reversible de la 41/43 y de `lib/config/ordenes.ts`/`gestion.ts`), `MIN_INTENTOS_ENTREGA`
  leído de env `REINTENTOS_MIN_INTENTOS` con **default 3** ("mínimo por ley"; permite subirlo
  sin tocar código). Un valor inválido cae al default.
- **Alternativa:** constante fija `3` en código. Más simple, pero cambiar la política de ley
  exige un deploy de código en vez de una variable de entorno.

**(b) ¿Qué cuenta como intento fallido?**
- **Recomendado:** SÓLO las gestiones `devuelta` cuentan para el contador. `reprogramada`
  NO es intento fallido (es reagenda; su liberación la maneja la feature 46). El conteo se
  deriva del historial (transiciones a `devuelta`), reusando `contarIntentos` de la 49.
- **Alternativa:** contar también otros resultados (p. ej. reprogramaciones repetidas). Se
  descarta: mezclaría reagenda con fallo de entrega y cambiaría la semántica legal de
  "intentos de entrega".

**(c) ¿Momento del escalado?**
- **Recomendado:** SÍNCRONO, en la MISMA transacción en que se registra la gestión `devuelta`
  número N (= umbral). Si con esta devolución se alcanza el umbral, la orden pasa directo a
  `rechazada` (final) en vez de volver a la bodega. Determinista, sin job. Con umbral 3: 1ª
  y 2ª devolución → bodega; la 3ª devolución ES la que escala.
- **Alternativa:** un job/cron diario que revise órdenes con ≥ umbral devoluciones y las
  escale (patrón de la liberación 46). Se descarta: introduce latencia, un estado transitorio
  "devuelta pendiente de escalar", y no determinismo, sin beneficio (el dato ya está a mano
  en la transacción de la gestión).

**(d) ¿Estado destino de una devolución NO terminal (intentos < umbral)?**
- **Recomendado:** vuelve a la bodega responsable (`en_bodega`/`en_bodega_satelite` derivado
  de `orden.zonaId` + `findCentralZonaId`, reusando el ruteo de 30/33/46 y la utilidad
  `resolverDestinoCierre`), limpiando el mensajero asignado (patrón de la liberación 46).
  Confirmado contra el código: hoy una gestión `devuelta` deja la orden en `estatus=devuelta`
  de forma terminal (sin reintento), porque `MisAsignacionesService.gestionar` fija
  `nuevoEstatusId = findEstatusIdByValue(input.resultado)`; la 47 cambia SÓLO esa rama.
- **Alternativa:** un estado intermedio dedicado (p. ej. `en_reintento`) donde la orden
  reposa hasta que un job la rutee. Se descarta: añade un `order_status` nuevo (migración de
  catálogo) y un job, cuando el ruteo a bodega ya existe y basta.

**(e) ¿Relación `devuelta` / `devuelta_origen` / `rechazada`?**
- **Recomendado:** `devuelta` = intermedia REINTENTABLE (se resuelve hacia la bodega o hacia
  el escalado en la misma operación; nunca queda en reposo). `rechazada` = FINAL (tras
  alcanzar el umbral, o rechazo directo del mensajero). `devuelta_origen` = FUERA DE ALCANCE:
  es el retorno a la tienda de la **feature 48** (depende de la 47). Confirmado contra el
  catálogo (`ORDER_STATUS_SEED`): los tres valores existen; `devuelta_origen` NO lo escribe
  hoy ningún call-site (reservado a la 48). La 47 no lo toca.
- **Alternativa:** unificar `devuelta` y `devuelta_origen` en un solo estado. Se descarta:
  rompería la distinción "vuelve a bodega para reintentar" (47) vs "vuelve a la tienda de
  origen" (48).

**(f) ¿El escalado atraviesa el choke point de la 49?**
- **Recomendado:** SÍ. La transición automática `devuelta → rechazada` (y la de reintento
  `devuelta → bodega`) usa `appendCambioEstado` (append al historial en la misma tx que el
  cambio de estado), con actor = sistema (nulo) por ser una transición automática (feature
  49/R21). Se AÑADE al inventario/test de cobertura de la 49 (R14). Sin doble fuente de
  verdad para el contador. **Sub-decisión (origen_tipo):** RECOMENDADO reutilizar el
  `origen_tipo = gestion` existente para la transición de seguimiento (misma causa: la
  gestión; enlazada por `gestion_orden_id`, distinguible por `actor = null` + par
  origen/destino), evitando así toda migración de enum. Alternativa: añadir valores nuevos al
  enum `orden_historial_origen_tipo` (p. ej. `reintento_devolucion`, `escalado_rechazo`) →
  historial autodescriptivo pero exige migración `ALTER TYPE ... ADD VALUE` con `down.sql`
  que recrea el enum (coste de reversibilidad). Ver `design.md §6` y §7.
- **Alternativa (descartada):** que la 47 mantenga su propio contador materializado en
  `orden.intentos` incrementado en cada devolución. Se descarta por doble fuente de verdad
  con el historial de la 49 (F1.4-a de la 49 ya lo descartó).

**(g) ¿UI del nº de intentos — dónde y quién la ve?**
- **Recomendado:** mostrar el nº de intentos en las vistas de órdenes/devoluciones como
  badge/columna, reutilizando la tabla de órdenes existente y la línea de tiempo de la 49
  (`HistorialOrdenTimeline`/`HistorialOrdenSheet`). Presentarlo como "intento X de N" para
  órdenes con ≥ 1 devolución. Visibilidad por rol reusando la autorización de la orden
  (feature 49/R27): maestro/admin (todas), adminTienda (su tienda), mensajero (sus
  asignadas/actuadas), adminSatélite (su zona). No existe hoy una vista dedicada de
  "devoluciones"; se surtea sobre la lista y el detalle/sheet ya existentes.
- **Alternativa:** una página/pestaña dedicada de "Devoluciones". Se descarta como follow-up:
  mayor cambio de navegación; el conteo cabe en las superficies existentes.

**(h) ¿Migración?**
- **Recomendado:** NO. No hace falta `order_status` nuevo (`devuelta`, `rechazada`,
  `en_bodega`, `en_bodega_satelite` ya existen) ni columna de contador (se deriva del
  historial de la 49). Con la sub-decisión (f) de reutilizar `origen_tipo = gestion`, TAMPOCO
  hay migración de enum → **la feature 47 no requiere ninguna migración**. SI en la aprobación
  se prefiere la variante con valores de enum nuevos, ENTONCES esa variante DEBE incluir su
  `down.sql` (recrear el enum sin los valores) y demostrar el round-trip (R21). Confirmado.
