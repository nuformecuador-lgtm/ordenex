# review_403 — un webhook que falla en racha se pausa, avisa y se recupera solo

> Spec: `specs/403-webhook-destino-que-falla-siempre/` (19 requisitos EARS)
> Rama: `feat/403-webhook-destino-que-falla-pausa-y-avisa`
> Commits revisados: `8b68f687` (backend, 40 archivos), `2e7e4ea8` (UI), `c8db4bff` (bitácora)
> Worktree: `.claude/worktrees/agent-a5c9c9ed7bdb3c9bf` — el repositorio principal no se tocó.
> Nota de método: el MCP `codebase-memory` **no está en mi conjunto de herramientas** en esta
> sesión, así que la exploración se hizo con `grep`/`git`/lectura de archivo. Se dice, y se sigue.

## Veredicto

**APROBADA CON RESERVAS.** Ningún hallazgo bloqueante. Los cinco puntos que el encargo señalaba
como núcleo se verificaron ejecutando, no leyendo, y los cinco se sostienen. Las reservas son
seis hallazgos menores —ninguno de comportamiento en producción salvo uno cosmético de pantalla
(H-2)— y una **condición de orden de merge con la 401** (H-1) que hay que resolver a mano en el
momento de mergear, no en el código.

---

## Lo que se corrió (medido, no citado de la bitácora)

`./init.sh` completo **NO se corrió**, por instrucción explícita: la ficha 401 trabaja sobre la
misma base local y su migración cruzada ensucia el resultado en ambas direcciones. Se usaron
tests focalizados con `DATABASE_URL` **exportada** desde el `.env` del árbol principal (nunca
copiada ni impresa): `postgresql:`, 70 chars, `host=localhost port=5432 db=ordenex` — la base
local, confirmada además con `prisma migrate status`.

```
pnpm run typecheck                                            TYPECHECK_EXIT=0
pnpm run lint         183 problems, 0 errors (183 warnings)   LINT_EXIT=0
prisma migrate status  187 migraciones, "Database schema is up to date!" (sin drift)

pnpm vitest run <los 19 archivos de la ficha>
  Test Files  1 failed | 18 passed (19)
       Tests  1 failed | 352 passed (353)
```

El **único rojo** es `tests/integration/db/notificacion-evento-webhook-suscripcion-migration.test.ts`
→ «la base tiene los DIEZ eventos y los OCHO entidad_tipo», y su causa está medida abajo (H-1).

**Los `describe` de integración usan `describe.skip` cuando no hay base**, no un `if (!x) return`
silencioso: sin `DATABASE_URL` salen como *skipped* visibles, no como *passed* vacíos. Con la
base exportada corrieron de verdad (el rojo VIENE de una consulta a `pg_enum`, o sea que tocaron
Postgres). **Ningún test de integración de esta ficha puede pasar sin datos.**

---

## Atribución de los rojos — comprobada, y con un matiz

El frontend afirma que sus 7 rojos son de la 401. **Reproducido y confirmado, con una corrección
de redacción.**

Corrí los 5 archivos rojos del gate del frontend. Los 7 fallos tienen **exactamente un** delta,
siempre aditivo y siempre el mismo:

```
- Expected   + Received
+   "geocodificacion_caida",        (5 aserciones)
+   "geocodificacion_caida_dia",    (2 aserciones)
```

No hay ni una línea `-`: los valores de la 403 **están todos presentes y en la posición correcta**.
`geocodificacion_caida` no aparece en `db/`, `lib/` ni `tests/` de esta rama — solo en
`specs/401-.../design.md` (que vive en `dev` desde `2819ca2c`) y en las bitácoras/logs. Lo mete la
migración `20260910120000_notificacion_evento_geocodificacion_caida` de la 401 en la base local
compartida.

**El matiz:** uno de los 7 rojos vive en un archivo **de esta ficha**
(`notificacion-evento-webhook-suscripcion-migration.test.ts`). La *causa* es externa —el diff de la
403 no lo provoca—, pero decir «los 7 rojos no son suyos» es impreciso: seis archivos son ajenos y
el séptimo es propio con causa ajena. No cambia el veredicto: **ningún rojo es atribuible al código
de la 403**. Sí cambia lo que hay que hacer al mergear (H-1).

