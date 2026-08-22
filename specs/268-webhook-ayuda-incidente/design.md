# Feature 268 — design

> Lee primero `requirements.md`. Aquí van las decisiones técnicas, el delta exacto de eventos,
> las alternativas descartadas y las dos puertas (P1 y el aviso de despliegue).

## 0. Resumen de una línea

Dos altas en `EVENTOS_PUBLICOS` (`ayuda_tienda`, `incidente`) y el vaciado de
`ORIGENES_SIN_EVENTO_PUBLICO`, conservando el mecanismo de exención; y —por la decisión firmada del
2026-08-22— el evento de `incidente` viaja con la **causa tipificada** y con un **enlace estable**
a las evidencias, para lo cual el detalle por API key pasa a exponerlas. Sin migración y sin
transiciones nuevas.

## 1. Modelo de datos

**No hay.** Ninguna tabla, columna, índice, RLS ni migración. Los dos values ya existen en
`ORDER_STATUS_SEED` (22 values) y sus aristas ya están declaradas y con productor:

| value | entradas | productor |
| --- | --- | --- |
| `ayuda_tienda` | #62 `en_reparto -> ayuda_tienda` vía `solicitud_ayuda_tienda` | feature 235 |
| `incidente` | #44 (vía `gestion`, desde `en_reparto`), #48/#49/#50/#51/#52 (vía familia `incidente`) | feature 158 |

Consecuencia operativa: `pnpm db:migrate` no participa en esta feature, y `db-rollback` tampoco.
Revertirla es revertir el commit.

## 2. El cambio, archivo por archivo

### 2.1 `lib/types/webhook-eventos.ts` (el único cambio de lógica)

```
EVENTOS_PUBLICOS: 10 -> 12    (+ "ayuda_tienda", + "incidente")
ORIGENES_SIN_EVENTO_PUBLICO: ["rescate_ayuda_tienda"] -> []
```

Nada más se toca en el archivo: `esEventoPublico`, `esFamiliaSinEventoPublico` y
`esTransicionEmitible` conservan firma y semántica (R6/R14). El bloque de comentario de 235/P4 NO
se borra: se **reescribe fechado**, siguiendo el patrón que ya usa
`order-status-transiciones.ts` («AQUÍ DECÍA, y ya no es cierto: …»), para que quede rastro de que
la decisión de 235 se revirtió a propósito y por quién.

El texto nuevo debe conservar, con estas ideas literales:

- **por qué la exención sigue existiendo vacía**: es el único sitio donde una exención futura puede
  escribirse por FAMILIA;
- **por qué por familia y nunca por estado**: una exención por estado destino sobre `en_reparto`
  silenciaría los reingresos legítimos (`liberacion_reprogramada`, `deshacer_gestion`,
  `recoleccion`), y eso sí es una regresión;
- **por qué una lista de exclusión aquí es segura**: una familia futura empieza a EMITIR sola, que
  es la dirección segura del error (un evento de más es ruido; uno de menos es un integrador que no
  se entera);
- **el coste que se acepta**: dos eventos más por orden que pase por ayuda, incluido un
  `en_reparto` repetido, admisible porque la clave de idempotencia lleva el instante (feature 47).

### 2.2 `lib/api/openapi-spec.ts` y `docs/api/api-key-openapi.yaml`

`ORDER_STATUS_ENUM` (constante única, consumida por los 4 sitios que el guard
`tests/unit/api/openapi-contrato-en-reparto.test.ts` cuenta) gana los dos values **al final**, tras
`devuelta_a_tienda`. El YAML tiene esos mismos 4 bloques (líneas ~174, ~696, ~903, ~965 en `dev`) y
se actualiza con el MISMO orden: el guard compara `toEqual` posicional, así que insertar en otra
posición lo pone rojo aunque el contenido coincida.

Se aprovecha para bajar parte de la deuda declarada en el propio comentario (values alcanzables sin
documentar) **solo si no cuesta**: `sin_gestionar` y los tres del flujo de devolución de la 139
quedan FUERA de esta feature. No se arregla de contrabando; se deja declarado aquí.

Los otros dos cambios del contrato publicado —la sección `webhooks:` con el cuerpo completo (R28–R30)
y el `incidente` en el enum `Evidencia.resultado` (R31)— viven en estos mismos dos archivos y están
justificados en §7.5 y §7.3.

