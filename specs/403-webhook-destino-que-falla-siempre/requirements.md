# 403 — Una suscripción de webhook que falla siempre ni se pausa sola ni avisa a nadie

## Contexto (no normativo, solo para lectura)

Medido en producción el 2026-09-09 contra el tipo de job `webhook_estado`: 2.042 fallos
`entregar webhook: HTTP 429` y 1.958 jobs muertos en 5 días, contra 60 entregas correctas,
todos contra una única suscripción activa. El leader la desactivó a mano el 2026-09-09 porque
apuntaba a un destino de pruebas.

**Actualización del mismo día (2026-09-09, posterior a la redacción inicial de este spec):**
esa misma suscripción SÍ tiene un dueño real detrás. El integrador reportó el 2026-09-07 que
llevaba días sin recibir eventos; la causa medida fue que la URL registrada era la de pruebas,
no la suya. El 2026-09-09 a las 22:27 UTC el leader corrigió la URL (conservando el secreto,
104/R7) y la dejó activa. **La suscripción que este spec vigila ahora sirve a alguien que
depende de ella para operar.**

**Decisión del humano, con esa información:** el mecanismo de esta ficha DEBE **pausar**, no
**desactivar**. Desactivar exige que un humano reactive a mano — y ya se demostró que ese
silencio puede durar cinco días sin que nadie lo note. La cura no puede parecerse a la
enfermedad. Todo lo que sigue en este documento usa exclusivamente el vocabulario de "pausa":
ninguna referencia a "desactivar" implica tocar el interruptor `activa` que el dueño controla
manualmente desde Configuración > API — ese interruptor es de la ficha 99/105/108 y esta ficha
no lo toca.

Alcance: el tipo de job `webhook_estado` (feature 99) y la tabla `webhook_suscripcion`
(features 99/105/108).

## Requisitos

### Circuito: un destino que rechaza sistemáticamente deja de castigar la cola, sin desconectarse

**R1** (Ubicuo). El sistema DEBE mantener, para cada suscripción de webhook, un contador de
entregas fallidas consecutivas y el instante de su última entrega exitosa (o de su alta o
reactivación más reciente, si nunca tuvo una entrega exitosa).

**R2** (Evento). CUANDO el envío HTTP de un job `webhook_estado` reciba una respuesta 2xx del
destino de una suscripción, el sistema DEBE reiniciar a cero el contador de fallos
consecutivos de esa suscripción, actualizar su instante de última entrega exitosa al momento en
que ocurrió, y — si la suscripción estaba pausada — dejar de tratarla como pausada de
inmediato, sin ninguna intervención manual.

**R3** (Evento). CUANDO el envío HTTP de un job `webhook_estado` NO reciba una respuesta 2xx
del destino de una suscripción (rechazo HTTP, timeout o fallo de red), el sistema DEBE
incrementar en uno el contador de fallos consecutivos de esa suscripción. Un error de
configuración propio (p. ej. clave de cifrado del secreto ausente) o un payload inválido, que
nunca llegan a intentar la petición HTTP, NO DEBEN incrementar este contador.

**R4** (Condicional). SI el contador de fallos consecutivos de una suscripción alcanza el
umbral configurado Y han transcurrido al menos la ventana configurada desde su última entrega
exitosa (o alta/reactivación), ENTONCES el sistema DEBE tratarla como **pausada**: los
siguientes intentos de entrega de sus jobs DEBEN espaciarse al intervalo de pausa configurado,
en vez del backoff exponencial normal.

**R5** (Condicional). SI una suscripción está pausada, ENTONCES el sistema NO DEBE modificar su
bandera `activa`, NO DEBE dejar de encolar nuevos jobs `webhook_estado` para ella, y NO DEBE
impedir que sus jobs se sigan reclamando y procesando por el drenador — sigue viva y
reintentando, solo que más espaciada.

**R6** (Condicional). SI una entrega falla y la suscripción todavía no cumple ambas
condiciones de R4 (fallos consecutivos insuficientes, o ventana sin transcurrir aún —incluida
una caída breve y aislada—), ENTONCES el sistema NO DEBE espaciar sus reintentos por encima
del backoff exponencial genérico que ya existe.

**R7** (Evento). CUANDO el dueño guarde de nuevo la URL de una suscripción desde la pantalla
existente (el mismo flujo de alta/edición ya vigente), el sistema DEBE reiniciar su contador de
fallos consecutivos y su instante de última entrega exitosa, saliendo de la pausa de inmediato
— es la palanca manual de "reintentar ya" sin necesidad de esperar a que llegue sola una
entrega exitosa.

