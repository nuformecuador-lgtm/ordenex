# Ficha 334 — bitácora del BACKEND (T0 + tandas A, B y C)

> Rama: `feature/334-movimiento-unificado-wallet` (nacida de `origin/dev` @ `b776d0da`; **ya
> existía**, no la creé yo).
> Alcance de esta sesión: **T0, tanda A, tanda B, tanda C** — y, además, el archivo de
> integración contra Postgres que `tasks.md` numera como **E1** (ver «Desviaciones», punto 1).
> **NO** se tocó nada de la tanda D (interfaz) ni E2/E3/E4. Cero comandos git de escritura.

---

## T0 — el terreno, medido en el archivo real

Los cuatro hechos en los que el spec se apoya, confirmados **leyendo el archivo**, no el grafo
(el índice del MCP `codebase-memory` estaba disponible y se usó solo para localizar):

| hecho | dónde, hoy | ¿confirmado? |
| --- | --- | --- |
| `fecha_movimiento` existe y es **distinta** de `created_at` | `db/schema.prisma:1518` y `:1519` | sí — dos columnas, ambas `@default(now())`, sin `updatedAt` ni `deletedAt` |
| los filtros `desde`/`hasta` van sobre `fecha_movimiento` | `lib/repositories/WalletMovimientoRepository.ts:56` (`where.fechaMovimiento = { gte, lte }`) | sí, y lo comparten `listar` y los dos agregados vía `buildWhere` |
| el `orderBy` del libro va sobre `fecha_movimiento` | `WalletMovimientoRepository.ts:120` | sí (era `{ fechaMovimiento: "desc" }`; ahora es el array de tres, ver B2) |
| `CrearMovimientoInput.fechaMovimiento?` es opcional desde la 173 | `lib/interfaces/repositories/IWalletMovimientoRepository.ts:49` | sí, y el repositorio **omite la clave** cuando no viene (línea 94) |

**T0.1 — rama:** saltada por instrucción del leader (la rama ya existía y ya estaba activa).

**T0.2 — base local al día:** `pnpm exec prisma migrate status --schema db/schema.prisma`
(sólo lectura; no se corrió `migrate deploy` porque no hacía falta):

```
Datasource "db": PostgreSQL database "ordenex", schema "public" at "localhost:5432"
168 migrations found in prisma/migrations
Database schema is up to date!
```

**Línea base de `pnpm typecheck` (antes de tocar nada):**

```
> ordenex@0.1.0 typecheck
> tsc --noEmit
TC_EXIT=0
```

**La regla del gasto FIJO (R11), localizada en sus cuatro sitios y NINGUNO tocado:**

1. `lib/types/wallet.ts:412` — `TIPO_EGRESO_MANUAL_SEED = ["gasto_variable", "sueldo"]`
2. `lib/types/wallet.ts:418` — `TIPO_EGRESO_MANUAL_A_CATEGORIA` (no mapea `gasto_fijo`)
3. `lib/types/wallet.ts:430` — `tipoEgreso: z.enum(TIPO_EGRESO_MANUAL_SEED)` en el borde
4. `app/(app)/wallet/_components/wallet-labels.ts:14,247` — el `Select` se puebla del SEED

De los cuatro, el único archivo que esta sesión abre es `lib/types/wallet.ts`, y sólo para
**añadir** `fecha` a los dos schemas. Hay dos tests nuevos que lo afirman en runtime:
`wallet-egreso-service.test.ts › «R11: el gasto FIJO no se puede registrar por aquí»` (mapa
entero y cerrado) y `wallet-egresos-actions.test.ts › «R19: gasto_fijo sigue cayendo aunque la
fecha sea impecable»`.

---

## Archivos creados / modificados

### Producción

| archivo | qué |
| --- | --- |
| `lib/config/wallet-movimiento.ts` **(nuevo)** | ventana de fechas admisibles del registro manual: `DIAS_HACIA_ATRAS = 30`, sobreescribible por `WALLET_MOVIMIENTO_DIAS_HACIA_ATRAS`. Molde: `lib/config/gasto-fijo.ts` |
| `lib/utils/fecha-movimiento-manual.ts` **(nuevo)** | `instanteDelMovimientoManual(fecha?, now?)`: `undefined` con «hoy» o sin fecha (manda el `DEFAULT`), `${fecha}T06:00:00.000Z` con una fecha pasada |
| `lib/types/wallet.ts` | `primerDiaMovimientoAdmisible` (320), `problemaDeFechaMovimiento` (334), `esFechaMovimientoValida` (343), `fechaMovimientoSchema` (347); `fecha` opcional en `registrarMovimientoManualSchema` (369) y en `registrarEgresoAdministrativoSchema` (433) |
| `lib/interfaces/repositories/IWalletMovimientoRepository.ts` | `CrearMovimientoInput.id?: string` (32); docstring de `listar` con el orden total |
| `lib/repositories/WalletMovimientoRepository.ts` | el `id` viaja sólo si el llamador lo trae (83); `orderBy` total (120) |
| `lib/services/WalletService.ts` | `registrarMovimientoManual`: `randomUUID()` + `instanteDelMovimientoManual` + relectura por `obtenerPorId` |
| `lib/services/WalletEgresoService.ts` | `registrarEgreso`: lo mismo, espejo exacto |

