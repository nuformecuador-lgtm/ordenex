# Ficha 85 — bitácora de implementación · FASE B (backend), T0.2 + B1..B9

> Rama `feature/85-gasto-fijo-periodicidad-ui`. Alcance de esta bitácora: **solo la fase B**.
> La fase F (frontend) la escribe otro agente y añadirá sus tareas y su mapa `R13-R25 → test`
> a este mismo archivo. Nada de `app/`, `components/`, `db/` ni `specs/` se ha tocado aquí.
>
> Herramienta de búsqueda: el MCP `codebase-memory` **no** estaba disponible en este agente
> (no aparece en su conjunto de tools), así que la localización de símbolos se hizo con
> `grep`/`sed` sobre el árbol real. Se declara explícitamente, como pide la regla 7 de
> `CLAUDE.md`. Efecto práctico nulo en este caso: T0.2 exige de todos modos confirmar en el
> archivo, no en el índice.

---

## T0.2 — los tres símbolos, confirmados en el árbol real

Confirmados leyendo el archivo (no el grafo), el 2026-08-29:

| Símbolo | Archivo : línea (antes de tocar nada) | Cómo se confirmó |
| --- | --- | --- |
| `periodicidadFields` | `lib/types/gasto-fijo-plantilla.ts:36` | `cat -n`; declaraba los tres campos con `.default("meses")` (:37), `.default(1)` (:38) y `.default(() => fechaCalendarioCR())` (:44), heredados por `actualizarGastoFijoPlantillaSchema` (:58) vía `.extend()` |
| `aplicaHoy` / `periodoDe` | `lib/utils/periodicidad.ts:66` y `lib/utils/periodicidad.ts:104` | `cat -n`; ambas puras, con `now` inyectado, sobre `startOfDayCR` y con clamping de fin de mes en la rama `meses` (:81) |
| Columnas del ciclo | `db/schema.prisma:1841` (`periodicidadUnidad`), `:1842` (`periodicidadCantidad`), `:1843` (`fechaCobro @db.Date`), dentro de `model GastoFijoPlantilla` (`:1836`), con `enum PeriodicidadUnidad` en `:1807` | `grep -n` sobre `db/schema.prisma` |

Los tres siguen existiendo. **`db/schema.prisma` no se modifica en esta ficha** (design §1).

---

## Qué se hizo en cada tarea

### B1 — borde de `actualizar` sin defaults (`lib/types/gasto-fijo-plantilla.ts`)

El corazón de la ficha. `periodicidadFields` (un fragmento con defaults compartido por crear y
actualizar) se parte en **una** declaración de reglas de campo y **dos** aplicaciones:

- `periodicidadUnidadSchema`, `periodicidadCantidadSchema`, `fechaCobroSchema` — las reglas,
  escritas una sola vez, para que crear y actualizar no puedan divergir en *la regla*.
- `periodicidadConDefault` — lo que usa **crear**: `meses` / `1` / `fechaCalendarioCR()`.
  **Se conserva a propósito** (R4, design §2.3): crear no pisa ningún valor previo.
- `periodicidadRequerida` — lo que usa **actualizar**: los tres campos **sin `.default()` y sin
  `.optional()`**, aplicados con `.extend()` sobre el schema de crear, que así pisa los heredados.

`fechaCobroSchema` gana `.refine(esFechaCalendarioValida, …)` (R5): el regex mide la FORMA y
`2026-02-31` la cumple, pero `new Date("2026-02-31T00:00:00.000Z")` **rueda al 3 de marzo** sin
error. Se importa `esFechaCalendarioValida` de `lib/utils/fecha-cr.ts` (la pieza que el repo ya
usa para esto); no se escribe ninguna comprobación nueva.

**Comentario de cabecera actualizado**, como pedía la tarea: el bloque afirmaba que la UI
«todavía NO envía periodicidad ni fecha de cobro», y con la 85 deja de ser cierto. El texto nuevo
explica la asimetría crear/actualizar, nombra el fallo que se cierra (la edición de
`{id, concepto, monto}` que reescribía el ciclo y movía el ancla en silencio) y su consecuencia
grave (el cambio de formato del periodo de la clave de idempotencia, `YYYY-MM` ↔ `YYYY-MM-DD`,
que es el escenario de doble cobro documentado en `GeneracionGastosFijosService`).

