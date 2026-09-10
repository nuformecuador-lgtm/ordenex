# Feature 406 — bitácora de implementación

**Rama:** `feat/406-enlace-evidencias-webhook-identificador`
**SHA base:** `7acd9cb0` (`chore(406): la ficha arranca, con su rama`, ya con la 404 **y** la 405 dentro)
**Fecha:** 2026-09-10 · **Agente:** backend_dev · **Worktree:** aislado

Qué se arregló: `data.evidenciasUrl` del webhook `orden.estado_actualizado` se construía con el
**uuid** de la orden, y el `{id}` de `GET /api/ordenes/api-key/orden/{id}` solo resuelve por
`num_guia` o `num_remision`. El enlace daba **404 garantizado**. Ahora lleva el identificador
**público** que el propio cuerpo ya nombra: la guía si existe, la remisión si no, codificado con
`encodeURIComponent`. **Sin migración, sin `db/`, sin `lib/types/`, sin tocar el resolutor.**

---

## Lo confirmado EN EL ARCHIVO REAL antes de tocar nada (el grafo devuelve de más)

El spec avisaba de que el índice daba líneas rancias (`evidenciasUrlDe` en 202-207 cuando el spec
la ubicaba en 276-281). **Se volvió a mover**: la 404 y la 405 ya habían entrado en `dev`.

| Símbolo | Dónde estaba de verdad (SHA `7acd9cb0`) |
|---|---|
| `evidenciasUrlDe(estado, ordenId)` | `lib/services/WebhookEstadoService.ts:303-308` (ni 202-207 ni 276-281) |
| `armarData(datos, ordenId)` | `:256` |
| El comentario **falso** de `PATH_ORDEN_API_KEY` | `:44-60`, la premisa en `:57-58` |
| `DataEvento.mensajero` (prueba de que la 404 está dentro, T1) | `:72` ✔ |
| `idOrdenApiSchema` = `z.string().trim().min(1).max(128)` | `lib/api/api-orden-identificador.ts:16` |
| `findByGuiaORemisionForOwner` (`tienda_id` + `deleted_at IS NULL` + `OR`, `take: 2`) | `lib/repositories/OrdenRepository.ts:3102-3117` (el spec decía 2894-2909) |
| `not_found` → 404 uniforme | `app/api/ordenes/api-key/orden/[id]/route.ts:125` ✔ |

---

## ⚠️ Q5, MEDIDA (no asumida) — task T9

**Pregunta:** ¿Next.js decodifica el segmento dinámico de ruta antes de entregarlo en `params`?

**Respuesta medida: SÍ, y decodifica EXACTAMENTE UNA VEZ.** Luego `encodeURIComponent` en el
emisor **basta**: no hay que decodificar nada al otro lado, y R5 se queda como está.

**Cómo se midió.** Sonda temporal `app/api/docs/eco-406/[id]/route.ts` que devuelve el `params.id`
crudo, su longitud y sus code points (bajo `/api/docs`, que es `PUBLIC_ROUTES` en `middleware.ts`;
en cualquier otro prefijo el guard de sesión la manda a `/login` y no se mide nada). Servidor de
desarrollo real —`pnpm exec next dev -p 3406`, Next.js 16.2.10 (Turbopack), `✓ Ready in 4.0s`—; no
había ningún otro dev server escuchando (`netstat` en 3000-3009 y 3100, vacío). **La sonda se
borró y el puerto se liberó**: no está en el diff (`git status` limpio y el árbol no la contiene).

```
$ curl -s http://localhost:3406/api/docs/eco-406/A%2FB
{"idRecibido":"A/B","longitud":3,"codigos":[65,47,66],"urlCruda":".../A%2FB"}

$ curl -s http://localhost:3406/api/docs/eco-406/A%20B
{"idRecibido":"A B","longitud":3,"codigos":[65,32,66],"urlCruda":".../A%20B"}

$ curl -s http://localhost:3406/api/docs/eco-406/A%2FB%20C     # el caso de los tests
{"idRecibido":"A/B C","longitud":5,"codigos":[65,47,66,32,67],"urlCruda":".../A%2FB%20C"}

$ curl -s http://localhost:3406/api/docs/eco-406/A%2525B       # la contraprueba
{"idRecibido":"A%25B","longitud":5,"codigos":[65,37,50,53,66],"urlCruda":".../A%2525B"}

$ curl -s http://localhost:3406/api/docs/eco-406/REM-0002
{"idRecibido":"REM-0002","longitud":8,...}
```