**R8** (Opcional/Where). DONDE el umbral de fallos, la ventana sin éxito y el intervalo de
pausa de R4 no se configuren explícitamente, el sistema DEBE usar 3 fallos consecutivos, 30
minutos y 1 hora respectivamente como valores por defecto.

### Aviso: alguien se entera (y el texto dice lo que de verdad pasa)

**R9** (Evento). CUANDO una entrega falle mientras la suscripción está pausada (R4), el
sistema DEBE intentar emitir una notificación dirigida al rol `maestro` que describa que el
webhook está **pausado por fallos de entrega sostenidos** y que sus reintentos se espaciaron
automáticamente. La notificación NUNCA DEBE decir que la suscripción se "desactivó", "dio de
baja" o "canceló": sigue activa y sigue reintentando.

**R10** (Ubicuo). El sistema DEBE emitir la notificación de R9 reutilizando el mecanismo de
notificaciones ya existente (tabla `notificacion` + repositorio + patrón de notificador
best-effort), sin construir un canal de aviso nuevo.

**R11** (Condicional). SI la emisión de la notificación de R9 falla, ENTONCES el sistema DEBE
registrar el fallo con contexto (no un `catch` vacío), sin propagar el error y sin interrumpir
el procesamiento del resto del lote de jobs.

**R12** (Ubicuo/Evento). Mientras una suscripción permanezca en la MISMA racha de fallos sin
éxito, el sistema DEBE emitir como mucho una notificación para esa racha (no debe repetirla en
cada intento fallido posterior). CUANDO más adelante ocurra una racha nueva y distinta (tras
una recuperación o una reactivación manual), el sistema DEBE emitir una notificación
independiente para esa nueva racha.

**R13** (Ubicuo). El sistema NUNCA DEBE incluir la URL del webhook ni su secreto (en claro o
cifrado) en el texto de la notificación de R9 ni en ningún log emitido por esta feature.

### El 429 deja de tratarse como un fallo genérico

**R14** (Condicional). SI la respuesta de entrega de un webhook es HTTP 429 y trae una
cabecera `Retry-After` con un valor interpretable (segundos o fecha HTTP), ENTONCES el sistema
DEBE usar ese valor como tiempo mínimo de espera antes de reintentar ese job en concreto (nunca
menor que el backoff genérico que ya aplicaría).

**R15** (Condicional). SI la respuesta es HTTP 429 sin cabecera `Retry-After` interpretable,
ENTONCES el sistema DEBE aplicar el backoff exponencial genérico existente, igual que ante
cualquier otro fallo transitorio.

**R16** (Ubicuo). El sistema DEBE seguir contando un HTTP 429 como un intento transitorio
normal a efectos de `MAX_INTENTOS_WEBHOOK`: sigue yendo a dead-letter tras agotar sus 5
intentos, exactamente igual que hoy.

**R17** (Ubicuo). El tiempo de espera derivado de `Retry-After` (R14) o del intervalo de pausa
(R4) NUNCA DEBE superar el tope de backoff ya configurado en la cola, de modo que un valor
extremo o malformado del destino, o una racha de pausa muy larga, no bloqueen un job
indefinidamente.

### Visibilidad y reversibilidad (sin pausa silenciosa)

**R18** (Ubicuo). La consulta que hoy expone `url`/`activa` de una suscripción a la pantalla
de Configuración > API DEBE exponer también si está actualmente pausada y desde cuándo lleva
sin una entrega exitosa.

**R19** (Evento). CUANDO el dueño guarde de nuevo la URL desde la pantalla ya existente (R7),
la consulta de R18 DEBE dejar de mostrar la suscripción como pausada de inmediato, sin
necesidad de ninguna acción adicional ni de esperar a la siguiente entrega.

## Fuera de alcance (frontera con otras fichas)

- **Ficha 402** (la cola no reparte trabajo entre tipos): esta ficha reduce la *probabilidad*
  de que el tipo `webhook_estado` compita por el lote de 10 jobs/corrida (espaciando los
  reintentos de un destino que falla en racha). La 402 ataca un problema distinto y
  complementario: que *cuando* un tipo satura el lote, no debe dejar a los demás tipos sin
  turno. Ninguna sustituye a la otra.
- **Ficha 401** (la caída del geocodificador no avisa ni se recupera): comparte con esta ficha
  la necesidad de "avisar cuando algo falla sistemáticamente en la cola". Esta ficha deja listo
  un notificador reutilizable con ese propósito y una convención de deduplicación por RACHA
  (ver `design.md` §7); la 401 debe medir sus propios números (volumen de jobs de
  geocodificación, ventana de caída aceptable) en vez de heredar los de esta ficha sin más.
