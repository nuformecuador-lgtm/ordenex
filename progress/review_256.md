# Feature 256 — Revision

**Rama:** `feature/256-webhook-motivo-devolucion` (worktree `C:/w256`), 4 commits.
**Base de la rama:** `021916ef`. `origin/dev` ya avanzo a `139062e3` (la 257 se mergeo despues);
el diff util es `git diff 021916ef..HEAD` — 12 archivos, +2156/-5. Merge de prueba contra
`origin/dev` (`git merge-tree`, solo lectura): **sin conflictos**.

**Veredicto: OK (APROBADO).** Cero hallazgos bloqueantes.

---

## Checklist de CHECKPOINTS.md

| Punto | Estado |
| --- | --- |
| `specs/256-.../requirements.md` con EARS numerados R1..R24 | OK |
| `design.md` con alternativas descartadas y su porque (A1..A6) | OK |
| `tasks.md` con todas las tasks `[x]` | **Parcial**: T11 quedo `[~]` (trazabilidad hecha; el gate lo corre el leader). Ver M3 |
| Cada `R<n>` mapea a al menos un test concreto | OK — 24/24 verificados uno a uno abriendo el test |
| `progress/impl_256.md` contiene el mapa `R<n> -> test` | OK, y la tabla resulto FIEL: ninguna fila apunta a un test inexistente |
| `pnpm typecheck` / `pnpm lint` | No re-medido aqui (gate del leader). El implementer reporta limpio, 97 warnings preexistentes |
| Tests del perimetro | **Corridos por mi**: 8 archivos, 108 tests, todos verdes (detalle abajo) |
| E2E Playwright para flujo critico | No aplica: este repo no tiene `tests/e2e/`. Lo equivalente es unitario + `tests/integration/api/procesar-jobs-webhook-estado.test.ts` (intacto y sin asserts del cuerpo) |
| RLS en tablas nuevas / migraciones reversibles | No aplica: cero migraciones, `db/schema.prisma` intacto, solo lectura de columnas existentes |
| Sin secretos hardcodeados | OK. El secreto sigue viniendo cifrado de la suscripcion; el test de R16 lo ejercita |
| Webhook valida firma y es idempotente | OK — R13/R14/R16 con tests que muerden |
| Capas separadas | OK: la POLITICA de contrato en el service, la consulta en el repositorio, el DTO en `lib/interfaces/repositories/` |
| Sin hardcode de pais/moneda/cuenta | OK, no aplica |
| `progress/review_256.md` con veredicto | este archivo |
| Entrada en `progress/history.md` | Pendiente (bookkeeping del leader). Ver M4 |

Tests corridos por mi, sin fiarme de la bitacora:

- `openapi-webhook-estado-actualizado`, `webhook-orden-reader`, `webhook-estado-service`,
  `intentos-no-alcance`, `openapi-contrato-en-reparto`, `openapi-177-paths-pdf-y-carga-id`,
  `webhook-eventos` -> **7 files passed, 100 tests passed**.
- `openapi-carga-row-paridad` -> **1 file passed, 8 tests passed**.

Barri ademas TODOS los tests que tocan el contrato (grep por `openApiSpec` y
`api-key-openapi.yaml`): son 5 archivos y los 5 estan verdes con la seccion nueva.

---

## Trazabilidad R1..R24 — verificada abriendo cada assert