*No se tocó*: servicio, repositorio, interfaces, migraciones. El `ActualizarPlantillaInput` del
repositorio ya exigía los tres campos: lo que estaba roto no era el escritor, era el contrato que
le entregaba valores inventados.

### B2 — `proximoCobro` puro (`lib/utils/periodicidad.ts`)

`export function proximoCobro(plantilla: PlantillaPeriodica, now: Date): string`, junto a sus dos
hermanas y con su misma convención (reloj inyectado, aritmética en la escala «medianoche UTC del
día calendario CR»). Devuelve `YYYY-MM-DD`.

Reutiliza `startOfDayCR`, `fechaADiaUTC`, `diffEnDias`, `diffEnMeses` y `ultimoDiaDelMes`, que ya
vivían en el módulo. Añade dos helpers privados: `aFechaCalendario` (Date → `YYYY-MM-DD`, con la
misma construcción manual que `periodoDe`) y `cobroDelMes` (el cobro a N meses del ancla, con el
clamping de fin de mes). El módulo sigue importando **solo** de `lib/utils/fecha-cr`.

**Una decisión que el design no cubría, y se declara aquí:** con `periodicidadCantidad` inválida
(0, negativa o decimal) el paso sería 0, `k` sería `Infinity` y la función emitiría un
`Invalid Date` **como si fuera una fecha** —justo la familia de fallo mudo que esta ficha cierra—.
Para esa plantilla `aplicaHoy` es `false` SIEMPRE, así que no existe «próximo cobro» que devolver:
se lanza un `RangeError` con contexto en lugar de mentir. Es una defensa inalcanzable mientras el
`CHECK >= 1` de la DB se cumpla (mismo estatus que la defensa equivalente de `aplicaHoy:72`), y
lleva su propio caso de test.

### B3 — tests del borde (`tests/unit/types/gasto-fijo-plantilla-schema.test.ts`, nuevo)

9 casos. R4 con `vi.setSystemTime(new Date("2026-03-15T18:00:00.000Z"))` y el literal
`"2026-03-15"` esperado (**nunca** comparado contra `fechaCalendarioCR()`); R5 (`2026-02-31`
rechazada al crear y al actualizar, más el 29/feb de 2028 aceptado y el de 2026 rechazado); R6
(cantidad `0`, cantidad `1.5`, unidad `"anual"`). Añade además el caso de R1 a nivel de schema
—el criterio de «hecho cuando» de B1— con el reloj congelado a propósito: si `fechaCobro` volviera
a heredar su default, ese `safeParse` pasaría devolviendo `"2026-03-15"` en vez de fallar.

### B4 — test de la acción (`tests/unit/actions/gasto-fijo-plantilla-actions.test.ts`)

- **(a) Caso nuevo R1**, la guardia principal del backend: `actualizarPlantillaAction({id, concepto, monto})`
  → `status: "validation_error"` con `fieldErrors.periodicidadUnidad`, `.periodicidadCantidad` y
  `.fechaCobro` presentes, y `service.actualizarPlantilla` **no** llamado.
- **(b)** Arreglado el caso existente «not_found se propaga desde el service»: se le completa el
  payload con el ciclo, porque a partir de B1 moriría antes en el borde.
- Dos casos más, y el motivo por el que se añaden: el caso «id no-uuid → validation_error»
  mandaba un payload corto, así que a partir de B1 **pasaría por el motivo equivocado**; se le
  completa el ciclo y se asevera `fieldErrors.id` para que siga probando lo que su nombre dice.
  Y un caso de contraparte que fija con **literales** que un payload completo llega al servicio
  TAL CUAL (`semanas`/`2`/`2026-03-31`), sin spread de la constante ni comparación contra los
  defaults.
- Constante `CICLO_VIGENTE = { semanas, 2, 2026-03-31 }`: ninguno de los tres coincide con los
  defaults del schema de crear, así que ningún caso puede pasar por culpa de un default.

