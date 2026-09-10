# Feature 405 — el detalle por API expone el historial de gestiones de la orden

> **Zona:** backend · **Complejidad:** media · **SDD:** sí · **depends_on:** 404
> **Endpoint afectado (uno solo):** `GET /api/ordenes/api-key/orden/{id}` (feature 177, DTO de la 106).
> **Estado del spec:** pendiente de la puerta humana. **Hay una pregunta abierta BLOQUEANTE (Q1).**

## 0. Contexto y alcance

Un integrador real pidió, el 2026-09-07 y explícitamente «cuando se pueda, sin afán», la **fase 2**
de su petición (la fase 1 es la ficha 404):

> en el detalle, un arreglo `gestiones[]` con `{ fecha, tipo, estado_resultante, motivo, mensajero }`
> — con eso medimos reintentos y tiempos por mensajero, no solo el resultado final.

Es una ampliación **ADITIVA y de SOLO LECTURA** del contrato público del canal por API key.

**Dentro del alcance:** una clave nueva en el cuerpo del detalle.
**Fuera del alcance, declarado:** el listado, el webhook, cualquier otro endpoint, `gestion_orden`
(no se modifica: es una tabla con historia y reglas propias), cualquier migración, cualquier índice
nuevo, y la deuda del enum `estado` publicado (ver §7-c).

### 0.1 ⚠️ Los dos `motivo`

`motivo` nombra **dos cosas distintas** en este sistema, y la confusión está documentada en el
código (`lib/services/WebhookEstadoService.ts`, `armarData`, líneas 161-188):

| | Qué es | Se publica hoy |
| --- | --- | --- |
| **Causa TIPIFICADA** | enum cerrado: `gestion_orden.causa_devolucion` (73) o `causa_incidente` (158) | **Sí**, en el webhook, bajo el nombre de cable `motivo` (256/R1-R7, 268/R20-R21) |
| **Texto libre** | `gestion_orden.motivo` (`db/schema.prisma:1045`), tecleado a mano por el mensajero | **NO, JAMÁS**, por decisión expresa (**256/R22**) |

Esta feature diseña sobre la **causa TIPIFICADA** y **no emite el texto libre bajo ninguna
circunstancia**. Confirmárselo al integrador es la pregunta **Q1**, y es **bloqueante**.

### 0.2 Asimetría de idioma: NO se corrige

La causa de devolución viaja en **inglés** (`not_found`/`wrong_number`/`wrong_address`, 73/F1.4-g)
y la de incidente en **español** (`danado`/`perdido`/`robado`, 158/Q-B). Es una decisión **consciente
y firmada**. Este spec la conserva tal cual y **no abre ningún ticket de consistencia**.

### 0.3 Premisa de privacidad, verificada en el código

La puerta que autoriza exponer el **nombre** del mensajero a la tienda por API la firmó el humano el
2026-09-09 para la ficha 404, con el argumento «la tienda ya ve ese nombre en su UI». **Premisa
verificada en este repo** antes de apoyarse en ella:

- `app/(app)/novedades/page.tsx:32` — la página es exclusiva del rol `adminTienda` (`notFound()` para
  cualquier otro), y sirve órdenes acotadas a la tienda del actor.
- `app/(app)/novedades/_components/NovedadesModule.tsx:769` — baja `mensajero={novedad.mensajeroNombre}`
  a la card.
- `lib/types/novedad.ts` — `NovedadDTO` transporta `mensajeroNombre`.

Es decir: la tienda **ya ve hoy** el nombre del mensajero de sus órdenes en pantalla. Ese permiso
alcanza a `gestiones[].mensajero`. **Cualquier dato que no estuviera en la petición del integrador
queda FUERA** (teléfonos, documento, evidencias, ubicación, montos, notas internas): ver R12.

---

## 1. La forma del campo nuevo

**R1.** CUANDO una petición autenticada a `GET /api/ordenes/api-key/orden/{id}` resuelve una orden
propia y viva, el sistema DEBE incluir en el cuerpo de la respuesta la clave `gestiones`, cuyo valor
es un array.

