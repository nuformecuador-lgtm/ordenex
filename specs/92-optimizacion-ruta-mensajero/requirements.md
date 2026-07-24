# Feature 92 — Optimización de ruta de entrega del mensajero · requirements

> Notación EARS (`docs/specs.md`). Cada `R<n>` mapea a **al menos un test concreto**.
> Consume la feature 90 (cola de jobs) y la 91 (coordenadas), ambas ya en `dev` (5244cf3).
>
> **Leyenda de procedencia** (regla 6 de `CLAUDE.md`):
> - 🔎 **VERIFICADO** — comportamiento leído directamente en el código de `dev`.
> - 🧭 **CRITERIO PROPUESTO** — decisión de negocio del spec_author, **no** confirmada por el
>   humano ni por `docs/`. Debe mirarse en el gate F1.4.
> - ✅ **DECIDIDO** — decisión explícita del humano en el gate adelantado 2026-07-19.

---

## Glosario

| Término | Significado |
| --- | --- |
| **Parada** | Una orden en estatus `en_reparto` asignada al mensajero, con `latitud` y `longitud` no nulas. |
| **Ruta optimizada** | Secuencia persistida de paradas de UN mensajero, con su instante de cálculo. |
| **Origen** | Punto de partida de la ruta: la ubicación del mensajero (✅ decisión 2). |
| **Gate de asignabilidad** | Guarda que impide asignar a un mensajero una orden sin coordenadas utilizables. |
| **Disparo con debounce** | Reoptimización diferida 60 s, colapsando eventos dentro de la ventana. |
| **Disparo inmediato** | Reoptimización sin espera. |

---

## Bloque A — Gate de asignabilidad por coordenadas

Los **tres** puntos de escritura de `mensajero_asignado_id` verificados en código son:
`GuiaAsignacionService.generarGuia` (rama GAM con mensajero), `GuiaAsignacionService.asignarDesdeBodega`
y `AsignacionSateliteService.asignar`. `AsignacionMensajeroService.asignarMensajeroSugerido`
escribe `mensajero_sugerido_id` (**sugerencia**, no asignación) y 🧭 **queda fuera del gate**.

**R1.** El sistema DEBE clasificar cada orden candidata a asignación en exactamente uno de estos
estados de asignabilidad: `asignable`, `direccion_no_geocodificable`, `geocodificacion_agotada`,
`geocodificacion_en_curso`, `geocodificacion_encolada`, `geocodificacion_no_encolable`.
→ `tests/unit/services/asignabilidad-coordenadas.test.ts`

**R2.** SI una orden tiene `latitud` y `longitud` no nulas, ENTONCES el sistema DEBE clasificarla
como `asignable` sin consultar la tabla `jobs`.
→ `tests/unit/services/asignabilidad-coordenadas.test.ts`

**R3.** SI una orden no tiene coordenadas y su `geocode_status` es uno de los desenlaces
**deterministas** (`ZERO_RESULTS`, `INVALID_REQUEST`, `SIN_DIRECCION`), ENTONCES el sistema DEBE
clasificarla como `direccion_no_geocodificable` sin consultar la tabla `jobs`.
🔎 Verificado: `GeocodificacionService` **completa** el job (no lo falla) en esos tres desenlaces
y persiste el status en la orden; por eso la tabla `jobs` **no** es la fuente de verdad de este caso.
→ `tests/unit/services/asignabilidad-coordenadas.test.ts`

**R4.** SI una orden no tiene coordenadas ni `geocode_status` determinista, ENTONCES el sistema DEBE
localizar su job de geocodificación construyendo la clave exacta
`geocodificacion:<ordenId>:<hashDireccion(orden.direccion).slice(0,8)>` y consultándola por
igualdad, en una **sola** consulta por lote de órdenes.
→ `tests/unit/services/asignabilidad-coordenadas.test.ts`,
  `tests/integration/repositories/job-find-by-dedupe-keys.test.ts`

