# Feature 91 — Geocodificación de direcciones de órdenes (Google Geocoding API) vía cola

Requisitos en notación EARS. Cada `R<n>` termina mapeado a un test concreto
(`docs/specs.md` §Trazabilidad). Sin detalles de implementación: el CÓMO vive en
`design.md`.

**Alcance:** backend puro. Se escriben coordenadas en la orden; NO se entrega ningún
consumidor (mapa, link "cómo llegar", ruteo). Sin backfill histórico.

---

## Bloque A — Modelo de datos y migración

**R1.** El sistema DEBE persistir, por orden, las coordenadas geocodificadas
(`latitud`, `longitud`), el instante de geocodificación (`geocoded_at`), la precisión
reportada por el proveedor (`geocode_precision`) y el estado del último intento
(`geocode_status`), todos ellos opcionales (una orden sin geocodificar los tiene
vacíos).
→ *Test:* `tests/integration/db/geocodificacion-migracion.test.ts` —
"la tabla orden expone latitud/longitud/geocoded_at/geocode_precision/geocode_status nullables".

**R2.** El sistema DEBE mantener un almacén de coordenadas ya resueltas, indexado por
una huella determinista de la dirección consultada, de modo que una misma dirección no
se consulte dos veces al proveedor.
→ *Test:* `tests/integration/db/geocodificacion-migracion.test.ts` —
"geocode_cache tiene direccion_hash con índice único".

**R3.** El almacén de coordenadas DEBE tener Row Level Security habilitada sin
políticas, quedando accesible solo desde el rol de servicio.
→ *Test:* `tests/integration/db/geocodificacion-migracion.test.ts` —
"geocode_cache tiene RLS habilitada y cero policies".

**R4.** El catálogo de tipos de job DEBE incluir el tipo `geocodificacion`.
→ *Test:* `tests/integration/db/geocodificacion-migracion.test.ts` —
"job_tipo acepta el valor geocodificacion".

**R5.** CUANDO se ejecute el `down.sql` de esta migración, el sistema DEBE dejar el
esquema exactamente como estaba antes de aplicarla, incluido el tipo de job sin el
valor `geocodificacion`.
→ *Test:* `tests/integration/db/geocodificacion-rollback.test.ts` —
"el rollback elimina columnas, tabla y el valor del enum sin dejar residuos".

---

## Bloque B — Encolado (transactional outbox) desde los writers de dirección

**R6.** CUANDO se cree una orden individual con una dirección geocodificable, el
sistema DEBE encolar un job de geocodificación para esa orden dentro de la MISMA
transacción que inserta la orden.
→ *Test:* `tests/integration/repositories/orden-geocode-enqueue.test.ts` —
"crear una orden con dirección deja un job geocodificacion pendiente".

**R7.** SI la transacción que crea la orden se revierte, ENTONCES el sistema NO DEBE
dejar ningún job de geocodificación encolado.
→ *Test:* `tests/integration/repositories/orden-geocode-enqueue.test.ts` —
"si la creación falla no queda job huérfano en la cola".

**R8.** CUANDO la carga masiva inserte un lote de órdenes, el sistema DEBE encolar un
job de geocodificación por cada orden EFECTIVAMENTE insertada (excluyendo las
descartadas por duplicado), dentro de la misma transacción del lote.
→ *Test:* `tests/integration/repositories/orden-geocode-enqueue.test.ts` —
"la carga masiva encola un job por orden nueva y ninguno por duplicado saltado".

**R9.** SI una orden no tiene una dirección geocodificable, ENTONCES el sistema NO
DEBE encolar job de geocodificación para ella.
→ *Test:* `tests/unit/services/geocodificacion-encolado.test.ts` —
"no encola cuando la dirección es null, vacía o solo espacios".

