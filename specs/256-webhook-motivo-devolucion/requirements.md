# Feature 256 — El evento de `devuelta` viaja con el motivo tipificado

Requisitos en notación EARS. Sin detalles de implementación (esos van en `design.md`).
Cada `R<n>` se mapea a un test concreto en `tasks.md`.

> **Puerta humana RESUELTA el 2026-08-21.** Las siete decisiones abiertas están firmadas y
> aplicadas en los requisitos de abajo. La sección «Preguntas abiertas — resueltas» del final
> conserva cada respuesta con su fecha: **está cerrada, no se reabre.**

**Alcance en una línea:** el cuerpo de entrega del webhook `orden.estado_actualizado` gana UN
campo, `data.motivo`, con la causa tipificada de la devolución
(`gestion_orden.causa_devolucion`, enum `GestionCausaDevolucion`: `not_found` / `wrong_number` /
`wrong_address`), resuelto AL ENTREGAR, igual que `numGuia` y `estado`.

**Fuera de alcance (explícito):**

- **Qué transiciones emiten evento NO cambia.** `EVENTOS_PUBLICOS` y
  `ORIGENES_SIN_EVENTO_PUBLICO` (`lib/types/webhook-eventos.ts:38-49,78-80`) se quedan como
  están. Esta feature no añade ni quita eventos.
- **El payload del JOB no cambia** (`{ordenId, estatusDestinoId, ocurridoAt}`, 99/R13):
  mínimo y sin PII. El emisor `lib/services/jobs/webhook-estado-encolado.ts` NO se toca.
- **Solo `devuelta`.** Decisión (d), firmada. Ningún otro estado aporta causa a este campo.
- **La evidencia de la visita, la georreferenciación, el número de intento y un PULL de
  gestiones** quedan fuera (así lo fija la ficha).
- **El aviso a integradores es tarea del humano**, no de esta feature (decisión (g)).
- **Nada se traduce.** Los tres valores viajan en inglés porque así están en la base: decisión
  consciente del humano cerrada en la puerta F1.4 de la feature 73
  (`db/schema.prisma:759-771`). No es deuda y no se castellaniza aquí.

---

## 1. El campo nuevo en el cuerpo

**R1.** CUANDO el sistema entrega un evento `orden.estado_actualizado` cuyo estado destino es
`devuelta` y la orden tiene una gestión de devolución vigente (R8) con causa registrada, el
sistema DEBE incluir en el objeto `data` del cuerpo el campo `motivo` con el valor de esa causa.

**R2.** El sistema DEBE emitir la causa como el `value` CRUDO del enum
(`not_found` | `wrong_number` | `wrong_address`), sin traducir a español, sin etiqueta de
presentación y sin ninguna normalización de mayúsculas, guiones o acentos.

**R3.** El sistema NO DEBE emitir NUNCA en `data.motivo` un valor fuera de esos tres, y NO DEBE
emitir ahí una causa de incidente (`danado` / `perdido` / `robado`, enum hermano de la 158).

**R4.** SI la gestión de devolución vigente de la orden tiene la causa sin registrar (`NULL` en
base: gestión `devuelta` anterior a la feature 73, cuyo histórico NO se backfilleó — 73/R16),
ENTONCES el sistema DEBE emitir `motivo: null`, y NO DEBE omitir el campo, inventar un valor por
defecto, ni fallar la entrega.

**R5.** SI la orden no tiene ninguna gestión de devolución vigente (ninguna gestión con
`resultado = 'devuelta'`, o todas anuladas), ENTONCES el sistema DEBE emitir `motivo: null` y
entregar el evento con normalidad.

**R6.** CUANDO el estado destino del evento es cualquiera distinto de `devuelta`, el sistema
DEBE incluir igualmente el campo `motivo` con valor `null`: la forma de `data` es UNA SOLA y el
consumidor no ramifica por estado para saber si el campo existe.