**R5.** SI el job de geocodificación de la dirección **actual** de la orden existe y su `estado` es
`failed`, ENTONCES el sistema DEBE clasificar la orden como `geocodificacion_agotada`.
🔎 Predicado exacto verificado en `JobQueueService.manejarFallo`: el dead-letter (`estado='failed'`)
se aplica cuando `intentos >= maxIntentos` **en el momento del fallo**. Un job `pending`/`processing`
con `intentos >= maxIntentos` **todavía puede tener éxito** (el claim incrementa `intentos` antes de
ejecutar), así que `estado = 'failed'` es el **único** predicado de "intentos agotados".
→ `tests/unit/services/asignabilidad-coordenadas.test.ts`

**R6.** SI el job de geocodificación de la dirección actual existe y su `estado` es `pending` o
`processing`, ENTONCES el sistema DEBE clasificar la orden como `geocodificacion_en_curso`.
→ `tests/unit/services/asignabilidad-coordenadas.test.ts`

**R7.** SI no existe job para la dirección actual de la orden (o existe en `done` sin coordenadas y
sin `geocode_status` determinista), ENTONCES el sistema DEBE encolar una geocodificación puntual
para esa orden y clasificarla como `geocodificacion_encolada`; SI ese encolado lanza, ENTONCES DEBE
clasificarla como `geocodificacion_no_encolable`.
→ `tests/unit/services/asignabilidad-coordenadas.test.ts`

**R8.** CUANDO una operación de asignación de mensajero (`generarGuia` rama GAM con mensajero,
`asignarDesdeBodega`, `AsignacionSateliteService.asignar`) incluya al menos una orden cuyo estado de
asignabilidad no sea `asignable`, el sistema DEBE abortar la operación completa sin efectos y
devolver `conflict` con un `detalle` por orden cuyo `motivo` identifique el estado.
🧭 Todo-o-nada por lote: es el contrato ya vigente de esos tres servicios (verificado), no se cambia.
→ `tests/unit/services/guia-asignacion-gate-coordenadas.test.ts`,
  `tests/unit/services/asignacion-satelite-gate-coordenadas.test.ts`

**R9.** CUANDO la UI de asignación reciba un `conflict` con motivo `direccion_no_geocodificable` o
`geocodificacion_agotada`, el sistema DEBE mostrar un toast con el texto **"Dirección no
encontrada"**; y CUANDO el motivo sea `geocodificacion_en_curso`, `geocodificacion_encolada` o
`geocodificacion_no_encolable`, DEBE mostrar un mensaje distinto que indique que la dirección aún se
está validando.
🔴 **HALLAZGO VERIFICADO 2026-07-20 (leader, al preparar la 93) — R9 NO es "añadir un toast".**
Los tres modales **no leen `detalle` en absoluto**: los tres hacen
`toast.error(guiaDecisionErrorMessage(error))` y ese mapper
(`app/(app)/ordenes/_components/guia-decision-error-messages.ts:47-56`) ramifica **solo por
`status`** (`isGuiaErrorStatus(status) ? GUIA_ERROR_MESSAGES[status] : "No se pudo completar la
operación."`). Un `conflict` con `motivo: "direccion_no_geocodificable"` cae hoy en el mensaje
genérico de `conflict` y **el motivo se descarta antes de llegar al toast**. R9 exige una rama nueva
que inspeccione `detalle[].motivo` ANTES del switch por `status`. El trabajo vive en el **mapper
compartido**, no en los tres modales por separado → se escribe una vez.
🔴 **CUARTO CONSUMIDOR NO DECLARADO:** `RutearSateliteModal.tsx:64` **también** usa
`guiaDecisionErrorMessage`. Al tocar el mapper compartido hereda el comportamiento nuevo
automáticamente. Probablemente deseable, pero **no está decidido ni testeado** → es el patrón de
drift "cambio el comportamiento y dejo un consumidor atrás" que ya golpeó al repo 8 veces. **Debe
resolverse explícitamente en la gate F1.4:** o entra en alcance con su test, o se documenta por qué
queda fuera. Ver **Q10**.
→ `tests/components/GenerarGuiaModal.test.tsx`, `tests/components/AsignarBodegaModal.test.tsx`,
  `tests/unit/components/guia-decision-error-messages.test.ts` (mapper: los 5 `motivo` → 2 mensajes)