### B5 — persistencia del ciclo en el servicio (R2)

`tests/unit/services/gasto-fijo-plantilla-service.test.ts`: doble de repositorio **con estado**
(`repoConEstado`) que escribe como escribe `GastoFijoPlantillaRepository.actualizar` (los cinco
campos, sin condición), de modo que la fila inspeccionada al final es la que habría quedado en la
tabla. Se siembra `semanas`/`2`/`2026-03-31`, se actualiza con ese mismo ciclo y `monto: "999.00"`,
y se comprueba **con literales** que la fila guardada sigue en `semanas`, `2`, `2026-03-31` y que
el monto es `"999.00"`. Un segundo caso fija la contraparte: cambiar el ciclo **a propósito** sí lo
mueve (la ficha no congela el ciclo; cierra el reset **mudo**).

### B6 — tests de `proximoCobro` (`tests/unit/utils/periodicidad-proximo-cobro.test.ts`, nuevo)

12 casos, R7-R12. Las cuatro periodicidades del pedido con fechas literales, más `cada 3 días` y
`cada 6 meses`; antes del ancla → el ancla (R8); hoy dispara → hoy (R9); ancla 31 → `2026-02-28`,
`2028-02-29`, `2026-04-30` (R10); dos instantes del mismo día CR (`06:00Z` y `23:00Z`) con el
reloj del proceso puesto en 2030 a propósito (R12); y el caso de la defensa de cantidad inválida.

**Barrido diferencial (R11):** 10 plantillas × 400 días = **4.000 días evaluados**, contrastando
`proximoCobro` contra `aplicaHoy`, que es una implementación independiente de la misma regla. Por
cada día se comprueba que la fecha devuelta no mira hacia atrás, que **cobra** según `aplicaHoy`,
y que **ningún** día entre hoy (incluido) y esa fecha (excluida) cobra. El número de días
evaluados se asevera (`expect(diasEvaluados).toBe(400 * 10)`) para que un bucle vacío no pueda
reportar verde.

---

## B7 — autocomprobación de las guardias (EJECUTADA, con la salida roja real)

Las tres mutaciones se aplicaron al árbol, **se corrieron los tests** y se revirtieron por copia
de respaldo (no con `git checkout`: este agente tiene prohibido escribir con git). Comprobación de
la reversión al final, por `md5sum` contra la copia previa a mutar: los tres archivos coinciden
byte a byte, y `git diff --exit-code -- lib/services/GastoFijoPlantillaService.ts` sale 0.

### Hallazgo previo, que corrige el enunciado de la tarea

`tasks.md` pide que la mutación del **borde** ponga rojos «B4(a) **y B5**». **B5 no puede
enrojecer por una mutación del schema**, y no es un defecto del test: B5 es un test de *servicio*
y vive por debajo del borde —invoca `svc.actualizarPlantilla(...)` con un input ya construido, sin
pasar por zod—. La comprobación se ejecutó igual y lo confirma (abajo, M1: B5 queda verde). Por eso
B7 se hizo con **tres** mutaciones y no dos: cada guardia se muta donde de verdad guarda.

### M1 — devolver los defaults al borde de `actualizar`

Mutación: se elimina `...periodicidadRequerida,` del `.extend()`, con lo que
`actualizarGastoFijoPlantillaSchema` vuelve a heredar `.default("meses")`/`.default(1)`/
`.default(() => fechaCalendarioCR())` de `crear` — exactamente el código pre-85.