**R2.** SI la orden no tiene ninguna gestión vigente, ENTONCES el sistema DEBE devolver
`gestiones: []` — array vacío, nunca `null` y nunca la clave omitida.

**R3.** El sistema DEBE emitir en cada elemento de `gestiones[]` EXACTAMENTE estas cinco claves, todas
SIEMPRE presentes: `createdAt`, `resultado`, `estadoResultante`, `motivo`, `mensajero`. Ni una clave
más, ni una menos, sea cual sea el resultado de la gestión.

**R4.** El sistema DEBE emitir en `createdAt` de cada elemento el instante en que la gestión quedó
REGISTRADA, con el mismo tipo y la misma serialización que el `createdAt` de la orden que ya publica
el detalle.

**R5.** El sistema DEBE emitir en `resultado` el value CRUDO del catálogo de resultados de gestión
—uno de `entregada`, `reprogramada`, `devuelta`, `rechazada`, `incidente`—, sin traducir y sin
etiqueta en español.

**R6.** El sistema DEBE emitir en `estadoResultante` el `value` del estado de la orden al que llevó
ESA gestión, entendido como el estado destino de la PRIMERA transición de estado que esa gestión
originó.

**R7.** SI una gestión no originó ninguna transición de estado registrada, ENTONCES el sistema DEBE
emitir `estadoResultante: null` (la clave sigue presente).

**R8.** El sistema DEBE emitir en `motivo` EXCLUSIVAMENTE la causa TIPIFICADA: la causa de devolución
cuando `resultado` es `devuelta`, la causa de incidente cuando `resultado` es `incidente`, y `null`
en cualquier otro caso o cuando la causa no está registrada.

**R9.** El sistema DEBE emitir en `mensajero` de cada elemento un objeto con la MISMA forma —mismas
claves, mismos tipos, misma fuente del nombre— que el campo `mensajero` que publica la feature 404.

**R10.** El sistema DEBE ordenar `gestiones[]` de forma ascendente por `createdAt` (la más antigua
primero) y DEBE resolver los empates de forma determinista, de modo que dos lecturas consecutivas de
la misma orden sin escrituras intermedias devuelvan el array en el mismo orden.

**R11.** El sistema DEBE incluir en `gestiones[]` únicamente las gestiones VIGENTES de la orden, y NO
DEBE incluir las gestiones ANULADAS.

---

## 2. Privacidad y frontera del contrato

**R12.** El sistema NO DEBE incluir en `gestiones[]` ninguno de estos datos: el texto libre
`gestion_orden.motivo` (**256/R22**), el `storage_path` de una evidencia, el nombre del bucket, el
identificador interno de la gestión, de la orden, del cierre o de la tienda, el monto recibido, el
método de pago, el pago al mensajero, la indemnización, la ubicación del mensajero, ni el teléfono,
correo o documento de nadie.

**R13.** El sistema DEBE emitir `gestiones[]` únicamente para una orden cuyo dueño es el actor
autenticado, y SI la orden es ajena, inexistente o borrada, ENTONCES DEBE responder el MISMO `404`
que responde hoy, sin cuerpo distinto y sin filtrar que el recurso existe.

**R14.** El sistema NO DEBE incluir en `gestiones[]` los incidentes reportados por un ADMIN
(`orden_incidente`): no son gestiones y no tienen mensajero atribuido.

---

## 3. No regresión del contrato vigente

**R15.** El sistema DEBE conservar sin cambio alguno todos los campos que el detalle publica hoy
—`numGuia`, `numRemision`, `estado`, `destinatario`, `telefonoDest`, `producto`, `direccion`,
`montoCobrar`, `createdAt`, `evidencias[]`— en nombre, tipo, valor y contenido.

**R16.** El sistema NO DEBE cambiar el cuerpo del listado (`GET /api/ordenes/api-key`), el cuerpo del
webhook `orden.estado_actualizado`, ni ningún otro endpoint del canal.

