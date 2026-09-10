# Feature 400 — Un fallo de configuración del geocodificador no debe bloquear la asignación

> Lee también `design.md` (el cómo) y `tasks.md` (el desglose). Ficha `fullstack`, `sdd: true`,
> complejidad media. Depende de nada; la ficha **401** depende de esta.

> **Corrección 2026-09-09 (puerta `spec_ready`):** esta versión rectifica dos premisas que el
> incidente había dejado caducadas —se afirmaba que la credencial de Google «sigue rota hoy» y que
> había 42 órdenes esperando el backfill de R17/R18— y añade el aviso que el humano pidió en la
> puerta de aprobación (Bloque F, R31-R36). Los Bloques A y B (el gate distingue la causa; el
> marcador) **no cambian de una coma**: su valor no era desbloquear las órdenes de hoy —eso ya se
> hizo, a mano— sino que el PRÓXIMO corte de este tipo no repita ni el bloqueo ni el rescate manual.
> Ver la actualización al final de "Origen" y el Bloque C.

## Origen, MEDIDO en producción (no supuesto)

El 2026-09-09 el humano reportó «Dirección no encontrada» al asignar mensajero: **6 de 15 órdenes
bloqueadas**. Lo medido en la base de producción:

1. La Google Geocoding API **rechaza todas** las peticiones desde el **2026-09-08 19:40:04** (último
   geocode con éxito). Desenlace: `geocodificar direccion: el proveedor rechazo la peticion
   (REQUEST_DENIED)`.
2. `lib/clients/google-geocode.ts:149-153` traduce `REQUEST_DENIED` al desenlace **`config_invalida`**
   — credencial, facturación o configuración del proyecto. **La dirección nunca llegó a consultarse.**
3. Las 6 órdenes bloqueadas tienen `latitud`, `longitud`, `geocode_status` y `geocoded_at` **todo en
   `null`**. Sus direcciones son normales, del mismo estilo que las 178 que se geocodificaron sin
   problema el 1-sep.
4. Alcance: **43 órdenes vivas sin coordenadas — 42 por la credencial rota y 1 sola por dirección
   genuinamente irresoluble (`ZERO_RESULTS`)**. El gate trata igual a las dos.
5. **25 jobs en `failed` y 23 en `pending`.** Ninguna alerta se disparó en 19 horas *(eso es la 401,
   fuera de alcance aquí)*.

### Actualización, MEDIDA el 2026-09-09 a las 15:41 UTC — el incidente ya está resuelto

1. **La credencial de Google ya funciona.** Una sonda (un job resucitado con `intentos=0`)
   geocodificó la orden NA-1143 con `geocode_status=OK` y precisión `ROOFTOP` a las 15:35 UTC.
2. **El leader reactivó A MANO los 47 jobs afectados** (`intentos=0`, `last_error=null`, `run_after`
   adelantado), directamente en la base de producción. Resultado medido: **0 jobs pendientes, 0
   fallidos, 42 geocodificaciones nuevas**. Las órdenes vivas sin coordenadas pasaron de 43 a **1**
   (NA-817, `ZERO_RESULTS`: dirección genuinamente irresoluble — el caso legítimo de bloqueo, que
   **sigue bloqueado**, sin cambios en esta ficha).
3. **El rescate fue manual.** Alguien tuvo que entrar a la base de producción a resucitar jobs uno
   por uno. Evitar exactamente eso —que un corte de proveedor solo se note y se repare porque un
   humano entra a mano a la base— es la razón de ser de la ficha **401**.
4. **Consecuencia para esta ficha:** los Bloques A y B no cambian de una coma — el gate seguirá sin
   distinguir la causa el día que el proveedor vuelva a rechazar peticiones, y ese día no hay ningún
   humano de guardia garantizado. El Bloque C (el backfill de R17/R18) sí cambia de premisa: hoy no
   tiene sujetos que reparar. Ver R17.

## Precisiones verificadas en el código, no supuestas

1. **El gate tiene UN SOLO camino para un job muerto.** `AsignabilidadCoordenadasService`
   (`lib/services/AsignabilidadCoordenadasService.ts:96-100`) clasifica cualquier job con
   `estado === 'failed'` como `geocodificacion_agotada`, sin mirar POR QUÉ murió. Un corte de
   credencial y una dirección que el proveedor no resuelve caen en el mismo cubo.