**R7.** El campo DEBE llamarse `motivo` y viajar PLANO dentro de `data`, al mismo nivel que
`numGuia`, `numRemision` y `estado`.

## 2. Qué gestión manda

**R8.** El sistema DEBE resolver la causa a partir de la gestión de esa MISMA orden que cumpla,
a la vez: `resultado = 'devuelta'`, `anulada_at IS NULL` y ser la más reciente por `created_at`
entre las que cumplen lo anterior.

**R9.** El sistema NO DEBE tener en cuenta gestiones ANULADAS, aunque sean las más recientes.

**R10.** El sistema NO DEBE tener en cuenta gestiones con otro `resultado`
(`entregada`, `reprogramada`, `rechazada`, `incidente`), aunque sean posteriores a la gestión
de devolución vigente.

**R11.** El sistema NO DEBE leer nunca gestiones de otra orden: la causa que viaja en el evento
DEBE proceder exclusivamente de la orden identificada por el payload del job.

**R12.** El sistema NO DEBE añadir consultas por evento respecto de las que hace hoy: la causa
DEBE resolverse dentro de la lectura de la orden que ya se realiza para armar el cuerpo.

## 3. Idempotencia y estabilidad del cuerpo (99/R23)

**R13.** CUANDO un job de webhook se reejecuta (reintento por fallo transitorio) y el estado de
la base no ha cambiado, el sistema DEBE producir un cuerpo BYTE-IDÉNTICO al de la ejecución
anterior, campo nuevo incluido, y el mismo `eventoId`.

**R14.** El cuerpo DEBE ser función determinista de (payload del job, estado leído de la base):
el campo `motivo` NO DEBE depender del reloj, del número de intento, del orden de llegada de los
jobs ni de ningún dato aleatorio.

**R15.** El sistema DEBE emitir SIEMPRE la causa VIGENTE EN EL INSTANTE DE LA ENTREGA. SI entre
el encolado y la entrega —o entre dos reintentos del mismo evento— cambia la gestión de
devolución vigente de la orden (se registra una nueva, o se anula la anterior), ENTONCES el
sistema DEBE emitir la causa vigente en ese momento, y NO DEBE fallar la entrega, reintentarla
ni emitir un evento adicional por ello. Es el comportamiento contratado, no una limitación:
el webhook dice lo mismo que dice el resto de la aplicación.

**R16.** El sistema DEBE calcular la firma sobre el cuerpo YA ampliado: la cabecera
`X-Ordenex-Signature` DEBE seguir verificando contra `${timestamp}.${cuerpo}` con el cuerpo
exacto que se envía.

## 4. No-regresión del contrato público

**R17.** El sistema NO DEBE cambiar el conjunto de transiciones que emiten evento: toda
transición que hoy emite DEBE seguir emitiendo, y ninguna que hoy no emite DEBE empezar a
hacerlo.

**R18.** El sistema NO DEBE cambiar el nombre del evento (`orden.estado_actualizado`), ni el
`eventoId`, ni la clave de deduplicación del job, ni el payload del job
(`{ordenId, estatusDestinoId, ocurridoAt}`).

**R19.** El sistema DEBE conservar en `data` los campos actuales `numGuia`, `numRemision` y
`estado` con el mismo nombre, el mismo tipo y el mismo valor que hoy, y NO DEBE reintroducir la
clave `orden` retirada por la feature 112.

**R20.** El sistema DEBE conservar los desenlaces actuales del job: orden inexistente o borrada
→ completado sin POST; sin suscripción activa → completado sin POST; respuesta 2xx →
completado; fallo transitorio → error recuperable con su detalle; payload con forma inesperada
→ error de integración sin secreto.

**R21.** El sistema DEBE seguir derivando el destino del webhook del `tienda_id` de la orden
(99/R24) y NO DEBE entregar el evento de una orden al callback de otro dueño.

## 5. Privacidad

**R22.** El sistema NO DEBE incluir en el cuerpo el texto libre `gestion_orden.motivo` —que
comparte nombre con el campo nuevo y NO es lo mismo— ni ningún otro dato del destinatario:
`data.motivo` transporta EXCLUSIVAMENTE la causa TIPIFICADA.

