# Feature 99 — Webhooks de cambios de estado para integradores con API key

Requisitos en notación EARS. Cada `R<n>` termina mapeado a un test concreto
(`docs/specs.md` §Trazabilidad). Sin detalles de implementación: el CÓMO vive en
`design.md`.

**Alcance:** backend puro. (1) Almacenar en DB la suscripción de webhook por *owner*
(URL de callback + secreto de firma). (2) Emitir un job por cada cambio de estado de una
orden cuyo owner tenga suscripción activa, encolado en la MISMA transacción que registra
la transición al historial (feature 49). (3) Entregar por POST firmado al callback del
owner, con los reintentos/backoff/dead-letter que ya provee la cola (feature 90). (4)
Aislar por owner: un integrador NUNCA recibe eventos de órdenes de otro.

**Reutiliza (verificado contra el código, no supuesto):**
- El *owner* ya está en la orden: `orden.tienda_id = actor.usuarioId` = el usuario
  dedicado de la API key (`BulkOrdenService.cargarViaApi:280`, D4 de la feature 88). **No
  se crea un identificador de suscripción aparte** (pedido literal del humano).
- El único punto de registro de cambios de estado es `appendCambioEstado`
  (`lib/repositories/registrar-cambio-estado.ts`), el CHOKE POINT append-only de la
  feature 49, invocado por los ~13 call-sites de escritura de `orden.estatus_id`
  (`OrdenRepository`, `GestionOrdenRepository`, `LiberacionReprogramadaRepository`).
- La cola de la feature 90: `IJobRepository.enqueue(tipo, payload, opts, tx)` soporta
  transactional-outbox y `dedupeKey`; `JobQueueService` da backoff/dead-letter/recurrencia;
  `buildHandlers()` de `app/api/cron/procesar-jobs/route.ts` registra un handler por tipo.
- El modelo `ApiKey` (`db/schema.prisma:1039`), 1:1 con su usuario dedicado.

**Fuera de alcance (follow-up, declarado):** reintentos configurables por cliente; panel
de entregas; la pantalla de registro de la suscripción, que es la feature frontend hermana
**F100** (ya registrada; consume la Server Action de esta feature, D1/D4); rate-limiting;
rotación programada del secreto.