**R17.** El sistema DEBE conservar sin cambio los códigos de estado del endpoint: `401` sin
credencial o con credencial inválida, `403` sin permiso, `422` con `{id}` inválido y `404` uniforme.

**R18.** El sistema NO DEBE modificar ninguna fila de `gestion_orden` ni de `orden_historial_estado`
al servir el detalle: esta feature es de SOLO LECTURA.

---

## 4. Coste de la lectura

**R19.** El sistema DEBE resolver el detalle completo —incluido `gestiones[]`— con el MISMO número de
consultas a la base de datos que hoy, sea cual sea el número de gestiones de la orden: no DEBE emitir
una consulta por gestión.

---

## 5. Documentación del contrato público

**R20.** El sistema DEBE declarar `gestiones` dentro del schema `OrdenDetalle` de la fuente de verdad
del contrato (`lib/api/openapi-spec.ts`) y de su espejo textual (`docs/api/api-key-openapi.yaml`),
con un ejemplo de respuesta que muestre al menos un elemento.

**R21.** El sistema DEBE derivar la lista de values publicados de `gestiones[].motivo` de las MISMAS
fuentes de las que el webhook deriva la suya, de modo que las dos listas coincidan valor a valor y no
puedan divergir sin que un test se ponga rojo.

**R22.** El sistema DEBE dejar una entrada fechada en `docs/api/CHANGELOG.md` **antes de la release**,
y esa entrada DEBE decir explícitamente: (a) que `motivo` es la causa tipificada y NO el texto libre
del mensajero; (b) que `mensajero` es el mensajero ATRIBUIDO a la gestión y no siempre quien la
registró (§7-e); (c) que `gestiones.length` NO es el contador interno de intentos de Ordenex (§7-d).

---

## 6. Trazabilidad `R<n>` → test

Los archivos con `(nuevo)` los crea esta feature; el resto se amplía.

| Req | Test | Archivo |
| --- | --- | --- |
| R1 | `el detalle incluye la clave gestiones` | `tests/integration/api/ordenes-api-key-orden-consulta.route.test.ts` |
| R2 | `una orden sin gestiones vigentes devuelve gestiones vacio, no null` | `tests/unit/services/api-orden-lectura-service.gestiones-405.test.ts` (nuevo) |
| R3 | `cada gestion lleva exactamente las cinco claves publicas` | `tests/unit/guards/gestiones-detalle-lista-blanca.guardia.test.ts` (nuevo) |
| R4 | `createdAt de la gestion es el instante de registro y viaja como el de la orden` | `tests/unit/services/api-orden-lectura-service.gestiones-405.test.ts` |
| R5 | `resultado viaja como value crudo del enum, sin traducir` | `tests/unit/services/api-orden-lectura-service.gestiones-405.test.ts` |
| R6 | `estadoResultante es el destino de la primera transicion que origino la gestion` | `tests/integration/db/gestiones-detalle-api-405.test.ts` (nuevo) |
| R7 | `una gestion sin transicion registrada emite estadoResultante null` | `tests/unit/services/api-orden-lectura-service.gestiones-405.test.ts` |
| R8 | `motivo lleva la causa de devolucion en devuelta, la de incidente en incidente y null en el resto` | `tests/unit/services/api-orden-lectura-service.gestiones-405.test.ts` |
| R9 | `el mensajero de la gestion usa el MISMO tipo publicado por la 404` | `tests/unit/guards/gestiones-detalle-lista-blanca.guardia.test.ts` |
| R10 | `las gestiones salen de la mas antigua a la mas reciente y el empate es determinista` | `tests/integration/db/gestiones-detalle-api-405.test.ts` |
| R11 | `una gestion anulada NO aparece en el detalle` | `tests/integration/db/gestiones-detalle-api-405.test.ts` |
| R12 | `ningun valor sensible de la gestion cruza al DTO publico` | `tests/unit/guards/gestiones-detalle-lista-blanca.guardia.test.ts` |
| R13 | `las gestiones de una orden de OTRA tienda no se devuelven y la respuesta es el 404 uniforme` | `tests/integration/db/gestiones-detalle-api-405.test.ts` |
| R14 | `un incidente reportado por un admin no aparece en gestiones` | `tests/integration/db/gestiones-detalle-api-405.test.ts` |
| R15 | `los nueve campos del detalle de la 106 siguen intactos junto a gestiones` | `tests/unit/services/api-orden-lectura-service.por-orden-id.test.ts` |
| R16 | `el cuerpo del listado y el del webhook no ganan ninguna clave` | `tests/unit/api/openapi-405-gestiones.test.ts` (nuevo) |
| R17 | `401, 403, 422 y 404 siguen siendo los de hoy` | `tests/integration/api/ordenes-api-key-orden-consulta.route.test.ts` |
| R18 | `servir el detalle no escribe en gestion_orden ni en orden_historial_estado` | `tests/integration/db/gestiones-detalle-api-405.test.ts` |
| R19 | `el detalle con N gestiones emite el mismo numero de consultas que sin ellas` | `tests/integration/db/gestiones-detalle-api-405.test.ts` |
| R20 | `OrdenDetalle declara gestiones y el yaml es espejo exacto` | `tests/unit/api/openapi-405-gestiones.test.ts` |
| R21 | `el enum de motivo del detalle coincide valor a valor con el del webhook` | `tests/unit/api/openapi-405-gestiones.test.ts` |
| R22 | `el CHANGELOG del canal tiene la entrada de la 405 con los tres avisos` | `tests/unit/api/openapi-405-gestiones.test.ts` |