**R23.** El sistema NO DEBE emitir por el logger la causa junto a la URL, el secreto de firma o
identificadores del destinatario; los mensajes de log DEBEN seguir siendo agregados y sin PII
(99/R29).

## 6. Documentación del contrato

**R24.** El sistema DEBE publicar el evento `orden.estado_actualizado` en la fuente de verdad
del contrato del canal por API key (`lib/api/openapi-spec.ts`) y en su espejo textual
(`docs/api/api-key-openapi.yaml`), en el mismo cambio, documentando el campo `motivo` con sus
tres valores, el caso `null`, y el hecho de que la causa es la vigente al entregar (R15). La
publicación NO DEBE alterar la lista de `paths` ni el número de enums de catálogo de estados
del contrato.

---

## Preguntas abiertas — RESUELTAS en la puerta humana del 2026-08-21

Se conservan con su respuesta y su fecha. **Cerradas: no se reabren ni se «mejoran».**

**(a) Nombre y forma del campo.** → *Resuelto 2026-08-21: **`data.motivo`**, plano, con el value
crudo del enum.* El humano eligió `motivo` DESPUÉS de que se le planteara explícitamente la
colisión con `gestion_orden.motivo` (el texto libre que escribe el mensajero, `db/schema.prisma:814`,
que NO se emite en el webhook — R22) y lo reafirmó. La recomendación del spec era
`causaDevolucion`; **queda descartada.** La convivencia de los dos `motivo` se documenta en
`design.md` §2.3 con archivo y línea, para que nadie los confunda ni los «unifique».

**(b) ¿Value crudo del enum, o también la etiqueta en español?** → *Resuelto 2026-08-21: solo el
value CRUDO, sin etiqueta.* Contrato de máquina, igual que `estado`. La traducción sigue viviendo
en la capa de presentación (73/R3, `app/(app)/mis-asignaciones/_components/causa-devolucion-options.ts`).

**(c) ¿El campo aparece SIEMPRE o SOLO en `devuelta`?** → *Resuelto 2026-08-21: SIEMPRE
presente.* `null` en los estados que no son `devuelta` y `null` también en una `devuelta` sin
causa (histórico previo a la 73 sin backfillear). La forma de `data` es una sola (R4/R5/R6).

**(d) ¿`rechazada` e `incidente` entran en esta ficha?** → *Resuelto 2026-08-21: NO. Solo
`devuelta`.* Los otros dos son follow-up, con su propia ficha y su propia decisión.

**(e) Semántica de estabilidad frente a una gestión posterior.** → *Resuelto 2026-08-21: la causa
emitida es la **VIGENTE AL ENTREGAR**, no una foto del instante del evento.* El payload del job
NO cambia (99/R13 intacto) y NO se añade `historialId`. La ventana —un reintento posterior a una
gestión nueva o anulada puede llevar otra causa que el intento anterior— es parte declarada del
contrato público (R15) y se afirma en un test (T8). Es una elección deliberada: el webhook dice
lo mismo que las pantallas y el cron de SLA, que leen con este mismo criterio de vigencia.

**(f) ¿Se publica el evento en el OpenAPI?** → *Resuelto 2026-08-21: SÍ, en una sección
`webhooks:` a nivel superior*, con su espejo en el `.yaml` (R24, T10). Restricción medida que se
mantiene: el campo `estado` se documenta como `type: string` con prosa y **sin `enum`**, porque
enumerarlo añade un 5.º bloque de catálogo de estados y pone roja
`tests/unit/api/openapi-contrato-en-reparto.test.ts` en `:74`, `:96` y `:124`.

**(g) ¿El aviso a integradores es parte de la feature?** → *Resuelto 2026-08-21: NO, es tarea del
humano.* No es requisito ni task. Queda como nota: el cambio es aditivo y no bloquea el
despliegue.