**R10.** CUANDO una actualización de orden modifique EFECTIVAMENTE el valor de la
dirección (valor entrante distinto del almacenado), el sistema DEBE encolar un job de
geocodificación dentro de la misma transacción de la actualización.
→ *Test:* `tests/unit/services/geocodificacion-encolado.test.ts` —
"encola cuando la dirección entrante difiere de la almacenada".
> **Estado del disparador (decisión Q1, RESUELTA):** este requisito se implementa como
> **guard latente**. Hoy es **estructuralmente inalcanzable**: `actualizarOrdenSchema`
> es `.strict()` y no admite `direccion`, y `toUpdateData()` no la proyecta (ver C1),
> así que la condición nunca se cumple en `dev`. **NO se amplía el CRUD de órdenes para
> permitir editar `direccion`** — eso es otra feature. Se implementa igualmente porque
> el día que el CRUD gane el campo, sin este guard la orden quedaría con **coordenadas
> obsoletas en silencio**: dirección nueva, coordenadas viejas, sin ninguna señal de
> inconsistencia. El guard cuesta ~6 líneas y deja el sistema correcto por construcción.
> Verificable hoy a nivel unitario sobre el guard; no end-to-end.

**R11.** SI una actualización de orden no incluye dirección, o la incluye con el mismo
valor ya almacenado, ENTONCES el sistema NO DEBE encolar job de geocodificación.
→ *Test:* `tests/unit/services/geocodificacion-encolado.test.ts` —
"no encola cuando el update no toca la dirección ni cuando la deja igual".
> Mismo guard latente que R10 (decisión Q1). La pre-lectura de `direccion` dentro de la
> transacción DEBE ser **condicional** a que el campo venga informado, para no añadir
> una lectura a cada actualización de orden.

**R12.** El sistema DEBE derivar una clave de idempotencia determinista por **el par
(orden, dirección normalizada)** — NO por la orden sola y NO por la dirección sola —,
de modo que encolar dos veces la misma orden con la misma dirección produzca una sola
entrada en la cola.
→ *Test:* `tests/integration/repositories/orden-geocode-enqueue.test.ts` —
"dos encolados de la misma orden y dirección producen una sola fila".
> **Forma normativa (decisión Q4, RESUELTA):** `geocodificacion:<ordenId>:<hash8>`,
> donde `<hash8>` son los 8 primeros hex de la huella de la dirección normalizada (R17).
> Los dos componentes son **obligatorios**; ver R13 para por qué el `<hash8>` no es
> opcional y **por qué `<ordenId>` a secas rompe la feature**.

**R13.** CUANDO la dirección de una orden ya geocodificada cambie, el sistema DEBE
poder encolar un job nuevo para ella: la clave de idempotencia NUNCA DEBE bloquear la
re-geocodificación tras una corrección de dirección.
→ *Test:* `tests/integration/repositories/orden-geocode-enqueue.test.ts` —
"corregir la dirección de una orden ya geocodificada encola un job nuevo".
> **⚠️ Punto más delicado de la feature — leer antes de implementar el `dedupeKey`.**
> El `<hash8>` de la dirección normalizada es **obligatorio**, no cosmético. Con
> `dedupeKey = "geocodificacion:<ordenId>"` a secas la feature queda rota en silencio:
> 1. El índice único de `dedupe_key` es `UNIQUE … WHERE "dedupe_key" IS NOT NULL`
>    (migración de la 90, `:39`): **no está acotado por estado del job**.
> 2. Las filas de `jobs` **no se purgan al completarse**: la fila `done` del primer
>    encolado sigue viva y sigue ocupando la clave.
> 3. Por tanto, corregir la dirección después de que el job terminó produciría un
>    `ON CONFLICT DO NOTHING` **silencioso**: sin error, sin log, sin job. La dirección
>    corregida **no se geocodificaría jamás** y la orden conservaría para siempre las
>    coordenadas de la dirección equivocada.
>
> La huella sola tampoco sirve: dos órdenes distintas con la misma dirección
> colisionarían y solo una recibiría coordenadas (rompe R6). Solo la clave **compuesta**
> satisface R12 y R13 a la vez.

**R14.** El payload del job DEBE contener únicamente el identificador de la orden, sin
datos personales.
→ *Test:* `tests/unit/services/geocodificacion-encolado.test.ts` —
"el payload encolado solo contiene ordenId".

---

## Bloque C — Construcción de la consulta

**R15.** El sistema DEBE construir la consulta de geocodificación concatenando la
dirección libre de la orden con los nombres de su distrito, cantón y provincia, y el
país, omitiendo los componentes ausentes y sin dejar separadores vacíos.
→ *Test:* `tests/unit/geo/direccion-query.test.ts` —
"concatena dirección, distrito, cantón, provincia y país omitiendo los ausentes".

