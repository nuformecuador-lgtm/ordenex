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

---

# TANDA D (interfaz) + E2 — 2026-08-29

Ejecutada por el `frontend_dev` sobre la misma rama `feature/334-movimiento-unificado-wallet`,
con el backend ya commiteado (`e6a40868`). Alcance: **D1–D6 + E2**. No se tocó `lib/`, ni
`feature_list.json`, ni `progress/current.md`, ni `specs/`, ni se corrió `./init.sh` (es del
leader), ni se ejecutó ningún comando de git que escriba.

## Archivos tocados

**Nuevos (producción)**
- `app/(app)/wallet/_components/wallet-conceptos-manuales.ts` — ⟨D1⟩ el catálogo de los cuatro
  conceptos, con su etiqueta, su categoría de destino, su etiqueta de descripción, su ejemplo y
  su ENRUTADO (unión discriminada `egreso_administrativo` / `ajuste_manual`). Módulo puro: sin
  React y sin leer ningún reloj.
- `app/(app)/wallet/_components/RegistrarMovimientoCajaDialog.tsx` — ⟨D3⟩ el diálogo único.

**Modificados (producción)**
- `app/(app)/wallet/_components/WalletModule.tsx` — ⟨D4⟩ la barra de acciones pasa de dos hijos
  a uno, con el mismo `onRegistrado={() => void recargar(filtros, page)}`.

**Borrados (producción)**
- `app/(app)/wallet/_components/RegistrarMovimientoManualDialog.tsx` — ⟨D5⟩
- `app/(app)/wallet/_components/RegistrarEgresoAdministrativoDialog.tsx` — ⟨D5⟩

**Tests**
- NUEVO `tests/unit/components/wallet-conceptos-manuales.test.ts` — ⟨D2⟩ (7 casos)
- NUEVO `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` — ⟨D6⟩ (20 casos)
- BORRADO `tests/unit/components/wallet-registrar-egreso-dialog.test.tsx` — ⟨D6⟩, en el mismo
  commit que el nuevo, **con sus casos migrados** (tabla más abajo).
- MODIFICADO `tests/integration/wallet-page.test.tsx` — ⟨E2⟩ dos casos nuevos (R1/R2) + los
  mocks de actions ampliados. **Ninguna aserción existente se tocó**: los 10 casos previos
  siguen con su texto y sus expectativas intactas.

## Qué caso de los dos diálogos viejos fue a parar dónde (R29)

El archivo borrado tenía **CUATRO** casos, no tres: los tres que nombra R29 más el que le añadió
la ficha 85 (R25). Los cuatro sobreviven.

| caso del archivo borrado | dónde vive ahora | qué cambió |
| --- | --- | --- |
| «el selector de tipo ofrece SOLO {gasto variable, sueldo}, sin gasto fijo» | «el selector no ofrece «Gasto fijo»: ese lo emite el cron desde su plantilla (R11)» | el selector ofrece ahora CUATRO conceptos; la aserción que importa —`queryByRole("option", { name: "Gasto fijo" })` ausente— se conserva **literal** |
| «registra un gasto variable con el tipo, monto y descripción enviados» | «gasto variable: envía tipoEgreso=gasto_variable con el monto STRING exacto (R5/R15)» | **idéntico**: mismo `toEqual({ tipoEgreso: "gasto_variable", monto: "125.50", descripcion: "Suministros" })` |
| «al elegir Sueldo cambia el label y envía tipoEgreso=sueldo» | «sueldo: cambia la etiqueta de la descripción y envía tipoEgreso=sueldo (R6/R9)» | **idéntico**: mismo `toEqual({ tipoEgreso: "sueldo", monto: "800.00", descripcion: "Juan Pérez — julio 2026" })`, y sigue alcanzando la descripción por `getByLabelText("Trabajador y periodo")` |
| «no llama la action si el monto es 0 o la descripción está vacía» | «monto 0 y descripción vacía no llaman a ninguna action y pintan los dos mensajes (R13/R14)» | **idéntico**, y AMPLIADO: ahora comprueba que NINGUNA de las dos actions se llamó, no solo una |
| (ficha 85, R25) «el diálogo de egreso manual no ofrece periodicidad ni fecha de cobro» | «un movimiento no es periódico: no hay ciclo, ni unidad, ni día de primer cobro (85/R25)» | **ADAPTADO, con motivo escrito.** Aquel caso afirmaba que el diálogo tenía CERO controles `input[type="date"]`. El diálogo unificado tiene campo de fecha por diseño (R19), así que esa aserción concreta ya no puede sostenerse tal cual. Lo que el caso protegía —que un gasto variable o un sueldo NO son periódicos, que la periodicidad es de la PLANTILLA de gasto fijo y de nada más— se conserva entero: ni «Cada cuánto se cobra», ni «Unidad del ciclo», ni «Día del primer cobro», ni «Cada». Y la comprobación de fecha se ENDURECE en vez de retirarse: hay **exactamente un** control de fecha, y es el que responde a la etiqueta «Fecha», de modo que un control de fecha colado por la puerta de atrás sigue cayendo |