---

## Bloque B — Cliente de Google Cloud Route Optimization y credencial

**R10.** El sistema DEBE resolver la configuración del proveedor de optimización (identificador de
proyecto, credencial de service account y timeout) desde variables de entorno, y la función de carga
NUNCA DEBE lanzar: una credencial ausente o vacía se resuelve como `null`.
🔎 Clon estructural de `loadGeocodeConfig` (verificado); el motivo original sigue vigente: el
drenador de la cola es compartido con `liberar_reprogramadas` y `geocodificacion`.
→ `tests/unit/config/route-optimization-config.test.ts`

**R11.** El sistema DEBE obtener un token de acceso OAuth2 para
`https://www.googleapis.com/auth/cloud-platform` firmando un JWT con la clave privada de la service
account, y DEBE reutilizar el token en memoria mientras no esté a menos de 60 s de expirar.
→ `tests/unit/auth/google-sa-token.test.ts`

**R12.** SI falta cualquiera de las piezas de la credencial de Route Optimization, ENTONCES el
sistema DEBE lanzar un error de tipo dedicado (`RutaNoConfiguradoError`) **antes** de cualquier
llamada de red, y el drenado del resto de la cola NO DEBE verse afectado.
🔎 Patrón `GeocodeNoConfiguradoError` verificado en `GeocodificacionService`; `JobQueueService.drenar`
captura job a job (verificado).
→ `tests/unit/services/optimizacion-ruta-service.test.ts`,
  `tests/unit/services/job-queue-service.test.ts` (caso existente reutilizado)

**R13.** El sistema DEBE validar con zod, en el borde, la respuesta de `optimizeTours`, y una
respuesta con forma inesperada DEBE producir un error de integración, nunca una secuencia parcial o
vacía persistida.
→ `tests/unit/clients/google-route-optimization.test.ts`

**R14.** El sistema NUNCA DEBE emitir por log ni por mensaje de error la credencial, el token, la
dirección en claro ni las coordenadas; los mensajes DEBEN citar solo la operación y el estado.
🔎 Misma regla que la 91 (`google-geocode.ts`, invariante 3).
→ `tests/unit/clients/google-route-optimization.test.ts`

**R15.** El sistema DEBE traducir el desenlace del proveedor a: `ok` (secuencia calculada),
`transitorio` (red, timeout, HTTP 5xx, cuota) o `config_invalida` (401/403); `transitorio` y
`config_invalida` DEBEN propagarse como error para que la cola aplique su backoff.
→ `tests/unit/clients/google-route-optimization.test.ts`

---

## Bloque C — Disparadores, debounce y encolado

**R16.** CUANDO un mensajero recoja (acepte) una o más órdenes, el sistema DEBE encolar una
reoptimización de su ruta con `runAfter = now + 60 s`, dentro de la misma transacción que hace la
transición a `en_reparto`.
🔎 `GestionOrdenRepository.recogerLote` ya abre su propio `$transaction`; el encolado va dentro,
patrón outbox de la 91 (`OrdenRepository` inyecta `jobRepo` y llama al helper dentro de `tx`).
→ `tests/integration/repositories/optimizacion-ruta-enqueue.test.ts`

**R17.** MIENTRAS exista un encolado con debounce en vuelo para el mismo mensajero y la misma ventana
de 60 s, un segundo evento de recogida NO DEBE crear un job nuevo ni adelantar el existente.
🔎 Se obtiene con la `dedupeKey` + el `ON CONFLICT ("dedupe_key") ... DO NOTHING` ya existente
(`JobRepository.enqueue`), sin infraestructura nueva.
→ `tests/unit/services/optimizacion-ruta-encolado.test.ts`,
  `tests/integration/repositories/optimizacion-ruta-enqueue.test.ts`