```
 ❯ tests/unit/types/gasto-fijo-plantilla-schema.test.ts (9 tests | 1 failed) 17ms
     × actualizar sin periodicidad falla nombrando los tres campos, sin inventar ningun default 6ms
 ❯ tests/unit/actions/gasto-fijo-plantilla-actions.test.ts (17 tests | 1 failed) 17ms
     × actualizar sin periodicidad devuelve validation_error en los tres campos y no llama al servicio 5ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/unit/actions/gasto-fijo-plantilla-actions.test.ts > actualizarPlantillaAction (R18/R25) > actualizar sin periodicidad devuelve validation_error en los tres campos y no llama al servicio
AssertionError: expected 'ok' to be 'validation_error' // Object.is equality

Expected: "validation_error"
Received: "ok"

 ❯ tests/unit/actions/gasto-fijo-plantilla-actions.test.ts:167:22

 FAIL  tests/unit/types/gasto-fijo-plantilla-schema.test.ts > actualizarGastoFijoPlantillaSchema — el ciclo es OBLIGATORIO (R1) > actualizar sin periodicidad falla nombrando los tres campos, sin inventar ningun default
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ tests/unit/types/gasto-fijo-plantilla-schema.test.ts:77:23

 Test Files  2 failed | 1 passed (3)
      Tests  2 failed | 41 passed (43)
```

El `Received: "ok"` es literalmente el fallo que la ficha cierra: la acción **aceptaba** la
edición incompleta. Y el «1 passed» del tercer archivo es B5, verde bajo esta mutación: la prueba
del hallazgo de arriba.

### M2 — que el SERVICIO reinvente el ciclo (la mutación que B5 sí guarda)

Mutación en `GastoFijoPlantillaService.actualizarPlantilla`: en lugar de reenviar
`input.periodicidadUnidad` / `input.periodicidadCantidad` / `input.fechaCobro` al repositorio,
escribe `"meses"` / `1` / `"2026-08-29"` (el reset silencioso, un piso más abajo).

```
 ❯ tests/unit/services/gasto-fijo-plantilla-service.test.ts (17 tests | 3 failed) 17ms
     × R25: maestro -> edita concepto/monto 6ms
     × editar el monto no mueve el ciclo: el repositorio recibe semanas/2/2026-03-31 2ms
     × cambiar el ciclo A PROPOSITO si lo mueve (la ficha no congela el ciclo, cierra el reset mudo) 1ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/unit/services/gasto-fijo-plantilla-service.test.ts > GastoFijoPlantillaService.actualizarPlantilla — persistencia del ciclo (R2, feature 85) > editar el monto no mueve el ciclo: el repositorio recibe semanas/2/2026-03-31
AssertionError: expected 'meses' to be 'semanas' // Object.is equality

Expected: "semanas"
Received: "meses"

 ❯ tests/unit/services/gasto-fijo-plantilla-service.test.ts:260:37

 FAIL  tests/unit/services/gasto-fijo-plantilla-service.test.ts > GastoFijoPlantillaService.actualizarPlantilla — persistencia del ciclo (R2, feature 85) > cambiar el ciclo A PROPOSITO si lo mueve (la ficha no congela el ciclo, cierra el reset mudo)
AssertionError: expected '2026-08-29' to be '2026-04-01' // Object.is equality

Expected: "2026-04-01"
Received: "2026-08-29"

 ❯ tests/unit/services/gasto-fijo-plantilla-service.test.ts:300:29

 Test Files  1 failed (1)
      Tests  3 failed | 14 passed (17)
```

`expected 'meses' to be 'semanas'` sobre la **fila guardada**: el doble con estado ve el reset.

### M3 — `proximoCobro` devuelve siempre el ancla

Mutación: `if (hoy.getTime() <= ancla.getTime())` → `if (true)`.