| R | Verificado | Muerde? |
| --- | --- | --- |
| R1, R2 | `it.each(CAUSA_DEVOLUCION_SEED)` en el service: identidad exacta con el value crudo | Si: si se tradujera o normalizara, falla |
| R3 | recorrido del SEED + set de 3 emitidos | Si (contra la lista cerrada de la 73). El `it` hermano de «causa de incidente» es tautologico: ver M1; el que muerde es `R10` del reader |
| R4 | service (`datosDevuelta(null)`) + reader (`devuelta({causaDevolucion:null})`) | Si |
| R5 | service + reader (fila `reprogramada` -> relacion vacia) | Si |
| R6 | dos casos: `en_reparto`, y orden CON devolucion vigente que transiciona a `en_bodega_central` | Si: el 2.o cae si se quita la ramificacion del service |
| R7 | `Object.keys(body.data)` exacto y ordenado, en el caso base y en el de devolucion | Si |
| R8 | reader: dos `devuelta` vigentes, gana la de `createdAt` mayor, mas assert sobre el `orderBy`/`take`/`select` capturados | Si, por partida doble |
| R9 | reader: `where` capturado `{resultado:'devuelta', anuladaAt:null}` y la anulada POSTERIOR no gana | Si |
| R10 | reader: `entregada`/`incidente` posteriores no desplazan; el `select` no pide `causaIncidente`; `danado` no aparece | Si |
| R11 | reader: `where {id: ORDEN_ID}` y los tres metodos de `gestionOrden` sin llamar | Si |
| R12 | reader: exactamente 2 llamadas a Prisma | Si |
| R13 | dos ejecuciones, cuerpo byte a byte, con el motivo INFORMADO (no `null`) | Si — y el test viejo de idempotencia sigue intacto al lado |
| R14 | dos servicios con relojes distintos, `JSON.stringify(data)` identico | Si |
| R15 | reader que responde `not_found` y luego `null`: 2.o cuerpo `null`, MISMO `eventoId`, sin lanzar, 2 intentos y no 2 eventos | Si |
| R16 | firma verificada contra el cuerpo ampliado **y** assert negativo contra el cuerpo sin el campo | Si; el assert negativo es el que lo hace serio |
| R17 | tamanos de `EVENTOS_PUBLICOS` (10) y `ORIGENES_SIN_EVENTO_PUBLICO` (1), mas `webhook-eventos.test.ts` verde SIN editar | Si (comprobe que el archivo no esta en el diff) |
| R18 | `webhook-estado-encolado.test.ts` verde sin editar; el emisor no aparece en el diff | Aceptable como no-regresion |
| R19 | service (tres campos viejos y `body.orden` undefined) y reader (`toEqual` del DTO completo) | Si |
| R20 | los cinco desenlaces re-ejercitados con una devolucion CON causa | Si |
| R21 | `findActivaByOwner('owner-A')` y URL del owner correcto con motivo presente | Si |
| R22 | reader: el `select` NO pide `motivo` y el texto libre inyectado en la fila cruda no sale | **Si en el reader**. El `it` del service es tautologico: M1 |
| R23 | log test ampliado: ninguna causa del SEED ni la palabra `motivo` llegan al logger | Si (el camino transitorio, el unico que loguea, es el que se ejercita) |
| R24 | `openapi-webhook-estado-actualizado.test.ts`, 7 casos | Si — ver abajo |

Los tres puntos que mas me importaban, comprobados en el codigo:

1. **El fake de Prisma del reader es un mini-motor real**: aplica el `where`, el `orderBy`, el
   `take` y el `select` que el repositorio le pasa, sobre filas CRUDAS. Por eso R8/R9/R10/R22
   caen de verdad si alguien borra `anuladaAt: null`, el `orderBy`, o mete `motivo: true` en el
   `select`. Un fake que devolviera la fila buena habria dado verde con el codigo roto.
2. **El congelador del cuerpo se REFORZO, no se debilito.** Antes hacia un `toEqual` de tres
   claves; ahora hace `Object.keys(...)` EXACTO y ordenado **mas** el `toEqual` de las cuatro
   claves con sus valores. Afirma estrictamente mas que antes.
3. **La guardia `intentos-no-alcance.test.ts` quedo intacta** (no aparece en el diff) y verde:
   el rojo ajeno se resolvio reescribiendo la prosa en singular, no tocando la guardia. Igual
   con `webhook-eventos`, `openapi-contrato-en-reparto` y `openapi-177-paths-pdf-y-carga-id`.

---

## Las tres advertencias del implementer, verificadas una a una