### 2.3 Lo que NO se toca

- `lib/services/jobs/webhook-estado-encolado.ts`: pregunta a la política y no re-deriva nada. Su
  comentario de 235 sí se actualiza (una nota, no lógica).
- `lib/types/order-status.ts`, `order-status-transiciones.ts`, `orden-historial.ts`: intactos.
- `db/**`: intacto (R23). Las dos tablas de evidencias existen y solo se leen.

`WebhookEstadoService`, `WebhookOrdenReader`, `OrdenRepository` (select del detalle) y el contrato
OpenAPI **sí** se tocan, por la decisión firmada del 2026-08-22: ver §7.

## 3. Delta exacto de eventos (lo que el integrador nota)

| transición | familia | hoy | tras 268 |
| --- | --- | --- | --- |
| `en_reparto -> ayuda_tienda` | `solicitud_ayuda_tienda` | silencio | **evento `ayuda_tienda`** |
| `ayuda_tienda -> en_reparto` | `rescate_ayuda_tienda` | silencio (exención 235/P4) | **evento `en_reparto`** (2.º sobre la orden) |
| `ayuda_tienda -> sin_gestionar` | `corte_sin_gestionar` | silencio | silencio (destino no público) |
| `ayuda_tienda -> reprogramada \| rechazada` | `gestion_tienda_ayuda` | evento | evento (sin cambio) |
| `* -> incidente` (#44, #48–#52) | `gestion` / `incidente` | silencio | **evento `incidente`** |
| `incidente -> en_reparto` (#53) | `deshacer_gestion` | evento | evento (sin cambio) |
| `incidente -> en_bodega_central` / `en_ruta_bodega_central` (#54/#56) | `incidente` | evento **huérfano** | evento, ahora precedido del `incidente` que lo explica |
| `incidente -> en_bodega_satelite` / `en_ruta_bodega_satelite` / `por_recoger` (#55/#57/#58) | `incidente` | silencio | silencio (destinos no públicos) |

Dos lecturas que importan:

1. **Ningún evento que hoy se emite deja de emitirse.** El cambio es aditivo en las dos mitades
   (altas en la política, vaciado de una lista de exclusión).
2. **Las reversiones del incidente mejoran solas.** Hoy el integrador ve un `en_bodega_central`
   repetido sin explicación; tras 268 ve `incidente` y luego la reposición. Es un efecto lateral
   deseable, no un requisito adicional (ver pregunta abierta 4).

## 4. Idempotencia: por qué el `en_reparto` repetido funciona

`dedupeKeyWebhookEstado(ordenId, estatusDestinoId, ocurridoAtISO)` incluye el instante desde la
feature 99 y por el hallazgo de la 47. Sin él, el segundo `en_reparto` chocaría contra la fila
`done` del primero y el `ON CONFLICT DO NOTHING` lo descartaría **en silencio** (el índice único de
`dedupe_key` no está acotado por estado del job y las filas de `jobs` no se purgan).

Con él: dos filas, dos entregas, dos `eventoId` distintos —porque `eventoId` **es** la
`dedupeKey`— y el consumidor deduplica por ese id. Esto no se implementa: se **verifica** con un
test (R10), porque es la premisa que hace aceptable revertir 235/P4.

## 5. Contratos de entrada/salida

Cuerpo de un evento cualquiera (sin cambios respecto de hoy, R19):

```jsonc
{
  "evento": "orden.estado_actualizado",
  "eventoId": "webhook_estado:<ordenId>:<estatusDestinoId>:<ocurridoAtISO>",
  "ocurridoAt": "2026-08-22T10:00:00.000Z",
  "data": { "numGuia": 100234, "numRemision": "…", "estado": "ayuda_tienda" }
}
```

Cuerpo de un evento de `incidente` (R20/R24), **con el nombre del campo de causa que fije el PR
#434** (no uno inventado aquí — pregunta abierta 1):

```jsonc
{
  "evento": "orden.estado_actualizado",
  "eventoId": "webhook_estado:<ordenId>:<estatusDestinoId>:<ocurridoAtISO>",
  "ocurridoAt": "2026-08-22T10:00:00.000Z",
  "data": {
    "numGuia": 100234,
    "numRemision": "…",
    "estado": "incidente",
    "<campoCausa>": "robado",
    "evidenciasUrl": "https://<base>/api/ordenes/api-key/orden/<ordenId>"
  }
}
```

Reglas:

- los dos campos aparecen **solo** con `data.estado === "incidente"`; la causa además exige que sea
  resoluble (R20/R21/R24);
- valores de causa: `danado` | `perdido` | `robado`, en español, sin traducir (158/Q-B);
- `evidenciasUrl` es **determinista**: sin token, sin expiración, sin consultar Storage (R22/R25).
  Es un enlace al detalle de la orden del propio canal, cuyo array `evidencias[]` lleva las URLs
  firmadas frescas. El nombre dice para qué está (llegar a las fotos) aunque el recurso devuelva el
  detalle completo; se documenta así en el OpenAPI para que nadie se sorprenda.

Respuesta del recurso enlazado (`GET /api/ordenes/api-key/orden/{id}`, ya existente desde la 177),
tras la ampliación de R27:

```jsonc
{
  "numGuia": 100234, "numRemision": "…", "estado": "incidente", "…": "…",
  "evidencias": [
    { "resultado": "incidente", "contentType": "image/jpeg", "url": "https://…", "expiraEnSegundos": 300 }
  ]
}
```

## 6. Endpoints

**Ninguno nuevo.** El enlace de R24 apunta a `GET /api/ordenes/api-key/orden/{id}`, que existe desde
la feature 177, exige `Authorization: Bearer ordx_...`, fuerza el owner y devuelve 404 uniforme
(R26): eso ya está implementado y con tests, y esta feature solo lo AMPLÍA con las evidencias de
incidente (R27). Se elige la variante por `orden.id` y no la de `{numGuia}` por una razón concreta:
`num_guia` puede ser NULL —es la razón de existir de la 177— y el `ordenId` siempre está en el
payload del job, así que el enlace siempre se puede construir.

## 7. La decisión firmada del 2026-08-22: «con causa y con el enlace»

### 7.1 El PR #434 — los dos escenarios, escritos por adelantado

El PR #434 (feature 256, «el evento de `devuelta` viaja con el motivo tipificado») ya resuelve el
motivo AL ENTREGAR: extiende la lectura de la orden y el armado del cuerpo en
`WebhookOrdenReader` / `WebhookEstadoService`. La causa de incidente es el mismo problema con otro
enum, y por eso la recomendación es reusar ese mecanismo en vez de construir uno paralelo.

**Caso A — #434 ya mergeado en `dev` cuando arranca la implementación.**
Se implementa la causa dentro de 268 (T6), reusando literalmente el punto de extensión de #434:
misma lectura de gestión vigente, mismo lugar de armado del cuerpo, misma convención de ausencia.
Un solo aviso a integradores cubre los dos campos.

**Caso B — #434 NO mergeado.**
**No se reimplementa el mecanismo en paralelo**: `WebhookOrdenReader.findDatosEntrega` y el armado
del cuerpo en `WebhookEstadoService.ejecutar` son exactamente las dos superficies que #434 toca, y
dos ramas escribiéndolas a la vez es un conflicto garantizado con resolución semántica (no textual).
Dos salidas, y elige el humano en la puerta:

- **B1 — 268 espera a #434.** La feature queda `blocked` hasta el merge. Correcto, pero cede el
  valor de la política (que no depende de #434) por un campo que sí.
- **B2 (recomendada) — 268 despliega la política y el ENLACE (T1–T5, T6b, T7–T9), y la CAUSA se
  implementa encima de #434 como continuación.** El enlace no depende de #434 en su lógica, pero sí
  comparte el punto de armado del cuerpo, así que la continuación se limita a añadir un campo más
  en un sitio ya tocado. El aviso a integradores se redacta UNA vez y anuncia las tres cosas
  (eventos nuevos, enlace y causa), que es el coste real que se quiere ahorrar.
  R20/R21 quedan entonces asignados a la continuación y así debe constar en `progress/impl_268.md`.

### 7.2 Por qué el cuerpo NO lleva una URL firmada (tres razones, cada una suficiente)

1. **Rompe la idempotencia del cuerpo (99/R23, fijada con tests por la 256).** El contrato dice que
   reejecutar un job produce el MISMO `eventoId` y el MISMO cuerpo. Una URL firmada de Supabase
   Storage lleva token y expiración distintos en cada firma: el intento 1 y el intento 4 entregarían
   cuerpos distintos para el mismo evento, y el consumidor que compara cuerpos para deduplicar
   dejaría de poder hacerlo.
2. **Caduca a los 300 s.** `gestionConfig.SIGNED_URL_TTL_SECONDS` (`lib/config/gestion.ts:42`,
   default `5 * 60`) contra una política de 5 intentos con backoff y un consumidor que puede drenar
   su cola horas después. Estaríamos entregando enlaces muertos como caso NORMAL, no excepcional.
3. **Es una credencial al portador.** Cualquiera que vea el cuerpo —un log del integrador, un proxy,
   un reenvío por correo— abre la foto sin autenticarse. El mismo argumento por el que la 170 se
   negó a meter URLs firmadas dentro de un `xlsx` descargable.

Lo que sí viaja es un enlace **estable, determinista y sin credencial**: el integrador lo invoca con
su `Authorization: Bearer ordx_...` y recibe las URLs firmadas frescas con el TTL de siempre. La
credencial la pone él, que es donde debe estar.

### 7.3 El hueco que esto destapa: hoy las evidencias de `incidente` NO son alcanzables

Verificado en el código, y es peor de lo que parece a primera vista:

- `API_ORDEN_DETALLE_SELECT` (`lib/repositories/OrdenRepository.ts:122`) filtra
  `resultado: { in: ["entregada", "rechazada"] }`, y el schema `Evidencia` del OpenAPI declara ese
  mismo par. Un incidente no aparece por ningún endpoint.
- Y hay **dos** procedencias de incidente, no una:
  - **camino del MENSAJERO** (arista #44, vía `gestion`): fila en `gestion_orden` con
    `resultado = incidente`, `causa_incidente`, evidencias 1..N en `gestion_orden_evidencia` y la
    portada denormalizada en `gestion_orden.evidencia_storage_path` (dual-write de la 119/R12);
  - **camino del ADMIN** (aristas #48–#52, vía familia `incidente`): **no crea gestión ninguna**.
    Crea `orden_incidente` (causa en `orden_incidente.causa`, MISMO enum) con sus evidencias en
    `orden_incidente_evidencia` (158/R46, tabla espejo propia y deliberada).

Esto tumba la lectura ingenua: resolver la causa «desde la gestión vigente», como hace #434 para
`devuelta`, **solo cubre uno de los dos caminos** — y es el minoritario en número de aristas (1 de
6). Un evento de `incidente` reportado por el admin llegaría sin causa y con un enlace a un array
vacío. Por eso R20 y R27 dicen explícitamente «sea cual sea su procedencia».

**Opciones evaluadas, con el código delante:**

- **(a) Ampliar el `resultado` de las evidencias existentes a `incidente`.** Un cambio de una línea
  en el `where` del select y del cast del `resultado`. **Insuficiente**: cubre solo el camino del
  mensajero y falla EN SILENCIO en el del admin, que es justo el que reporta paquetes dañados en
  bodega. Un enlace que a veces apunta a nada es peor que no mandarlo.
- **(a+) — ELEGIDA. Ampliar el detalle existente a las DOS procedencias.** Se añade `incidente` al
  `where` de gestiones y se suma una segunda relación (`incidentes`) al mismo select, mapeando
  ambas al mismo array `evidencias[]` con `resultado: "incidente"`. El firmado NO cambia:
  `ApiOrdenLecturaService.toDetalleDTO` ya junta todos los `storagePath` y los firma en UNA sola
  llamada, así que la ampliación viaja gratis por ahí. Superficie: `OrdenRepository` (select + dos
  mapeos), el tipo `ApiOrdenDetalleRow`, el enum `Evidencia.resultado` del OpenAPI y su YAML.
  **Sin migración, sin endpoint nuevo, sin tocar RLS.** Regla de contenido: se expone **la portada**
  (índice 0) de cada registro, igual que hoy se expone una foto por gestión, para no reabrir la
  deuda de la 119 dentro de esta ficha (pregunta abierta 4).
- **(b) Endpoint dedicado de evidencias por orden.** Descartada: superficie pública nueva (ruta,
  contrato, paginación, 404 uniforme, tests de aislamiento por owner) para devolver un subconjunto
  de lo que el detalle ya devuelve. Se justificaría si hiciera falta paginar muchas fotos o
  exponerlas sin el resto del detalle; ninguna de las dos cosas se pide.

**Válvula declarada:** si al implementar (a+) aparece algo que hoy no se ve —por ejemplo que el
alcance de lectura de `orden_incidente` exija reglas propias, o que el mapeo obligue a reabrir la
119— **se para y se propone ficha aparte** («el detalle por API expone las evidencias de
incidente»), con dependencia declarada de 268, y 268 sale **sin** `evidenciasUrl` (R24 pasa a la
ficha nueva). Lo que NO se hace es mandar el enlace a un recurso incompleto.

### 7.4 El origin del enlace

`evidenciasUrl` es absoluta y necesita un origin. Se resuelve **por configuración**, nunca
hardcodeado (`docs/architecture.md`, principio 4): se añade a `lib/config/webhook.ts` un valor que
por defecto lee `NEXT_PUBLIC_APP_URL` (el mismo que usa `lib/utils/paquete-url.ts`), con el patrón
`loadWebhookConfig` de ese archivo —ausente o `""` -> `null`, y **la función nunca lanza**, que es
un invariante explícito de ese módulo—.

Si no se puede resolver el origin, el campo **se OMITE** (nunca se emite una ruta relativa ni un
`https://undefined/...`). Sobre la idempotencia: el origin es constante dentro de un despliegue, así
que dos intentos del mismo job producen el mismo enlace (R25); cambiar la base URL es un evento de
despliegue, no una variación entre reintentos, y se anota como tal.

Nota honesta sobre determinismo: la CAUSA se lee de la base al entregar, así que un cuerpo depende
del estado de la base en ese instante. Es exactamente la propiedad que #434 ya acepta para el motivo
de `devuelta`; se hereda su decisión en vez de inventar otra. El enlace, en cambio, no depende de la
base en absoluto.

### 7.5 Dónde se publica el contrato del cuerpo (R28–R31)

Hallazgo: **el OpenAPI de hoy no documenta el webhook en absoluto**. Describe los endpoints del
canal por API key y no menciona `orden.estado_actualizado` en ninguna parte. Es decir, los campos
nuevos no tienen dónde publicarse… salvo que se abra el sitio correcto.

Decisión: usar la sección **`webhooks:` de OpenAPI 3.1** (el documento ya declara
`openapi: "3.1.0"`), con el `post` del callback y el schema del cuerpo completo: `evento`,
`eventoId`, `ocurridoAt` y `data.{numGuia, numRemision, estado, <campoCausa>?, evidenciasUrl?}`.

Detalle que evita un rojo tonto y que hay que respetar: el enum de `data.estado` de ese schema se
**deriva de `EVENTOS_PUBLICOS`** (R29), no del catálogo entero. Dos consecuencias, las dos buenas:

1. es lo correcto semánticamente — el webhook solo emite los 12 values públicos, no los 16
   documentados en las respuestas REST;
2. el guard `openapi-contrato-en-reparto.test.ts` cuenta enums de estado con el predicado
   `esEnumDeEstado`, que exige `entregada` **y** `por_recoger`. El enum del webhook no contiene
   `por_recoger`, así que **no** entra en el recuento y los cuatro bloques siguen siendo cuatro
   (R28). Si se documentara con el catálogo completo, el guard pasaría a esperar cinco bloques en
   el TS y cinco en el YAML: churn gratuito en un guard que protege otra cosa.

Como ese bloque nuevo no lo cubre el espejo automático del guard vigente, R30 exige un test propio
que compare el bloque del YAML con el del objeto TS.

## 8. Alternativas descartadas

**A1 — Meter `ayuda_tienda` en la política y DEJAR la exención de `rescate_ayuda_tienda`.**
Descartada. Es la media feature: el integrador ve ENTRAR la orden en ayuda y no la ve salir nunca
hasta el desenlace (que puede tardar horas o llegar por el corte de la noche como `sin_gestionar`).
Un estado de ayuda sin cierre visible se lee como «orden atascada» y genera exactamente la llamada
de soporte que la feature quiere evitar: peor que el silencio actual. **Las dos mitades van juntas
o no van.**

**A2 — Borrar el mecanismo de exención por completo, ya que la lista queda vacía.**
Descartada. Es el único punto del sistema donde una exención futura puede escribirse **por
familia**. Si mañana hace falta silenciar un reingreso concreto y este mecanismo no existe, la
implementación natural será por ESTADO destino —silenciando de paso los reingresos legítimos— que
es justo la regresión que 235 documentó y prohibió. Borrar la lista vacía ahorra 6 líneas y compra
esa regresión. Se conserva con su razonamiento (R6).

**A3 — Exención (o inclusión) por ESTADO destino en vez de por familia.**
Descartada, y es la misma decisión que 235 ya tomó. Una regla por estado sobre `en_reparto` no
puede distinguir el rescate de una `reprogramada` liberada por el cron, de un `deshacer_gestion` ni
de una `recoleccion`. La familia es el único discriminante disponible en el punto de decisión.

**A4 — Añadir `devolucion_por_confirmar` «ya que estamos ampliando el vocabulario».**
Descartada. Decisión 239/P2 firmada el 2026-08-19: el integrador no sabría interpretar un
pre-estado interno de confirmación, y lo que la 239 cambió fue CUÁNDO llega `devuelta`, no el
vocabulario. R4 lo afirma en negativo para que la ausencia sea auditable.

**A5 — Crear eventos propios (`orden.ayuda_solicitada`, `orden.incidente_reportado`) en vez de
ampliar el vocabulario de `orden.estado_actualizado`.**
Descartada. Obliga a cada integrador a suscribirse y enrutar tipos de evento nuevos (hoy el canal
entrega UN tipo), duplica el shape del cuerpo y rompe la premisa de que `eventoId`/dedupe son
homogéneos. Ambos casos SON cambios de estado de la orden: caben en el evento que ya existe.

**A6 — Relajar los tests congelados a un aserto de tamaño para que no molesten en cada alta.**
Descartada explícitamente (R18). Un `size` no detecta un intercambio (un value entra y otro sale) y
convierte la puerta humana en un contador. Los tests se actualizan **con la decisión escrita al
lado**, que es su función.

**A7 — Mandar la URL firmada de la evidencia dentro del cuerpo.**
Descartada por decisión firmada y por tres razones independientes, cada una suficiente: rompe la
idempotencia del cuerpo, caduca a los 300 s contra 5 intentos con backoff, y es una credencial al
portador. Desarrollo completo en §7.2. Variante también descartada: firmar con un TTL largo «solo
para el webhook» — sigue siendo una credencial al portador y además una con más vida.

**A8 — Meter la causa y las fotos ENTERAS (base64 o metadatos) en el cuerpo.**
Descartada. Engorda un POST que hoy es mínimo y deliberadamente sin PII (99/R13/R29), multiplica el
coste de cada reintento y obliga al integrador a manejar binarios en un endpoint de notificación.
El patrón del repo es el contrario: payload mínimo y el dato se resuelve al consultar.

**A9 — Un endpoint dedicado de evidencias por orden (opción (b) de §7.3).**
Descartada: superficie pública nueva —ruta, contrato, 404 uniforme, tests de aislamiento por
owner— para devolver un subconjunto de lo que el detalle ya devuelve, y con la ampliación de R27
sigue haciendo falta tocar la lectura igualmente. Se reconsideraría si hubiera que paginar muchas
fotos o exponerlas sin el resto del detalle; ninguna de las dos cosas se pide.

## 9. Riesgo de colisión (leer antes de escribir código)

Dos ramas vivas tocan exactamente estos archivos:

1. **Rama `ux`** ya hizo *la mitad* de esta feature: mete `ayuda_tienda`, vacía la exención,
   actualiza los dos tests y toca el OpenAPI en los cuatro sitios más el `.yaml`. Si `ux` mergea a
   `dev` antes que 268, parte de T1/T4/T5 ya estará hecha y lo que queda es `incidente` más el
   comentario fechado. **No se re-aplica a ciegas.**
2. **PR #434 (feature 256)**, abierto y mergeable, toca `lib/api/openapi-spec.ts`, el `.yaml`
   espejo y —lo importante ahora— **el armado del cuerpo** en `WebhookEstadoService` y la lectura
   en `WebhookOrdenReader`, que son exactamente los archivos donde 268 escribe la causa y el
   enlace. Con la decisión firmada, esta ya no es una colisión periférica: es LA colisión. Si #434
   aterriza primero, 268 se rebasa y se cuelga de su punto de extensión; si no, se aplica la salida
   B2 de §7.1. **Y si 268 crea la sección `webhooks:` del OpenAPI (§7.5) antes que #434, esa sección
   debe documentar también el motivo de `devuelta` que #434 añade**, o el contrato publicado quedará
   incompleto en cuanto #434 mergee.

Por eso `tasks.md` **abre** con una task de comprobación del estado real de `dev` (T0), no con
código. Este spec se escribió contra `origin/dev` @ `ece96483` en un worktree limpio (`C:/w268`),
deliberadamente sin leer el checkout principal, que está en `ux`.

## 10. Verificación y despliegue

- **Gate: `./init.sh` COMPLETO, sin excepción.** No hay migración, pero el diff toca `lib/types/`
  y el modo rápido **se niega solo** ahí (`docs/verification.md`: «un catálogo o un enum lo importa
  medio repo»). Es un `fail`, no un aviso.
- **Sigue sin migración (R23)**, también después de la decisión firmada: las dos tablas de
  evidencias existen desde la 119 y la 158, y solo se leen. Lo único que se añade a la
  configuración es el origin del enlace (§7.4), que es una variable de entorno con default, no un
  cambio de esquema. El gate no cambia: sigue siendo el COMPLETO por `lib/types/`.
- **Aviso a integradores: bloquea el DESPLIEGUE, no el código** (misma política que 239/T0.3). Es
  un cambio de contrato observable en dirección de MÁS eventos y MÁS campos, con dos values que el
  integrador no sabe interpretar todavía. El PR puede mergearse a `dev`; la release a `prod` no sale
  sin el aviso dado.

## 11. Trazabilidad R -> test

| R | Test |
| --- | --- |
| R1, R2, R3, R4, R18 | `tests/unit/types/webhook-eventos.test.ts` (igualdad de contenido de `EVENTOS_PUBLICOS`) |
| R5, R6, R7, R18 | `tests/unit/types/webhook-eventos.test.ts` (bloque de la exención) |
| R8, R9, R11, R12, R13, R14 | `tests/unit/services/webhook-estado-encolado.test.ts` |
| R10 | `tests/unit/services/webhook-estado-encolado.test.ts` (dos `dedupeKey` distintas para dos `en_reparto`) |
| R15, R16, R17 | `tests/unit/api/openapi-contrato-en-reparto.test.ts` |
| R19, R21 | `tests/unit/services/webhook-estado-service.test.ts` (cuerpo de un evento no-incidente: claves exactas) |
| R20 | `tests/unit/services/webhook-estado-service.test.ts` (causa desde gestión Y causa desde `orden_incidente`) |
| R22 | `tests/unit/services/webhook-estado-service.test.ts` (el cuerpo entregado no contiene `token`/`X-Amz`/`?` de firma ni el bucket, afirmado sobre el string real que recibe el sender) |
| R24 | `tests/unit/services/webhook-estado-service.test.ts` (enlace presente en `incidente`, ausente en `entregada`) |
| R25 | `tests/unit/services/webhook-estado-service.test.ts` (dos ejecuciones del mismo job -> cuerpos idénticos byte a byte) |
| R26 | tests ya existentes de `GET /api/ordenes/api-key/orden/{id}` (401 sin key, 404 uniforme ajeno) — se verifican, no se reescriben |
| R27 | `tests/unit/services/api-orden-lectura-service.test.ts` y `…por-orden-id.test.ts` (evidencias de incidente por las DOS procedencias, con URL firmada y sin `storage_path`) |
| R28, R29, R30 | `tests/unit/api/openapi-webhook-contrato.test.ts` (nuevo): bloque `webhooks`, enum derivado de `EVENTOS_PUBLICOS`, espejo YAML, y `enumsDeEstado(openApiSpec)` sigue devolviendo 4 |
| R31 | `tests/unit/api/openapi-contrato-en-reparto.test.ts` (o el nuevo): `Evidencia.resultado` incluye `incidente`, TS y YAML |
| R23 | `tests/integration/db/schema-drift-saneamiento.test.ts` (sigue verde, sin migración pendiente) + inspección del diff en T7: cero archivos bajo `db/` |

(Los dos archivos de R27 existen hoy y cubren el detalle por `numGuia` y por `orden.id`: el mapeo y
el firmado son literalmente los mismos, así que la ampliación se afirma en los dos.)