---

## Los cinco puntos del encargo

### 1. Las migraciones y sus down.sql — CORRECTO

- **20260909120000_webhook_suscripcion_circuito**: dos `ADD COLUMN` en un solo `ALTER TABLE`,
  aditivas, con default, sin backfill, sin tocar RLS ni `activa`. Su `down.sql` es `DROP COLUMN IF
  EXISTS` de las dos **en orden inverso**. No hay tercera columna `pausada` (es derivado). OK
- **20260909130000_notificacion_evento_webhook_suscripcion**: `ALTER TYPE ... ADD VALUE IF NOT
  EXISTS` x2, sola y con timestamp posterior (55P04). OK
- **El down recrea-con-lista, y la precondición ruidosa EXISTE Y ESTÁ EJERCITADA.** No es prosa:
  `notificacion-evento-webhook-suscripcion-migration.test.ts` corre el `down.sql` **sentencia a
  sentencia contra Postgres** dentro de una transacción revertida, con una fila del evento nuevo
  insertada, y espera `rejects.toThrow()`. Y tiene su **control positivo** (línea 315): borrando esa
  fila, ese MISMO down corre entero y `notificacion_dedupe_key` sobrevive con su `NULLS NOT
  DISTINCT` y su `WHERE (entidad_id IS NOT NULL)`; `notificacion_entidad_idx` idem. Sin ese control,
  el `rejects.toThrow()` habría pasado por cualquier motivo. **No hay ni un `DELETE` ni un `UPDATE`
  para hacer sitio** — verificado leyendo el `down.sql` entero. OK
- **Las listas del down cuadran con db/schema.prisma:** 9 valores en `notificacion_evento` y 7 en
  `notificacion_entidad_tipo`, que son exactamente los previos a esta ficha, y en el mismo orden. OK
- **No se tocó ningún down.sql anterior:** `git diff --name-status origin/dev...HEAD -- db/migrations/`
  devuelve **solo** los 4 archivos nuevos de la 403. Los cinco downs de 146/253/262/271/333 están
  intactos, y además hay 5 tests que afirman lo que cada uno hace hoy (146 solo dropea; 253 con 4+4;
  262 con 5+5; 271 solo `evento` con 6; 333 con 8+6). OK
- **Ninguna migración se editó después de aplicarse:** cada uno de los 4 archivos tiene **un solo
  commit** en su historia (`8b68f687`), y `prisma migrate status` no reporta drift ni checksum
  distinto contra la base donde ya corrieron. OK

### 2. Las dos desviaciones declaradas — AMBAS VÁLIDAS

**`sin_exito_desde` es TIMESTAMP(3) y no timestamptz. Validado, y el argumento es más fuerte de lo
que dice la bitácora:** buscar `timestamptz` o `Timestamptz` en `db/schema.prisma` da **0
resultados en todo el schema**. `created_at`/`updated_at` de esa misma tabla son `TIMESTAMP(3)`
(`20260721130000_webhook_suscripcion/migration.sql:15-16`). Un `DateTime` sin `@db.` mapea a
`TIMESTAMP(3)`, así que `timestamptz` habría dejado drift permanente y `migrate dev` propondría
cambiarlo en cada migración futura. La desviación es la elección **correcta**, no una concesión.

**`incrementarFalloYLeer(owner, ahora)` no usa `ahora`. El razonamiento es correcto y está
demostrado:** si un fallo moviera el ancla, (a) la resta `ahora - sinExitoDesde` sería siempre ~0 y
la ventana de R4 no se cumpliría jamás, y (b) el `entidadId` del aviso cambiaría en cada intento,
produciendo un aviso por fallo en vez de uno por racha. Lo mide
`webhook-suscripcion-repository.test.ts:355` (NO mueve el ancla de la racha, y ESA es la línea que
sostiene R12): 5 incrementos seguidos, contador 5, ancla intacta las cinco veces.