**El archivo borrado NO estaba citado por ninguna fila `R<n>` de ningún `specs/*/tasks.md` ni
`specs/*/design.md`.** `specs/85-gasto-fijo-periodicidad-ui/tasks.md:152` lo nombra, pero dentro
del **cuerpo de la task F7**, no en una fila de tabla de requisito, que es lo único que lee
`tests/unit/guards/test-citado-desaparecido.guardia.test.ts` (su `FILA_DE_REQUISITO`). La guardia
se corrió tras el borrado y quedó **verde**, así que no hizo falta ninguna anotación
`@test-desaparecido` — y no se tocó `specs/`.

## Decisiones de la interfaz que conviene tener escritas

1. **La fecha SOLO viaja si es distinta de hoy** (`fechaAEnviar()`). Es lo que hace que los dos
   casos migrados conserven su `toEqual` sin una clave de más, y sobre todo lo que cumple R23 con
   coste cero: sin la clave manda el `DEFAULT CURRENT_TIMESTAMP` y el movimiento del día en curso
   sigue encabezando el libro, byte a byte como antes de esta ficha.
2. **Los textos de rechazo de la fecha en el cliente son los del BORDE.** El diálogo llama a
   `problemaDeFechaMovimiento` (`lib/types/wallet.ts`) en vez de escribir su propia redacción, así
   que «Esa fecha no existe en el calendario.», «La fecha no puede ser posterior a hoy.» y «No se
   admiten movimientos anteriores al …» no pueden divergir entre las dos orillas.
3. **El `min` y el `max` del selector de fecha se congelan al ABRIR**, no se recalculan en cada
   render: leer el reloj durante el render haría que la ventana cambiara sola a medianoche debajo
   de una persona que está escribiendo. `max` = `fechaCalendarioCR()`, `min` =
   `primerDiaMovimientoAdmisible()` (la ventana de 30 días de `lib/config/wallet-movimiento.ts`).
4. **Voseo, y ninguna sigla.** «Elegí el concepto, el monto y la fecha», «No tenés permiso para
   registrar movimientos.», «Tu sesión expiró. Iniciá sesión de nuevo.», «Poné el día en que
   ocurrió». La línea de ayuda dice «Se registra en el libro como «Gasto variable».», con el
   nombre DERIVADO de `CATEGORIA_LABEL` (R4), no copiado.
5. **Money-safe (R15):** ninguna conversión a punto flotante en los dos archivos nuevos —
   comprobado por grep, y el comentario de cabecera está redactado para no contener ni siquiera
   el literal que se está prohibiendo.
6. **`vi.importActual` descartado en `wallet-page.test.tsx`.** El primer intento montaba el módulo
   real con `vi.importActual`; ahí las dependencias del módulo dejan de estar mockeadas y el panel
   de gastos fijos acabó **abriendo una conexión real contra Postgres** (`SASL:
   SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`). Se sustituyó por un stub
   CONMUTABLE (`vi.mock` con `importOriginal` + una bandera que los dos casos de R1/R2 ponen a
   `true`), que sí respeta los mocks del archivo. El resto de la suite sigue viendo el
   `wallet-module-stub` de siempre.