### Tests

| archivo | qué |
| --- | --- |
| `tests/unit/types/wallet-fecha-movimiento-schema.test.ts` **(nuevo, 14 casos)** | A2 |
| `tests/integration/db/wallet-fecha-elegida.test.ts` **(nuevo, 4 casos)** | E1 (ver «Desviaciones» 1) |
| `tests/unit/repositories/wallet-movimiento-repository.test.ts` | +3 casos (id opcional ×2, orden total); el literal del `orderBy` **reescrito entero** |
| `tests/unit/services/wallet-service.test.ts` | `buildRepo` con memoria; +5 casos (R22/R23/R28) |
| `tests/unit/services/wallet-egreso-service.test.ts` | `buildRepo` con memoria; +5 casos (R22/R23/R28/R11) |
| `tests/unit/actions/wallet-actions.test.ts` | +5 casos de borde (R20/R21/ventana/R22) |
| `tests/unit/actions/wallet-egresos-actions.test.ts` | +6 casos de borde (R20/R21/ventana/R22/R19) |

**No se tocó:** `feature_list.json`, `progress/current.md`, `specs/**`, `app/**`,
`components/**`. Ninguna migración, ningún `down.sql`, ningún cambio de RLS — la columna
`fecha_movimiento` ya existe con índice desde la 42 y su escritura opcional ya estaba en el
contrato del repositorio desde la 173 (design §7).

---

## Tanda A — el borde

- **A1.** `fechaMovimientoSchema` reutiliza las dos piezas de `lib/utils/fecha-cr.ts` que el
  design nombra: el **round-trip** `esFechaCalendarioValida` (lo único que caza `2026-02-31`,
  porque V8 **no** devuelve `Invalid Date` con el día desbordado: rueda al 3 de marzo) y
  `fechaCalendarioCR` (el día CR sin off-by-one). No se promovió nada desde
  `lib/types/liquidacion.ts`.
- **Decisión del leader implementada:** ventana de **30 días hacia atrás**, configurable por
  entorno. Fuera de la ventana —más de 30 días atrás, o cualquier fecha futura— el borde
  responde `validation_error`.
- **Desviación menor del design §8.1:** en vez de un `.refine` con un único mensaje, el schema
  usa `superRefine` sobre `problemaDeFechaMovimiento`, que devuelve el **motivo**. Razón: con
  dos cotas (futuro y ventana) un solo mensaje no diría cuál se rompió, y el diálogo pinta el
  texto bajo el campo. `esFechaMovimientoValida(value, now)` existe con la firma del design.
- **A3.** `fecha: fechaMovimientoSchema.optional()` en los dos schemas. Ausente ⇒ el
  comportamiento es el de hoy, byte a byte (hay un caso por cada schema que lo afirma).

### Los tres mensajes del borde

| situación | mensaje |
| --- | --- |
| formato ≠ `YYYY-MM-DD` | `La fecha debe tener el formato YYYY-MM-DD.` |
| día inexistente | `Esa fecha no existe en el calendario.` |
| posterior a hoy CR | `La fecha no puede ser posterior a hoy.` |
| fuera de la ventana | `No se admiten movimientos anteriores al <YYYY-MM-DD>.` |

Van bajo `fieldErrors.fecha`. Un formato inválido emite **un solo** issue (el `superRefine` sale
temprano) para que el diálogo no pinte dos avisos que dicen lo mismo.

## Tanda B — el repositorio

- **B1.** `id?: string` en `CrearMovimientoInput`, con la misma forma que `fechaMovimiento?`:
  la clave viaja sólo si el llamador la trae. Ninguno de los escritores existentes la pasa
  (`pnpm typecheck` verde lo demuestra: el campo es opcional) y hay un caso que afirma que sin
  `id` la clave **no aparece** en el `createMany`.