Sobre que la firma muerta no confunda a quien la lea: **no confunde.** El parámetro se llama
`_ahora` en la implementación (convención del repo para deliberadamente sin usar), lleva un
comentario **en la propia línea del parámetro** además del docblock, y el contrato de la interfaz
documenta por qué sigue ahí (simetría con `registrarEntregaOk`, y los dobles necesitan el mismo
reloj). Es lo mejor que se puede hacer sin romper la simetría. Aceptado.

### 3. El falso positivo — M3 REPRODUCIDA, y el caso que faltaba, MEDIDO

**M3 reproducida tal cual la reportan.** Mutación aplicada con autocomprobación por sha1
(25e8b654... -> f6293632..., aborta si el archivo no cambia), con `estaPausada` devolviendo `true`
en cuanto se cumple el conteo (eje de tiempo eliminado), y restaurada verificando el sha1 de vuelta:

```
Tests  6 failed | 102 passed (108)   -- 6 tests en 3 archivos, exactamente lo reportado

  webhook-suscripcion-pausa : "CAIDA CORTA Y AISLADA: 5 fallos en 4 minutos NO pausa"
  webhook-suscripcion-pausa : "el minuto 30 exacto pausa; el 29 (y un ms antes) no"
  webhook-suscripcion-pausa : "un ahora ANTERIOR al ancla no pausa"
  webhook-estado-service    : "CAIDA CORTA: 5 fallos en 4 minutos NO pausa ni avisa"
  repository                : "la MISMA fila da false o true segun el ahora inyectado"
  repository                : "una caida corta NO sale como pausada (R6, el falso positivo)"
```

El umbral es 3 fallos consecutivos **Y** al menos 30 min sin éxito (comparación `>=` en los dos
ejes, con test del límite exacto en ambos), la pausa se levanta sola al primer 2xx (medido de punta
a punta en `repository.test.ts:306`), y **la pausa no toca `activa` en ningún camino** (un test
espía `desactivarByOwner` y una guardia mira el código sin comentarios). El integrador real no
puede acabar pausado indefinidamente: no existe estado del que solo un humano pueda sacarlo.

**El caso que NO probaron: un destino que ALTERNA éxitos y fallos.** Lo medí con un test temporal
que conduce el repositorio real (borrado tras medir; el árbol quedó limpio):

| escenario | resultado medido |
|---|---|
| A) éxito cada 10 min entre fallos, 12 ciclos | **nunca pausa** (ningún vistazo dio `pausada: true`) |
| B) éxito cada 40 min entre fallos, 5 ciclos | pausa en **cada** ciclo y **sale sola** en cada 2xx; **5 entidades de aviso distintas** |

(A) es el límite conocido y **declarado por escrito** en `design.md` 3 y 10 (un destino
genuinamente intermitente puede no llegar nunca a pausar). No es un defecto: es la decisión.
(B) confirma la propiedad que justifica el pivote: entra y sale, nunca se atasca. **Ninguno de los
dos tiene test en la suite**, y (B) tiene además una consecuencia no documentada: ver H-4.

### 4. El texto de la pantalla — CUMPLE los cuatro requisitos de contenido

Texto entregado (verificado renderizado, no leído del commit):

> Los envíos a este webhook se están espaciando: el destino lleva sin aceptar ninguno desde el
> 9/9/2026, 8:05. No hay que hacer nada: vuelven a su ritmo normal en cuanto el destino acepte un
> envío. Si ya está resuelto, guarda la URL de nuevo para reintentarlo ahora.

- **No culpa al dueño:** el sujeto es el destino, y la única acción que se le ofrece va condicionada
  ("Si ya está resuelto"). OK
- **No suena a corte:** ni desactiv, ni baja, ni cancel, ni suspend, ni bloquead. OK
- **Dice que no hay que hacer nada**, y lo dice **antes** de mencionar la salida manual. OK
- **No filtra URL ni secreto:** test explícito que compara contra `URL_ACTIVA` y `SECRET`. OK

Desviación del literal de `design.md` 7: **legítima**. El propio `requirements.md` marca el copy
como pregunta abierta 2 (si Producto quiere un texto distinto, es un cambio de copy, no de
mecanismo) y el cambio fue por encargo del leader. El mecanismo no cambió.

