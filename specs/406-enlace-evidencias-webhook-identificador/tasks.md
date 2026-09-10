# Feature 406 — tasks

Checklist ejecutable. `[P]` = paralelizable con las tareas de su mismo grupo. Cada task lleva su
criterio de **hecho**, y el criterio es un **aserto que se pone rojo si el código está mal** — nunca
un `grep` sobre un comentario ni «existe el archivo».

Orden de trabajo: **T1 → (T2 [P] T3 [P] T4) → T5 → (T6 [P] T7 [P] T8) → T9 → T10 → T11 → T12 → T13**.

---

## T1 — Ramificar DESPUÉS de la 404 (bloqueante)

**Depende de:** que la feature 404 esté **mergeada en `dev`**.

- Sacar `feat/406-enlace-evidencias-webhook-identificador` de `origin/dev` **con la 404 dentro**.
- Releer `lib/services/WebhookEstadoService.ts` entero antes de tocarlo: la 404 cambia `DataEvento`
  y el cuerpo de `armarData` justo encima de las líneas de esta ficha (design §4).

**Hecho:** `git log origin/dev` muestra el merge de la 404, **y** `DataEvento` en
`lib/services/WebhookEstadoService.ts` contiene el campo `mensajero`. Si no lo contiene, la 404 no
está dentro y esta task **no** está hecha.

> Si el humano ordena empezar antes: el orden de aplicación no cambia (la 406 rebasa sobre la 404,
> nunca al revés) y los cinco conflictos de design §4 se resuelven a mano.

---

## T2 [P] — Test de cierre de lazo, en ROJO primero

Archivo nuevo `tests/integration/api/webhook-evidencias-url-resuelve.route.test.ts`. Harness copiado
de `tests/integration/api/ordenes-api-key-orden-consulta.route.test.ts:48-83` (repo fake + service de
resolución REAL) y del `buildService` de `tests/unit/services/webhook-estado-service.test.ts`.

Casos:

1. **Orden con guía** → extraer el último segmento de `data.evidenciasUrl` (con
   `decodeURIComponent`), pasarlo a `handleConsultaOrdenApi` → **200** y el detalle devuelto es el
   de **esa** orden (`orden.id` idéntico).
2. **Orden sin guía** (`numGuia: null`) → mismo cierre de lazo, resuelto por remisión.
3. **Remisión con `/` y con espacio** → mismo cierre de lazo (prueba la codificación de R5).
4. **La orden equivocada no cuela:** sembrar en el repo fake una segunda orden del mismo owner y
   afirmar que el `orden.id` resuelto es el de la orden del evento, no el de la otra.

**Hecho:** los cuatro casos **fallan** contra el código actual con **404**, y la salida roja queda
pegada en `progress/impl_406.md`. Un test que ya pase aquí es un test que no prueba el defecto.

---

## T3 [P] — Tests unitarios del constructor, en ROJO primero

En `tests/unit/services/webhook-estado-service.test.ts`, bloque nuevo `406/…` (los `describe`
existentes de la 268 se tocan en T6, no aquí).

- **R4:** orden con `numGuia: 100235` → `data.evidenciasUrl` termina en `/100235`. Literal escrito
  **a mano**, no derivado de `PATH_ORDEN_API_KEY` ni de ninguna función del service.
- **R5:** orden con `numGuia: null` y `numRemision: "REM-0002"` → termina en `/REM-0002`; con
  `numRemision: "A/B C"` → termina en `/A%2FB%20C` y `decodeURIComponent` lo devuelve intacto.
- **R6:** el cuerpo entregado (el **string** que recibe el sender) **no contiene** el `ordenId` del
  job en ninguna parte de `evidenciasUrl`. Aserto por ausencia sobre el string real.

**Hecho:** los tres fallan hoy (hoy el segmento es el uuid) y su salida roja queda pegada.

---

## T4 — Implementar el arreglo

`lib/services/WebhookEstadoService.ts`, según design §5:

- `identificadorPublicoDe(datos): string | null` (guía → remisión, validado contra
  `idOrdenApiSchema` con `parsed.data === bruto`, y sin dejar escapar `URIError`).
- `evidenciasUrlDe(datos): string | null` con la guarda nueva y `encodeURIComponent`.
- `armarData` pierde el parámetro `ordenId`; ajustar la llamada en `ejecutar`.
- Reescribir el comentario **falso** de `PATH_ORDEN_API_KEY` (hoy dice que se elige la variante por
  `orden.id`), explicando qué identificador viaja y por qué.

**Hecho:** T2 y T3 pasan **sin haber tocado sus asertos**. (Si para ponerlos en verde hubo que
cambiar un aserto, se revierte y se piensa otra vez.)

---

## T5 — R7 y R8: cuándo se omite en vez de enlazar roto

Casos nuevos en `tests/unit/services/webhook-estado-service.test.ts`:

- **R7a:** `numGuia: null`, `numRemision` de **129 caracteres** → la clave `evidenciasUrl` **no
  existe** en `data` (`"evidenciasUrl" in data === false`), el resto del cuerpo va normal y el job
  **completa** (`resolves.toBeUndefined()`).