2. **La causa ya viaja hasta el gate; no hace falta ni columna ni migración.**
   `JobDTO.lastError` (`lib/interfaces/repositories/IJobRepository.ts:19`) forma parte del DTO que
   `findByDedupeKeys` devuelve, y ese es exactamente el método que el gate ya invoca (`:85`).
   `JobQueueService.manejarFallo` persiste ahí el `err.message` del handler, recortado a 500
   caracteres (`lib/services/JobQueueService.ts:20-24, :98, :109`).
3. **El desenlace de configuración ya está aislado en el dominio, en dos sitios.**
   `GeocodificacionService` lanza `GeocodeIntentoFallidoError` en el `case "config_invalida"`
   (`:168-173`) y `GeocodeNoConfiguradoError` cuando falta `GOOGLE_MAPS_API_KEY` (`:114-118`). Los dos
   son fallos NUESTROS. Pero `GeocodeIntentoFallidoError` se usa **también** para el desenlace
   `transitorio` (`:164-167`), que NO es lo mismo: hoy los dos son indistinguibles río abajo.
4. **Una dirección irresoluble NUNCA produce un job `failed`.** `GeocodificacionService` **completa**
   el job (lo deja en `done`) en los tres desenlaces deterministas: `sin_resultados`
   (`ZERO_RESULTS`), `consulta_invalida` (`INVALID_REQUEST`) y `SIN_DIRECCION`; y escribe ese valor en
   `orden.geocode_status`, que es lo que el gate lee en su paso R3. Es decir: **el caso «la dirección
   no existe» y el caso «nuestra configuración está rota» ya llegan al gate por caminos distintos** —
   uno por la ORDEN, otro por la COLA. El bug es que el segundo camino no distingue la causa.
5. **El modo degradado río abajo YA EXISTE y está probado.** Feature 92:
   - **R37** — las órdenes en reparto sin coordenadas se **excluyen** de la optimización y se
     registran como paradas sin posición, **en vez de abortarla**
     (`lib/services/OptimizacionRutaService.ts:225-233`, test en
     `tests/unit/services/optimizacion-ruta-degradacion.test.ts`).
   - **R28** — las paradas sin posición se muestran **al final** de la lista del mensajero.
   - **R30** — el módulo **avisa** mientras existan órdenes sin posición.
   - `OrdenRepository.findParadasEnReparto` ni siquiera filtra las coordenadas nulas.
   **Conclusión: una orden sin coordenadas asignada a un mensajero no se pierde.** El único que lo
   impide es el gate.
6. **La orden puede recibir coordenadas DESPUÉS de asignada.**
   `OrdenGeocodeRepository.guardarResultado` hace `updateMany({ where: { id, deletedAt: null } })`:
   no mira el estatus ni el mensajero. Un job que se ejecute con éxito más tarde escribe las
   coordenadas igual, y la siguiente optimización ya la coloca en su sitio.
7. **El mensaje que miente vive en un módulo compartido.**
   `app/(app)/_components/geocodificacion-motivo-messages.ts` mapea HOY
   `direccion_no_geocodificable` **y** `geocodificacion_agotada` al mismo
   `MSG_DIRECCION_NO_ENCONTRADA = "Dirección no encontrada"`. Lo consumen **dos mappers**
   (`ordenes/_components/guia-decision-error-messages.ts` y
   `recepcion-satelite/_components/asignacion-satelite-error-messages.ts`) y, para el mensaje por
   orden de la 368, **dos modales** que importan `mensajeDireccionPorMotivo` directamente
   (`AsignarBodegaModal.tsx:24`, `AsignarSateliteModal.tsx:25`). Los modales que consumen los mappers
   son cuatro (`GenerarGuiaModal`, `AsignarBodegaModal`, `AsignarRecoleccionModal`,
   `AsignarSateliteModal`; además `RutearSateliteModal` y `QuitarRecoleccionModal` usan el mismo
   mapper). **Cambiar el módulo compartido los alcanza a todos; declarar el mapa en otro sitio, no.**