**R18.** El sistema DEBE construir la `dedupeKey` de forma que **nunca** quede permanentemente
ocupada por una fila `done`: la clave DEBE incluir un componente que cambie con el tiempo
(ventana temporal) o con el evento.
🔎 Trampa documentada en el gate F1.4-Q4 de la 91: el índice único de `dedupe_key` no está acotado
por estado y las filas `done` no se purgan.
→ `tests/unit/services/optimizacion-ruta-encolado.test.ts`

**R19.** CUANDO un mensajero registre una gestión (`entregada`, `reprogramada`, `devuelta` o
`rechazada`), el sistema DEBE encolar una reoptimización **sin delay**, dentro de la misma
transacción de `crearGestionYTransicionar`, y ese encolado NUNCA DEBE ser descartado por un encolado
con debounce en vuelo del mismo mensajero.
→ `tests/unit/services/optimizacion-ruta-encolado.test.ts`,
  `tests/integration/repositories/optimizacion-ruta-enqueue.test.ts`

**R20.** CUANDO el drenador ejecute un job de optimización cuyo `createdAt` sea anterior al
`calculada_at` de la ruta vigente del mensajero, el sistema DEBE completar el job **sin llamar al
proveedor**.
🧭 Guarda de coste: evita pagar la reoptimización del debounce cuando un disparo inmediato posterior
ya recalculó la ruta. No es posible cancelar un job `pending` (`IJobRepository` no lo expone).
→ `tests/unit/services/optimizacion-ruta-service.test.ts`

**R21.** El tipo de job de optimización NO DEBE registrarse como recurrente: se encola por evento.
🔎 Espejo de `geocodificacion` en `buildRecurrencias()` (verificado).
→ `tests/unit/api/procesar-jobs-registro.test.ts`

---

## Bloque D — Origen de la ruta

**R22.** El sistema DEBE aceptar, en las acciones del mensajero que disparan reoptimización, una
ubicación opcional `{ lat, lng }` capturada por geolocalización del navegador, validada en el borde
con zod dentro de los rangos `[-90, 90]` y `[-180, 180]`.
→ `tests/unit/actions/mis-asignaciones-ubicacion.test.ts`

**R23.** CUANDO se reciba una ubicación válida del navegador, el sistema DEBE persistirla como origen
de la ruta del mensajero junto con su instante de captura y la fuente `gps`.
→ `tests/integration/repositories/ruta-optimizada-repo.test.ts`

**R24.** SI en el momento de optimizar no hay ubicación `gps` con antigüedad menor a
`RUTA_ORIGEN_TTL_MIN` (🧭 default propuesto **120 min**), ENTONCES el sistema DEBE usar como origen,
en este orden: (1) la última ubicación conocida aunque esté vencida, marcando la fuente
`ultima_conocida`; (2) si no hay ninguna, el **centroide** de las coordenadas de las paradas,
marcando la fuente `centroide`.
🧭 Criterio propuesto. El centroide no requiere ninguna llamada externa ni hardcodear una bodega
(no existen coordenadas de zona/bodega en el esquema — verificado).
→ `tests/unit/services/optimizacion-ruta-origen.test.ts`

**R25.** El sistema NUNCA DEBE bloquear la optimización por ausencia de permiso de geolocalización:
la denegación del permiso DEBE degradar al fallback de R24, no abortar.
→ `tests/unit/services/optimizacion-ruta-origen.test.ts`,
  `tests/components/MisAsignacionesModule.test.tsx`

---

## Bloque E — Persistencia del orden y reordenado de las cards

**R26.** El sistema DEBE persistir el último orden optimizado válido de cada mensajero como una
secuencia entera sin huecos ni repeticiones sobre sus órdenes en reparto, junto con el instante de
cálculo, la fuente del origen y el estado de la ruta.
→ `tests/integration/repositories/ruta-optimizada-repo.test.ts`,
  `tests/integration/db/ruta-optimizada-migracion.test.ts`