**R16.** SI la orden no tiene distrito asignado, ENTONCES el sistema DEBE construir la
consulta igualmente con los componentes disponibles.
→ *Test:* `tests/unit/geo/direccion-query.test.ts` —
"construye la consulta sin distrito cuando la orden no lo tiene".

**R17.** La huella de deduplicación de una dirección DEBE ser insensible a mayúsculas,
acentos y espacios redundantes, de modo que dos escrituras equivalentes de la misma
dirección compartan huella.
→ *Test:* `tests/unit/geo/direccion-query.test.ts` —
"dos variantes con acentos, mayúsculas y espacios extra producen la misma huella".

---

## Bloque D — Integración con el proveedor de geocodificación

**R18.** CUANDO el proveedor responda con resultado satisfactorio, el sistema DEBE
registrar en la orden la latitud, la longitud, la precisión y el instante de la
geocodificación.
→ *Test:* `tests/unit/services/geocodificacion-service.test.ts` —
"con respuesta OK escribe latitud, longitud, precisión y geocoded_at".

**R19.** El sistema DEBE validar la respuesta del proveedor en el borde antes de
usarla, y SI la respuesta no cumple el contrato esperado, ENTONCES DEBE fallar con un
error que identifique la operación sin exponer la credencial ni la dirección.
→ *Test:* `tests/unit/clients/google-geocode.test.ts` —
"una respuesta con forma inesperada produce error de integración sin credencial ni dirección".

**R20.** El sistema DEBE registrar la precisión reportada aunque sea aproximada, sin
descartar el resultado por baja precisión.
→ *Test:* `tests/unit/services/geocodificacion-service.test.ts` —
"un resultado APPROXIMATE se guarda con su precisión".

---

## Bloque E — Política de desenlace por respuesta del proveedor

> **Tabla normativa (decisión Q3, RESUELTA).** Esta tabla NO es una sugerencia: es el
> contrato que R21–R25 y R34 codifican, y contra el que se testea. Ningún estado puede
> desviarse de ella sin modificar este documento.
>
> | Estado del proveedor | Acción | Motivo |
> | --- | --- | --- |
> | `OK` | escribe coordenadas + precisión + instante, **completa** | — |
> | `ZERO_RESULTS` | registra el estado en la orden, **completa** (sin reintento) | nunca va a resolver; no debe gastar intentos pagados ni contaminar el dead-letter |
> | `INVALID_REQUEST` | registra el estado en la orden, **completa** (sin reintento) | consulta malformada: determinista, reintentar no la mejora |
> | `OVER_QUERY_LIMIT` | **falla recuperable** → backoff | transitorio por definición |
> | `UNKNOWN_ERROR`, HTTP 5xx, fallo de red | **falla recuperable** → backoff | transitorio |
> | `REQUEST_DENIED` | **falla recuperable** → backoff → dead-letter, sin escribir coordenadas | configuración o facturación rota: debe ser RUIDOSO, nunca silencioso |
>
> `REQUEST_DENIED` yendo al dead-letter es una consecuencia aceptada conscientemente:
> es preferible una cola de fallidos visible a completar en silencio jobs que nunca
> escribieron coordenadas. R34 amortigua el caso.

**R21.** CUANDO el proveedor indique que la dirección no tiene resultados, el sistema
DEBE registrar ese estado en la orden y dar el job por COMPLETADO, sin reintentarlo ni
enviarlo a la cola de fallidos.
→ *Test:* `tests/unit/services/geocodificacion-service.test.ts` —
"ZERO_RESULTS registra el estado y completa el job sin reintento".

**R22.** CUANDO el proveedor indique que la consulta es inválida, el sistema DEBE
registrar ese estado en la orden y dar el job por COMPLETADO, sin reintentarlo.
→ *Test:* `tests/unit/services/geocodificacion-service.test.ts` —
"INVALID_REQUEST registra el estado y completa el job sin reintento".

**R23.** CUANDO el proveedor indique agotamiento de cuota, error desconocido, o la
llamada falle por red o error de servidor, el sistema DEBE fallar el job de forma
recuperable para que la cola lo reintente con su backoff.
→ *Test:* `tests/unit/services/geocodificacion-service.test.ts` —
"OVER_QUERY_LIMIT, UNKNOWN_ERROR, 5xx y fallo de red lanzan para reintento".