8. **La unión `EstadoAsignabilidad` dice que es cerrada, pero HOY nada lo comprueba.** Su comentario
   afirma que añadir un valor «debe romper el exhaustive check» — no hay ningún `switch` exhaustivo
   sobre ella en el árbol: el mapa de mensajes clasifica los motivos con dos arrays de literales, y
   un valor nuevo no clasificado simplemente cae al `null` defensivo. Un guard hardcodea los cinco
   literales (`tests/unit/guards/geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts:28-34`).
9. **La 368 (done) ya hizo que el lote no aborte completo** y reporte las bloqueadas por guía con su
   motivo (`partial`). Esta ficha se apoya en eso; no lo rehace.

## Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **fallo de configuración propia** | El intento de geocodificación murió por algo NUESTRO —el proveedor rechazó la petición (`REQUEST_DENIED` → desenlace `config_invalida`) o falta la credencial— **sin llegar a evaluar la dirección**. |
| **fallo ajeno a la configuración** | Cualquier otro motivo por el que un job de geocodificación falla: red, timeout, HTTP 5xx, cuota (`OVER_QUERY_LIMIT`), estado desconocido del proveedor, respuesta con forma inesperada, payload inválido, handler no registrado. |
| **dirección irresoluble** | La geocodificación SÍ se ejecutó y concluyó que la dirección no resuelve: `geocode_status ∈ {ZERO_RESULTS, INVALID_REQUEST, SIN_DIRECCION}` en la orden. |
| **marcador** | Señal legible por máquina que viaja con el fallo hasta el gate e identifica «fallo de configuración propia» sin depender de la redacción del mensaje. |
| **asignable sin ubicación** | Clasificación NUEVA del gate: la asignación pasa, pero la orden sigue sin coordenadas y entra en el modo degradado ya existente (precisión 5). |
| **estado bloqueante** | Valor de `EstadoAsignabilidad` que impide la asignación y viaja como `motivo` en el `detalle` de un rechazo. |

---

# Requisitos

## Bloque A — El gate distingue la causa

**R1.** CUANDO el gate evalúe una orden sin coordenadas y sin dirección irresoluble, y exista un job
de geocodificación de su dirección vigente cuyo último error registrado lleve el **marcador** de
fallo de configuración propia, el sistema DEBE clasificarla como **asignable sin ubicación**.

**R2.** SI ese job existe y su último error registrado NO lleva el marcador, ENTONCES el sistema DEBE
conservar la clasificación vigente sin cambio alguno: `geocodificacion_agotada` si el job está
`failed`, `geocodificacion_en_curso` si está `pending` o `processing`.

**R3.** El sistema DEBE evaluar el caso nuevo **después** de los pasos que se resuelven sin tocar la
cola (coordenadas presentes; `geocode_status` determinista) y **antes** de los pasos que clasifican
por estado del job (`failed`; `pending`/`processing`), sin alterar el orden relativo del resto del
árbol de decisión.

**R4.** SI la orden tiene `geocode_status` determinista (`ZERO_RESULTS`, `INVALID_REQUEST` o
`SIN_DIRECCION`), ENTONCES el sistema DEBE seguir bloqueando la asignación **aunque** exista un job
con el marcador de fallo de configuración. *(La fuente de verdad de «dirección no encontrada» es la
ORDEN, no la cola.)*

**R5.** SI no existe job para la dirección vigente, o el job está `done`, ENTONCES el sistema DEBE
conservar el comportamiento vigente (encolar una geocodificación puntual), sin cambios.

**R6.** MIENTRAS una orden esté clasificada como asignable sin ubicación, el sistema DEBE permitir
asignarle mensajero por las mismas dos vías que hoy admiten una orden asignable: la asignación desde
la bodega central y la asignación desde la bodega satélite.

**R7.** CUANDO el sistema deje pasar una asignación por esta vía, NO DEBE escribir `latitud`,
`longitud`, `geocode_status` ni `geocoded_at` en la orden: la orden queda asignada **y sin
ubicación**.