- **R7b:** `numRemision: " REM-1 "` (espacios de borde) → clave ausente, por la misma razón.
  Complemento del par: pasar `" REM-1 "` al `handleConsultaOrdenApi` real con una orden cuya
  remisión es exactamente `" REM-1 "` y comprobar que da **404** — así el test demuestra que la
  omisión estaba **justificada**, no que es un capricho.
- **R7c:** `numRemision` de 128 caracteres exactos → la clave **SÍ** existe (la cota no se pasa de
  frenada).
- **R8:** `numRemision` con un sustituto UTF-16 desemparejado (p. ej. `"REM-\uD800"`) → clave
  ausente y el job **completa**; `expect(service.ejecutar(...)).resolves` y no `.rejects`.

**Hecho:** los cuatro pasan, y R7a/R8 fallan si se quita la guarda (se comprueba en T11).

---

## T6 [P] — Actualizar los tests de la 268 que congelan el enlace

En `tests/unit/services/webhook-estado-service.test.ts`, describe `268/R22-R25` (hoy 660-810, y **ya
movido por la 404**):

- La constante `ENLACE` pasa a construirse con el identificador público, **escrito a mano**.
- El caso «268/R25: otra orden → otro enlace» (hoy usa `ordenId: "orden-2"`) se reformula: lo que
  cambia el enlace ahora es la **guía/remisión de la orden**, no el `ordenId` del payload. Añadir el
  aserto complementario: **mismo** `numGuia` con **distinto** `ordenId` → **mismo** enlace.
- `expect(url.pathname).toBe(...)` se actualiza al segmento nuevo.
- **No se toca** el caso de idempotencia byte-a-byte (268/R25) ni el de la firma (268/R18): tienen
  que seguir verdes tal cual, y son la prueba de que R11/R12 no se rompieron.

**Hecho:** el archivo entero pasa, incluidos los casos de la 268 y de la 404 **sin modificar** los
asertos de idempotencia ni de firma.

---

## T7 [P] — Contrato publicado: OpenAPI TS + espejo YAML

- `lib/api/openapi-spec.ts`: en el ejemplo de `incidente`, `evidenciasUrl` pasa a
  `https://app.ordenex.co/api/ordenes/api-key/orden/100235` (el `numGuia` que ese mismo ejemplo
  declara). En la descripción del campo: decir con qué identificador se construye, y **precisar** la
  frase que hoy promete que las dos entregas de un mismo `eventoId` llevan «exactamente el mismo
  valor» (riesgo 1 de `requirements.md`).
- `docs/api/api-key-openapi.yaml`: espejo textual exacto.
- Aserto nuevo (en `tests/unit/api/openapi-webhook-contrato.test.ts` o archivo hermano): el último
  segmento de `evidenciasUrl` del ejemplo **es igual a** `String(ejemplo.data.numGuia)`, en el TS
  **y** en el YAML. Cruce de dos campos del mismo ejemplo — no la función contra sí misma.

**Hecho:** el aserto nuevo falla contra el estado actual (`018f2c31-…-0002` ≠ `100235`), pasa tras
el cambio, y `pnpm exec vitest related --run lib/api/openapi-spec.ts` queda verde (incluidos los
guards de espejo y el de «siguen siendo 4 catálogos de estado»).

---

## T8 [P] — `docs/api/CHANGELOG.md`

Entrada **nueva** fechada, con el ejemplo corregido y una frase explícita de que el enlace de
`incidente` viajaba con un identificador que el endpoint no resolvía. **No** se reescribe la entrada
histórica del 2026-08-22 (pendiente de Q2; si el humano decide lo contrario, se corrige también).

**Hecho:** un aserto —patrón de `tests/unit/api/openapi-374-nodo-retirado.test.ts:119-124`— encuentra
la entrada por su fecha **y** comprueba que el `evidenciasUrl` que aparece en ella no termina en un
segmento con forma de uuid.

---

## T9 — Medir Q5: ¿Next decodifica el segmento dinámico?

Los tests del handler lo invocan con el `rawId` ya decodificado, así que **no** lo prueban. Medirlo,
no asumirlo: levantar el dev server (o usar la exportación `GET` con su `ctx.params`) y pedir
`/api/ordenes/api-key/orden/A%2FB` con una key válida, comprobando qué llega al handler.

**Hecho:** el resultado queda escrito en `progress/impl_406.md` con el comando y la salida. Si Next
**no** decodifica, R5 cambia de forma → **se para y se pregunta**, no se improvisa.

---

## T10 — Postgres real: el `WHERE` donde vive

Archivo nuevo `tests/integration/db/webhook-evidencias-url-resuelve-sql-real.test.ts`, envuelto en
`HAY_BASE_DE_DATOS` (`tests/integration/db/_postgres-real.ts`, `crearPrismaDeTest()`). Patrón:
`tests/integration/db/orden-remision-borrada-libera-numero.test.ts`.

- Sembrar tienda + orden **con guía** y orden **sin guía** (limpiar al terminar).
- Tomar el identificador del cuerpo real producido por `WebhookEstadoService` y llamar al
  `OrdenRepository.findByGuiaORemisionForOwner` **real**.