**R24.** CUANDO el proveedor rechace la petición por credencial o configuración
inválida, el sistema DEBE fallar el job de forma ruidosa y recuperable, sin registrar
coordenadas en la orden.
→ *Test:* `tests/unit/services/geocodificacion-service.test.ts` —
"REQUEST_DENIED lanza y no escribe coordenadas".

**R25.** MIENTRAS la credencial del proveedor no esté configurada, el sistema DEBE
fallar únicamente los jobs de geocodificación con un error explícito, y el drenado del
resto de la cola DEBE continuar sin verse afectado.
→ *Test:* `tests/unit/services/geocodificacion-service.test.ts` —
"sin credencial configurada falla solo el job de geo y el resto del lote se procesa".

---

## Bloque F — Almacén de coordenadas resueltas

**R26.** CUANDO la huella de la dirección ya esté en el almacén, el sistema DEBE
escribir las coordenadas en la orden SIN consultar al proveedor.
→ *Test:* `tests/unit/services/geocodificacion-service.test.ts` —
"un acierto en caché escribe coordenadas sin invocar al proveedor".

**R27.** CUANDO el proveedor resuelva satisfactoriamente una dirección no almacenada,
el sistema DEBE guardarla en el almacén para consultas posteriores.
→ *Test:* `tests/unit/services/geocodificacion-service.test.ts` —
"un fallo de caché con respuesta OK guarda la entrada en el almacén".

**R28.** Las entradas del almacén DEBEN persistir sin caducidad; su invalidación ocurre
únicamente porque una dirección distinta produce una huella distinta.
→ *Test:* `tests/unit/services/geocodificacion-service.test.ts` —
"una entrada antigua del almacén se usa igual, sin expiración por tiempo".

---

## Bloque G — Idempotencia, robustez y privacidad del handler

**R29.** El sistema DEBE ser idempotente por orden: ejecutar dos veces el mismo job
DEBE dejar el mismo estado final, sin duplicar entradas del almacén ni corromper las
coordenadas.
→ *Test:* `tests/unit/services/geocodificacion-service.test.ts` —
"ejecutar el mismo job dos veces deja el mismo estado final".

**R30.** SI la orden referida por el job no existe o está borrada, ENTONCES el sistema
DEBE dar el job por completado sin error.
→ *Test:* `tests/unit/services/geocodificacion-service.test.ts` —
"un job de una orden inexistente o borrada se completa sin error".

**R31.** El sistema NUNCA DEBE registrar en logs la dirección, las coordenadas ni la
credencial del proveedor; los conteos de la corrida del cron DEBEN permanecer
agregados y sin datos personales.
→ *Test:* `tests/unit/services/geocodificacion-service.test.ts` —
"ningún log emitido contiene dirección, coordenadas ni credencial".

**R32.** El sistema DEBE registrar el handler de geocodificación en el drenador de la
cola, y este tipo de job NO DEBE ser recurrente.
→ *Test:* `tests/integration/api/procesar-jobs-geocodificacion.test.ts` —
"el drenador resuelve el handler de geocodificacion y no lo re-agenda".

**R33.** La credencial del proveedor DEBE resolverse por configuración de entorno y
NUNCA estar incrustada en el código; su ausencia NO DEBE provocar una excepción al
cargar la configuración.
→ *Test:* `tests/unit/config/geocode-config.test.ts` —
"la credencial ausente o vacía se resuelve a null sin lanzar".

**R34.** Los jobs de geocodificación DEBEN encolarse con un límite de intentos propio,
superior al límite por defecto de la cola, de modo que una interrupción prolongada del
proveedor o de su facturación no envíe los jobs al dead-letter de forma prematura.
→ *Test:* `tests/unit/services/geocodificacion-encolado.test.ts` —
"el encolado fija maxIntentos en 8, por encima del default de la cola".
> **Valor normativo (decisión Q3, RESUELTA):** `maxIntentos: 8`, como override por fila
> en el `enqueue` (la cola de la 90 lo admite). Con el backoff base de 60 s de la 90,
> tolera un corte de ~4 h antes del dead-letter, frente a los ~15 min del default de 5.

---

## Trazabilidad — resumen