```
 ❯ tests/unit/utils/periodicidad-proximo-cobro.test.ts (12 tests | 10 failed) 29ms
     × devuelve la primera fecha en que la plantilla cobra, para las cuatro periodicidades del pedido 6ms
     × tambien resuelve ciclos que no son preset: cada 3 dias y cada 6 meses 1ms
     × si hoy cobra, el proximo cobro es hoy 0ms
     × ancla 31: el proximo cobro cae 28/feb, 29/feb en bisiesto y 30/abr 1ms
     × NO se saltea febrero: el dia clampeado ES el cobro, y el mes siguiente vuelve al 31 0ms
     × anclas 29 y 30 tambien se clampean en febrero 0ms
     × coincide con aplicaHoy: la fecha devuelta cobra y ningun dia anterior desde hoy cobra (barrido de 400 dias) 15ms
     × con dos instantes distintos del mismo dia CR devuelve lo mismo, y no usa el reloj del sistema 2ms
     × no toca ninguna dependencia externa: mismo resultado llamado dos veces 0ms
     × falla fuerte y con contexto en vez de emitir una fecha invalida 1ms

 FAIL  tests/unit/utils/periodicidad-proximo-cobro.test.ts > proximoCobro — las cuatro periodicidades del pedido (R7) > devuelve la primera fecha en que la plantilla cobra, para las cuatro periodicidades del pedido
AssertionError: expected '2026-09-01' to be '2026-09-14' // Object.is equality

Expected: "2026-09-14"
Received: "2026-09-01"

 ❯ tests/unit/utils/periodicidad-proximo-cobro.test.ts:47:7

 FAIL  tests/unit/utils/periodicidad-proximo-cobro.test.ts > proximoCobro — barrido diferencial contra aplicaHoy (R11) > coincide con aplicaHoy: la fecha devuelta cobra y ningun dia anterior desde hoy cobra (barrido de 400 dias)
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ tests/unit/utils/periodicidad-proximo-cobro.test.ts:226:34
```

10 de 12 rojos, y el barrido diferencial entre ellos.

### Reversión comprobada

```
=== md5 vs backup (deben coincidir los 3) ===
17a54be7a7de99e929d7900f1ab73f6c *lib/types/gasto-fijo-plantilla.ts
7d1693e510f660b617be35fb22d307df *lib/utils/periodicidad.ts
1e8c3941194cc42fa3cdaccb48172094 *lib/services/GastoFijoPlantillaService.ts
17a54be7a7de99e929d7900f1ab73f6c *…/scratchpad/b7/gasto-fijo-plantilla.ts.bak
7d1693e510f660b617be35fb22d307df *…/scratchpad/b7/periodicidad.ts.bak
1e8c3941194cc42fa3cdaccb48172094 *…/scratchpad/b7/GastoFijoPlantillaService.ts.bak
=== rastros de mutacion en el arbol (grep "if (true)" / 'periodicidadUnidad: "meses"') ===
(vacio)
=== servicio SIN cambios? ===
GastoFijoPlantillaService.ts: sin cambios (exit 0)
```

---

## B8 — corrida acotada del backend (salidas reales)

### `pnpm typecheck`

```
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit

TYPECHECK_EXIT=0
```

Sin errores. No hizo falta borrar `.next/dev` (el modo de fallo conocido no se presentó).

### `pnpm lint`

```
✖ 126 problems (0 errors, 126 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

LINT_EXIT=0
```

**0 errores.** Los 126 warnings son preexistentes (`no-unused-vars` sobre parámetros `_algo` en
tests de toda la suite); filtrando la salida por `gasto-fijo-plantilla` y `periodicidad` no aparece
ninguno, es decir **ninguno cae en los archivos de esta ficha**.

### `pnpm exec vitest related --run lib/types/gasto-fijo-plantilla.ts lib/utils/periodicidad.ts`

```
 RUN  v4.1.10 R:/job/singularis/projects/ordenex

 Test Files  14 passed (14)
      Tests  130 passed (130)
   Start at  14:16:21
   Duration  30.39s (transform 2.65s, setup 1.28s, import 65.19s, tests 20.82s, environment 10.92s)

VITEST_EXIT=0
```

Los 14 archivos que el grafo de módulos relaciona:

```
tests/components/descarga/WalletDescarga.test.tsx
tests/components/descarga/WalletPropsDescarga.test.tsx
tests/components/paginacion/BajoRiesgoPaginacion.test.tsx
tests/integration/actions/generar-gastos-fijos-route.test.ts
tests/integration/db/generacion-gastos-fijos.test.ts
tests/integration/wallet-page.test.tsx
tests/unit/actions/gasto-fijo-plantilla-actions.test.ts
tests/unit/actions/wallet-listados-descarga-action.test.ts
tests/unit/components/wallet-gastos-fijos-panel.test.tsx
tests/unit/services/gasto-fijo-plantillas-paginado.test.ts
tests/unit/services/generacion-gastos-fijos-service.test.ts
tests/unit/types/gasto-fijo-plantilla-schema.test.ts
tests/unit/utils/periodicidad-proximo-cobro.test.ts
tests/unit/utils/periodicidad.test.ts
```