**R27.** SI la llamada al proveedor falla, ENTONCES el sistema DEBE conservar intacto el último orden
optimizado válido y marcar la ruta como **desactualizada**; el sistema NUNCA DEBE revertir el orden
de las cards a `createdAt desc` de forma silenciosa.
→ `tests/unit/services/optimizacion-ruta-service.test.ts`

**R28.** El sistema DEBE ordenar las cards de la sección "En reparto / por gestionar" por la
secuencia optimizada ascendente; las órdenes que entraron a la ruta después de la última
optimización (sin posición asignada) DEBEN mostrarse **al final**, ordenadas entre sí por
`createdAt desc` (orden actual verificado en `GestionOrdenRepository.ts:78`) y marcadas como
pendientes de optimizar.
→ `tests/unit/services/mis-asignaciones-orden-ruta.test.ts`

**R29.** El sistema NO DEBE alterar el orden de la sección "Por recoger" (`PorAceptarSection`).
→ `tests/components/MisAsignacionesModule.test.tsx`

**R30.** MIENTRAS la ruta esté marcada como desactualizada o existan órdenes sin posición, el módulo
del mensajero DEBE mostrar un aviso visible que indique que el orden mostrado no está actualizado.
→ `tests/components/MisAsignacionesModule.test.tsx`

---

## Bloque F — Botón de sincronización manual

**R31.** DONDE el actor tenga rol `mensajero`, el módulo DEBE mostrar un botón de sincronización
manual de la ruta; para cualquier otro rol el botón NO DEBE renderizarse.
🔎 La página ya hace `notFound()` para roles distintos de `mensajero` (verificado); la guarda del rol
en la Server Action es defensa en profundidad, no decoración.
→ `tests/components/MisAsignacionesModule.test.tsx`,
  `tests/unit/actions/sincronizar-ruta.test.ts`

**R32.** CUANDO el mensajero pulse el botón de sincronización manual, el sistema DEBE ejecutar la
optimización de forma **síncrona** en la Server Action (sin esperar el debounce ni el cron) y, al
terminar, la UI DEBE reflejar el orden nuevo vía `router.refresh()`.
🔎 El módulo **no usa SWR**: es Server Component + props + `router.refresh()` (verificado en
`MisAsignacionesModule.tsx`, líneas ~81/105/120/129/140).
→ `tests/unit/actions/sincronizar-ruta.test.ts`, `tests/components/MisAsignacionesModule.test.tsx`

**R33.** SI un actor con rol distinto de `mensajero` invoca la Server Action de sincronización,
ENTONCES el sistema DEBE devolver `forbidden` sin efectos ni llamada al proveedor.
→ `tests/unit/actions/sincronizar-ruta.test.ts`

**R34.** El sistema DEBE impedir que dos pulsaciones del botón dentro de la misma ventana de
`RUTA_SYNC_MIN_INTERVALO_S` (🧭 default propuesto **10 s**) produzcan dos llamadas facturadas.
→ `tests/unit/services/optimizacion-ruta-service.test.ts`

---

## Bloque G — Guardas de coste

**R35.** SI el mensajero tiene **0 o 1** paradas con coordenadas, ENTONCES el sistema DEBE completar
la optimización sin llamar al proveedor, persistiendo la secuencia trivial cuando haya una parada.
→ `tests/unit/services/optimizacion-ruta-service.test.ts`

**R36.** SI el conjunto de órdenes en reparto del mensajero y el origen son idénticos a los de la
última optimización válida, ENTONCES el sistema DEBE completar sin llamar al proveedor.
🧭 Criterio propuesto (dedupe por huella del conjunto + origen redondeado).
→ `tests/unit/services/optimizacion-ruta-service.test.ts`

**R37.** El sistema DEBE excluir de la optimización las órdenes en reparto **sin** coordenadas, y
DEBE registrarlas como paradas sin posición (R28) en vez de abortar la optimización completa.
→ `tests/unit/services/optimizacion-ruta-service.test.ts`