---

## 7. Preguntas abiertas

### ⚠️ Q1 — BLOQUEANTE: ¿qué `motivo` pidió el integrador?

El integrador escribió «motivo» **sin saber que en Ordenex son dos cosas** (§0.1). Este spec diseña
sobre la **causa TIPIFICADA**, que es lo más probable y lo único publicable.

**Hay que confirmárselo antes de implementar.** El texto exacto que se le propone mandar:

> «`motivo` te llega como la **causa tipificada** del desenlace: `not_found` / `wrong_number` /
> `wrong_address` en una devolución, `danado` / `perdido` / `robado` en un incidente, y `null` en
> los demás casos. Es el mismo campo y los mismos valores que ya recibís en el webhook. **No es** el
> comentario en texto libre que escribe el mensajero: ese no sale del sistema por decisión de
> privacidad, y no va a salir.»

**Si respondiera que quería el texto libre:** NO se implementa. Contradice un requisito vigente
(256/R22) y es texto escrito a mano por un empleado sobre un cliente. Se para y se lleva al humano.

### Q2 — Los nombres de las claves: `createdAt`/`resultado` en vez de `fecha`/`tipo`

El integrador escribió `fecha` y `tipo` en `snake_case`. El canal es `camelCase` sin excepción y ya
tiene **nombre propio publicado** para los dos conceptos: `createdAt` (instante de creación, en
`OrdenListItem`) y `resultado` (el mismo enum, en `Evidencia`). Usar `fecha` y `tipo` sería inventar
un segundo nombre para un concepto que ya tiene el suyo —y `fecha` colisionaría además con
`gestion_orden.fecha_reprogramacion`, que es otra fecha—. **Decisión tomada: `createdAt` y
`resultado`**, y se le avisa en el CHANGELOG. *No bloquea; se confirma junto con Q1.*

### Q3 — La forma de `mensajero` depende de la ficha 404, que aún no tiene spec escrito

Al cerrar este documento (2026-09-09), `specs/404-mensajero-en-webhook-y-api/` **no existe en disco**
(comprobado). La forma que este spec asume es la que declara la ficha 404 en `feature_list.json`:
`{ id, nombre }`, con `nombre` construido por `nombreCompletoUsuario` (`lib/utils/nombre-usuario.ts:32`).
**R9 está escrito para que la dependencia sea estructural, no de prosa:** se reutiliza el MISMO tipo
que exporte la 404, de modo que si la 404 aterriza con otra forma esta feature la sigue **sin
edición** o deja de compilar. Si la 404 se cancelara, hay que decidir aquí la forma y decirlo.