**El test de palabras prohibidas SÍ sirve de algo.** No es un `expect(true)` disfrazado: el helper
`avisoDeEspaciado()` hace `screen.getByText(/se están espaciando/i)`, que **lanza** si el aviso no
está, así que el test no puede pasar por ausencia. Y la lista no es decorativa: incluye `fall`,
`error` y `pausad`, o sea que el vocabulario interno del servidor no puede filtrarse a la pantalla
por descuido. Comprobado en la corrida M2 del implementador y en la mía: con el bloque JSX borrado,
este test cae junto con los demás.

### 5. Los DOS archivos bajo app/ — la columna pinta lo mismo, incluido el caso vacío

La extracción a `_components/fecha-legible.ts` es correcta y el motivo es real:
`api-keys-columns.tsx` **importa** `WebhookAccionCell`, así que importarlo de vuelta habría cerrado
un ciclo. Verificado por comparación línea a línea del antes/después:

| | antes | después |
|---|---|---|
| coerción | `value instanceof Date ? value : new Date(value)` | idéntica, dentro de `formatFechaHoraLegible` |
| fecha inválida | `Number.isNaN(d.getTime())` da `SIN_DATO` | da `null`, y el llamador aplica `?? SIN_DATO` |
| formato | `Intl.DateTimeFormat("es-EC", dateStyle short + timeStyle short)` | el mismo literal, movido |

**Comportamiento idéntico, incluido el guion del caso vacío.** Pero ese caso **no tiene test que lo
fije**: ver H-3 (mutación superviviente).

---

## Trazabilidad R -> test (los 19, verificados corriendo)

| R | Test que lo cubre | Estado |
|---|---|---|
| R1 | `integration/db/webhook-suscripcion-circuito-migracion.test.ts` (Postgres real: las 2 columnas, tipos, NOT NULL, defaults) + `repository.test.ts:274` | verde |
| R2 | `webhook-estado-service.test.ts:900-937` + `repository.test.ts:288-337` | verde |
| R3 | `webhook-estado-service.test.ts:944-1011` (no-2xx/timeout/red cuentan; payload inválido y `WebhookSecretKeyError` NO) + `repository.test.ts:340-395` | verde |
| R4 | `webhook-suscripcion-pausa.test.ts:24-33` + `webhook-estado-service.test.ts:1013-1027` | verde |
| R5 | `webhook-habilitacion-api-emision.test.ts:174` + `webhook-estado-service.test.ts:1140-1188` + `repository.test.ts:319,371,482,513` | verde |
| R6 | `webhook-suscripcion-pausa.test.ts:35-62` + `webhook-estado-service.test.ts:1081-1107` | verde |
| R7 | `repository.test.ts:398-455` (`actualizarUrlByOwner`, `upsertByOwner`, y que rotar el secreto NO reinicia) | verde |
| R8 | `webhook-config.test.ts` (defaults 3 / 30 min / 1 h, override, inválido cae al default, `pausaConfigDe`) | verde |
| R9 | `webhook-suscripcion-pausada-aviso.test.ts:89-149` + `integration/db/...-migration.test.ts:523` (Postgres real) | verde |
| R10 | `webhook-suscripcion-pausada-aviso.test.ts:251` | verde |
| R11 | `...aviso.test.ts:265,286` + `webhook-estado-service.test.ts:1060` | verde |
| R12 | `integration/db/...-migration.test.ts:410-521` (misma racha da 1 fila; racha nueva da la 2a; **contraprueba** y **control** sobre el índice a pelo) + `...aviso.test.ts:151-230` | verde |
| R13 | `webhook-estado-service.test.ts:1189-1234` + `...aviso.test.ts:231` + `WebhookAccionCell.test.tsx` | verde |
| R14 | `webhook-sender.test.ts` (segundos y fecha HTTP, `parseRetryAfterMs` puro) + `job-queue-service.test.ts:227` | verde |
| R15 | `webhook-sender.test.ts` (sin cabecera, ilegible, cero o hacia atrás) | verde |
| R16 | `job-queue-service.test.ts:283` (cinco 429 con `Retry-After` acaban en `failed`) | verde |
| R17 | `job-queue-service.test.ts:227ss` (cap por los dos lados; incluye la hora de pausa y un `Retry-After` extremo) | verde |
| R18 | `webhooks-action.test.ts` + `webhook-suscripcion-service.test.ts` + `repository.test.ts:456-521` + `WebhookAccionCell.test.tsx` (4 casos) | verde |
| R19 | `repository.test.ts:399` (servidor) + `WebhookAccionCell.test.tsx` (2a lectura, modal en pie) | verde |