Tres cosas quedan medidas, no supuestas:

1. **Decodifica**: `A%2FB` llega como `A/B` (code point 47 = `/`), y `A%20B` como `A B`.
2. **El `/` codificado NO parte el segmento**: la ruta sigue casando con `[id]` y llega un único
   `params.id`. Era el riesgo real de R5.
3. **Decodifica UNA vez, no dos**: `A%2525B` → `A%25B`, no `A%B`. Es lo que garantiza que una
   remisión con `%` sobreviva al viaje entero.

Medido en el servidor de **desarrollo**; la ruta de producción usa el mismo mecanismo
(`ctx.params`) y no hay nada específico de build en juego. Queda dicho por si alguien quiere
repetirlo contra un `next build && next start`.

---

## Archivos creados

| Archivo | Qué es |
|---|---|
| `tests/integration/api/webhook-evidencias-url-resuelve.route.test.ts` | T2 — **el cierre de lazo**: emisor real → `new URL` → `decodeURIComponent` → `handleConsultaOrdenApi` REAL con `ApiOrdenResolucionService` REAL. 5 casos |
| `tests/integration/db/webhook-evidencias-url-resuelve-sql-real.test.ts` | T10 — el `WHERE` contra **Postgres real**. 4 casos |
| `tests/unit/api/openapi-406-evidencias-url.test.ts` | T7/T8 — R14/R15/R16 sobre el TS, el YAML y el CHANGELOG. 9 casos |

## Archivos modificados

**Producción y contrato (4, exactamente los del design §3):**

| Archivo | Cambio |
|---|---|
| `lib/services/WebhookEstadoService.ts` | `identificadorPublicoDe` (nuevo), `evidenciasUrlDe(datos)` con la tercera guarda y `encodeURIComponent`, `armarData` pierde `ordenId`, y el comentario **falso** de `PATH_ORDEN_API_KEY` corregido con bloque fechado |
| `lib/api/openapi-spec.ts` | ejemplo de `incidente`: uuid → `100235` (el `numGuia` de ese mismo ejemplo); descripción de `evidenciasUrl`: qué identificador lleva, que va codificado, y la promesa de idempotencia **precisada** |
| `docs/api/api-key-openapi.yaml` | espejo textual exacto de lo anterior |
| `docs/api/CHANGELOG.md` | entrada nueva fechada `2026-09-10` (R16). La histórica del 2026-08-22 **no** se reescribe (Q2) |

**Tests ajenos enmendados (3)** — ninguno relajado; los tres son literales que **eran** el contrato
del enlace y cambian con él:

| Archivo | Qué se enmendó y por qué |
|---|---|
| `tests/unit/services/webhook-estado-service.test.ts` | la constante `ENLACE` del describe `268/R22-R25` (uuid → `…/12345`, la guía de `DATOS_BASE`, **escrita a mano**), el `pathname` de `268/R22 (4)`, y el caso `268/R25` reformulado: lo que cambia el enlace es la orden, no el `ordenId` del payload. **NO se tocaron** el caso byte-a-byte de idempotencia ni el de la firma (R11/R12) |
| `tests/unit/services/webhook-estado-service.mensajero.test.ts` | un literal de la 404 que congelaba el enlace con el uuid. Lo que ese caso protege —que en `incidente` viajan `mensajero: null` **y** el enlace— no cambia |
| `tests/unit/api/openapi-405-gestiones.test.ts` | su localizador de la entrada del CHANGELOG buscaba `"## 2026-09-10 —"` **a secas**: con dos entradas del mismo día medía la equivocada (5 rojos ajenos). Se ancla al **título** propio. Ningún aserto se relajó |