- No se toca el tamaño de lote del drenador, `MAX_INTENTOS_WEBHOOK`, ni el cálculo genérico de
  backoff exponencial de `JobQueueService` salvo la extensión puntual y genérica de R14/R17.
- No se añade ninguna bandera ni máquina de estados nueva para representar "pausada": es un
  estado DERIVADO de datos que ya hace falta guardar (R1), nunca persistido aparte (ver
  `design.md` §2, justificación explícita de por qué se evita la columna nueva).

## Preguntas abiertas

1. El umbral (3 fallos / 30 minutos) y el intervalo de pausa (1 hora) son una elección
   razonada con los datos disponibles (ver `design.md` §3), pero siguen siendo un juicio de
   producto: el humano puede preferir otro punto del equilibrio velocidad-de-reacción /
   tolerancia-a-blips. Son tres números de configuración (R8), no un cambio de diseño.
2. El texto exacto de la notificación (R9) es una propuesta (`design.md` §7); si Producto
   quiere un texto distinto, es un cambio de copy, no de mecanismo.
3. R18/R19 siguen obligando a tocar `app/(app)/configuracion/api/_components/WebhookAccionCell.tsx`
   para que "el dueño pueda verlo", aunque la ficha está etiquetada `zone: backend`. Se mantiene
   en este spec por la misma razón que en la versión anterior: la restricción de visibilidad es
   más específica que la etiqueta de zona.

## Trazabilidad (R → test)

| Requisito | Test propuesto |
|---|---|
| R1 | `tests/integration/repositories/webhook-suscripcion-repository.test.ts` — columnas nuevas con sus defaults tras el alta |
| R2 | `tests/unit/services/webhook-estado-service.test.ts` — entrega 2xx resetea `fallosConsecutivos`/`sinExitoDesde` y `estaPausada()` pasa a `false` |
| R3 | `tests/unit/services/webhook-estado-service.test.ts` — no-2xx/timeout/red incrementan; `WebhookSecretKeyError`/payload inválido NO incrementan |
| R4 | `tests/unit/utils/webhook-suscripcion-pausa.test.ts` + `tests/unit/services/webhook-estado-service.test.ts` — al cruzar umbral+ventana, el siguiente `runAfter` usa el intervalo de pausa |
| R5 | `tests/unit/services/jobs/webhook-habilitacion-api-emision.test.ts` — una suscripción pausada sigue recibiendo jobs nuevos (`activa` intacto) |
| R6 | `tests/unit/utils/webhook-suscripcion-pausa.test.ts` — fallos insuficientes o ventana no cumplida ⇒ `estaPausada() === false` |
| R7 | `tests/integration/repositories/webhook-suscripcion-repository.test.ts` — `actualizarUrlByOwner`/`upsertByOwner` resetean contador y ancla |
| R8 | `tests/unit/config/webhook-config.test.ts` — defaults 3 / 30 min / 1 h sin env configurado |
| R9 | `tests/unit/services/notificacion-notificadores-reales.test.ts` — una fila `notificacion` dirigida a `maestro`, texto sin la palabra "desactiv" |
| R10 | `tests/unit/services/notificacion-notificadores-reales.test.ts` — usa `INotificacionRepository.crear`, no un canal nuevo |
| R11 | `tests/unit/services/notificacion-notificadores-reales.test.ts` — fallo del repo se loguea y no interrumpe el drenado |
| R12 | `tests/integration/db/notificacion-evento-webhook-suscripcion-migration.test.ts` — dos intentos fallidos de la MISMA racha producen una sola fila; dos rachas distintas producen dos |
| R13 | `tests/unit/services/webhook-estado-service.test.ts` + `notificacion-notificadores-reales.test.ts` — el texto/log nunca contiene la URL ni el secreto |
| R14 | `tests/unit/clients/webhook-sender.test.ts` — 429 con `Retry-After` en segundos y en fecha HTTP |
| R15 | `tests/unit/clients/webhook-sender.test.ts` — 429 sin `Retry-After` usable cae al backoff genérico |
| R16 | `tests/unit/services/job-queue-service.test.ts` — 5 fallos 429 seguidos siguen yendo a `failed` |
| R17 | `tests/unit/services/job-queue-service.test.ts` — `Retry-After` extremo y el intervalo de pausa se acotan a `JOBS_BACKOFF_CAP_MS` |
| R18 | `tests/unit/actions/webhooks-action.test.ts` — `obtenerWebhook` expone `pausada`/`sinExitoDesde` |
| R19 | `tests/components/WebhookAccionCell.test.tsx` — tras "Guardar URL" el aviso de pausa desaparece sin recargar |