**R38.** El sistema DEBE acotar el número de paradas enviadas al proveedor a
`RUTA_MAX_PARADAS` (🧭 default propuesto **100**); superado el límite DEBE optimizar las primeras
`RUTA_MAX_PARADAS` por `createdAt asc` y dejar el resto sin posición.
→ `tests/unit/services/optimizacion-ruta-service.test.ts`

---

## Bloque H — Migración y seguridad de datos

**R39.** La migración DEBE ser aditiva, habilitar RLS sin policies en toda tabla nueva y tener su
`down.sql` que la revierta exactamente.
🔎 Patrón `jobs` / `geocode_cache` verificado.
→ `tests/integration/db/ruta-optimizada-migracion.test.ts`,
  `tests/integration/db/ruta-optimizada-rollback.test.ts`

**R40.** El valor nuevo del enum `job_tipo` DEBE añadirse en una migración **propia**, separada de
cualquier migración que lo consuma.
🔎 Motivo verificado en `20260719120000_job_tipo_geocodificacion/migration.sql`: Postgres rechaza
usar un valor de enum en la misma transacción que lo añadió (55P04).
→ `tests/integration/db/ruta-optimizada-migracion.test.ts`

---

## Trazabilidad resumida

| Req | Test |
| --- | --- |
| R1–R7 | `tests/unit/services/asignabilidad-coordenadas.test.ts` |
| R4 | + `tests/integration/repositories/job-find-by-dedupe-keys.test.ts` |
| R8 | `tests/unit/services/guia-asignacion-gate-coordenadas.test.ts`, `tests/unit/services/asignacion-satelite-gate-coordenadas.test.ts` |
| R9 | `tests/components/GenerarGuiaModal.test.tsx`, `tests/components/AsignarBodegaModal.test.tsx`, `tests/unit/components/guia-decision-error-messages.test.ts` |
| R10 | `tests/unit/config/route-optimization-config.test.ts` |
| R11 | `tests/unit/auth/google-sa-token.test.ts` |
| R12, R20, R27, R34–R38 | `tests/unit/services/optimizacion-ruta-service.test.ts` |
| R13–R15 | `tests/unit/clients/google-route-optimization.test.ts` |
| R16, R17, R19 | `tests/integration/repositories/optimizacion-ruta-enqueue.test.ts` |
| R17–R19 | `tests/unit/services/optimizacion-ruta-encolado.test.ts` |
| R21 | `tests/unit/api/procesar-jobs-registro.test.ts` |
| R22 | `tests/unit/actions/mis-asignaciones-ubicacion.test.ts` |
| R23, R26 | `tests/integration/repositories/ruta-optimizada-repo.test.ts` |
| R24, R25 | `tests/unit/services/optimizacion-ruta-origen.test.ts` |
| R28 | `tests/unit/services/mis-asignaciones-orden-ruta.test.ts` |
| R25, R29–R32 | `tests/components/MisAsignacionesModule.test.tsx` |
| R31–R33 | `tests/unit/actions/sincronizar-ruta.test.ts` |
| R39, R40 | `tests/integration/db/ruta-optimizada-migracion.test.ts`, `tests/integration/db/ruta-optimizada-rollback.test.ts` |

---

## Preguntas abiertas (gate F1.4)

Ver `design.md` §0 para las dos correcciones de premisa que motivan Q1 y Q2.

**Q1 — Búsqueda del job: clave exacta reconstruida en vez de prefijo.**
El leader pidió buscar por prefijo `geocodificacion:<ordenId>:`. Verifiqué que `hashDireccion` está
exportado y que la clave se puede **reconstruir exactamente** desde `orden.direccion`. Reconstruirla
es más barato (usa el índice único ya existente, sin índice nuevo con `text_pattern_ops`), es una
sola consulta por lote, y **es más correcto**: el prefijo devuelve también jobs de direcciones
históricas, que responden por una dirección que ya no existe. ¿Se acepta clave exacta en lugar de
prefijo? **Recomendación: sí, clave exacta.**