**Ni una línea bajo `db/`, `lib/types/`, `lib/interfaces/`, `lib/repositories/`, `app/` ni
`middleware.ts`** (T12, R13; ver §Alcance).

---

## La decisión de Q1, aplicada y no reabierta

**Guía primero, remisión de respaldo** (firma del leader). `num_guia` es `@unique` **global** y
tiene precedencia absoluta en el resolutor (177/R14): cuando existe, la resolución es exacta y no
puede caer en OTRA orden. `num_remision` es `NOT NULL`, así que siempre hay identificador.

**El precio, escrito:** el enlace puede cambiar entre reintentos del mismo `eventoId` si la guía se
genera en medio. Se acepta porque `data.numGuia` ya tiene hoy esa misma propiedad, y porque el
`eventoId` —la clave de deduplicación— no depende del cuerpo. **La frase del OpenAPI que prometía
que las dos entregas llevan «exactamente el mismo valor» se corrigió**: prometía más de lo que el
arreglo puede sostener, y hay un aserto que impide que vuelva.

---

## Mapa `R<n> → test`

| R | Test (archivo → caso) |
|---|---|
| R1 | `webhook-evidencias-url-resuelve.route.test.ts` → «orden CON guia -> 200 y el detalle devuelto es el de ESA orden», «orden SIN guia -> 200 resolviendo por remision», «con OTRA orden viva del mismo owner, se resuelve la del EVENTO y no la vecina». El aserto de fondo es `orden.id` resuelto === `orden.id` del evento |
| R2 | mismo archivo — los cuatro casos del lazo afirman **200**, y los cuatro daban **404** antes del arreglo |
| R3 | 🔴 `webhook-evidencias-url-resuelve-sql-real.test.ts` → los 4 casos contra Postgres real (guía, remisión, `tienda_id` con contraprueba, `deleted_at` con las dos filas sembradas) |
| R4 | `webhook-estado-service.test.ts` → «406/R4: con guia, el ultimo segmento es la guia en decimal» (literal `/100235` **a mano**) · 🔴 el caso «con guia» del SQL real |
| R5 | ídem → «sin guia, el ultimo segmento es la remision tal cual» y «una remision con `/` y espacio viaja CODIFICADA y vuelve intacta» (`/A%2FB%20C` + round-trip) · `…route.test.ts` → «una remision con `/` y espacio sobrevive al viaje y resuelve igual» |
| R6 | ídem → «el `ordenId` del payload NO aparece en el enlace (aunque siga en el `eventoId`)»: aserto por AUSENCIA sobre el string entregado, más una regex de uuid sobre el enlace |
| R7 | ídem → `406/R7a` (129 caracteres), `406/R7b` (espacios de borde), `406/R7c` (128 exactos, la clave SÍ viaja) · **y la justificación**: `…route.test.ts` → «una remision con espacios de borde NO es alcanzable por el endpoint: da 404» |
| R8 | ídem → «sustituto UTF-16 desemparejado -> clave AUSENTE y el job NO falla» (`resolves`, y la entrega **se hizo**) |
| R9 | `268/R24 (1)` ya existente: en `entregada` la clave no existe. **Verificado, no reescrito** |
| R10 | `268/R24 (2)` ya existente: sin origin, clave omitida y el cuerpo no contiene `/api/ordenes/api-key/orden`. **Verificado, no reescrito** |
| R11 | `268/R24 (1)` (las seis claves de `data` en orden) + `268/R18` (la firma verifica contra el cuerpo). **Los dos ya existentes; solo cambió el valor de `ENLACE`, no sus asertos** |
| R12 | `268/R22 (4)` ya existente: sin bucket, sin token, `url.search === ""` |
| R13 | T12: `git diff --name-only origin/dev...HEAD` = 10 archivos, **cero** bajo `db/`, `lib/types/`, `lib/interfaces/`, `lib/repositories/`, `app/` y `middleware.ts` (salida pegada abajo). Además el gate lo dijo solo: «el cambio no toca esquema, tipos compartidos, config ni dinero» |
| R14 | `openapi-406-evidencias-url.test.ts` → «TS: el ultimo segmento del enlace es EXACTAMENTE el `numGuia` de ese mismo ejemplo» y «YAML: el espejo publica el MISMO enlace…» (en el YAML el `numGuia` se **lee del archivo**, no se repite el literal) |
| R15 | ídem → «TS: la prosa nombra los dos identificadores…», «la promesa … queda PRECISADA, no en pie» y **«el espejo `.yaml` dice EXACTAMENTE lo mismo, palabra por palabra»** (cotejo real TS↔YAML con espacios colapsados) |
| R16 | ídem → «hay una entrada del 2026-09-10 que dice que el enlace NO resolvia», «el enlace que muestra esa entrada NO termina en un segmento con forma de uuid» y «la entrada HISTORICA del 2026-08-22 NO se reescribe» |