**Ningún requisito queda sin test, y ninguno de los tests listados es vacío.** Los tres que más
podían serlo se probaron a la contra: el `rejects.toThrow()` del down tiene control positivo, el
dedupe por racha tiene contraprueba **sobre el motor** (el mismo INSERT a pelo dos veces) y control
(dos entidades dan dos filas), y el test de palabras prohibidas falla si el aviso no existe.

---

## Mutaciones — verificación independiente

Cinco mutaciones aplicadas por mí, todas con autocomprobación por sha1 (aborta si el archivo no
cambia) y restauración verificada por sha1 más `git status` limpio.

| # | Qué rompí | Resultado |
|---|---|---|
| **R-M1** | `estaPausada` sin eje de tiempo (**= la M3 del implementador**) | **MUERTA** — 6 tests / 3 archivos, idéntico a lo reportado |
| **R-M2** | `webhook-estado-handler.ts` deja de pasar el 7o argumento (el notificador REAL) | **MUERTA** — 2 guardias: "inyecta el notificador real" y "cada notificar*Real lo PASA alguien, no solo lo importa". Cubre el fallo del corte-diario de la 271 |
| **R-M3** | `findByOwner` devuelve `sinExitoDesde: null` siempre | **MUERTA** — 2 tests |
| **R-M4** | `registrarEntregaOk` con el WHERE vaciado (resetearía TODAS las suscripciones) | **MUERTA** — 2 tests, incluido el que afirma que la fila del vecino no se toca |
| **R-M5** | `formatFechaCreacion` pierde su guion (devuelve cadena vacía con fecha inválida) | **SUPERVIVIENTE** -> H-3 |

---

## Hallazgos

### H-1 · menor (con acción obligatoria al mergear) — el test de enums de la 403 y la 401 se pisan

`notificacion-evento-webhook-suscripcion-migration.test.ts:250` afirma la lista **literal y cerrada**
de valores del enum leída de la base. Hoy espera 10 eventos y 8 entidades; la base local ya tiene 11
y 9 por la migración de la 401.

Es el patrón aceptado del repo (el precio escrito de añadir un valor a un enum), y de hecho la 403
ya lo pagó por las cuatro fichas anteriores (253/262/271/333) actualizando sus listas a mano. Pero
significa que **la que mergee segunda deja `dev` en rojo si no actualiza las listas de la primera**:

- si mergea **403 primero**, la 401 debe añadir sus dos valores a las listas de **cinco** archivos
  (los cuatro previos más el de la 403);
- si mergea **401 primero**, hay que actualizar el archivo de la 403 **antes** de abrir su PR.

**Qué falta:** una decisión explícita de orden de merge entre 401 y 403, y que la segunda actualice
las listas. No es código de la 403 lo que hay que cambiar hoy.

### H-2 · menor — una suscripción dada de baja sigue diciendo que sus envíos se están espaciando

Reproducido midiendo contra el repositorio real: `activa=false` y `pausada=true` a la vez.

Camino: la suscripción está en racha (pausada), el dueño pulsa "Dar de baja", `desactivarByOwner`
pone `activa=false` y **no reinicia el circuito**, `findByOwner` no filtra por `activa`, y la
pantalla pinta una debajo de la otra:

> No hay webhook registrado para este owner.
> Los envíos a este webhook se están espaciando: el destino lleva sin aceptar ninguno desde el ...

Las dos frases se contradicen, y la segunda es falsa: una suscripción inactiva no recibe entregas,
así que no hay nada que espaciar. Además el estado no se limpia solo (sin entregas no hay 2xx), solo
al volver a registrar.