**Q2 — La fuente de verdad de "dirección no encontrada" es `orden.geocode_status`, no `jobs`.**
Verifiqué que `ZERO_RESULTS` / `INVALID_REQUEST` / `SIN_DIRECCION` **completan** el job (`done`), no
lo fallan. Es decir, el caso más frecuente de "dirección no encontrada" **nunca** aparece como job
agotado. R3 lo resuelve leyendo la orden antes que la cola. ¿Se confirma? **Recomendación: sí; la
cola queda solo para distinguir "aún no se intentó" de "se intentó y reventó".**

**Q3 — TTL de la última ubicación conocida (R24).** Propuse 120 min. ¿Es razonable para la jornada
del mensajero o se prefiere otro valor / no vencer nunca?
**Recomendación: 120 min, configurable por env.**

**Q4 — Fallback de origen cuando no hay ninguna ubicación (R24).** Propuse el centroide de las
paradas porque el esquema **no tiene** coordenadas de zona ni de bodega (verificado). ¿Se acepta, o
se prefiere añadir coordenadas de bodega/zona (feature aparte)?
**Recomendación: centroide ahora; coordenadas de bodega como seguimiento.**

**Q5 — Sincronización manual síncrona (R32).** Propuse ejecutar la optimización dentro de la Server
Action en vez de encolar, porque el módulo no usa SWR y encolar obligaría al mensajero a esperar al
cron (hasta 60 s) sin feedback. Coste: una llamada facturada por pulsación, mitigada por R34.
**Recomendación: síncrono.**

**Q6 — Alcance del gate de asignabilidad (R8).** ¿Debe aplicar también a
`asignarMensajeroSugerido` (la **sugerencia** del adminTienda, que no asigna)? Lo dejé fuera.
**Recomendación: fuera; bloquear la sugerencia castigaría a la tienda por una geocodificación que
todavía no ha corrido.**

**Q7 — `RUTA_MAX_PARADAS` (R38).** Propuse 100 sin base documental. ¿Hay un techo operativo real de
paradas por mensajero?
**Recomendación: fijar 100 y revisar con datos reales.**

**Q8 — Purga de `jobs`.** Sigue sin definirse (seguimiento heredado de la 91). Con dos tipos de job
por evento el crecimiento se acelera. ¿Se abre feature de retención?
**Recomendación: sí, feature aparte; no se resuelve aquí.**

**Q9 — Coste real del SKU de Route Optimization.** No está en `docs/` ni en el repo. El humano
aceptó el SKU a sabiendas, pero el spec no puede dimensionar el gasto mensual sin ese dato.
**Recomendación: confirmar precio por `optimizeTours` antes de habilitar en producción.**

**Q10 — `RutearSateliteModal`, el cuarto consumidor del mapper (R9).** Añadida 2026-07-20 tras el
hallazgo del leader. R9 obliga a extender `guia-decision-error-messages.ts`, que es **compartido por
cuatro** modales, no por los tres que nombra el alcance: `GenerarGuiaModal`, `AsignarBodegaModal`,
`AsignarSateliteModal` y **`RutearSateliteModal` (`:64`)**. Extender el mapper le cambia el
comportamiento al cuarto **quiera o no** — no hay forma de tocar el mapper y dejarlo fuera salvo
duplicar la lógica, que es peor.
**Recomendación: que entre en alcance CON su test.** El ruteo a satélite puede toparse con los
mismos 5 `motivo`, y un mensaje específico es estrictamente mejor que el genérico actual; el coste
es un archivo de test. La alternativa (documentarlo como fuera de alcance) deja un consumidor con
comportamiento cambiado y sin cobertura, que es justo la forma del drift que este repo ya sufrió 8
veces.
🔴 **Es criterio de producto, no hecho verificado** → merece segunda mirada del reviewer.