## Mapa `R<n> → test` de esta tanda, ejecutado

| R | test | estado |
| --- | --- | --- |
| R1 | `tests/integration/wallet-page.test.tsx` :: «la wallet ofrece un solo botón para registrar dinero» | verde |
| R2 | `tests/integration/wallet-page.test.tsx` :: «ya no hay un segundo botón de registro manual» | verde |
| R3 | `wallet-registrar-movimiento-dialog.test.tsx` :: «ofrece gasto variable, sueldo y los dos ajustes, y nada más» | verde |
| R4 | `wallet-registrar-movimiento-dialog.test.tsx` :: «la línea de ayuda sigue al concepto elegido» + `wallet-conceptos-manuales.test.ts` :: «el nombre del libro se DERIVA» | verde |
| R5 | `wallet-registrar-movimiento-dialog.test.tsx` :: «gasto variable: envía tipoEgreso=gasto_variable…» | verde |
| R6 | `wallet-registrar-movimiento-dialog.test.tsx` :: «sueldo: cambia la etiqueta de la descripción…» | verde |
| R7 | `wallet-registrar-movimiento-dialog.test.tsx` :: «ajuste que suma: envía tipo=ingreso y categoria=ingreso_ajuste» | verde |
| R8 | `wallet-registrar-movimiento-dialog.test.tsx` :: «ajuste que resta: envía tipo=egreso y categoria=egreso_ajuste» | verde |
| R9 | `wallet-conceptos-manuales.test.ts` :: «los cuatro tienen etiqueta…» + «las DOS etiquetas que ya existían se conservan byte a byte» | verde |
| R10 | `tests/integration/wallet-page.test.tsx` :: los 10 casos previos, sin tocar | verdes |
| R11 | `wallet-conceptos-manuales.test.ts` :: «ninguno mapea a egreso_gasto_fijo ni a ninguna otra categoría del SEED» + `wallet-registrar-movimiento-dialog.test.tsx` :: «el selector no ofrece «Gasto fijo»» | verde |
| R13 | `wallet-registrar-movimiento-dialog.test.tsx` :: «monto 0 y descripción vacía no llaman a ninguna action…» | verde |
| R14 | idem | verde |
| R15 | `wallet-registrar-movimiento-dialog.test.tsx` :: «…con el monto STRING exacto (R5/R15)» | verde |
| R18 | `wallet-registrar-movimiento-dialog.test.tsx` :: «llama a onRegistrado, refresca la ruta y cierra el diálogo» | verde |
| R19 | `wallet-registrar-movimiento-dialog.test.tsx` :: «la fecha arranca en el día de hoy de Costa Rica…» | verde |
| R20 | `wallet-registrar-movimiento-dialog.test.tsx` :: «una fecha del futuro se rechaza en el cliente, sin llamar a la action» | verde |
| R21 | `wallet-registrar-movimiento-dialog.test.tsx` :: «un día que no existe en el calendario se rechaza en el cliente» | verde |
| R22 | `wallet-registrar-movimiento-dialog.test.tsx` :: «si se elige un día anterior, la fecha viaja tal cual…» | verde |
| R23 | `wallet-registrar-movimiento-dialog.test.tsx` :: «si NO se toca la fecha, la clave fecha no viaja…» | verde |
| R29 | los cinco casos migrados de la tabla de arriba | verdes |
| R31 | `wallet-registrar-movimiento-dialog.test.tsx` :: «forbidden/unauthenticated → el aviso en voseo…» + «el título y la descripción del diálogo también hablan de vos» | verde |
| R32 | `wallet-registrar-movimiento-dialog.test.tsx` :: «concepto, monto, fecha y descripción tienen nombre accesible» + «el validation_error del borde con clave fecha se pinta bajo el campo de la fecha» | verde |