No viola ningún requisito (R5 prohíbe tocar `activa`, y `pausada` es fiel al estado derivado) y
`design.md` 7 pidió expresamente la línea independiente de esa rama, sin contemplar este caso. Es
cosmético, de alcance limitado y autorreparable al re-registrar. **Qué falta:** condicionar la línea
a `pausada && activa` (una palabra en `WebhookAccionCell.tsx:181`) **o** reiniciar el circuito en
`desactivarByOwner`, con su test. No bloquea.

### H-3 · menor — mutación superviviente: el caso vacío de "Fecha de creación" no tiene test

`formatFechaCreacion(value)` devuelve `SIN_DATO` cuando la fecha no es interpretable. Cambiado a
cadena vacía, la suite entera de esa pantalla sigue verde:

```
ApiKeysModule + ConfiguracionApiPage + api-keys-descarga-columnas + api-keys-tabla-una-linea.guardia
  ->  Test Files 4 passed (4) | Tests 53 passed (53)
```

Es **deuda preexistente**, no una regresión: la extracción a `fecha-legible.ts` preserva el
comportamiento (verificado línea a línea, tabla del punto 5). Pero el encargo pedía comprobar
"incluido su caso vacío", y la respuesta honesta es: se comprobó **por lectura**, no hay red que lo
sostenga. `fecha-legible.ts` tampoco tiene test propio. **Qué falta:** un test de una fila con
`createdAt` inválido que espere el guion.

### H-4 · menor — el destino que aletea produce un aviso por ciclo, y eso no está escrito

Medido (escenario B del punto 3): con éxitos cada 40 min entre rachas de fallos salen **5 entidades
de aviso distintas en 200 minutos**, o sea un `warning` al maestro por ciclo, del orden de 36 al día
en el peor caso sostenido. Es **literalmente correcto** según R12 (racha nueva, aviso independiente)
y el aviso es `warning`, no `alert`. Pero `design.md` 10 documenta dos límites conocidos y **este no
es ninguno de los dos**. **Qué falta:** una línea en esa sección declarándolo, o un test del
escenario alternante. Ninguna de las dos cambia código.

### H-5 · menor — tasks.md con 0 de 15 casillas marcadas

`CHECKPOINTS.md > Especificacion` exige literalmente que todas las tasks estén marcadas. Ninguna lo
está, aunque T1-T14 están hechas y verificadas una a una en esta revisión. El frontend lo declaró y
decidió no estrenar convención. Lo señalo porque es el **único checkpoint que falla por su letra**;
no es motivo de rechazo con el trabajo hecho y trazado. Deuda del arnés, no de la ficha.

Colateral del mismo bloque: T15 pedía `progress/impl_403-webhook-destino-que-falla-siempre.md` y la
bitácora vive partida en `impl_403_backend.md` y `impl_403_frontend.md`. El mapa R->test existe y
está completo entre las dos; solo cambia el nombre.

### H-6 · menor — el repositorio calcula un derivado y lee process.env

`WebhookSuscripcionRepository` importa `estaPausada` y `loadWebhookConfig()`, y `findByOwner` deriva
`pausada`. `CHECKPOINTS.md > Patron de capas` dice que el repositorio solo ejecuta queries Prisma,
sin lógica de negocio. Es una desviación **sancionada explícitamente por `design.md` 2 y 7**, y con
un motivo bueno: que la escritura (drenador) y la lectura (pantalla) compartan predicado es justo lo
que impide que divergan. Se deja anotado, no se pide cambiar.

Relacionado y **no** achacable a esta ficha:
`tests/integration/repositories/webhook-suscripcion-repository.test.ts` vive bajo `integration/`
pero usa un doble semántico de Prisma, no Postgres (lo declara su propia cabecera desde la feature
99). Comprobé que el doble sí modela lo que importa (`{increment}`, `P2025` y el WHERE) con la
mutación R-M4, que muere. Las columnas y sus defaults sí se miden contra Postgres de verdad en
`webhook-suscripcion-circuito-migracion.test.ts`.

---