**R8.** Una orden asignada sin ubicación DEBE seguir pudiendo recibir coordenadas más tarde: el ciclo
de geocodificación NO DEBE depender de si la orden ya tiene mensajero.

**R9.** Una orden asignada sin ubicación DEBE quedar cubierta por el modo degradado ya existente de
la feature 92 (excluida del cálculo de ruta sin abortarlo, mostrada como parada sin posición al final
de la lista del mensajero, y contada por el aviso del módulo).

**R10.** El estado «asignable sin ubicación» NO DEBE aparecer nunca como `motivo` en el `detalle` de
un rechazo de asignación: no es un motivo de bloqueo.

## Bloque B — El marcador (estable, sin prosa, sin PII)

**R11.** CUANDO un intento de geocodificación termine por un fallo de configuración propia —el
proveedor rechaza la petición, o falta la credencial— el sistema DEBE registrar el fallo con un
marcador **legible por máquina** cuya detección NO dependa de la redacción del mensaje de error.

**R12.** El marcador DEBE sobrevivir al recorte de longitud que la cola aplica al mensaje de error
antes de persistirlo (hoy, 500 caracteres desde el principio).

**R13.** El marcador DEBE estar declarado en **un único** módulo, y tanto quien lo escribe como quien
lo lee DEBEN consumir esa declaración: ningún literal copiado en otro archivo.

**R14.** El marcador NO DEBE contener la dirección, el id de la orden, la credencial ni la URL del
proveedor.

**R15.** El sistema NO DEBE reducir el filtrado de datos personales que hoy aplica el cliente HTTP del
proveedor (`lib/clients/google-geocode.ts`): ni el `strip` de zod sobre la respuesta, ni la regla de
que los mensajes de error citen la operación y jamás la URL, la credencial o la dirección.

**R16.** SI un fallo de geocodificación es **ajeno a la configuración** (red, timeout, HTTP 5xx,
cuota, estado desconocido del proveedor, respuesta con forma inesperada, payload inválido, handler no
registrado), ENTONCES el sistema NO DEBE registrarlo con el marcador.

## Bloque C — Recuperación idempotente para el PRÓXIMO incidente (hoy sin sujetos)

**R17.** SI existen jobs de geocodificación **no completados** cuyo error se registró antes de que el
marcador existiera y cuya causa fue un fallo de configuración propia, ENTONCES el sistema DEBE
ofrecer una operación **idempotente** que les añada el marcador. *(Medido el 2026-09-09 a las 15:41
UTC: HOY no hay ninguna fila que cumpla esta condición — el rescate de las 42 órdenes del incidente
que origina esta ficha ya se hizo, A MANO, en producción; ver la actualización de "Origen". Esta
operación no fue lo que las desbloqueó. Es la red para que la PRÓXIMA vez ese rescate no dependa de
que alguien entre a la base a mano, que es exactamente lo que hizo falta esta vez y lo que la 401
automatiza más allá, con la alerta y el reencolado. La decisión de conservarla sin sujetos hoy está
justificada en `design.md` §7.)*

**R18.** Esa operación NO DEBE modificar el estado, los intentos, la programación ni la clave de
deduplicación de ningún job, ni tocar jobs de otro tipo, ni jobs cuyo error tenga otra causa. *(Se
verifica sembrando filas propias en el test de integración: R17/R18 no dependen de que existan
candidatas reales en ninguna base.)*

## Bloque D — El mensaje deja de mentir

**R19.** CUANDO el sistema muestre al operador el motivo `geocodificacion_agotada`, el mensaje NO
DEBE afirmar que la dirección no se encontró, y NO DEBE pedir al operador que corrija la dirección.

**R20.** CUANDO el sistema muestre al operador el motivo `direccion_no_geocodificable`, el mensaje
DEBE seguir siendo el literal vigente «Dirección no encontrada», sin cambios.

**R21.** Los tres motivos transitorios (`geocodificacion_en_curso`, `geocodificacion_encolada`,
`geocodificacion_no_encolable`) DEBEN conservar su mensaje vigente, sin cambios.

**R22.** CUANDO un lote de rechazo acumule motivos de más de una clase, el sistema DEBE mostrar un
único mensaje agregado, con esta precedencia: dirección irresoluble **>** fallo del servicio de
geocodificación **>** en validación. *(Gana el que exige una acción del operador sobre el dato.)*