Nota sobre R19/R23: el día calendario de Costa Rica se calcula **dentro del test** (restando 6 h
al instante actual y quedándose con los 10 primeros caracteres del ISO), no se importa de
`lib/utils/fecha-cr.ts`. Comparar el componente contra la misma función que el componente usa
deja el caso siempre verde —precedente medido en este repo— y aquí lo que se quiere afirmar es el
DÍA, no la función.

## Salidas reales

### `pnpm typecheck`

```
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit

=== TYPECHECK EXIT=0 ===
```

(La primera corrida ya salió limpia: no hizo falta borrar `.next/dev`.)

### `pnpm lint`

```
✖ 127 problems (0 errors, 127 warnings)
```

**0 errores.** Ninguno de los 127 avisos cae en un archivo de esta tanda: comprobado filtrando la
salida por los cinco nombres tocados, que no devuelve ni una línea.

### `pnpm exec vitest related --run` sobre los archivos de producción tocados

```
$ pnpm exec vitest related --run \
    "app/(app)/wallet/_components/RegistrarMovimientoCajaDialog.tsx" \
    "app/(app)/wallet/_components/wallet-conceptos-manuales.ts" \
    "app/(app)/wallet/_components/WalletModule.tsx"

 Test Files  4 passed (4)
      Tests  50 passed (50)
   Duration  11.88s
```

### Corrida explícita, por nombre, de cada archivo de test creado o modificado

```
$ pnpm exec vitest run tests/unit/components/wallet-conceptos-manuales.test.ts \
    tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx \
    tests/integration/wallet-page.test.tsx

 Test Files  3 passed (3)
      Tests  39 passed (39)
   Duration  11.41s
```

Ni un solo rojo por timeout en esta tanda: los 20 casos del diálogo llevan su `15000` explícito
(el mismo que traía el archivo que sustituyen) y el más lento tardó 822 ms.

### Guardias del arnés relacionadas

```
$ pnpm exec vitest run tests/unit/guards/test-citado-desaparecido.guardia.test.ts \
    tests/unit/guards/plantilla-gasto-fijo-borrado.guardia.test.ts \
    tests/unit/guards/caja-173-alcance.guardia.test.ts

 Test Files  3 passed (3)
      Tests  70 passed (70)
```

## Mutaciones ejecutadas (con su salida ROJA)

### M1 — «que el diálogo mande siempre la fecha, aunque sea la de hoy»

`fechaAEnviar()` pasa de devolver `undefined` cuando la fecha es la de hoy a devolver siempre la
fecha elegida.

```
     × gasto variable: envía tipoEgreso=gasto_variable con el monto STRING exacto (R5/R15) 537ms
     × sueldo: cambia la etiqueta de la descripción y envía tipoEgreso=sueldo (R6/R9) 822ms
     × ajuste que suma: envía tipo=ingreso y categoria=ingreso_ajuste (R7) 720ms
     × ajuste que resta: envía tipo=egreso y categoria=egreso_ajuste (R8) 685ms
     × si NO se toca la fecha, la clave `fecha` no viaja… (R23) 376ms

AssertionError: expected { tipoEgreso: 'gasto_variable', …(3) } to deeply equal { tipoEgreso: 'gasto_variable', …(2) }
- Expected
+ Received
+   "fecha": "2026-08-29",

AssertionError: expected [ 'descripcion', 'fecha', …(2) ] to deeply equal [ Array(3) ]
- Expected
+ Received
+   "fecha",

 Test Files  1 failed (1)
      Tests  5 failed | 15 passed (20)
```

**Cinco casos rojos**, entre ellos los dos migrados con su `toEqual` intacto. Revertida.

### M2 — «que el selector ofrezca el gasto FIJO»

Se añade un quinto concepto al catálogo, con id `gasto_fijo`, etiqueta «Gasto fijo» y categoría
`egreso_gasto_fijo`.