**1. «R24 no tenia test propio; el nuevo muerde.» — CONFIRMADO, y es cierto.**
Las dos guardias hermanas son de no-regresion y efectivamente pasarian con la seccion
`webhooks:` borrada (la de `paths` corta el `.yaml` al primer bloque de indentacion 0; la de
catalogos solo cuenta enums de estados). El test nuevo es AFIRMATIVO y muerde por construccion:
a nivel de modulo hace
`openApiSpec.webhooks[EVENTO].post.requestBody.content["application/json"].schema` — si la
seccion desaparece, el archivo revienta antes del primer `it`. Del lado del `.yaml`,
`lineasDeSeccionTopLevel` lanza con mensaje explicito si no hay una linea `webhooks:` en la
columna 0. No hace falta creerse la mutacion: el codigo del test no admite falso verde.

**2. «design.md §5.2 cita 7 `paths` y son 8.» — CONFIRMADO. Hallazgo MENOR (M2).**
`openapi-177-paths-pdf-y-carga-id.test.ts` congela OCHO desde la 255 (`PATH_COTIZACION`). No
afecta a T10 —la seccion es de nivel superior y no toca `paths`, cosa que el test afirma con
`expect(JSON.stringify(openApiSpec.paths)).not.toContain(EVENTO)`— pero el spec queda con un
dato falso escrito.

**3. «js-yaml no es resoluble; se usa un lector acotado.» — CONFIRMADO, y NO es hallazgo.**
`js-yaml` no figura en `package.json`, y el resto de los tests de OpenAPI del repo leen el
`.yaml` como texto: el molde se respeta. Lo importante es que el riesgo que se teme —un lector
casero que ignore algo en silencio— no se materializa, por como esta escrita la paridad:
`expect(JSON.stringify(webhooksYaml)).toEqual(JSON.stringify(openApiSpec.webhooks))`.
Es igualdad total de la seccion y sensible al orden: si el lector se comiera una clave, la
malinterpretara o la ordenara distinto, los dos strings dejarian de coincidir y el test se
pondria ROJO, no verde. El fallo del parser se manifiesta como fallo del test, nunca como
aprobacion silenciosa. Ademas el parser lanza ante sangria inesperada y ante lineas que no casan
con su regex. Verifique a mano los dos puntos delicados del bloque: `- "null"` en `type`
(string) frente a `- null` en `enum` (nulo) se distinguen bien, y los bloques `|-` reconstruyen
el mismo texto que el `join("\n")` del TS. La paridad esta realmente afirmada.

---

## Los otros cuatro focos

**Idempotencia (R13/R14).** El `eventoId` es
`webhook_estado:<ordenId>:<estatusDestinoId>:<ocurridoAt>`, todo del payload: no se toca. El
cuerpo se compara byte a byte con el campo INFORMADO (el test viejo comparaba un cuerpo con
`motivo: null`, que habria pasado igual sin el campo; el nuevo cierra ese hueco). La seleccion
de la gestion es `where {resultado:'devuelta', anuladaAt:null}` + `orderBy createdAt desc` +
`take 1`: el mismo criterio, comparado linea a linea, que `OrdenRepository.findCausasDevueltaVigentes`
y `DevolucionSlaRepository`. Determinista salvo empate exacto de `created_at` — ver M5.

**Los dos nombres.** NO se unificaron: el DTO
(`IWebhookOrdenReader.DatosEntregaOrden.causaDevolucion`) y el repositorio conservan
`causaDevolucion`; `motivo` aparece unicamente en la linea del service y en el contrato
publicado. `gestion_orden.motivo` (texto libre del mensajero) no se emite en ningun caso, y es
estructural, no un filtro: el `select` de la relacion pide solo `causaDevolucion`, asi que el
texto libre ni siquiera entra al proceso. Comprobado tambien que `GestionOrden` no tiene
`deletedAt`: la vigencia es `anuladaAt`, correcto.

**Politica de publicacion.** El spec (R6, decision (c)) exige el campo SIEMPRE presente y `null`
fuera de `devuelta`; el service hace
`motivo: datos.estado === "devuelta" ? datos.causaDevolucion : null`, con la ramificacion en la
capa que fija design §2.3. Las dos ramas tienen test, incluida la interesante: orden CON causa
vigente que transiciona a otro estado -> `null`, y la causa no aparece en el string. Nota de
alcance, correcta: `devuelta_a_tienda` y `devolviendo_a_tienda` son eventos publicos distintos y
emiten `null`, tal como fija la decision (d).