**R23.** Los cuatro modales de asignación DEBEN recibir el cambio de mensajes a través del módulo
compartido `geocodificacion-motivo-messages`; ninguno DEBE declarar su propio mapa
`motivo → mensaje`, ni citar los literales de motivo del gate.

**R24.** Todo mensaje que esta ficha introduzca o modifique DEBE ser un literal fijo, sin la
dirección, sin el id de la orden y sin ningún otro dato personal.

**R25.** El sistema DEBE mantener la lista de estados **bloqueantes** en un único sitio, y el mapa
`motivo → mensaje` DEBE cubrir exactamente esa lista: añadir un estado nuevo sin clasificarlo como
bloqueante o como asignable DEBE producir un fallo detectable, no un silencio.

## Bloque E — Alcance: lo que esta ficha NO hace

**R26.** Esta ficha NO DEBE levantar el bloqueo de las direcciones irresolubles: `ZERO_RESULTS`,
`INVALID_REQUEST` y `SIN_DIRECCION` siguen bloqueando la asignación (decisión del humano, no
reabrible aquí). Cubierto por R4/R20.

**R27.** Esta ficha NO DEBE añadir tabla, columna, enum ni migración, ni cambiar el contrato de
`IJobRepository`, ni introducir un proveedor de geocodificación de respaldo, ni alterar la
arquitectura de la cola.

**R28.** Esta ficha NO DEBE implementar la alerta por caída del geocodificador ni el reencolado
automático de los jobs muertos: **eso es la ficha 401**, que depende de esta.

**R29.** Esta ficha NO DEBE tocar `geocode_precision` ni ninguna regla sobre la **calidad** de la
coordenada: **eso es la ficha 270** (`pending`), que trata de un centroide de distrito haciéndose
pasar por la casa del cliente. La frontera es nítida: **270 = la coordenada existe pero es mala;
400 = la coordenada NO existe y hay que decidir si eso bloquea.** No comparten archivo de decisión.

**R30.** Ningún comentario del código que siga afirmando que `estado === 'failed'` es el único
predicado de «intentos agotados», o que los dos motivos definitivos comparten mensaje, DEBE
sobrevivir sin reescribirse para declarar la regla vigente desde esta ficha, con su fecha.

## Bloque F — El aviso que el humano pidió en la puerta de aprobación (R31-R36)

El 2026-09-09, en la puerta `spec_ready`, el humano confirmó que SÍ quiere ver, al asignar, cuántas
órdenes quedaron asignadas sin ubicación (antes "Q1"; la alternativa de no avisar queda descartada en
`design.md` §8-A6). Una orden asignada sin ubicación **recibió mensajero** — no es un conflicto ni un
fallo de la operación — así que este aviso es un canal **propio**, distinto del que reporta órdenes
bloqueadas (368).

**R31.** CUANDO una asignación desde bodega central o desde bodega satélite deje al menos una orden
del lote clasificada como asignable sin ubicación, el sistema DEBE informar cuántas órdenes de ese
lote quedaron en esa condición.

**R32.** El aviso de R31 DEBE ser una cifra agregada: el sistema NO DEBE identificar, en ese aviso ni
en los datos que lo acompañan, cuál orden en particular quedó sin ubicación — ni por su identificador
interno, ni por su número de guía o remisión, ni por su dirección.

**R33.** SI ninguna orden del lote asignado quedó sin ubicación, ENTONCES el sistema NO DEBE mostrar
ningún aviso derivado de R31.

**R34.** El operador DEBE poder ver el aviso de R31 en el mismo lugar donde hoy ve la confirmación
del resultado de su asignación, sin abrir otra pantalla ni otro reporte.

**R35.** Una orden asignada sin ubicación NO DEBE reportarse junto con las órdenes bloqueadas del
mismo lote: el aviso de R31 viaja por un canal distinto del que reporta bloqueos, porque asignar sin
ubicación no es un conflicto.