🔴 = vive en `tests/integration/db/`, contra Postgres real.

---

## El rojo de partida (T2 y T3), que es lo que prueba que los tests prueban algo

**T2 — cierre de lazo, contra el código de `dev`:**

```
 × 406/R1: orden CON guia -> 200 y el detalle devuelto es el de ESA orden
 × 406/R1: orden SIN guia -> 200 resolviendo por remision, y es ESA orden
 × 406/R5: una remision con `/` y espacio sobrevive al viaje y resuelve igual
 × 406/R1: con OTRA orden viva del mismo owner, se resuelve la del EVENTO y no la vecina
AssertionError: expected 404 to be 200 // Object.is equality
 Test Files  1 failed (1)
      Tests  4 failed | 1 passed (5)
```

(El quinto caso —el 404 que **justifica** la omisión de R7— pasa desde el principio: mide el
endpoint, no el emisor.)

**T3 — unitarios del constructor, contra el código de `dev`:**

```
 × 406/R4: con guia, el ultimo segmento es la guia en decimal
 × 406/R5: sin guia, el ultimo segmento es la remision tal cual
 × 406/R5: una remision con `/` y espacio viaja CODIFICADA y vuelve intacta
 × 406/R6: el `ordenId` del payload NO aparece en el enlace (aunque siga en el `eventoId`)
AssertionError: expected 'https://app.ordenex.co/api/ordenes/ap…' not to contain 'orden-1'
 Test Files  1 failed (1)
      Tests  4 failed | 67 skipped (71)
```

Ni un aserto se tocó para ponerlos en verde: lo único que cambió entre el rojo y el verde fue
`lib/services/WebhookEstadoService.ts`.

---

## Mutaciones — las 8 murieron, ninguna sobrevivió

Cada una se aplicó sobre **código de producción**, se corrieron los tests, se pegó el rojo y se
revirtió con `git checkout HEAD --`. **Se commiteó ANTES de mutar** (lección de la 405: el
`checkout --` de la restauración se lleva lo que no está guardado). Al terminar,
`git status --porcelain` vuelve **vacío** y `grep -rn MUTACION lib/ docs/` solo devuelve menciones
preexistentes y ajenas.

| # | Mutación | Resultado |
|---|---|---|
| **M1** | volver al bug entero (`git checkout origin/dev -- lib/services/WebhookEstadoService.ts`) | **MUERTA — 22 rojos en 4 archivos**: 4 del lazo (404), **4 contra Postgres real**, 13 unitarios y 1 de la 404 |
| **M2** | invertir la precedencia: la remisión aunque haya guía | **MUERTA — 8 rojos**, entre ellos el literal a mano de R4 y el caso «con guía» del SQL real. ⚠️ **El archivo del lazo pasó ENTERO**: es la fila que el design anticipó —resuelve igual de bien por remisión—, y por eso R4 necesita su literal escrito a mano |
| **M3** | quitar `encodeURIComponent` | **MUERTA — 2 rojos**: el unitario `/A%2FB%20C` y el caso 3 del lazo |
| **M4** | quitar la guarda de R7 (`!parsed.success \|\| parsed.data !== bruto`) | **MUERTA — 2 rojos**: R7a (129 caracteres) y R7b (espacios de borde) |
| **M5** | quitar el `try` de R8 | **MUERTA — 1 rojo**: `AssertionError: promise rejected "URIError: URI malformed" instead of resolving`. Es exactamente el job que se habría ido a dead-letter |
| **M6** | devolver el uuid al ejemplo del **TS** | **MUERTA — 2 rojos** en `openapi-406-evidencias-url.test.ts` (el cruce con `numGuia` y el literal) |
| **M7** | devolver el uuid al ejemplo del **YAML** | **MUERTA — 1 rojo**: el cruce del espejo |
| **M8** | quitar un acento a UNA palabra de la descripción del **YAML** (divergencia TS↔YAML) | **MUERTA — 1 rojo**: «el espejo `.yaml` dice EXACTAMENTE lo mismo, palabra por palabra» |