**Contrato publico.** La seccion `webhooks:` esta a nivel superior en los dos archivos y es
espejo exacto (paridad por igualdad total). Documenta las 4 claves con su `required`, el enum de
`motivo` con `null` incluido, `estado` SIN enum (con un assert que recorre todos los enums del
subarbol comprobando que ninguno contiene `entregada`/`por_recoger`), las dos cabeceras de firma
y la prosa de R15. El endpoint saliente lleva `security: []`, correcto: se autentica con la
firma, no con la API key.

---

## Hallazgos

**BLOQUEANTES: ninguno.**

**M1 (menor) — dos `it` del service son tautologicos.**
En `256/R22: ... el texto libre no aparece por ningun lado` y en `256/R3: una causa de
INCIDENTE ... nunca aparece`, las cadenas buscadas (`TEXTO_LIBRE_DEL_MENSAJERO`, `DESTINATARIO`,
`0999123456`, `danado`/`perdido`/`robado`) NUNCA se inyectan en el fake: `DatosEntregaOrden` no
tiene donde alojarlas. Esos `not.toContain` no pueden ponerse rojos jamas. No es bloqueante
porque R22 y R3 SI tienen un test que muerde, en
`tests/unit/repositories/webhook-orden-reader.test.ts` (`R22` y `R10`), donde el texto libre y la
causa de incidente si estan en las filas crudas y el mini-motor proyecta lo que el `select` pida.
Para el futuro: dejar en el service solo el assert positivo y no simular blindaje donde no hay
superficie.

**M2 (menor) — `design.md` §5.2 tiene un numero caduco.** Dice que la lista de `paths` esta
congelada en 7; el arbol real dice 8 desde la 255. No afecta a la implementacion ni a ningun
test; conviene corregirlo para que nadie lo tome como dato al releer el spec.

**M3 (menor) — `tasks.md` T11 quedo `[~]`, no `[x]`.** CHECKPOINTS pide todas las tasks en `[x]`.
La trazabilidad esta hecha y verificada; lo que falta es `./init.sh --rapido`, que por diseno
corre el leader. Cerrar la marca cuando el gate pase.

**M4 (menor) — bookkeeping pendiente, del leader:** sin entrada en `progress/history.md`, sin
actualizar `feature_list.json` ni `progress/current.md`. El implementer hizo bien en no tocarlos.

**M5 (menor, deuda compartida, NO de esta feature) — sin desempate secundario en el `orderBy`.**
Si dos gestiones `devuelta` vigentes de la misma orden compartieran `created_at` exacto (posible
si se insertaran en la misma transaccion, donde `now()` es constante), la fila elegida seria
ambigua y la promesa de cuerpo byte-identico de R13 dependeria del plan de Postgres. No es
regresion: los tres sitios preexistentes del repo tienen la misma ambiguedad y el design elige a
proposito «decir lo mismo que las pantallas». Si algun dia se cierra, se cierra en los cuatro a
la vez (`orderBy: [{createdAt:'desc'},{id:'desc'}]`), no solo aqui.

**Nota, no hallazgo:** la rama esta basada en `021916ef` y `origin/dev` ya es `139062e3` (la 257
entro despues). El merge de prueba con `origin/dev` sale limpio; el `git diff origin/dev..HEAD`
muestra borrados de la 257 que son artefacto de la base desfasada, no cambios de esta rama.

---

## Veredicto

**OK.** La feature esta completa contra su spec: 24/24 requisitos con test que existe, corre y
—salvo los dos asserts decorativos de M1, cubiertos en otro nivel— muerde. Sin migraciones, sin
secretos, sin cruce de capas, el congelador del cuerpo reforzado y las guardias ajenas verdes sin
haber sido editadas. Los cinco menores son de spec y bookkeeping: ninguno devuelve codigo al
implementer.