- **B2.** `orderBy: [{ fechaMovimiento: "desc" }, { createdAt: "desc" }, { id: "desc" }]`. El
  literal de `wallet-movimiento-repository.test.ts` se **reescribió entero** con el array; no se
  relajó a `expect.anything()` ni se derivó de la fuente. Sin índice nuevo (design §4).
- **B3.** La superficie del repositorio sigue siendo **cinco** métodos: el caso «R47: la
  superficie del repositorio son CINCO metodos» sigue verde **sin tocar su lista**.

## Tanda C — los servicios

- **C1/C2.** Los dos `registrar*` generan el `id` con `randomUUID()`, lo mandan dentro del
  **único** `createMany` y releen con `obtenerPorId(id)`. Si la relectura diera `null`
  —imposible: el manual lleva `origen_id NULL` y queda fuera del índice único parcial— se lanza
  un `Error` con contexto en vez de devolver una fila ajena.
- **Desviación del design §8.2 (declarada):** `instanteDe` no es un método privado duplicado en
  los dos servicios, sino **una** función pura en `lib/utils/fecha-movimiento-manual.ts` que los
  dos llaman. Motivo: es la *definición del instante de un movimiento*; escrita dos veces puede
  divergir en una sola de ellas y media docena de filas quedarían fechadas con otra convención
  sin que nada falle. Sigue siendo lógica de servicio (pura, sin HTTP ni Prisma).
- **C3.** Casos de borde en las dos suites de actions, todos con el espía del servicio a **cero
  llamadas**, más un caso de no-vacuidad que comprueba que una fecha válida **sí** llega al
  servicio tal cual, como texto.

---

## Mapa `R<n> → test` (sólo lo que cubre esta sesión)

| R | test | archivo |
| --- | --- | --- |
| R11 | «R11: el gasto FIJO no se puede registrar por aquí — no hay tipo que lo mapee» | `tests/unit/services/wallet-egreso-service.test.ts` |
| R12 | «R19: tipoEgreso 'gasto_fijo' → validation_error, sin tocar el service» *(existente)* + «R19: gasto_fijo sigue cayendo aunque la fecha sea impecable» | `tests/unit/actions/wallet-egresos-actions.test.ts` |
| R14/R15 | «R15: maestro con ajuste valido → ok, movimiento con monto STRING» *(existente)* + «el monto viaja como STRING» en los casos nuevos | `tests/unit/actions/wallet-actions.test.ts` |
| R16 | «sin sesion → unauthenticated», «R19: rol no autorizado → forbidden» *(existentes)* | `tests/unit/actions/wallet-actions.test.ts` |
| R17 | «R47: la superficie del repositorio son CINCO metodos» *(existente, intacto)* | `tests/unit/repositories/wallet-movimiento-repository.test.ts` |
| R20 | «R20: rechaza MAÑANA, y el mensaje dice por que» + «R20: fecha FUTURA → validation_error con la clave `fecha`, sin tocar el service» (×2 bordes) | `tests/unit/types/wallet-fecha-movimiento-schema.test.ts`, `tests/unit/actions/wallet-*.test.ts` |
| R21 | «R21: rechaza un dia que NO existe (2026-02-31)…», «R21: rechaza un formato que no es YYYY-MM-DD, con UN solo mensaje», + los dos bordes | ídem |
| R22 | «R22: con la fecha de AYER, viaja el instante en que ese dia EMPIEZA en Costa Rica (06:00Z)» (×2 servicios) + «R22/R24: un gasto fechado AYER se guarda a las 06:00Z de ayer…» | `tests/unit/services/wallet-*.test.ts`, `tests/integration/db/wallet-fecha-elegida.test.ts` |
| R23 | «R23: con la fecha de HOY, la clave fechaMovimiento NO viaja» (×2 servicios) + «sin fecha, tampoco viaja» | `tests/unit/services/wallet-*.test.ts` |
| R24 | «R22/R24: … y `created_at` es el presente» | `tests/integration/db/wallet-fecha-elegida.test.ts` |
| R25 | «R25: el rollup DIARIO lo cuenta en el dia de AYER y no en el de hoy» | ídem |
| R26 | «R26: el orden del libro desempata por creacion y por id» + «R26: tres movimientos EMPATADOS … paginan sin repetir ni perder filas» | `tests/unit/repositories/…`, `tests/integration/db/…` |
| R27 | «R27: el filtro `desde` = ayer devuelve el movimiento fechado ese dia» | `tests/integration/db/wallet-fecha-elegida.test.ts` |
| R28 | «R28: devuelve el movimiento que CREO, aunque exista uno mas reciente de su misma categoria» (×2 servicios) + la relectura por id contra Postgres | `tests/unit/services/wallet-*.test.ts`, `tests/integration/db/…` |
| R30 | las seis suites nombradas siguen verdes (ver salidas) | — |
| **ventana** *(decisión del leader, pregunta abierta 1)* | «acepta el dia MAS ANTIGUO de la ventana…», «rechaza el dia ANTERIOR a la ventana…», «rechaza una fecha de hace años», + un caso por borde | `tests/unit/types/…`, `tests/unit/actions/wallet-*.test.ts` |