**R36.** El texto del aviso de R31 DEBE estar en lenguaje llano para el operador: NO DEBE usar siglas
ni terminología interna del sistema — quedan prohibidas, entre otras, "geocodificación",
"config_invalida" y "API" — y DEBE dejar claro que la causa es del sistema, no de la dirección de la
orden.

---

## Trazabilidad R → test

Un requisito sin test es un fallo de la feature (`docs/specs.md`). Archivos existentes marcados
*(ext.)* = se extienden; el resto son nuevos.

| R | Test concreto |
| --- | --- |
| R1 | `tests/unit/services/asignabilidad-coordenadas.test.ts` *(ext.)* — «un job `failed` cuyo `lastError` lleva el marcador de configuracion clasifica la orden como `asignable_sin_ubicacion`» + su gemelo con el job en `pending` y en `processing` |
| R2 | idem *(ext.)* — «un job `failed` con `lastError` SIN marcador (o `null`) sigue dando `geocodificacion_agotada`» y «`pending`/`processing` sin marcador siguen dando `geocodificacion_en_curso`» |
| R3 | idem *(ext.)* — «con coordenadas presentes el gate NO consulta la cola aunque el job lleve el marcador» y «el paso del marcador se evalúa antes que la rama por estado del job» (doble de `IJobRepository` que cuenta llamadas) |
| R4 | idem *(ext.)* — «`geocode_status = ZERO_RESULTS` + job `failed` CON marcador → `direccion_no_geocodificable`», parametrizado sobre los tres status deterministas |
| R5 | idem *(ext.)* — «sin job, y con job `done`, se sigue encolando (`geocodificacion_encolada`)» (test vigente, no debe cambiar) |
| R6 | `tests/unit/services/guia-asignacion-gate-coordenadas.test.ts` *(ext.)* y `tests/unit/services/asignacion-satelite-gate-coordenadas.test.ts` *(ext.)* — «`asignable_sin_ubicacion` NO entra en el `detalle` y la orden sí recibe mensajero» |
| R7 | `tests/unit/services/guia-asignacion-gate-coordenadas.test.ts` *(ext.)* — «asignar una orden `asignable_sin_ubicacion` no escribe latitud/longitud/geocode_status/geocoded_at» (doble de repo que falla si se le pasan esos campos) |
| R8 | `tests/unit/services/geocodificacion-service.test.ts` *(ext.)* — «`guardarResultado` escribe las coordenadas de una orden ya asignada» (el update no filtra por estatus ni mensajero). **Corregido al implementar (2026-09-09):** el test se escribió contra el **repositorio real** (`OrdenGeocodeRepository`) con un `prisma.orden.updateMany` doblado que captura el `where` **literal**, no contra el service con un doble del repo — porque lo que R8 afirma ES el `WHERE`, y un doble del repositorio no lo ve (memoria del repo: «probar el WHERE donde vive»). La aserción compara el objeto completo, no `objectContaining`: añadir un filtro por mensajero o por estatus lo pone rojo |
| R9 | `tests/unit/services/optimizacion-ruta-degradacion.test.ts` *(ext.)* — «una orden en reparto sin coordenadas se excluye del cálculo, se reporta como parada sin posición y no aborta la optimización» (ancla de no-regresión de 92/R37) |
| R10 | `tests/unit/services/asignabilidad-coordenadas.test.ts` *(ext.)* + `tests/unit/components/geocodificacion-motivo-messages.test.ts` *(ext.)* — «`asignable_sin_ubicacion` no tiene entrada en el mapa de mensajes y `esAsignable` lo acepta» |
| R11 | `tests/unit/services/geocodificacion-marcador-contrato.test.ts` (nuevo) — «el error que lanza `GeocodificacionService` ante `config_invalida`, y ante credencial ausente, produce un `lastError` que el gate reconoce» (recorre service → mensaje → `JobDTO` → gate, sin doble intermedio) |
| R12 | `tests/unit/geo/fallo-config-geocode.test.ts` (nuevo) — «el marcador sigue detectándose tras recortar el mensaje a 500 caracteres, con un detalle de 2000» |
| R13 | `tests/unit/guards/marcador-fallo-config-declaracion-unica.guardia.test.ts` (nuevo) — lee el árbol real: el literal del marcador aparece SOLO en su módulo; `GeocodificacionService` y `AsignabilidadCoordenadasService` lo importan de ahí. Con contraprueba (detecta un literal copiado) |
| R14 | `tests/unit/geo/fallo-config-geocode.test.ts` (nuevo) — «el marcador no contiene la dirección ni el id: es un literal constante afirmado a mano» |
| R15 | `tests/unit/services/geocodificacion-service.test.ts` — test vigente «el payload crudo persistido en la cache NO arrastra la direccion en claro» (debe seguir verde) + `tests/unit/clients/google-geocode.test.ts` — «ningún `detalle` devuelto por el cliente contiene la dirección consultada ni la clave». **Corregido al implementar (2026-09-09):** ese archivo **NO se extendió**, y no hacía falta: su test vigente ya incluye el caso `REQUEST_DENIED` entre los tres que barre, pese a llamarse «transitorio». El camino de configuración queda cubierto por el test que ya existía, así que extenderlo habría sido añadir una copia. `lib/clients/google-geocode.ts` no se toca en toda la ficha (`git diff --stat` lo acredita) |
| R16 | `tests/unit/services/geocodificacion-marcador-contrato.test.ts` (nuevo) — parametrizado sobre red/timeout/5xx/`OVER_QUERY_LIMIT`/`UNKNOWN_ERROR`/estado desconocido/payload inválido: «el `lastError` resultante NO lleva el marcador y el gate sigue bloqueando» |
| R17 | `tests/integration/db/backfill-marcador-config-geocode.test.ts` (nuevo) — siembra jobs con el `last_error` legado, corre el backfill dos veces y comprueba que el marcador queda una sola vez y que el gate ya los deja pasar *(sembradas por el test; en producción, medido el 2026-09-09, el `WHERE` no encuentra ninguna fila real — ver la nota de R17 arriba)* |
| R18 | idem (nuevo) — «no cambia `estado`, `intentos`, `run_after` ni `dedupe_key`; no toca jobs de otro tipo ni jobs con otro `last_error`» (se comparan filas testigo antes/después) |
| R19 | `tests/unit/components/geocodificacion-motivo-messages.test.ts` *(ext.)* — «`geocodificacion_agotada` NO devuelve "Dirección no encontrada"» + el literal nuevo afirmado a mano |
| R20 | idem *(ext.)* — «`direccion_no_geocodificable` devuelve exactamente "Dirección no encontrada"» (literal escrito a mano, no derivado de la constante) |
| R21 | idem *(ext.)* — «los tres motivos transitorios devuelven el literal vigente» |
| R22 | idem *(ext.)* — matriz de las tres clases mezcladas dos a dos y las tres juntas: gana irresoluble, luego fallo del servicio, luego validación |
| R23 | `tests/unit/guards/geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts` *(ext.)* — la lista de literales prohibidos en los modales pasa a cubrir la unión completa; `tests/unit/components/guia-decision-error-messages.test.ts` *(ext.)* y `tests/unit/utils/guia-decision-error-message.test.ts` *(ext.)* y el test del mapper satélite — «el mensaje nuevo llega por los DOS mappers» |
| R24 | `tests/unit/components/geocodificacion-motivo-messages.test.ts` *(ext.)* — «ningún mensaje del mapa contiene dígitos, `@`, ni las cadenas de una dirección/id de prueba» |
| R25 | idem *(ext.)* — «las claves del mapa `motivo → mensaje` son exactamente la lista de estados bloqueantes exportada», y el guard de R13 comprueba que la lista se declara una sola vez |
| R26 | Cubierto por R4 y R20 (mismos tests). Además `tests/unit/services/asignabilidad-coordenadas.test.ts` *(ext.)* mantiene verde el caso vigente de dirección irresoluble |
| R27 | `./init.sh` completo (no hay migración nueva que aplicar) + `tests/unit/guards/marcador-fallo-config-declaracion-unica.guardia.test.ts` (nuevo) — «`IJobRepository.ts` no cambia de forma: el guard afirma que `JobDTO` sigue exponiendo `lastError` y que no se añadieron campos para esta ficha» |
| R28 | Revisión de alcance: `progress/impl_400_*.md` debe declarar que no se tocó ni el cron, ni el notificador, ni el reencolado. Sin test de código (requisito de NO-hacer) |
| R29 | Revisión de alcance: el diff no toca `geocode_precision`. Verificable con `git diff --stat` en el informe del reviewer. Sin test de código |
| R30 | `tests/unit/guards/marcador-fallo-config-declaracion-unica.guardia.test.ts` (nuevo) — lee la cabecera de `AsignabilidadCoordenadasService.ts` y exige que el bloque normativo cite el paso nuevo y la fecha de esta ficha |
| R31 | `tests/unit/services/guia-asignacion-gate-coordenadas.test.ts` *(ext.)* + `tests/unit/services/asignacion-satelite-gate-coordenadas.test.ts` *(ext.)* — «un lote con N órdenes `asignable_sin_ubicacion` entre las asignables devuelve el conteo N junto al resultado (`ok` o `partial`)» + `tests/components/AsignarBodegaModal.test.tsx` *(ext.)* y `tests/components/AsignarSateliteModal.test.tsx` *(ext.)* — el número aparece en el DOM del bloque de resultado |
| R32 | mismos tests de gate *(ext.)* — «el conteo es un `number`, nunca un array de ids/guías/direcciones» + mismos tests de componente *(ext.)* — «el DOM del aviso no contiene ningún `numRemision` ni id de las órdenes sin ubicación» |
| R33 | mismos tests de gate *(ext.)* — «sin ninguna `asignable_sin_ubicacion` el resultado no expone el aviso» + mismos tests de componente *(ext.)* — «con el conteo en cero, el DOM no renderiza ningún aviso derivado de R31» |
| R34 | `tests/components/AsignarBodegaModal.test.tsx` *(ext.)* y `tests/components/AsignarSateliteModal.test.tsx` *(ext.)* — «el aviso aparece dentro del mismo bloque de confirmación (`ManifiestoResultado`/toast) que ya muestra el resultado de la asignación, sin navegación adicional» |
| R35 | mismos tests de componente *(ext.)* — «un lote con `bloqueadas` Y con conteo de sin-ubicación a la vez: el aviso de R31 no aparece dentro de la lista `role="alert"` de bloqueadas, ni sus números se mezclan» + `tests/unit/services/*-gate-coordenadas.test.ts` *(ext.)* — el conteo y `bloqueadas` son campos hermanos, nunca anidados |
| R36 | `tests/unit/components/geocodificacion-motivo-messages.test.ts` *(ext.)* — «el literal del aviso de R31 no contiene "geocodificación", "config_invalida" ni "API" (case-insensitive)» + el literal completo afirmado a mano (design.md §6.5) |