**Aviso para quien lea esta lista:** `tests/unit/services/gasto-fijo-plantilla-service.test.ts`
—donde vive B5— **no** aparece, porque importa los tipos con `import type` y esa arista se borra
al transpilar, así que `vitest related` no la ve. Se corrió aparte, junto con las otras cuatro
directamente tocadas:

```
 RUN  v4.1.10 R:/job/singularis/projects/ordenex

 Test Files  5 passed (5)
      Tests  72 passed (72)
   Start at  14:18:22
   Duration  3.48s (transform 390ms, setup 242ms, import 1.05s, tests 3.10s, environment 0ms)
```

(archivos: `gasto-fijo-plantilla-service`, `gasto-fijo-plantilla-schema`,
`periodicidad-proximo-cobro`, `periodicidad`, `gasto-fijo-plantilla-actions`).

---

## B9 — comprobación de alcance

Como los cambios de esta fase están **sin commitear** (el commit lo hace el leader),
`git diff --name-only origin/dev...HEAD` solo muestra los specs ya commiteados; la comprobación
de alcance se hace sobre la unión de eso y el árbol de trabajo:

```
=== arbol de trabajo (git status --porcelain) ===
 M lib/types/gasto-fijo-plantilla.ts
 M lib/utils/periodicidad.ts
 M tests/unit/actions/gasto-fijo-plantilla-actions.test.ts
 M tests/unit/services/gasto-fijo-plantilla-service.test.ts
?? tests/unit/types/gasto-fijo-plantilla-schema.test.ts
?? tests/unit/utils/periodicidad-proximo-cobro.test.ts

=== prohibidos (db/migrations/, db/schema.prisma, vercel.json,
    GeneracionGastosFijosService.ts, GastoFijoPlantillaRepository.ts) ===
OK: ningun archivo prohibido tocado
```

Tampoco se tocó `app/`, `components/`, `feature_list.json`, `progress/current.md` ni nada bajo
`specs/`.

---

## Archivos creados / modificados (fase B)

**Producción (2, ambos ya existentes):**
- `lib/types/gasto-fijo-plantilla.ts` — B1.
- `lib/utils/periodicidad.ts` — B2 (`proximoCobro` + dos helpers privados).

**Tests (4: 2 nuevos, 2 modificados):**
- `tests/unit/types/gasto-fijo-plantilla-schema.test.ts` — **nuevo** (B3, 9 casos).
- `tests/unit/utils/periodicidad-proximo-cobro.test.ts` — **nuevo** (B6, 12 casos).
- `tests/unit/actions/gasto-fijo-plantilla-actions.test.ts` — B4 (3 casos nuevos, 2 arreglados).
- `tests/unit/services/gasto-fijo-plantilla-service.test.ts` — B5 (2 casos nuevos + 1 import).

---

## Mapa `R<n> → test` — lo que cubre la fase B