**Sin cubrir aquí (son de la tanda D, otro agente):** R1–R10, R13, R18, R19 (el campo del
diálogo), R29, R31, R32.

---

## Verificación ejecutada

### `pnpm typecheck`

```
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit

TYPECHECK_EXIT=0
```

### `pnpm lint`

```
✖ 127 problems (0 errors, 127 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

**0 errores.** Los 127 warnings son preexistentes (`no-unused-vars` sobre parámetros `_x` en
suites ajenas); `pnpm lint | grep -i wallet` no devuelve **ninguna** línea, así que ni uno solo
cae en los archivos de esta ficha.

### `pnpm exec vitest related --run` sobre los siete archivos de producción tocados

```
 Test Files  198 passed (198)
      Tests  3355 passed | 17 skipped (3372)
   Duration  147.71s

VITEST_RELATED_EXIT=0
```

### Corrida explícita, por nombre, de los siete archivos de test creados o modificados

```
pnpm exec vitest run \
  tests/unit/types/wallet-fecha-movimiento-schema.test.ts \
  tests/unit/repositories/wallet-movimiento-repository.test.ts \
  tests/unit/services/wallet-service.test.ts \
  tests/unit/services/wallet-egreso-service.test.ts \
  tests/unit/actions/wallet-actions.test.ts \
  tests/unit/actions/wallet-egresos-actions.test.ts \
  tests/integration/db/wallet-fecha-elegida.test.ts

 Test Files  7 passed (7)
      Tests  123 passed (123)
   Duration  1.08s
```

Y por archivo, aislados: schema **14**, repositorio **20**, wallet-service **23**,
wallet-egreso-service **22**, las dos suites de actions **40**, integración **4**.

**No se corrió `./init.sh`** (instrucción del leader: la suite completa la corre él).

---

## Mutaciones ejecutadas — las salidas ROJAS

Ningún verde de esta bitácora se da por bueno sin haberlo matado antes.

### Mutación 1 — `fechaCalendarioCR(now)` → `now.toISOString().slice(0, 10)` (A2)

En `problemaDeFechaMovimiento` (`lib/types/wallet.ts`). Es la versión ingenua que este repo
tiene prohibida: después de las 18:00 de Costa Rica el reloj UTC ya marca el día siguiente.

```
 FAIL  …wallet-fecha-movimiento-schema.test.ts > las 20:00 de Costa Rica … > a las 20:00 CR del 29, el 30 es MAÑANA y se rechaza (el UTC ya dice 30)
AssertionError: expected true to be false // Object.is equality
- false
+ true
   137|     expect(r.success).toBe(false);

 FAIL  …wallet-fecha-movimiento-schema.test.ts > las 20:00 de Costa Rica … > y a las 23:59 CR del 29 (05:59Z del 30) tampoco se ha adelantado
AssertionError: expected true to be false // Object.is equality
   146|     expect(esFechaMovimientoValida("2026-08-30")).toBe(false);

 Test Files  1 failed (1)
      Tests  2 failed | 12 passed (14)