| Bloque | Requisitos | Archivo de test principal |
| --- | --- | --- |
| A · Datos | R1–R5 | `tests/integration/db/geocodificacion-migracion.test.ts`, `…-rollback.test.ts` |
| B · Encolado | R6–R14 | `tests/integration/repositories/orden-geocode-enqueue.test.ts`, `tests/unit/services/geocodificacion-encolado.test.ts` |
| C · Consulta | R15–R17 | `tests/unit/geo/direccion-query.test.ts` |
| D · Proveedor | R18–R20 | `tests/unit/clients/google-geocode.test.ts`, `tests/unit/services/geocodificacion-service.test.ts` |
| E · Desenlace | R21–R25 | `tests/unit/services/geocodificacion-service.test.ts` |
| F · Caché | R26–R28 | `tests/unit/services/geocodificacion-service.test.ts` |
| G · Handler | R29–R34 | `tests/unit/services/geocodificacion-service.test.ts`, `tests/integration/api/procesar-jobs-geocodificacion.test.ts`, `tests/unit/config/geocode-config.test.ts`, `tests/unit/services/geocodificacion-encolado.test.ts` |

**Total: 34 requisitos, 34 con test concreto mapeado. Ninguno huérfano.**

---

## Correcciones al encargo (verificadas contra el código)

Se documentan aquí porque **contradicen la descripción de la feature** y afectan el
alcance. Ambas están verificadas en el worktree `../ordenex-f90` (rama de la 90, ya
mergeada a `dev`).

### C1 — Los writers de dirección efectivos son DOS, no TRES

La descripción afirma que `update()` es el tercer disparador y cita
`UpdateOrdenData.direccion` en `lib/types/orden.ts:150`. Ambas cosas son inexactas:

1. `lib/types/orden.ts:150` es `OrdenListItemDTO.direccion` (campo del **listado**,
   añadido para columnas de dinero/detalle), no un campo de actualización.
2. `actualizarOrdenSchema` (`lib/types/orden.ts:32-46`) es `.strict()` y **no incluye
   `direccion`**: una petición con ese campo se rechaza con `validation_error`.
3. `OrdenRepository.toUpdateData()` (`lib/repositories/OrdenRepository.ts:579-595`)
   proyecta `estatusId, destinatario, telefonoDest, tiendaId, zonaId, provinciaId,
   cantonId, distritoId, producto, peso, notas`. **`direccion` no está**, así que
   `update()` nunca la escribe aunque llegara.

**Consecuencia:** la ruta de edición hoy es incapaz de cambiar una dirección. El
disparador de R10 es **estructuralmente inalcanzable en `dev`**. Se implementa igual como
guard latente (**decisión Q1, resuelta**), pero R10/R11 solo son testeables a nivel
unitario sobre el guard, no end-to-end. El implementer **no** debe "arreglar" esto
añadiendo `direccion` al schema de actualización: eso está explícitamente fuera de
alcance.

### C2 — Números de línea desplazados

`create()` está en `:407` (tx en `:410`), `update()` en `:483` (tx en `:489`) y
`createManyOrdenes()` en `:664` (tx en `:674`), no en `:411/:487/:668` como indica la
descripción. La descripción probablemente citó la rama `flow`, que tiene
`OrdenRepository.ts` modificado sin commitear. El desarrollo de esta feature nace de
`origin/dev` limpio, donde valen las líneas de arriba.

### C3 — Hallazgo de implementación en la carga masiva

`createManyOrdenes()` ya identifica las órdenes realmente insertadas mediante el diff
`before`/`after` de ids (`:678-691`), pero el `select` del `after` solo trae
`{ id, estatusId }`. Para cumplir R8 hay que ampliarlo con `direccion` (y los ids de
catálogo si se decide filtrar por geocodificabilidad ahí). Es un cambio aditivo dentro
de una query que ya se ejecuta: **no** añade un round-trip.

---

## Decisiones del gate F1.4 — RESUELTAS 2026-07-19

**Estado: CERRADO.** No quedan preguntas abiertas. La spec es ejecutable.

**Cómo se resolvió — contexto para el reviewer:**

- El humano aprobó las nueve preguntas **con la recomendación del spec_author, sin
  ningún override**: instrucción literal *"toma el recomendado"*.
- Se resolvieron **en bloque**, no caso por caso: el humano **no estaba disponible para
  deliberar** cada pregunta por separado. Es decir, hay aprobación explícita del
  resultado, pero **no** hubo debate individual sobre cada trade-off.