| R | Test (archivo :: nombre) | Estado |
| --- | --- | --- |
| R1 | `tests/unit/actions/gasto-fijo-plantilla-actions.test.ts` :: «actualizar sin periodicidad devuelve validation_error en los tres campos y no llama al servicio» (+ el gemelo a nivel de schema en `tests/unit/types/gasto-fijo-plantilla-schema.test.ts` :: «actualizar sin periodicidad falla nombrando los tres campos, sin inventar ningun default») | ✅ verde; rojo bajo M1 |
| R2 | `tests/unit/services/gasto-fijo-plantilla-service.test.ts` :: «editar el monto no mueve el ciclo: el repositorio recibe semanas/2/2026-03-31» | ✅ verde; rojo bajo M2 |
| R4 | `tests/unit/types/gasto-fijo-plantilla-schema.test.ts` :: «crear sin periodicidad aplica meses/1 y la fecha CR del dia (reloj congelado en 2026-03-15)» | ✅ verde |
| R5 | `tests/unit/types/gasto-fijo-plantilla-schema.test.ts` :: «rechaza 2026-02-31 al crear y al actualizar aunque cumpla el formato» | ✅ verde |
| R6 | `tests/unit/types/gasto-fijo-plantilla-schema.test.ts` :: «rechaza cantidad 0, cantidad decimal y unidad desconocida» | ✅ verde |
| R7 | `tests/unit/utils/periodicidad-proximo-cobro.test.ts` :: «devuelve la primera fecha en que la plantilla cobra, para las cuatro periodicidades del pedido» | ✅ verde; rojo bajo M3 |
| R8 | idem :: «antes del ancla el proximo cobro es el ancla» | ✅ verde |
| R9 | idem :: «si hoy cobra, el proximo cobro es hoy» | ✅ verde; rojo bajo M3 |
| R10 | idem :: «ancla 31: el proximo cobro cae 28/feb, 29/feb en bisiesto y 30/abr» | ✅ verde; rojo bajo M3 |
| R11 | idem :: «coincide con aplicaHoy: la fecha devuelta cobra y ningun dia anterior desde hoy cobra (barrido de 400 dias)» | ✅ verde; rojo bajo M3 |
| R12 | idem :: «con dos instantes distintos del mismo dia CR devuelve lo mismo, y no usa el reloj del sistema» | ✅ verde; rojo bajo M3 |

**R3 y R13-R25 son de la fase F** (frontend) y **siguen sin cubrir** al cerrar esta fase. R3 —la
guardia principal de la ficha, «editar solo el monto reenvía semanas/2/2026-03-31 sin moverlos»—
vive en el test del diálogo y depende de F2. Mientras no exista, el fallo está cerrado en el borde
(una edición incompleta ya no pasa) pero **el diálogo sigue mandando `{id, concepto, monto}` y por
tanto está roto**: hasta F2, editar una plantilla desde la UI devolverá `validation_error`. Es la
razón por la que la ficha es `fullstack` y se secuencia backend → frontend en la misma rama; no se
puede desplegar la fase B sola.

---

## Lo que el frontend hereda de esta fase

1. `proximoCobro(plantilla: PlantillaPeriodica, now: Date): string` se exporta desde
   `lib/utils/periodicidad.ts` y devuelve `YYYY-MM-DD`. Recibe el instante **por parámetro**
   (R23): no lee ningún reloj. `PlantillaPeriodica` es el subconjunto
   `{periodicidadUnidad, periodicidadCantidad, fechaCobro}`, así que un `GastoFijoPlantillaDTO`
   entra tal cual. **No sabe si la plantilla está activa** (design §3.4): «No se cobra» es
   decisión de `proximoCobroTexto` en las etiquetas (F1), no de la aritmética.
2. `actualizarPlantillaAction` exige ahora `periodicidadUnidad`, `periodicidadCantidad` y
   `fechaCobro`, los tres. Sin ellos devuelve
   `{ status: "validation_error", fieldErrors: { periodicidadUnidad: [...], periodicidadCantidad: [...], fechaCobro: [...] } }`
   —`fieldErrors` es `Record<string, string[]>`, con la clave **exacta** del campo— y el servicio
   no se llega a invocar. `crearPlantillaAction` **conserva** sus defaults (`meses`/`1`/hoy-CR).
3. Mensajes que el borde puede devolver, para que F2 los pinte junto al campo: «La cantidad debe
   ser al menos 1.», «La fecha de cobro debe tener el formato YYYY-MM-DD.» y «La fecha de cobro no
   existe en el calendario.».
4. Money-safe intacto: `monto` es STRING de punta a punta. `periodicidadCantidad` **no es dinero**
   —es un contador— y viaja como entero.

---

## Veredicto

Fase B completa (T0.2 + B1..B9): el reset silencioso del ciclo está cerrado en el borde,
`proximoCobro` existe y está contrastado contra `aplicaHoy` en 4.000 días, typecheck y lint en
verde, y las tres guardias se comprobaron enrojeciendo de verdad —no declarándolo—.