> **Gate F1.4 CERRADO (aprobado 2026-07-21).** D1–D5 resueltas (ver §"Resolución del gate
> F1.4" al final). Este documento ya refleja las decisiones: canal = Server Action en la UI
> (D1), secreto **cifrado en reposo** (D2), emisión **solo para órdenes cargadas por API
> key** (D3), `maxIntentos = 5` (D5), y un requisito nuevo de persistencia del desenlace de
> entrega (pedido del humano, **R31**).

---

## Bloque A — Modelo de datos y migración

**R1.** El sistema DEBE persistir, por *owner* (el usuario dueño de las órdenes), una
suscripción de webhook con: la URL de callback, un secreto de firma, un indicador de
actividad e instantes de creación/actualización; con a lo sumo UNA suscripción por owner
(`owner_usuario_id` único).
→ *Test:* `tests/integration/db/webhook-suscripcion-migracion.test.ts` —
"webhook_suscripcion expone owner_usuario_id único, url, secret, activa y timestamps".

**R2.** La tabla de suscripciones DEBE tener Row Level Security habilitada sin políticas,
quedando accesible solo desde el rol de servicio.
→ *Test:* `tests/integration/db/webhook-suscripcion-migracion.test.ts` —
"webhook_suscripcion tiene RLS habilitada y cero policies".

**R3.** El catálogo de tipos de job DEBE incluir el tipo `webhook_estado`.
→ *Test:* `tests/integration/db/webhook-suscripcion-migracion.test.ts` —
"job_tipo acepta el valor webhook_estado".

**R4.** CUANDO se ejecute el `down.sql` de esta migración, el sistema DEBE dejar el
esquema exactamente como estaba antes de aplicarla, incluida la tabla eliminada y el tipo
de job sin el valor `webhook_estado`.
→ *Test:* `tests/integration/db/webhook-suscripcion-rollback.test.ts` —
"el rollback elimina la tabla y el valor del enum sin dejar residuos".

---

## Bloque B — Registro de la suscripción (nivel servicio, agnóstico del canal)

> El **canal** de registro quedó FIJADO en **D1 = Server Action en la UI** (`Configuración >
> API`, rol `maestro`); la pantalla es la feature hermana **F100** (D4). El almacenamiento
> en DB y la lógica del servicio (este bloque) son independientes del canal y se especifican
> aquí; el controller concreto (Server Action) vive en `design.md` §9.

**R5.** CUANDO se registre una suscripción, el sistema DEBE validar en el borde que la URL
de callback es una URL absoluta con esquema `https`, y SI no lo es, ENTONCES DEBE
rechazar el registro con un error de validación sin persistir nada.
→ *Test:* `tests/unit/services/webhook-suscripcion-service.test.ts` —
"rechaza una URL no https o relativa sin persistir".

**R6.** CUANDO un owner que ya tiene suscripción registre de nuevo, el sistema DEBE
actualizar su suscripción existente (una sola fila por owner), sin crear una segunda fila.
→ *Test:* `tests/integration/repositories/webhook-suscripcion-repository.test.ts` —
"un segundo registro del mismo owner actualiza la fila, no crea otra".

**R7.** El sistema DEBE devolver el secreto de firma en claro ÚNICAMENTE en el momento en
que se genera (alta de la suscripción, R33; o rotación explícita, R34); cualquier consulta
o listado posterior de la suscripción NUNCA DEBE exponer el secreto, y el secreto DEBE
almacenarse **cifrado en reposo** (nunca en texto plano).
→ *Test:* `tests/unit/services/webhook-suscripcion-service.test.ts` —
"el alta retorna el secreto en claro (status creada), persiste su CIPHERTEXT y no lo expone al consultar".

**R8.** El sistema DEBE permitir dar de baja (desactivar) la suscripción de un owner, tras
lo cual sus órdenes dejan de generar entregas.
→ *Test:* `tests/unit/services/webhook-suscripcion-service.test.ts` —
"desactivar la suscripción la marca inactiva".

**R9.** El sistema NO DEBE permitir que un actor registre, consulte, rote ni desactive la
suscripción de un owner distinto del autorizado; cada suscripción pertenece a un único
owner.
→ *Test:* `tests/unit/services/webhook-suscripcion-service.test.ts` —
"un actor no puede operar la suscripción de otro owner".

**R33.** CUANDO se registre una suscripción, el sistema DEBE distinguir dos casos: SI el
owner NO tenía suscripción (ALTA), ENTONCES la crea generando y cifrando un secreto nuevo
que devuelve en claro UNA vez (resultado `creada`); SI el owner YA tenía suscripción
(EDICIÓN), ENTONCES DEBE actualizar únicamente la URL, CONSERVANDO el secreto existente y
SIN devolver ni regenerar secreto (resultado `actualizada`). Editar la URL NO rota el
secreto. *(Gate P4.)*
→ *Test:* `tests/unit/services/webhook-suscripcion-service.test.ts` —
"editar un owner existente actualiza la URL, conserva el secreto y NO devuelve secreto (actualizada)".

**R34.** El sistema DEBE ofrecer una rotación EXPLÍCITA del secreto de un owner con
suscripción existente, que genera y cifra un secreto NUEVO (invalidando el anterior) y lo
devuelve en claro UNA vez; SI el owner no tiene suscripción, ENTONCES DEBE responder
`not_found` sin generar nada. *(Gate P4.)*
→ *Test:* `tests/unit/services/webhook-suscripcion-service.test.ts` —
"rotar genera un secreto NUEVO distinto, lo persiste cifrado y lo devuelve una vez".

**R35.** El sistema DEBE ofrecer una lectura de la suscripción para la UI (feature 105) que
devuelva `{url, activa}` o `null`, y que NUNCA exponga el secreto (ni cifrado). *(Gate D2.)*
→ *Test:* `tests/unit/actions/webhooks-action.test.ts` —
"R35: devuelve la vista {url, activa} y NUNCA el secreto".

---

## Bloque C — Emisión por cambio de estado (transactional outbox)

**R10.** CUANDO se registre una transición de estado de una orden cuyo owner tenga una
suscripción ACTIVA, el sistema DEBE encolar un job `webhook_estado` para esa transición
dentro de la MISMA transacción que inserta la fila de historial.
→ *Test:* `tests/integration/repositories/orden-webhook-enqueue.test.ts` —
"una transición de una orden con owner suscrito deja un job webhook_estado pendiente".

**R11.** SI la transacción que cambia el estado se revierte, ENTONCES el sistema NO DEBE
dejar ningún job `webhook_estado` encolado.
→ *Test:* `tests/integration/repositories/orden-webhook-enqueue.test.ts` —
"si el cambio de estado falla no queda job huérfano en la cola".

**R12.** El sistema DEBE encolar `webhook_estado` ÚNICAMENTE para transiciones de órdenes
cargadas por API key —es decir, cuyo owner (`orden.tienda_id`) sea un usuario de API key
(rol `apiKey`) con suscripción ACTIVA—; SI el owner no tiene suscripción activa, o no es un
usuario de API key, ENTONCES NO DEBE encolar job.
→ *Test:* `tests/integration/repositories/orden-webhook-enqueue.test.ts` —
"solo encola para órdenes de un owner rol apiKey con suscripción activa; no encola para órdenes de un adminTienda ni de un owner sin suscripción".
> **Invariante D3 (verificada en el código):** el usuario de rol `apiKey` no tiene filas en
> `rol_permiso` (fallo seguro de la 81, `schema.prisma:41`), así que **no puede crear
> órdenes por UI**: sus únicas órdenes son las creadas vía API (`cargarViaApi`). El filtro
> por-owner + el guard de rol `apiKey` restringe la emisión a "solo órdenes cargadas por API
> key" por construcción.

**R13.** El payload del job DEBE contener únicamente los datos necesarios para resolver la
entrega (identificador de la orden, estado destino e instante de la transición) y NUNCA el
secreto de firma.
→ *Test:* `tests/unit/services/webhook-estado-encolado.test.ts` —
"el payload encolado lleva ordenId, estado e instante y no lleva secreto".

**R14.** El sistema DEBE derivar una clave de idempotencia que identifique la transición
como un EVENTO ÚNICO, de modo que dos órdenes distintas —o una misma orden que vuelve a un
estado por el que ya pasó (reintentos)— NUNCA colapsen en una sola entrada de cola.
→ *Test:* `tests/unit/services/webhook-estado-encolado.test.ts` —
"dos transiciones distintas (incluida la repetición del mismo estado) producen claves distintas".

**R15.** El sistema DEBE emitir únicamente para las transiciones incluidas en la política
de eventos públicos `EVENTOS_PUBLICOS`, y SI una transición no está en esa política,
ENTONCES NO DEBE encolar job para ella.
→ *Test:* `tests/unit/services/webhook-estado-encolado.test.ts` —
"un estado dentro de EVENTOS_PUBLICOS emite y uno fuera de ella no".
> **Política FIJADA (D3):** `EVENTOS_PUBLICOS` = los estados del ciclo de vida relevantes
> al integrador: `en_ruta_bodega_principal`, `en_bodega`, `en_reparto`, `entregada`,
> `reprogramada`, `devuelta`, `rechazada`, `devuelta_origen`, `recibido_origen`. Se excluyen
> los estados internos de fulfillment/ruteo que el integrador no consume
> (`en_fulfillment`, `en_preparacion`, `en_espera_aceptacion`, `en_ruta_bodega_satelite`,
> `en_bodega_satelite`). La lista vive en una constante única (`lib/types/webhook-eventos.ts`).

**R16.** El sistema DEBE emitir desde el único choke point de append al historial
(`appendCambioEstado`), de modo que TODA transición registrada por cualquiera de los
call-sites de escritura de estado sea candidata a webhook, sin añadir puntos de emisión
nuevos ni depender de que cada call-site recuerde emitir.
→ *Test:* `tests/integration/repositories/orden-webhook-enqueue.test.ts` —
"transiciones originadas por dos mecanismos distintos (creación y gestión) encolan por igual".

---

## Bloque D — Entrega firmada (handler)

**R17.** CUANDO el drenador ejecute un job `webhook_estado`, el sistema DEBE enviar una
petición POST con cuerpo JSON a la URL de callback de la suscripción activa del owner de la
orden referida.
→ *Test:* `tests/unit/services/webhook-estado-service.test.ts` —
"con suscripción activa hace POST a la URL del owner con el cuerpo del evento".

**R18.** El sistema DEBE firmar cada entrega con HMAC-SHA256 del secreto del owner sobre
`${timestamp}.${cuerpo}`, e incluir la firma y el timestamp en las cabeceras
`X-Ordenex-Signature: sha256=<hex>` y `X-Ordenex-Timestamp: <unix>`, de modo que el
consumidor pueda verificar autenticidad e integridad y descartar reenvíos fuera de la
ventana `WEBHOOK_REPLAY_WINDOW_S` (anti-replay).
→ *Test:* `tests/unit/crypto/webhook-firma.test.ts` —
"la firma es HMAC-SHA256 determinista sobre timestamp + cuerpo y cambia si cualquiera cambia".

**R19.** SI el callback responde con un estado de éxito (2xx), ENTONCES el sistema DEBE dar
el job por COMPLETADO.
→ *Test:* `tests/unit/services/webhook-estado-service.test.ts` —
"una respuesta 2xx completa el job".

**R20.** CUANDO el callback responda con un estado no satisfactorio (no-2xx), agote el
tiempo de espera o falle la red, el sistema DEBE fallar el job de forma recuperable para
que la cola lo reintente con su backoff.
→ *Test:* `tests/unit/services/webhook-estado-service.test.ts` —
"un 5xx, un timeout y un fallo de red lanzan para reintento".

**R21.** SI entre el encolado y la entrega la suscripción del owner fue desactivada o
eliminada, ENTONCES el sistema DEBE dar el job por COMPLETADO sin entregar (no reintenta un
destino que ya no existe).
→ *Test:* `tests/unit/services/webhook-estado-service.test.ts` —
"sin suscripción activa el job se completa sin hacer POST".

**R22.** SI la orden referida por el job no existe o está borrada, ENTONCES el sistema DEBE
dar el job por COMPLETADO sin error.
→ *Test:* `tests/unit/services/webhook-estado-service.test.ts` —
"un job de una orden inexistente o borrada se completa sin error".

**R23.** El sistema DEBE ser idempotente: reejecutar el mismo job DEBE producir un cuerpo
determinista con el mismo identificador de evento, de modo que el consumidor pueda
deduplicar reentregas sin corromper su estado.
→ *Test:* `tests/unit/services/webhook-estado-service.test.ts` —
"reejecutar el job produce el mismo identificador de evento y el mismo cuerpo".

---

## Bloque E — Aislamiento por owner

**R24.** El sistema DEBE entregar el evento de una orden EXCLUSIVAMENTE a la suscripción
del owner de esa orden, y NUNCA a la de otro owner.
→ *Test:* `tests/unit/services/webhook-estado-service.test.ts` —
"el evento de la orden de un owner nunca se envía al callback de otro owner".

**R25.** MIENTRAS existan varios owners con suscripción activa, cada uno DEBE recibir
únicamente los eventos de sus propias órdenes.
→ *Test:* `tests/integration/repositories/orden-webhook-enqueue.test.ts` —
"con dos owners suscritos, cada job se resuelve al callback de su propio owner".

---

## Bloque F — Cola, reintentos y wiring del cron

**R26.** El sistema DEBE registrar el handler de `webhook_estado` en el drenador de la
cola, y este tipo de job NO DEBE ser recurrente (se encola por evento, no por reloj).
→ *Test:* `tests/integration/api/procesar-jobs-webhook-estado.test.ts` —
"el drenador resuelve el handler de webhook_estado y no lo re-agenda".

**R27.** Los jobs `webhook_estado` DEBEN encolarse con una política de reintentos y
dead-letter explícita, de modo que un callback caído temporalmente se reintente con backoff
y un callback permanentemente roto termine en la cola de fallidos de forma visible, sin
bloquear el drenado del resto de la cola.
→ *Test:* `tests/unit/services/webhook-estado-encolado.test.ts` —
"el encolado fija maxIntentos en 5 para el tipo webhook_estado".
> **Valor FIJADO (D5):** `maxIntentos = 5` (override por fila en el `enqueue`).

**R28.** La configuración de entrega (timeout, y en su caso ventana anti-replay y límites)
DEBE resolverse por variables de entorno y NUNCA estar incrustada en el código; su ausencia
NO DEBE provocar una excepción al cargar la configuración.
→ *Test:* `tests/unit/config/webhook-config.test.ts` —
"la configuración ausente o vacía se resuelve a defaults sin lanzar".

---

## Bloque G — Seguridad, privacidad y robustez del handler

**R29.** El sistema NUNCA DEBE registrar en logs el secreto de firma, la URL de callback ni
los datos personales del destinatario; los conteos de la corrida del cron DEBEN permanecer
agregados y sin datos personales.
→ *Test:* `tests/unit/services/webhook-estado-service.test.ts` —
"ningún log emitido contiene secreto, URL ni datos del destinatario".

**R30.** El sistema DEBE validar el payload del job con un validador en el borde del
handler antes de usarlo, y SI la forma no cumple el contrato, ENTONCES DEBE fallar con un
error que identifique la operación sin exponer el secreto.
→ *Test:* `tests/unit/services/webhook-estado-service.test.ts` —
"un payload con forma inesperada produce error de integración sin secreto".

**R31.** CUANDO una entrega falle, el sistema DEBE persistir de forma consultable que hubo
error y su motivo (el detalle del desenlace transitorio), asociado al job de esa entrega,
sin exponer el secreto.
→ *Test:* `tests/unit/services/webhook-estado-service.test.ts` —
"un fallo de entrega propaga el detalle del error para que quede persistido en last_error del job, sin secreto".
> **Mínimo suficiente (design §12):** se apoya en la fila `jobs`, que ya persiste `estado`,
> `intentos`, `updated_at` y `last_error` vía `JobQueueService.fail`. El requisito exige que
> el `detalle` del outcome transitorio del handler llegue al `Error` que la cola escribe en
> `last_error`. NO se crea una tabla de entregas por-orden (eso es el "panel de entregas",
> follow-up declarado).

**R32.** El secreto de firma DEBE almacenarse cifrado en reposo con una clave simétrica
resuelta por entorno, y descifrarse únicamente para firmar en el momento de la entrega; SI
la clave de cifrado no está configurada, ENTONCES la carga de configuración NO DEBE lanzar,
pero el job de entrega DEBE fallar de forma recuperable (sin loguear jamás el secreto).
→ *Test:* `tests/unit/crypto/webhook-secret-cipher.test.ts` —
"cifrar y descifrar es round-trip fiel; sin clave configurada el descifrado lanza error recuperable sin filtrar el secreto".

---

## Trazabilidad — resumen

| Bloque | Requisitos | Archivo(s) de test principal |
| --- | --- | --- |
| A · Datos | R1–R4 | `tests/integration/db/webhook-suscripcion-migracion.test.ts`, `…-rollback.test.ts` |
| B · Registro | R5–R9, R33–R35 | `tests/unit/services/webhook-suscripcion-service.test.ts`, `tests/integration/repositories/webhook-suscripcion-repository.test.ts`, `tests/unit/actions/webhooks-action.test.ts` |
| C · Emisión | R10–R16 | `tests/integration/repositories/orden-webhook-enqueue.test.ts`, `tests/unit/services/webhook-estado-encolado.test.ts` |
| D · Entrega | R17–R23 | `tests/unit/services/webhook-estado-service.test.ts`, `tests/unit/crypto/webhook-firma.test.ts` |
| E · Aislamiento | R24–R25 | `tests/unit/services/webhook-estado-service.test.ts`, `tests/integration/repositories/orden-webhook-enqueue.test.ts` |
| F · Cola/wiring | R26–R28 | `tests/integration/api/procesar-jobs-webhook-estado.test.ts`, `tests/unit/services/webhook-estado-encolado.test.ts`, `tests/unit/config/webhook-config.test.ts` |
| G · Seguridad | R29–R32 | `tests/unit/services/webhook-estado-service.test.ts`, `tests/unit/crypto/webhook-secret-cipher.test.ts` |

**Total: 35 requisitos, 35 con test concreto mapeado. Ninguno huérfano.**

> **Delta gate P4/D2 (2026-07-22).** Se añadieron **R33** (editar la URL preserva el
> secreto: alta `creada` con secreto una vez vs edición `actualizada` sin secreto), **R34**
> (rotación explícita del secreto vía service `rotarSecreto` + Server Action
> `rotarSecretoWebhook`) y **R35** (lectura `obtenerWebhook` para la UI, feature 105, sin
> secreto). R7 y R9 quedaron reescritos para reflejar que el secreto solo sale al generarse
> (alta o rotación) y que la rotación también es una operación keyed por owner.

---

## Resolución del gate F1.4 (aprobado 2026-07-21)

**Estado: CERRADO.** No quedan preguntas abiertas. La spec es ejecutable. El humano aprobó
la feature y fijó las cinco decisiones, más un requisito nuevo (R31).

| # | Decisión tomada | Dónde vive ahora |
| --- | --- | --- |
| D1 | **UI en `Configuración > API`.** El controller es una **Server Action** (`lib/actions/webhooks.ts`, autorizada al rol `maestro`, patrón feature 82), **no** un endpoint por API key. | R5–R9, design §9, tasks T10 |
| D2 | **Secreto CIFRADO EN REPOSO** (AES-256-GCM, clave `WEBHOOK_SECRET_ENC_KEY` en entorno). Cifrado del secreto legible que se necesita para firmar; **no** texto plano. Firma de entrega: HMAC-SHA256 sobre `${timestamp}.${cuerpo}`, cabeceras `X-Ordenex-Signature`/`X-Ordenex-Timestamp`, ventana `WEBHOOK_REPLAY_WINDOW_S`. | **R32**, R7, R18, design §1.3/§3 |
| D3 | **Solo las actualizaciones de estado de las órdenes CARGADAS POR API KEY.** Sostenido por la invariante de rol `apiKey` (sin `rol_permiso` → sin creación por UI) + guard explícito. `EVENTOS_PUBLICOS` fijada; payload de entrega con `num_guia`, `num_remision`, estado en texto e instante. | R12, R15, design §5/§6/§7 |
| D4 | **F100 nace** (feature frontend hermana, ya registrada): pantalla de registro en `Configuración > API`, consume la Server Action de D1. | Fuera de alcance de la 99 |
| D5 | **`maxIntentos = 5`** para el tipo `webhook_estado`. | R27, design §6 |

**Requisito nuevo pedido por el humano (R31):** persistir el desenlace de cada entrega
("guardar si es error y cuál fue"). Resuelto con el **mínimo suficiente**: la fila `jobs`
ya persiste `estado`, `intentos`, `updated_at` y `last_error` (vía `JobQueueService.fail`);
basta con que el `detalle` del outcome transitorio del handler llegue a `last_error`. NO se
crea tabla de entregas por-orden (sería el "panel de entregas", follow-up declarado).

### Detalle de las decisiones cuyo "por qué" no puede perderse

**D2 — cifrado, no texto plano.** El emisor necesita el secreto LEGIBLE para firmar (a
diferencia de `ApiKey`, que solo compara un hash). Cifrarlo en reposo con clave en entorno
evita que el secreto viva en claro en la DB. La clave ausente NO rompe el arranque (config
no lanza, R28/R32) pero deja la entrega sin poder firmar → el job **falla recuperable** y
espera a que se configure la clave; el secreto NUNCA se loguea (R29/R32).

**D3 — "solo órdenes API" es correcto por construcción.** El owner de una suscripción es el
usuario dedicado de la API key (rol `apiKey`). Ese usuario no tiene filas en `rol_permiso`
(fallo seguro de la 81), así que **no puede crear órdenes por UI**: sus únicas órdenes son
las de `cargarViaApi`. El filtro por-owner del §5 ya restringe a órdenes API; se añade un
guard explícito de rol `apiKey` para que la invariante sea enforced y no incidental.

**D5 — `maxIntentos = 5`.** Con el backoff base de la 90, tolera un callback caído del orden
de minutos antes del dead-letter. Un callback de integrador que no responde no debe
reintentarse indefinidamente; 5 intentos y a la cola de fallidos (visible, R31).