- Afirmar que la fila devuelta es la orden sembrada.
- **Prohibido** el `if (!fila) return;`: ese patrón reporta `passed` sin comprobar nada.

**Hecho:** el test corre **con `DATABASE_URL` resoluble** (no saltado — se verifica en el resumen de
vitest que dice `passed`, no `skipped`) y falla si se revierte T4. La salida se pega en
`progress/impl_406.md`.

---

## T11 — Autocomprobación por mutación

Aplicar una a una, correr los tests, **pegar la salida roja de cada una** y revertir. Un resumen sin
salida no cuenta: aquí un arnés de mutaciones ya reportó supervivientes sin haber ejecutado un test.

| # | Mutación | Rojo esperado |
|---|---|---|
| 1 | Volver a `` `${origin}${PATH}/${ordenId}` `` | T2 (404) y T10 |
| 2 | Invertir la precedencia: remisión aunque haya guía | T3/R4 (el literal a mano) |
| 3 | Quitar `encodeURIComponent` | T2 caso 3 |
| 4 | Quitar la guarda de R7 | T5 R7a |
| 5 | Quitar el `try` de R8 | T5 R8 (el job pasa a rechazar) |

**Hecho:** las cinco filas tienen su salida roja pegada. Si alguna sobrevive, el test correspondiente
no vale y se rehace **antes** de seguir.

---

## T12 — Verificación del alcance (R13)

**Hecho:** `git diff --name-only origin/dev...HEAD` devuelve **exactamente** los cuatro archivos de
producción del design §3 más los de test, y **cero** entradas bajo `db/`,
`lib/interfaces/`, `lib/repositories/`, `app/api/` y `middleware.ts`.

---

## T13 — Gate y bitácora

- `./init.sh --rapido` verde para abrir el PR.
- `./init.sh` completo **antes de la release a `prod`** y tras el merge a `dev`. Leer los
  `skipped`, no solo el `INIT_EXIT`: sin `DATABASE_URL` T10 se salta y el gate sale verde igual.
- `progress/impl_406.md` con la tabla `R<n> → test` de abajo, las salidas rojas de T2/T3/T11 y el
  resultado de T9.
- Entrada en `progress/history.md`.
- **Commitear el informe**: en este repo se ha quedado sin commitear tres veces en un día y un
  `git checkout` se lo ha llevado.

**Hecho:** gate verde con su `INIT_EXIT` escrito **dentro** del log, `progress/impl_406.md`
commiteado y verificado en el blob de la rama (no solo en el árbol de trabajo).

---

## Trazabilidad `R<n> → test`

| Requisito | Test |
|---|---|
| R1 | `tests/integration/api/webhook-evidencias-url-resuelve.route.test.ts` — casos 1, 2 y 4 (el `orden.id` resuelto es el del evento) |
| R2 | mismo archivo — los cuatro casos afirman **200**, no 404 |
| R3 | `tests/integration/db/webhook-evidencias-url-resuelve-sql-real.test.ts` (T10) |
| R4 | `tests/unit/services/webhook-estado-service.test.ts` — bloque `406`, literal `/100235` a mano |
| R5 | ídem — `/REM-0002` y `/A%2FB%20C` con round-trip; + caso 3 de T2 |
| R6 | ídem — el `ordenId` del job no aparece en el `evidenciasUrl` del string entregado |
| R7 | T5 R7a / R7b / R7c (129, espacios de borde, 128 exactos) + el 404 que justifica la omisión |
| R8 | T5 R8 (sustituto desemparejado → clave ausente y job completado) |
| R9 | `268/R24 (1)` ya existente: en `entregada` la clave no existe (se conserva sin tocar) |
| R10 | `268/R24 (2)` ya existente: sin origin, clave omitida (se conserva sin tocar) |
| R11 | `268/R24 (1)` (orden exacto de claves de `data`) + `268/R18` (la firma verifica contra el cuerpo) — ambos ya existentes, ninguno modificado |
| R12 | `268/R22 (4)` ya existente: sin bucket, sin token, `url.search === ""` |
| R13 | T12: `git diff --name-only` sin entradas bajo `db/` (y `schema-drift-saneamiento` sigue verde) |
| R14 | T7: último segmento del ejemplo `=== String(ejemplo.data.numGuia)`, en TS y en YAML |
| R15 | T7: guard de espejo TS↔YAML sobre la descripción de `evidenciasUrl` |
| R16 | T8: entrada localizada por fecha y sin uuid en el enlace del ejemplo |

**Requisitos sin test = fallo de la feature** (`docs/verification.md` §Regla del reviewer). Los que
se cubren con tests **ya existentes** (R9-R12) se verifican, **no se reescriben**: son la prueba de
que este arreglo no rompió lo que la 268 dejó bien.

---

## Puerta previa

Antes de T4 hace falta respuesta humana a **Q1** (`requirements.md`): guía-primero (recomendado) o
siempre remisión. Q2 afecta a T8. Q3, Q4 y Q5 no bloquean: Q5 se mide en T9.