```

Revertida; 14/14 verdes de nuevo.

### Mutación 2 — `instanteDelMovimientoManual` devuelve siempre `undefined` (E1)

Es la neutralización que pide `tasks.md` E1: la fecha elegida se ignora y todo cae en el
`DEFAULT` de la columna.

```
 FAIL  …wallet-fecha-elegida.test.ts > R22/R24: un gasto fechado AYER se guarda a las 06:00Z de ayer…
   126|       expect(fila.fechaMovimiento.toISOString()).toBe(`${ayerCR}T06:00…

 FAIL  …wallet-fecha-elegida.test.ts > R25: el rollup DIARIO lo cuenta en el dia de AYER y no en el de hoy
AssertionError: expected '0.00' to be '1234.56' // Object.is equality
Expected: "1234.56"
Received: "0.00"
   171|       expect(delta(ayerCR)).toBe(MONTO_DEL_GASTO);

 FAIL  …wallet-fecha-elegida.test.ts > R26: tres movimientos EMPATADOS en la misma fecha paginan sin repetir ni perder filas
AssertionError: expected +0 to be 3 // Object.is equality
   256|       expect(p1.total).toBe(3);

 Test Files  1 failed (1)
      Tests  3 failed | 1 passed (4)
```

**El caso que SOBREVIVE, y se dice:** «R27: el filtro `desde` = ayer devuelve el movimiento
fechado ese día» pasa igual con la mutación, y es correcto que pase: con la fila fechada hoy, un
filtro `desde = ayer` la sigue incluyendo. Ese caso mide el filtro, no el instante; quien mide
el instante son los otros tres. Revertida; 4/4 verdes de nuevo.

### Mutación 3 — `orderBy` de vuelta a una sola columna (B2)

```
 FAIL  …wallet-movimiento-repository.test.ts > listar (R20/R24) > R20: aplica filtros … orderBy fecha desc; paginado
 FAIL  …wallet-movimiento-repository.test.ts > listar (R20/R24) > R26: el orden del libro desempata por creacion y por id — orden TOTAL, no solo por fecha
AssertionError: expected false to be true // Object.is equality
   224|     expect(Array.isArray(orderBy)).toBe(true);

 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 22 passed (24)
```

**Hallazgo honesto:** la que caza esta mutación es la **unidad**, no la integración. El caso de
las tres filas empatadas contra Postgres **pasó igual** sin el desempate: con tres filas en una
tabla pequeña el planificador devolvió el mismo orden físico en las dos páginas. Es exactamente
por qué el literal del `orderBy` en el test unitario es contrato y no se puede relajar: la
inestabilidad de `skip`/`take` sin orden total es un riesgo que la base **no** exhibe a
demanda. Revertida; 24/24 verdes.

---

## Desviaciones y decisiones, todas declaradas

1. **Escribí `tests/integration/db/wallet-fecha-elegida.test.ts`, que `tasks.md` numera en la
   tanda E.** El leader excluyó las tandas D y E, pero su encargo insistía en que «los
   requisitos que dependen de un `WHERE`, de un `orderBy` o de un índice se prueban donde
   viven, contra Postgres» y pedía las salidas rojas de las mutaciones sobre integraciones que
   pueden terminar sin comprobar nada. Ese archivo cubre **sólo backend** (servicios +
   repositorios) y es la verdad contra la base de R22/R24/R25/R26/R27, que nacen en mis tandas.
   **No hice E2, E3 ni E4.** Si el leader prefiere que ese archivo lo escriba el agente de la
   tanda E, está aislado en un solo fichero y se puede descartar sin tocar nada más.
2. **`instanteDe` es una función compartida, no un método privado por servicio** (design §8.2).
   Motivo arriba, en la tanda C.
3. **El schema de fecha usa `superRefine` con motivo, no un `refine` de mensaje único**
   (design §8.1). Motivo arriba, en la tanda A.
4. **Las cuatro preguntas abiertas restantes del spec siguen abiertas y sin tocar:** la
   asimetría de reversabilidad (2), el desfase de la tarde del libro (3), el filtro `hasta` (4)
   y el nombre de los dos ajustes (5). La 1 la cerró el leader y está implementada.

## Lo que el test de integración necesita para no mentir

`tests/integration/db/wallet-fecha-elegida.test.ts` **no tiene ni un `return` mudo**. Cuando le
falta un dato previo, **falla con su motivo**:

- sin ningún `usuario` en la base local lanza un `Error` explicando que `registrado_por` es una
  FK (no se salta);
- si el filtro del caso R27 desbordara la página, falla con «el filtro devuelve más de una
  página; el caso ya no aísla»;
- si la base ya tuviera ajustes en el instante exacto del caso R26, falla con «la base ya tiene
  ajustes en ese instante exacto; el caso dejaría de aislar».

Todo corre dentro de `enTransaccionRevertida`: pase, falle o muera el runner, no queda una sola
fila de dinero inventada. Sin `DATABASE_URL` alcanzable la suite se **salta** (no falla), que es
el patrón del repo.

---

## Veredicto

Backend de la 334 cerrado en T0/A/B/C con typecheck y lint sin errores, 3355 tests relacionados
verdes y tres mutaciones ejecutadas y revertidas; falta la tanda D (interfaz) y el cierre.