### Q4 — ¿Excluir las gestiones ANULADAS es lo que quiere el negocio?

**Decisión tomada: se excluyen (R11).** Razón medida, no de gusto: el sistema ya tiene UN criterio de
«gestión que cuenta» y filtra `anulada_at IS NULL` (`whereIntentosVigentes`,
`lib/repositories/OrdenHistorialRepository.ts:192-218`). Incluir las anuladas inflaría justo la
métrica que el integrador pidió (reintentos). *Se confirma; no bloquea.*

### Q5 — ¿Hace falta un tope duro o paginación? → ✅ **CERRADA (2026-09-10): no**

**Cerrada con medición sobre producción, no con razonamiento** (consulta y tabla completas en design
§5.1): **1.163** órdenes con al menos una gestión, **máximo 5** gestiones en una sola orden, promedio
**1,40**, **0** órdenes por encima de 10 y **0** por encima de 50. Un tope o una paginación hoy serían
código muerto: no hay un solo caso que atender. El peor caso real son ~750 bytes de cuerpo.

La estimación previa desde el esquema (≈10) era conservadora y correcta en su conclusión; la realidad
es la mitad.

⚠️ **Matiz que no se borra:** la base se vació a propósito el 2026-08-25 (arranque comercial), así que
esas 1.163 órdenes son de las últimas semanas. El número es real, pero es una **foto joven**: si el
negocio cambia el patrón de reintentos, el techo sube. Por eso la **válvula** de design §5.3 sigue
escrita —sub-recurso paginado si alguna orden pasara de 50, nunca un recorte silencioso— **como plan
de contingencia, no como trabajo pendiente**.

### Q6 — `gestiones.length` no es el contador de intentos de Ordenex. ¿Basta con avisarlo?

El contador interno (`contarIntentosVigentes`) cuenta **cierres aprobados distintos** con un resultado
contable y visita real, no gestiones: varias gestiones del mismo cierre valen **1**. `gestiones[]` es
la lista cruda. **Decisión: se avisa en el CHANGELOG y en el contrato (R22-c) y NO se añade un campo
`intentos`** —no se pidió, y es un número con el que se cobra—. *Si el integrador dice que lo que
quería era ese contador, es otra ficha.*

### Q7 — `mensajero` es el ATRIBUIDO, no siempre quien registró la gestión

Hay gestiones **sintéticas** que el sistema o la tienda crean y que quedan atribuidas al mensajero de
la última devolución vigente: la reprogramación de escritorio (100), el escalado del cron de plazo
(99), el rechazo manual de la tienda (240), el desenlace de la ayuda (237) y el rechazo por tope
(276). En `gestiones[]` se ven idénticas a una visita de calle. **Decisión: se emiten todas y se
avisa (R22-b)**, porque excluirlas escondería cambios de estado reales.
*La alternativa —un booleano `visitaReal` derivado de `ORIGEN_TIPOS_VISITA_REAL`— NO se especifica
aquí: es un dato que el integrador no pidió. Si al confirmarle Q1 dice que sin eso no puede medir
«tiempos por mensajero», se añade en esta misma ficha antes de implementar.*

### Q8 — `estadoResultante` se publica sin lista cerrada de valores

El enum `estado` que el contrato publica hoy está **incompleto por deuda declarada desde la feature
109** (`lib/api/openapi-spec.ts:26-57`: faltan `sin_gestionar` y los tres del flujo de devolución de
la 139, todos alcanzables). `estadoResultante` SÍ puede valer esos. **Decisión: se publica como string
con descripción, sin `enum`**, para no publicar una lista que contradiga a la de `estado`. Bajar esa
deuda entera **no entra aquí**, igual que la 268 declaró que no entraba en la suya.
*Confirmar que se acepta y que la deuda sigue viva en su ficha.*