---

## Preguntas abiertas

**Ninguna.** Las cuatro de la versión anterior se resolvieron en la puerta de aprobación del
2026-09-09:

- **Q1** (¿aviso al asignar una orden sin ubicación?) → **sí**. Formalizado como Bloque F
  (R31-R36). La alternativa de no avisar queda en `design.md` §8-A6 como descartada, junto con una
  segunda alternativa descartada (marcar cada item de `resultados` con un booleano en vez de un
  conteo agregado) que sí se consideró y se rechazó por identificar demasiado.
- **Q2** (¿cuándo se corre el backfill contra producción?) → sin objeto. Medido el mismo día a las
  15:41 UTC: el incidente ya se resolvió a mano, en producción, antes de que esta pregunta llegara a
  responderse. Ver la actualización en "Origen" y el R17 corregido.
- **Q3** (¿el marcador aplica también a `processing`?) → confirmado el criterio amplio
  (`failed`/`pending`/`processing`), sin cambios en R1. La alternativa conservadora
  (`design.md` §8-A4) queda solo como alternativa descartada, con su coste medido (23 de 48 jobs del
  incidente estaban en `pending`).
- **Q4** (texto exacto del mensaje nuevo) → fijado. `design.md` §6.2 conserva el texto de
  `geocodificacion_agotada` (R19) y §6.5 añade el texto del aviso de R31-R36. Los dos son, por
  convención del repo, contrato de test afirmado a mano — nunca comparado contra la constante que
  los genera.