## Checklist de CHECKPOINTS.md

| Punto | Estado |
|---|---|
| `requirements.md` con EARS numerados | **OK** — 19, de R1 a R19 |
| `design.md` con alternativa descartada y su porqué | **OK** — cinco, con motivo cada una |
| `tasks.md` con todas las tasks marcadas | **NO** — 0 de 15 (H-5) |
| Cada R mapea a un test concreto | **OK** — 19/19, tabla arriba, todos corridos |
| `progress/impl_<feature>.md` con el mapa R -> test | **OK** — partido en 2 archivos (H-5) |
| `pnpm run typecheck` | **OK** — exit 0 |
| `pnpm run lint` | **OK** — 0 errores (183 warnings, patrón preexistente de parámetros `_algo`) |
| `pnpm test` | **PARCIAL** — 352/353 focalizados; el completo NO se corrió por instrucción (la 401 comparte base). El único rojo es H-1 |
| E2E para flujo crítico (webhooks) | **INAPLICABLE** — no hay harness E2E vivo en el repo; el riesgo se cubre con los 353 tests focalizados y las mutaciones |
| RLS en tabla nueva | **N/A** — no hay tabla nueva; las 2 columnas caen bajo la RLS ya activa de `webhook_suscripcion` desde la 99, y el `migration.sql` lo declara |
| Migraciones versionadas y reversibles, con `down.sql` | **OK** — las dos, y los dos downs **ejercitados contra Postgres**, no solo por regex. `scripts/db-rollback.ts` los encuentra (nombre válido, `down.sql` en su carpeta) |
| Ningún secreto hardcodeado | **OK** — los 3 números por env con default; ni URL ni secreto en aviso, log ni pantalla (3 tests) |
| Webhooks validan firma / idempotentes | **OK (no-regresión)** — no se toca `webhook-firma.ts` ni `webhook-secret-cipher.ts`; el `eventoId` determinista sigue igual |
| Controller sin queries ni negocio | **OK** — `lib/actions/webhooks.ts` **sin cambios**; solo cambió el tipo de retorno |
| Service sin HTTP | **OK** — `WebhookEstadoService` habla con `IWebhookSender`; `JobQueueService` recibe un hint duck-typed y no sabe qué es un webhook |
| Repository solo queries | **DESVIACIÓN sancionada por el design** (H-6) |
| Interfaces en `lib/interfaces/` por categoría | **OK** — `repositories/`, `services/`, `external/` |
| Páginas protegidas validan permisos en servidor | **OK** — `obtenerWebhook` exige rol `maestro` antes de nada |
| Componentes reciben datos por props | **OK** — `WebhookAccionCell` consume la Server Action; no fetchea nada sensible |
| Mutaciones por Server Actions | **OK** — sin API routes nuevas |
| Sin hardcode de país, moneda ni cuenta | **OK** — `fechaCalendarioCR` y `es-EC` son convenciones ya vigentes del repo, no valores nuevos |
| `./init.sh` en verde | **NO EJECUTADO** — por instrucción explícita (la 401 trabaja la misma base). Y en esta rama muere antes de los tests: `feature_list.json` registra 400 y 402 sin su carpeta de specs, que viven en otras ramas. **Ajeno a este diff** |
| `progress/review_<feature>.md` con veredicto | **OK** — este archivo |
| Entrada en `progress/history.md` | **PENDIENTE** — todavía no hay línea de la 403 (cierre del leader) |

---

## Qué queda en manos del leader

1. **Decidir el orden de merge 401 / 403** y que la segunda actualice las listas de enum (H-1). Es
   lo único que puede dejar `dev` en rojo.
2. Antes de cerrar: marcar `tasks.md`, añadir la línea a `progress/history.md`, y correr el gate
   completo cuando la base local deje de estar compartida.
3. H-2, H-3 y H-4 son mejoras de una línea cada una; se pueden llevar a una ficha de deuda o
   arreglarse aquí si se prefiere. No condicionan la aprobación.

Ninguno de los cinco puntos del encargo quedó sin verificar ejecutando, y ninguna de las
afirmaciones de las dos bitácoras resultó falsa.