```
     × el catálogo ofrece los cuatro conceptos del pedido y ninguno más 7ms
     × el conjunto de categorías destino es EXACTAMENTE las cuatro admitidas 2ms
     × ninguno mapea a `egreso_gasto_fijo` ni a ninguna otra categoría del SEED 1ms
     × ofrece gasto variable, sueldo y los dos ajustes, y nada más 392ms
     × el selector no ofrece «Gasto fijo»: ese lo emite el cron desde su plantilla (R11) 193ms
     × un movimiento no es periódico: no hay ciclo, ni unidad, ni día de primer cobro (85/R25) 177ms

AssertionError: expected [ Array(5) ] to have a length of 4 but got 5
AssertionError: expected [ 'egreso_ajuste', …(4) ] to deeply equal [ 'egreso_ajuste', …(3) ]
+   "egreso_gasto_fijo",
AssertionError: expected [ 'Gasto variable', 'Sueldo', …(3) ] to deeply equal [ 'Gasto variable', 'Sueldo', …(2) ]
+   "Gasto fijo",

 Test Files  2 failed (2)
      Tests  6 failed | 21 passed (27)
```

**Seis casos rojos** en los dos niveles: el catálogo (donde vive la regla) y el diálogo (donde se
ve). Revertida.

### M3 — «que vuelva el segundo botón de registro manual»

Se añade un segundo botón rotulado «Registrar egreso» en la barra de acciones de
`WalletModule.tsx`.

```
     × ya no hay un segundo botón de registro manual 83ms

 FAIL  tests/integration/wallet-page.test.tsx > … > ya no hay un segundo botón de registro manual
expected document not to contain element, found <button

 Test Files  1 failed (1)
      Tests  1 failed | 11 passed (12)
```

Revertida. Esta mutación es además la que prueba que el caso de E2 mide la pantalla REAL y no el
stub: con el stub montado, el botón añadido no habría existido en el documento y el caso habría
pasado en verde.

Las tres mutaciones se revirtieron copiando de vuelta el original guardado antes de mutar, y el
árbol quedó comprobado con `git status --short` (sin restos de la marca `MUTACION`).

## Rojo PREEXISTENTE, ajeno a esta tanda

`tests/unit/guards/superficie-de-uso.guardia.test.ts` falla con un solo infractor:

```
+   "lib/actions/tarifas.ts:67 obtenerTarifa",
```

**No lo causa esta ficha.** `obtenerTarifa` no tiene un solo importador de producción en todo el
árbol (solo `tests/integration/actions/tarifas-action.test.ts`), y ninguno de los dos diálogos
borrados menciona la palabra «tarifa» —verificado sobre los blobs de `HEAD`, no sobre el árbol
local—. La action llegó en `b7bd887a` (2026-08-24, feature 273), que **ya estaba en `origin/dev`
(`b776d0da`)**, la base de esta rama; comprobado con `git merge-base --is-ancestor`. Queda para el
leader: o se le devuelve superficie, o se anota `@sin-superficie` junto al export. Se avisa aquí
porque `./init.sh` completo —el cierre de esta ficha— lo va a encontrar.

## Lo que queda pendiente de esta tanda

- **E1** ya lo dejó hecho el backend; **E3** (gate completo) y **E4** (bitácora final + PR) son
  del leader.
- El `min` del selector de fecha se calcula en el NAVEGADOR con `primerDiaMovimientoAdmisible()`,
  que lee `WALLET_MOVIMIENTO_DIAS_HACIA_ATRAS` de `process.env`. En el bundle de cliente esa
  variable no es `NEXT_PUBLIC_*`, así que el navegador usa siempre el **fallback de 30 días**. Si
  algún día se configura otro valor por entorno, el tope visual del selector y el del borde
  podrían discrepar; el borde manda y responde `validation_error` con su texto, que el diálogo
  pinta bajo el campo, así que **no hay agujero de validación** — pero la pista visual quedaría
  corrida. Se anota y no se arregla aquí: tocaría `lib/`, que está fuera de esta tanda.