M6/M7/M8 no estaban en la tabla de T11: se añadieron porque T7 exige demostrar que el aserto del
contrato **falla contra el estado anterior**, y porque la equivalencia TS↔YAML no tenía comparador
automático hasta ahora (era verificación humana). Ahora la tiene.

---

## Alcance verificado (T12, R13)

```
$ git diff --name-only origin/dev...HEAD
docs/api/CHANGELOG.md
docs/api/api-key-openapi.yaml
lib/api/openapi-spec.ts
lib/services/WebhookEstadoService.ts
tests/integration/api/webhook-evidencias-url-resuelve.route.test.ts
tests/integration/db/webhook-evidencias-url-resuelve-sql-real.test.ts
tests/unit/api/openapi-405-gestiones.test.ts
tests/unit/api/openapi-406-evidencias-url.test.ts
tests/unit/services/webhook-estado-service.mensajero.test.ts
tests/unit/services/webhook-estado-service.test.ts

$ git diff --name-only origin/dev...HEAD | grep -E '^db/|^lib/types/|package.json|pnpm-lock|tsconfig|middleware.ts|next.config|vitest.config|prisma.config|eslint.config|init.sh'
(vacío)
```

**La dependencia de ORDEN de la 405 en el `.yaml` sigue intacta:** `Evidencia` continúa apareciendo
antes que `OrdenGestion` (no se movió un solo bloque del `.yaml`; solo cambió texto dentro del
schema del webhook, que vive en otra parte del archivo), y el caso que lo vigila en
`openapi-405-gestiones.test.ts` está **verde** en el gate.

**El `.ts` y el `.yaml` dicen lo mismo:** cotejado a mano bloque por bloque **y**, desde esta ficha,
con un aserto que compara la descripción entera de `evidenciasUrl` entre los dos artefactos (M8 lo
mata con un solo carácter de diferencia).

---

## Gate

**`./init.sh --rapido`** — y el propio gate lo autorizó: *«✓ el cambio no toca esquema, tipos
compartidos, config ni dinero: el modo rapido basta»*. El diff no toca `lib/types/**`, `db/**` ni
configuración de build (verificado sobre el diff real, arriba).

Log: `scratchpad/gate-406-rapido.log` (no canalizado por `tail`; el `INIT_EXIT` se escribe **dentro**
del log, dentro del mismo bloque `{ …; echo "INIT_EXIT=$?"; }`).