- Consecuencia práctica para la revisión: las decisiones que dependen de un criterio de
  negocio y no de un hecho verificado en el código — señaladamente **Q3**
  (`REQUEST_DENIED` al dead-letter, `maxIntentos: 8`), **Q7** (caché sin TTL ni purga) y
  **Q8** (guardar `APPROXIMATE`) — merecen una segunda mirada del reviewer. Las demás se
  apoyan en hechos verificados contra el código de `origin/dev`.

| # | Decisión tomada | Dónde vive ahora |
| --- | --- | --- |
| Q1 | **(b)** Guard latente en `update()`: se implementa aunque hoy sea inalcanzable. **NO** se amplía el CRUD para permitir editar `direccion`. | R10, R11, C1, T13 |
| Q2 | **N jobs individuales** por orden en carga masiva, no un job por lote. | R8, design §6 |
| Q3 | Tabla de desenlace por estado del proveedor **como contrato normativo**, con `maxIntentos: 8` para este tipo de job. | Bloque E (tabla), R21–R25, **R34** |
| Q4 | `dedupeKey = geocodificacion:<ordenId>:<hash8>`. El `<hash8>` es **obligatorio**. | R12, R13, design §6 y §8.3 |
| Q5 | Se encola **solo si `direccion` tiene contenido tras normalizar**; provincia/cantón sin dirección libre no se consultan. | R9 |
| Q6 | Función hermana `hashDireccion` en `lib/geo/`; **no** se reutiliza `hashApiKey`. | design §4, §8.6 |
| Q7 | Caché **permanente, sin TTL**; invalidación implícita por cambio de huella. Se acepta no tener purga. | R28, design §1.4, §9.4 |
| Q8 | Se guarda **siempre**, incluida precisión `APPROXIMATE`; el umbral lo decidirá el primer consumidor. | R20 |
| Q9 | **No** se implementa `createManyOrdenesConGuia` a ciegas: queda como seguimiento hasta que la 88 (PR #92) aterrice en `dev`. | T14, design §9.1 |

### Detalle de las decisiones cuyo "por qué" no puede perderse

**Q1 — guard latente.** (c) —ampliar `actualizarOrdenSchema` + `toUpdateData` + el
formulario— es scope creep sobre el CRUD de órdenes y es una feature aparte. (a)
—sacarlo del alcance— deja el sistema incorrecto el día que alguien añada `direccion` al
schema, y ese día nadie recordará esta feature. Se elige (b): ~6 líneas, testeable hoy,
correcto por construcción. **El código DEBE documentar que el guard está latente y por
qué.**

**Q3 — `REQUEST_DENIED` es ruidoso a propósito.** Un corte de facturación mandará jobs
al dead-letter. Es el comportamiento deseado: preferimos una cola de fallidos visible a
jobs completados en silencio que nunca escribieron coordenadas. `maxIntentos: 8` (R34)
sube la tolerancia de ~15 min a ~4 h sin renunciar a la señal.

**Q4 — el `<hash8>` no es opcional.** Ver el bloque de advertencia bajo **R13**: con
`<ordenId>` a secas, corregir una dirección ya geocodificada produce un
`ON CONFLICT DO NOTHING` silencioso y la corrección no se geocodifica **jamás**. Es el
punto donde esta feature se rompe más fácilmente y sin ruido.

**Q5 — por qué no basta provincia + cantón.** Geocodificar solo con catálogo devuelve el
centroide del cantón: un `APPROXIMATE` inútil que cuesta dinero y ensucia el dato con
coordenadas que **parecen** válidas. Sin dirección libre no hay nada que resolver.

**Q6 — por qué no reutilizar `hashApiKey`.** Es técnicamente idéntica (SHA-256 hex
determinista), pero su justificación documentada es específica de **secretos de alta
entropía** ("no hay tabla precomputable para 2^256 valores aleatorios"), y eso **no
aplica** a direcciones postales, que son adivinables. Reutilizarla ataría el hasheo de
un dato personal a una justificación que no lo cubre, y bloquearía cambiar `hashApiKey`
en el futuro (p. ej. añadir sal) sin invalidar toda la caché de geocodificación.

**Q7 — riesgo aceptado.** Sin TTL y sin purga, `geocode_cache` crece de forma monótona.
Es aceptable (coordenadas estables, filas diminutas) y queda anotado como seguimiento
(design §9.4), igual que la purga de `jobs` (§9.2), que la 90 tampoco definió.