```
✓ typecheck paso
✖ 183 problems (0 errors, 183 warnings)      <- todos preexistentes y ajenos
✓ lint paso
✓ DATABASE_URL resuelta: los 154 archivos de tests contra Postgres SI se ejecutan
 ✓ tests/integration/db/webhook-evidencias-url-resuelve-sql-real.test.ts (4 tests) 518ms
 Test Files  29 passed (29)          <- relacionados con el diff
      Tests  383 passed (383)
 Test Files  202 passed (202)        <- guardias
      Tests  3015 passed (3015)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 228 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Los `skipped`, mirados y no supuestos:** **CERO archivos saltados** — ni una línea `↓` en todo el
log. Se copió el `.env` del checkout principal al worktree tras comprobar que su `DATABASE_URL`
apunta a **`localhost:5432`** y no a Supabase (`prisma`/`grep` sobre la línea, con la credencial
enmascarada). De los **154** archivos de `tests/integration/db/` que el gate declara ejecutables,
el modo rápido seleccionó **4**, y **los 4 corrieron**:

```
✓ tests/integration/db/webhook-evidencias-url-resuelve-sql-real.test.ts (4 tests)  <- el de esta ficha
✓ tests/integration/db/analytics-daily-guards.test.ts (26 tests)
✓ tests/integration/db/zona-central-guarda-y-rastro.test.ts (17 tests)
✓ tests/integration/db/zona-guardado-conserva-inactivos.test.ts (2 tests)
```

**Sin `40P01` en ninguna corrida.** `grep -ci "40P01|deadlock"` sobre el log del gate → **0**. La
contención con el otro agente contra la misma base local no se materializó, y todas las corridas de
`tests/integration/db/` de esta ficha (limpia, 5 mutadas, limpia otra vez) terminaron con recuento
explícito de tests, nunca con «suite roja y 0 tests fallidos».

Los tres avisos de `down.sql` faltante son deuda preexistente de tres migraciones de agosto: esta
ficha **no crea ninguna migración**.

> El gate **completo** (`./init.sh` a secas) no lo corre este agente: `AGENTS.md > Regla del gate`
> lo asigna al leader, antes de la release a `prod` y tras el merge a `dev`.

---

## Notas del entorno

- El worktree venía **sin `node_modules`**. La junction al del checkout principal no se pudo crear
  (`mklink`/`New-Item -ItemType Junction` y `ln -s` bloqueados en esta sesión: *Operation not
  permitted*), así que se resolvió con `pnpm install --frozen-lockfile --ignore-scripts` +
  `pnpm exec prisma generate` **dentro del worktree**. Efecto lateral bueno: el cliente Prisma queda
  en el `node_modules/.pnpm` propio, así que **no se pisa con el de otros worktrees**.
- `.next/` se borró tras la medición de Q5 (tipos generados truncados dejan el typecheck rojo).

---

## Lo que queda abierto

1. **Q3 (avisar al integrador) — decisión del humano, no del arnés.** Medido: 0 incidentes y 0
   eventos de este tipo en producción, luego **0 consumidores** han recibido nunca este enlace. La
   entrada del CHANGELOG está redactada para copiarse y enviarse tal cual si se quiere avisar.
2. **Q4 sigue SIN medir**: no se consultó el `max(length(num_remision))` real de producción ni si
   hay remisiones con espacios de borde. R7 está implementado y probado en los dos sentidos (129,
   128 exactos, y con espacios), pero **no se sabe si llega a activarse alguna vez** o es puramente
   defensivo. El arreglo no depende del resultado; medirlo es un `SELECT` de solo lectura.
3. **La colisión heredada de la 177 sigue viva y no la cierra esta ficha** (riesgo 2 de
   `requirements.md`): con una orden **sin guía**, si su remisión es un entero decimal canónico que
   coincide con el `num_guia` de otra orden viva de la misma tienda, la precedencia absoluta
   resuelve la **otra**. Es un defecto preexistente del endpoint; guía-primero lo **reduce** a un
   subconjunto estricto. Cerrarlo exige tocar el resolutor, que está fuera de alcance.
4. **Q5 se midió en `next dev`**, no contra un `next build && next start`. La ruta usa el mismo
   `ctx.params` y no hay nada específico de build en juego, pero queda dicho.
5. **Deuda ajena que esta ficha destapó y arregló de paso**: el localizador del CHANGELOG de la 405
   ataba una aserción a la **fecha**, y una segunda entrada del mismo día la rompía. Puede haber
   otros localizadores por fecha en `tests/unit/api/`; no se auditaron.

---

## Veredicto

El enlace de evidencias del webhook ya resuelve a la orden que el propio evento nombra, probado
extremo a extremo contra el handler y el resolutor REALES y contra el `WHERE` real de Postgres;
gate rápido en verde con `INIT_EXIT=0`, cero archivos saltados, y las 8 mutaciones muertas.
