# Ficha 332 — Eliminar plantillas de gasto fijo · bitácora del BACKEND (T0–T13)

> Agente: `backend_dev`. Alcance: **T0 a T13** de `specs/332-eliminar-plantilla-gasto-fijo/tasks.md`.
> **T14–T18 (frontend + apéndice en `specs/45`), T19 (guardia), T20–T22 (gate, cierre y repaso a
> mano) NO son de esta bitácora** y quedan abiertas. Fecha: 2026-08-29.
> Rama: `feature/332-eliminar-plantilla-gasto-fijo` (ya existía, nacida de `origin/dev` `48d40398`).

---

## 0. Lo que se decidió antes de escribir una línea

- **Quién puede borrar: `esAccesoTotal` (maestro + admin)**, igual que crear, editar y activar.
  Es la pregunta abierta 2 de `requirements.md`, resuelta por el leader: la decisión humana de
  «sólo maestro» era para APROBAR COBROS (ficha 333). Este CRUD no gana una asimetría que nadie
  pidió. Hay un caso explícito que lo fija (`admin -> ok`, paridad de la feature 94).
- **La ficha 85 ya está mergeada** en esta rama: las columnas de periodicidad/próximo cobro y el
  schema de ACTUALIZAR sin defaults son el estado correcto y no se tocaron. El conflicto que
  advertía `tasks.md` (riesgo R-2) **ya no existe**.
- **`db/migrations/**` NO se tocó** (R24). Ver §5.

---

## 1. Tarea por tarea

### T0 — Lectura del terreno y línea base
La rama ya existía, así que **la parte de `git` de T0 se saltó a propósito** (instrucción del
leader). Lo demás sí: se leyeron enteros `GastoFijoPlantillaService.ts`,
`GastoFijoPlantillaRepository.ts`, las dos interfaces, `lib/actions/gasto-fijo-plantilla.ts`,
`lib/types/gasto-fijo-plantilla.ts` y el panel, más `docs/architecture.md` y `docs/conventions.md`.

**Línea base, ANTES de tocar nada:**

```
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit

TYPECHECK_EXIT=0
```

`git status` limpio. La base venía verde: cualquier rojo posterior es mío.

### T1 — `eliminar` en el contrato del repositorio · R2/R22
`lib/interfaces/repositories/IGastoFijoPlantillaRepository.ts`:
- La cabecera («NO expone `delete` (R25)») se sustituyó por **la nota larga de la revocación**, que
  es donde vive completa: palabra **revoca**, fecha **2026-08-29**, **motivo** (la tabla acumula
  ruido; el histórico no depende de la plantilla: sin FK, referencia derivada, la descripción del
  movimiento ya lleva concepto y periodo) y **puntero** `specs/332-eliminar-plantilla-gasto-fijo`.
  Conserva verbatim, entre comillas, lo que la cabecera decía hasta esa fecha.
- Se añadió `eliminar(id: string): Promise<boolean>` con su docstring (por qué `deleteMany` y no
  `delete`; R3 y R8).
- Se reescribió la nota de `setActiva` («sin borrado») explicando que pausar y eliminar son dos
  intenciones distintas y que las dos existen (R11).

**Señal esperada, obtenida:** el typecheck marcó el repositorio concreto como incompleto
(`TS2420: Property 'eliminar' is missing in type 'GastoFijoPlantillaRepository'`), más los cuatro
dobles literales de la interfaz. Ese rojo ES la prueba de que el contrato cambió.

### T2 — Implementación en el repositorio · R2/R3/R8
`lib/repositories/GastoFijoPlantillaRepository.ts`:

```
const res = await this.prisma.gastoFijoPlantilla.deleteMany({ where: { id } });
return res.count > 0;
```

- `PlantillaPrismaClient = Pick<PrismaClient, "gastoFijoPlantilla">` **NO se ensanchó**: es lo que
  hace estructuralmente imposible tocar el libro (R8).
- Notas de la clase y de `setActiva` reescritas con el puntero y la fecha.

### T3 — El `WHERE` probado donde vive · R3/R8 · **la tarea que de verdad prueba algo**
Nuevo `tests/unit/repositories/gasto-fijo-plantilla-eliminar.test.ts`, 4 casos:
(a) literal `{ where: { id } }` + desmontado clave a clave; (a-bis) con DOS filas en una tienda en
memoria que **aplica** el filtro, la otra plantilla sigue viva; (b) `count 0 -> false` sin lanzar;
(c) un `Proxy` de cliente Prisma que **revienta ante cualquier modelo que no sea
`gastoFijoPlantilla`**, con autocomprobación del propio detector (se le exige lanzar ante
`walletMovimiento` antes de creerle el verde).

**La mutación, ejecutada — no supuesta.** `{ where: { id } }` → `{}`:

```
 ❯ tests/unit/repositories/gasto-fijo-plantilla-eliminar.test.ts (4 tests | 3 failed) 13ms
     × (a) filtra por el id EXACTO y por ninguna otra columna 8ms
     × (a-bis) R3: borra EXACTAMENTE esa fila; la otra plantilla sigue en la tabla 1ms
     × (b) la fila ya no existia (count 0) -> false, sin lanzar 1ms

 FAIL  ... > (a) filtra por el id EXACTO y por ninguna otra columna
AssertionError: expected "vi.fn()" to be called with arguments: [ Array(1) ]
Received:
  1st vi.fn() call:
  [
-   {
-     "where": {
-       "id": "11111111-1111-4111-8111-111111111111",
-     },
-   },
+   {},
  ]

 FAIL  ... > (a-bis) R3: borra EXACTAMENTE esa fila; la otra plantilla sigue en la tabla
AssertionError: expected [] to deeply equal [ Array(1) ]
- Expected
+ Received
- [
-   "22222222-2222-4222-8222-222222222222",
- ]
+ []

 FAIL  ... > (b) la fila ya no existia (count 0) -> false, sin lanzar
AssertionError: expected "vi.fn()" to be called with arguments: [ Array(1) ]

 Test Files  1 failed (1)
      Tests  3 failed | 1 passed (4)
```

Archivo restaurado desde copia y vuelto a verde (4/4). El `where` del repositorio quedó
byte-idéntico al original: `git diff` no muestra cambio en esa línea más allá del método nuevo.

### T4 — Schema de borde · R6
`lib/types/gasto-fijo-plantilla.ts`: `eliminarPlantillaSchema = z.object({ id: z.string().uuid() }).strict()`
+ `EliminarPlantillaInput`. `.strict()` con su motivo escrito: en una operación irreversible,
aceptar en silencio una clave que nadie lee es la forma barata de que el llamador crea que pidió
algo que no pidió. Nota de la línea de `setActiva` reescrita.

### T5 — Contrato del servicio · R25/R22
`lib/interfaces/services/IGastoFijoPlantillaService.ts`: `EliminarPlantillaServiceResult`
(`ok` | `forbidden` | `not_found`) y `eliminarPlantilla(input, actor)`. En su docstring va, además
de la revocación, **el contrato con la ficha 333 (R25)** con sus tres puntos: (1) cancelar los
pendientes en la MISMA operación atómica, (2) contarlos ANTES y pasar el número a la confirmación,
(3) si el número cambia entre medias lo decide la 333, la 332 no lo prejuzga. Más el punto de
sutura (la transacción entra aquí; el tipo de resultado ganará el campo del conteo) y **por qué hoy
no se deja ni un parámetro opcional «por si acaso»**. Notas de cabecera y de `setActiva`
reescritas.

**Señal esperada, obtenida:** `TS2420: Property 'eliminarPlantilla' is missing in type 'GastoFijoPlantillaService'`.

### T6 — Implementación en el servicio · R2/R4/R7/R25
Guard `esAccesoTotal` **antes** de tocar el repositorio; `repo.eliminar(id)`; `ok`/`not_found` según
el booleano. **Sin `obtenerPorId` previo**, con el motivo escrito (una consulta de más y una ventana
TOCTOU para terminar diciendo lo mismo; el `count` es la respuesta y es atómico). El **riesgo R-1**
de `design.md §7` queda anotado junto al método: borrar tira el id, y con él la clave de
idempotencia del cron.

**El sitio delicado (`§4.2` del design).** En el docstring de `listarPlantillasCompleto` la frase
«que no se borra (R25)» sostenía la **excepción declarada a `170/R29` de la feature 184**. Se
cambió SÓLO la premisa citada —«que se da de alta **y de baja** a mano (ficha 332)»— y **el resto
del párrafo quedó intacto**: la conclusión (la tabla es configuración, no bitácora; su tamaño lo
marca el catálogo de gastos) sigue en pie y de hecho se refuerza.

### T7 — Tests del servicio + la INVERSIÓN del testigo · R2/R4/R7/R11
`tests/unit/services/gasto-fijo-plantilla-service.test.ts`:
- `buildRepo` (literal completo de la interfaz) gana `eliminar`.
- Casos nuevos: `forbidden` sin llamar al repo (R4); `ok` + `eliminar("p-1")` (R2); `admin -> ok`
  (paridad feature 94); `false -> not_found` sin lanzar (R7); y **«no lee antes de borrar»**
  (`obtenerPorId` no se llamó), que fija la decisión de §2.2 del design.
- **El testigo del `45/R25` se INVIRTIÓ, no se borró.** El `describe` «— sin borrado (R25)» pasa a
  **«borrado habilitado: la ficha 332 revoca 45/R25»**, sus aserciones están dadas vuelta (el
  service **sí** expone `eliminarPlantilla`, el repo **sí** expone `eliminar`) y el comentario del
  bloque conserva que **hasta el 2026-08-29 afirmaba exactamente lo contrario**, con el puntero y
  citando la convención del repo (`decision5-revertida`, `d5-revertida`, `reversion-r49`). Se le
  añadió un segundo caso: R11 — desactivar **no se fue** con la revocación.

### T8 — Server Action · R5/R6
`lib/actions/gasto-fijo-plantilla.ts`: `EliminarPlantillaActionResult` + `eliminarPlantillaAction`,
espejo literal de `setActivaPlantillaAction` (sesión → `UnauthenticatedError`; `parse` →
`VALIDATION_ERROR`; delegación al service dentro de `withErrorHandler`). **Sin** anotación
`@sin-superficie` — ver §4, que es el único punto que el leader tiene que leer sí o sí. Notas de
cabecera y de `setActivaPlantillaAction` reescritas.

### T9 — Tests de la acción · R4/R5/R6/R7
`tests/unit/actions/gasto-fijo-plantilla-actions.test.ts`: `fakeService` (literal completo) gana
`eliminarPlantilla`. Siete casos: sin sesión (R5); id no-uuid (R6); sin id (R6); **clave
desconocida con el id VÁLIDO** (R6, `.strict()` — el id va bien a propósito para que el único
motivo posible del rojo sea la clave de más); `forbidden` lo decide el service (R4); `not_found` se
propaga (R7); y el camino feliz afirmando que el service recibe `{ id }` y el actor.

### T10 — Dobles reparados
`tests/integration/db/generacion-gastos-fijos.test.ts` (`fakePlantillaRepo`) **y
`tests/unit/services/generacion-gastos-fijos-service.test.ts` (`buildPlantillaRepo`)**. El segundo
**no estaba en el censo de `design.md §4.1`**: lo encontró el typecheck, que es exactamente para lo
que T1 pedía mirar el rojo. Los `as unknown as` de `gasto-fijo-plantillas-{paginado,completo}` no
se ven afectados, como preveía el spec. `pnpm typecheck` volvió a 0 en todo el repo.

### T11 — El libro sobrevive, contra Postgres · R8/R9
Nuevo `tests/integration/db/gasto-fijo-plantilla-borrado.test.ts`. Crea la plantilla con el
repositorio real, inserta su egreso **tal como lo emite el cron** (`egreso_gasto_fijo`,
`origen_tipo='gasto'`, `origen_id='<id>:2026-09'`, descripción `'<concepto> — 2026-09'`, autor
NULL) **más un movimiento ajeno**, borra la plantilla y afirma: la plantilla ya no está; el egreso
sigue con `monto` (STRING, `toFixed(2)`), `fecha_movimiento`, `origen_id` y `descripcion` intactos;
la descripción sigue llevando concepto y periodo (se explica sola); `createdAt` sin mover; el
movimiento ajeno vivo; y el **conteo del libro idéntico antes y después** del borrado. Todo dentro
de `enTransaccionRevertida`: no queda ni una fila.

**¿Se corrió o se saltó? SE CORRIÓ.** `HAY_BASE_DE_DATOS` era verdadero:
`PostgreSQL database "ordenex", schema "public" at "localhost:5432"`, `Database schema is up to
date!` (168 migraciones). Salida: `Test Files 1 passed (1) / Tests 1 passed (1)`, 235 ms de tests
— no un `skipped` disfrazado.

**Y no es un verde vacío, medido:** con `eliminar` mutado a un no-op (`const res = { count: 1 }`)
el test se puso ROJO en `expect(r.plantillaDespues).toBeNull()`, imprimiendo la fila que seguía en
la tabla. Restaurado y verde otra vez. No hay ningún `if (!x) return;`: si el fixture no se puede
crear, el test falla.

### T12 — La clave derivada · R10
Caso nuevo en `tests/integration/db/generacion-gastos-fijos.test.ts`: dos plantillas con el MISMO
concepto y el mismo periodo producen `origen_id` **distintos** (`p-vieja:2026-07` /
`p-recreada:2026-07`) y DOS egresos; y sus descripciones son idénticas, o sea que por el texto no
hay forma de distinguirlas. Es el testigo de que borrar y recrear **no reusa** la clave de
idempotencia. Su comentario apunta a `design.md §7 R-1`.

### T13 — Comentario del modelo y barrido del backend · R21/R22/R24
`db/schema.prisma` l. 1815: el «NO se borra (R25)» pasa a la revocación con fecha, motivo y
puntero, dejando dicho que desactivar sigue existiendo como pausa y que **la ficha cambia sólo el
comentario: el modelo es idéntico y no lleva migración**. `prisma validate`: *The schema at
db\schema.prisma is valid*.

**Censo de `design.md §4.1`, sitios 1–13 (los del backend): los 13 cubiertos.**

| # | Archivo | Estado |
| --- | --- | --- |
| 1 | `db/schema.prisma` | reescrito |
| 2–3 | `lib/interfaces/repositories/IGastoFijoPlantillaRepository.ts` | reescritos (aquí va la nota LARGA) |
| 4–5 | `lib/interfaces/services/IGastoFijoPlantillaService.ts` | reescritos |
| 6–8 | `lib/services/GastoFijoPlantillaService.ts` | reescritos (#8 sólo la premisa, ver T6) |
| 9–10 | `lib/repositories/GastoFijoPlantillaRepository.ts` | reescritos |
| 11 | `lib/types/gasto-fijo-plantilla.ts` | reescrito |
| 12–13 | `lib/actions/gasto-fijo-plantilla.ts` | reescritos |

Comprobación: `grep -rn "sin borrado\|no se borra\|NO se borra\|NUNCA borrar\|NO expone .delete"
lib/ db/schema.prisma | grep -i plantilla` sólo devuelve **las frases de la propia revocación** (las
que dicen «hasta esa fecha decía…» o «revoca el "sin borrado"»). Ninguna afirmación vigente.

**Sitios 14–18 siguen abiertos y NO son de este agente:** `GastosFijosPlantillasPanel.tsx:68` y
`GastoFijoPlantillaDialog.tsx:18,23` (T16), `tests/unit/components/wallet-gastos-fijos-panel.test.tsx:15`
(T17) y `specs/45-wallet-gastos-sueldos/{requirements,design}.md` (T18).

---

## 2. Archivos tocados

**Producción (7):**
`db/schema.prisma` (sólo comentario) · `lib/interfaces/repositories/IGastoFijoPlantillaRepository.ts` ·
`lib/repositories/GastoFijoPlantillaRepository.ts` · `lib/interfaces/services/IGastoFijoPlantillaService.ts` ·
`lib/services/GastoFijoPlantillaService.ts` · `lib/types/gasto-fijo-plantilla.ts` ·
`lib/actions/gasto-fijo-plantilla.ts`

**Tests (6, dos nuevos):**
`tests/unit/repositories/gasto-fijo-plantilla-eliminar.test.ts` **(nuevo)** ·
`tests/integration/db/gasto-fijo-plantilla-borrado.test.ts` **(nuevo)** ·
`tests/unit/services/gasto-fijo-plantilla-service.test.ts` ·
`tests/unit/actions/gasto-fijo-plantilla-actions.test.ts` ·
`tests/unit/services/generacion-gastos-fijos-service.test.ts` ·
`tests/integration/db/generacion-gastos-fijos.test.ts`

**Sin migración. Sin cambio de esquema. `db/migrations/**` intacto.** Y no se tocó `feature_list.json`,
ni `progress/current.md`, ni nada bajo `specs/`, `app/` o `components/`.

---

## 3. Mapa `R<n> → test`

| R | Estado | Test que lo cubre |
| --- | --- | --- |
| R1 | backend listo, UI pendiente | La acción existe y se ejercita en `tests/unit/actions/gasto-fijo-plantilla-actions.test.ts`. El botón por fila es **T17** (frontend). |
| R2 | ✅ | `tests/unit/services/gasto-fijo-plantilla-service.test.ts` «R2: maestro -> ok, y llama a eliminar con EL id pedido» · `tests/unit/actions/…` «R2: … el service recibe `{ id }` y el actor» · `tests/integration/db/gasto-fijo-plantilla-borrado.test.ts` (la fila deja de estar) |
| R3 | ✅ | `tests/unit/repositories/gasto-fijo-plantilla-eliminar.test.ts` (a) y (a-bis) — **mutación del `where` verificada en rojo** |
| R4 | ✅ | `…/gasto-fijo-plantilla-service.test.ts` «R4: rol sin acceso total -> forbidden, sin llamar a repo.eliminar» · `…/gasto-fijo-plantilla-actions.test.ts` «R4: forbidden lo decide el SERVICE» |
| R5 | ✅ | `…/gasto-fijo-plantilla-actions.test.ts` «R5: sin sesion -> unauthenticated, sin tocar el service» |
| R6 | ✅ | `…/gasto-fijo-plantilla-actions.test.ts` ×3: id no-uuid, sin id, y **clave desconocida con id válido** (`.strict()`) |
| R7 | ✅ | `…/gasto-fijo-plantilla-service.test.ts` «R7: … -> not_found, sin lanzar» · `…/actions…` «R7: not_found se propaga desde el service» |
| R8 | ✅ | `…/gasto-fijo-plantilla-eliminar.test.ts` (c) (el cliente sólo expone `gastoFijoPlantilla`, con autocomprobación) · `tests/integration/db/gasto-fijo-plantilla-borrado.test.ts` (3) (conteo del libro idéntico; el movimiento ajeno vivo) |
| R9 | ✅ | `tests/integration/db/gasto-fijo-plantilla-borrado.test.ts` (2) — monto, `fecha_movimiento`, `origen_id` y `descripcion` intactos, contra Postgres real |
| R10 | ✅ | `tests/integration/db/generacion-gastos-fijos.test.ts` «R10: dos plantillas con el MISMO concepto producen origen_id DISTINTOS» |
| R11 | parcial (backend ✅) | `…/gasto-fijo-plantilla-service.test.ts` «R11: y desactivar NO se fue con la revocacion» + los casos de `setActivaPlantilla` que ya existían. El «Desactivar sigue llamando a `setActiva`» del panel es **T17**. |
| R12–R20 | ❌ **pendientes** | **Frontend: T14–T17.** Ninguno es alcanzable desde el backend. |
| R21 | parcial | Backend barrido en T13 (los 13 sitios). Faltan los sitios 14–18 (**T16/T17/T18**) y la guardia que lo afirma (**T19**). |
| R22 | parcial | La revocación con sus 4 piezas (revoca / 2026-08-29 / motivo / puntero) está escrita en los 7 archivos de producción del backend. Verificarlo por test es **T19**. |
| R23 | ❌ **pendiente** | **T18** — apéndice en `specs/45-wallet-gastos-sueldos/`. Fuera del alcance de este agente por instrucción explícita (no tocar `specs/`). |
| R24 | ✅ (por construcción) | `db/migrations/20260713150000_gasto_fijo_plantilla/` **no aparece en el diff**: `git status` sólo lista los 13 archivos de §2. La exclusión razonada del censo la escribirá la guardia de **T19**. |
| R25 | ✅ | El contrato con la 333 está escrito en el docstring de `IGastoFijoPlantillaService.eliminarPlantilla` (tres puntos + punto de sutura) y en `specs/332/design.md §5`. Su verificación por test es **T19 bloque (f)**. |
| R26 | **sin test, y es deliberado** | Comportamiento propiedad de la **ficha 333**, dueña de la tabla de pendientes. La 332 sólo promete R25 —que el contrato quede escrito—, y eso está hecho. No hay nada que probar aquí sin inventar el esquema de otra ficha. |

---

## 4. ⚠️ Lo único que el leader tiene que decidir antes de mergear

**`eliminarPlantillaAction` nace sin superficie hasta T14, y la guardia lo dice.**

```
 FAIL  tests/unit/guards/superficie-de-uso.guardia.test.ts > R-A — …
+ [
+   "lib/actions/gasto-fijo-plantilla.ts:158 eliminarPlantillaAction",
+   "lib/actions/tarifas.ts:67 obtenerTarifa",
+ ]
```

- Es **consecuencia directa de secuenciar backend → frontend**, que es lo que manda `tasks.md`. Se
  cierra sola en **T14**, cuando el panel monte el botón.
- **NO se le puso `@sin-superficie`**, y es deliberado: `design.md §2.3` lo prohíbe expresamente
  («nace con consumidor vivo»). Anotarla ahora obligaría a acordarse de quitarla después, que es
  justo la basura que esa guardia existe para evitar.
- `obtenerTarifa` **es deuda ajena y previa**: el archivo ya figura en `tests/baseline-rojos.json`
  por él. Ojo con esto, porque el propio baseline lo advierte: la comparación es **por archivo**, así
  que un archivo ya listado que gana un rojo nuevo **el gate no lo ve**. Por eso queda escrito aquí.
- **Conclusión práctica:** este backend **no se debe mergear solo**. Va con T14–T17 o el árbol
  queda con una Server Action que ningún usuario puede disparar — exactamente el incidente que esa
  guardia nació para impedir.

---

## 5. Verificación ejecutada

**No se corrió `./init.sh`** (ni rápido ni completo): es **T20**, y para esta ficha el rápido se
niega solo porque el diff toca `db/schema.prisma` y rutas con nombre de dinero. Lo corre el leader,
con el árbol quieto.

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

LINT_EXIT=0
```
De esas 127, **una** es mía: `tests/unit/repositories/gasto-fijo-plantilla-eliminar.test.ts:50:37
warning '_args' is defined but never used`. Es el mismo patrón —y el mismo warning— del archivo de
referencia que el spec manda copiar (`historicos-paginados-where.test.ts`): el parámetro se declara
explícitamente **porque es justo lo que el test captura**; sin él el mock sería de cero argumentos.
Cero errores.

### `pnpm exec vitest related --run` sobre los 6 archivos de producción TS tocados
```
 Test Files  16 passed (16)
      Tests  177 passed (177)
   Duration  17.44s
```

### Corrida explícita por nombre de cada archivo de test creado o modificado
(`vitest related` no alcanza los que sólo importan tipos, así que va aparte)
```
 pnpm exec vitest run \
   tests/unit/repositories/gasto-fijo-plantilla-eliminar.test.ts \
   tests/unit/services/gasto-fijo-plantilla-service.test.ts \
   tests/unit/actions/gasto-fijo-plantilla-actions.test.ts \
   tests/unit/services/generacion-gastos-fijos-service.test.ts \
   tests/integration/db/generacion-gastos-fijos.test.ts \
   tests/integration/db/gasto-fijo-plantilla-borrado.test.ts

 Test Files  6 passed (6)
      Tests  65 passed (65)
   Duration  863ms
```

### Vecino que no se debía romper
`tests/unit/components/wallet-gastos-fijos-panel.test.tsx` → `12 passed`. El panel sigue verde
con el backend nuevo debajo; T14/T17 arrancan desde ahí.

### `prisma validate`
```
Prisma schema loaded from db\schema.prisma.
The schema at db\schema.prisma is valid 🚀
```

---

## 6. Money-safe

En este camino **no viaja ningún monto**: la entrada es `{ id }` y la salida es un `status`. Los
únicos montos que aparecen —el del fixture de T11 y el del DTO— se manejan como **STRING de punta
a punta** (`monto.toFixed(2)`, `new Prisma.Decimal(MONTO)`), sin un solo `Number` ni `parseFloat`.

---

## 7. Veredicto

**T0–T13 cerradas y verdes; el backend del borrado está completo y probado donde vive, pero NO es
mergeable por sí solo: la acción no tiene superficie hasta T14.**

---
---

# Ficha 332 · bitácora del FRONTEND (T14–T19) + cierre parcial de T21

> Agente: `frontend_dev`. Alcance: **T14 a T19** de `specs/332-eliminar-plantilla-gasto-fijo/tasks.md`,
> más la parte de **T21** que no depende del gate. Fecha: 2026-08-29.
> Rama: `feature/332-eliminar-plantilla-gasto-fijo` (ya existía; **no se ejecutó ningún comando de
> git que escriba**: el commit lo hace el leader).
> **No se corrió `./init.sh`** (es T20, del leader, y para esta ficha el rápido se niega solo).
> **No se tocó** `feature_list.json`, `progress/current.md` ni nada de `lib/`.

---

## 6. Tarea por tarea (frontend)

### T14 — Botón «Eliminar» + confirmación en el panel · R1/R12–R19
`app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx`:

- **Tercer botón** en la columna «Acciones», `variant="destructive"`, `size="sm"`, deshabilitado
  **sólo en su fila** mientras su borrado está en vuelo (estado `eliminando`, mismo patrón que
  `alternando`). El botón **no borra**: sólo hace `setAEliminar(p)` (R12/R13).
- **`Modal` de `components/shared/Modal.tsx`** con `confirmVariant="destructive"`,
  `confirmLabel="Eliminar"`, `cancelLabel="Cancelar"`. No se creó ningún componente nuevo ni se
  añadió un `AlertDialog` de shadcn: la primitiva que este mismo panel ya usa a través de
  `GastoFijoPlantillaDialog` trae foco atrapado, `aria-modal`, `Escape`/overlay y
  anti-doble-submit. Los textos son **los de `design.md §3.2`, literales**:
  - título `Eliminar plantilla de gasto fijo`;
  - descripción `«<concepto>» — <money(monto)>` (R14: el monto sale del `GastoFijoPlantillaDTO`
    que el panel ya tiene, **STRING**, pintado con `money(...)`; **ni un `Number` ni un
    `parseFloat`** en este camino);
  - las **tres consecuencias** (R15) y **la alternativa «Desactivar»** en su propia línea (R16),
    en voseo, que es la forma que ya usa el archivo (no se abre aquí el debate de la 331).
- **Handler** (R18/R19): `ok` → `toast.success("Plantilla eliminada.")` + `recargar()` +
  `router.refresh()`. Cuatro errores con **mensaje propio cada uno**, calcados de
  `alternarActiva`: `forbidden` → «No tenés permiso para administrar plantillas.»;
  `unauthenticated` → «Tu sesión expiró. Iniciá sesión de nuevo.»; `validation_error` → «No se
  pudo eliminar la plantilla.»; `not_found` → «La plantilla ya no existe.» **y además
  `recargar()`**, porque en ese caso el listado del usuario está desactualizado y releerlo ES la
  respuesta.
- La acción devuelve `{ status: "ok" }` **sin payload**: la fila **no** se reconstruye en el
  cliente, se relee del servidor (R18).
- **No se tocó** el botón Desactivar/Activar ni su handler (R11).

### T15 — Volver a la página anterior si la página queda vacía · R20
En el mismo handler, evaluado **antes** del borrado y aplicado tras el `ok`:
`if (filasVisibles === 1 && page > 1) setPage(page - 1);`. Sin tocar
`components/shared/Pagination.tsx` ni recalcular el número de páginas.

### T16 — Notas de revocación del frontend · R21/R22
- `GastosFijosPlantillasPanel.tsx` (l. 66-71): la cabecera decía «activar/desactivar (NUNCA
  borrar, R25…)». Ahora dice que el CRUD **elimina**, y conserva **entre comillas y verbatim** lo
  que decía hasta el 2026-08-29, con las cuatro piezas de la revocación (palabra *revoca*, fecha,
  motivo y puntero `specs/332-eliminar-plantilla-gasto-fijo`) y con R11 dicho aparte.
- `GastoFijoPlantillaDialog.tsx`: igual con su «Sin borrado (R25)…», añadiendo **dónde** vive el
  borrado (en el panel, con su confirmación) para que nadie lo busque aquí.

Comprobación pedida por la tarea:

```
$ grep -rniE "sin borrado|no se borra|nunca borrar" "app/(app)/wallet/"
GastoFijoPlantillaDialog.tsx:35:    // Ficha 332 — hasta el 2026-08-29 esta cabecera decía, verbatim: «Sin borrado (R25): la
GastosFijosPlantillasPanel.tsx:76:  // activar/desactivar (NUNCA borrar, R25: la desactivación es el mecanismo para dejar de
GastosFijosPlantillasPanel.tsx:77:  // generar)». La ficha 332 **revoca** ese «sin borrado» de `45/R25` con decisión humana del
GastosFijosPlantillasPanel.tsx:219:  * no corre y no se borra nada (R13). Del servidor vuelve un `status` a secas —sin payload—,
GastosFijosPlantillasPanel.tsx:477:                <strong>siguen en el libro de movimientos</strong>: no se borran ni se
WalletModule.tsx:228:          dudar de cuál de los dos números es el bueno. No se borra su contenido: su lista es
```

Las dos primeras son **citas dentro de la propia revocación** (van seguidas de «revoca»/«quedó
revocada»); l. 219 dice que no se borra **hasta que el usuario confirma** (R13); l. 477 es el
texto de la UI que promete que **el libro** no se toca (R8/R9); `WalletModule` habla de otra cosa.
**Ninguna afirmación vigente de que las plantillas no se puedan borrar.** Y no queda en manos de
este `grep`: es justo lo que afirma el bloque (a) de la guardia de T19, con la ventana de ±400
caracteres que distingue CITAR de AFIRMAR.

### T17 — Tests del panel · R1/R2/R11–R20
`tests/unit/components/wallet-gastos-fijos-panel.test.tsx`. **No se borró ni un caso existente**:
se añadió `eliminarPlantillaAction` al `vi.mock` del módulo de acciones, se actualizó el
comentario de cabecera (decía «(nunca borran)») conservando **verbatim** lo que afirmaba hasta el
2026-08-29, y al caso de «Desactivar» se le añadieron dos aserciones nuevas (que **no** llamó al
borrado y que la fila **sigue** en la tabla), que es R11 dicho con todas las letras. De 12 casos a
27.

Casos nuevos (15): «cada fila ofrece Eliminar, junto a Editar y al toggle» (R1); «Eliminar abre la
confirmación y NO llama a la acción» (R12/R13); «la confirmación identifica la plantilla por
concepto y monto» (R14); «el monto pasa por `money`: agrupa miles y no se pega crudo» (R14);
«enuncia las TRES consecuencias» (R15); «ofrece Desactivar como alternativa» (R16); «Cancelar
cierra sin llamar a la acción» (R17); «confirmar llama con `{ id }` y, tras ok, avisa y relee»
(R2/R18); los **cuatro** estados de error, cada uno afirmando además que **los otros tres mensajes
NO están** (R19); «los cuatro mensajes son distintos entre sí» (anti-vacuidad de esa tabla);
«borrada la ÚNICA fila de la página 2, el panel muestra la página 1» (R20) y su contraparte «si la
página 2 tenía DOS filas, no se mueve de página» (R20).

**Dos decisiones que conviene saber:**

1. El caso de R14 con `300.00` **no discrimina solo**: un `${p.monto}` a pelo se vería casi igual.
   Por eso hay un segundo caso con un monto de siete cifras, donde pegar el STRING crudo daría
   `1500000.00` y sólo el camino money-safe da `₡1.500.000`.
2. Los avisos de error se buscan con `findAllByText`, no con `findByText`: un toast de prioridad
   alta se anuncia **además** en la región `aria-live` del proveedor, así que el texto aparece en
   dos nodos y `findByText` reventaba por ambigüedad. Es ruido del proveedor, no un fallo.

**Las mutaciones, EJECUTADAS sobre el panel real — no supuestas.** Tras cada una, el archivo se
restauró y se verificó con `diff` que quedó **byte-idéntico**:

| Mutación | Resultado |
| --- | --- |
| se borra la regla de R20 (`if (filasVisibles === 1 && page > 1) setPage(page - 1);`) | **1 rojo**: «borrada la ÚNICA fila de la página 2, el panel muestra la página 1» |
| `money(aEliminar.monto)` → `aEliminar.monto` (se salta el camino money-safe) | **2 rojos**: los dos casos de R14 |
| el botón de la fila llama a la acción en vez de abrir la confirmación | **13 rojos**, empezando por R12/R13 |

### T18 — Apéndice en el spec de la ficha 45 · R23
**AÑADIDO** (nunca reescrito) en los dos sitios que `tasks.md` nombra: al final de `45/R25` en
`specs/45-wallet-gastos-sueldos/requirements.md` y detrás de la línea equivalente de
`design.md:236`. El bloque lleva `⚠️ SUPERSEDED 2026-08-29 por la ficha 332`, el puntero, el
motivo y **por qué la premisa de R25 no se sostenía** (sin FK; la descripción del movimiento ya
lleva concepto y periodo). En el `design.md` se dice además qué mitad de aquella frase **sigue
siendo verdad**: el egreso no se borra nunca.

**El texto original de `45/R25` se conserva VERBATIM**, y no depende de que alguien se acuerde: el
bloque (d) de la guardia lo compara contra testigos literales.

```
$ git diff --numstat -- specs/45-wallet-gastos-sueldos/
8	0	specs/45-wallet-gastos-sueldos/design.md
15	0	specs/45-wallet-gastos-sueldos/requirements.md

$ git diff -- specs/45-wallet-gastos-sueldos/ | grep -c "^-[^-]"
0
```

Cero líneas borradas: **sólo líneas añadidas**, que es lo que la tarea exige.

### T19 — La guardia de la revocación · R21–R25
Nuevo `tests/unit/guards/plantilla-gasto-fijo-borrado.guardia.test.ts` (28 casos). Molde:
`decision5-revertida.guardia.test.ts` (feature 287), que este repo ya escribió para este mismo
problema. Bloques:

- **(0) autocomprobación del censo** — los archivos censados existen y **ninguno se leyó en
  blanco**; el censo **no está vacío** y tiene **cota mínima explícita**
  (`>= 9` archivos, `>= 6` patrones, 4 piezas por cada juego, testigos de más de 40 caracteres);
  el barrido de la carpeta de wallet encuentra archivos de verdad **y ve el panel**; y la rebanada
  de `db/schema.prisma` es el bloque del modelo y **no el archivo entero**.
- **(a) R21** — ningún archivo vivo afirma que las plantillas no se pueden borrar. Seis patrones
  **estrechos** (los del censo de `design.md §4.1`), sobre texto normalizado que quita las marcas
  de comentario (`//`, `--`) para cazar una frase partida en dos líneas. Un hallazgo **no cuenta**
  si tiene una marca de revocación a menos de 400 caracteres: R22 obliga a CITAR la frase vieja, y
  un detector que leyera la cita como afirmación forzaría a borrarla.
- **(b) R22** — la revocación con sus piezas. Las **cuatro** (revoca / 2026-08-29 / motivo /
  puntero) en el **ancla** (`IGastoFijoPlantillaRepository.ts`, donde `design.md §4.1` manda que
  vaya la nota larga) y **tres** en los otros ocho. Que sean tres y no cuatro está escrito **en la
  guardia, con su motivo**: repetir el motivo entero en nueve archivos es prosa que envejece en
  nueve sitios a la vez.
- **(c) R23** — el apéndice en los dos archivos de `specs/45`, con SUPERSEDED, fecha, «ficha 332»
  y puntero.
- **(d) R23** — **cuatro testigos VERBATIM** del texto original de `45/R25` (tres líneas del
  `requirements.md` y la del `design.md`).
- **(e) R24** — `db/migrations/**` fuera del censo, **con el motivo escrito en el propio archivo
  de la guardia** (migración aplicada = foto de su fecha; editarla en sitio produce drift). Y una
  segunda mitad que no estaba pedida pero sin la cual la exclusión no vale nada: la migración
  **sigue diciendo lo que decía** (`NO se borra (R25)`), así que si alguien la «deja coherente»,
  la guardia lo caza.
- **(f) R25** — el contrato con la 333 escrito en el docstring de `eliminarPlantilla` **y** en
  `specs/332/design.md`: cancelar los pendientes en la **misma operación atómica**, contarlos
  **ANTES** y anunciar el número **en la confirmación**.
- **Autocomprobación de los detectores** (11 casos), incluidas **dos mutaciones sobre archivos
  REALES** —una frase añadida al panel de verdad, y el motivo borrado del ancla de verdad—, porque
  en la guardia de la 287 el hueco que dejó pasar una mutación estaba justo ahí: los textos
  sintéticos no vieron lo que el archivo real sí tenía.

**Cada bloque se vio ROJO al menos una vez, rompiéndolo a mano.** El script de mutaciones hizo
copia, mutó, corrió, restauró y comprobó `cmp` byte a byte en cada paso:

```
=== LINEA BASE (todo verde)                                     Tests  28 passed (28)
=== (0) censo: un archivo censado que no existe                 Tests  3 failed | 25 passed (28)
=== (a) el panel afirma que no se pueden borrar                 Tests  3 failed | 25 passed (28)
=== (b) al dialogo se le quita el puntero a la ficha            Tests  1 failed | 27 passed (28)
=== (c) al design de la 45 se le quita la marca SUPERSEDED      Tests  1 failed | 27 passed (28)
=== (d) alguien reescribe el texto original de 45/R25           Tests  2 failed | 26 passed (28)
=== (e) alguien deja «coherente» la migracion ya aplicada       Tests  1 failed | 27 passed (28)
=== (f) el contrato con la 333 pierde la operacion atomica      Tests  1 failed | 27 passed (28)
```

Cada línea fue seguida de `restaurado byte-identico: OK`, y el `git status --porcelain` final
muestra **exactamente** los cinco archivos de esta fase más el de la guardia: la migración y todo
`lib/` quedaron **sin tocar**.

---

## 7. ⚠️ La comprobación que cierra el aviso del §4 de esta bitácora

El backend dejó escrito que `eliminarPlantillaAction` **nacía sin superficie** y que, como
`tests/baseline-rojos.json` compara **por archivo** y ese archivo ya estaba listado por
`obtenerTarifa` (deuda ajena, desde el 2026-08-28), **el gate no habría visto la entrada nueva**:
una fase a medias habría salido verde mintiendo. Con T14 hecha, la guardia ya **no** señala la
acción:

```
$ pnpm exec vitest run tests/unit/guards/superficie-de-uso.guardia.test.ts

 FAIL  tests/unit/guards/superficie-de-uso.guardia.test.ts > R-A — toda Server Action tiene
       superficie, o dice por escrito por qué no
AssertionError: estas Server Actions no las importa NINGÚN módulo alcanzable desde una raíz de
ruta: expected [ Array(1) ] to deeply equal []
+ [
+   "lib/actions/tarifas.ts:67 obtenerTarifa",
+ ]

 Test Files  1 failed (1)
      Tests  1 failed | 17 passed (18)
```

**`eliminarPlantillaAction` ya no aparece.** Lo único que queda es `obtenerTarifa`, que es la
deuda ajena y previa por la que ese archivo está en el baseline (motivo registrado allí:
«probablemente de la ficha 274 (cascada de tarifas)»). El panel monta el botón, el botón está en
`app/(app)/wallet/...`, y la cadena hasta `wallet/page.tsx` se recorre sola.

---

## 8. Archivos tocados en esta fase

**Producción (2):**
`app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx` (botón, confirmación, handler, R20 y
la nota de la revocación) ·
`app/(app)/wallet/_components/GastoFijoPlantillaDialog.tsx` (**sólo comentario**)

**Tests (2, uno nuevo):**
`tests/unit/components/wallet-gastos-fijos-panel.test.tsx` (ampliado, sin borrar casos) ·
`tests/unit/guards/plantilla-gasto-fijo-borrado.guardia.test.ts` **(nuevo)**

**Specs de otra ficha (append-only, R23):**
`specs/45-wallet-gastos-sueldos/requirements.md` · `specs/45-wallet-gastos-sueldos/design.md`

**Sin tocar:** `lib/**` (el backend está cerrado), `db/**` —incluida la migración—,
`components/**`, `feature_list.json`, `progress/current.md`.

---

## 9. Mapa `R<n> → test`, completado con el frontend

Las filas del backend (§3) siguen valiendo. Lo que esta fase cierra:

| R | Estado | Test que lo cubre |
| --- | --- | --- |
| R1 | ✅ | `wallet-gastos-fijos-panel.test.tsx` «cada fila ofrece Eliminar, junto a Editar y al toggle» |
| R2 | ✅ (backend + UI) | + «confirmar llama a la acción con `{ id }` y, tras ok, avisa y relee la página» |
| R11 | ✅ | «Desactivar una plantilla activa llama setActiva con activa=false» **+ no llamó al borrado + la fila sigue en la tabla** · y en el service, «R11: desactivar NO se fue con la revocacion» |
| R12 | ✅ | «Eliminar abre la confirmación y NO llama a la acción» |
| R13 | ✅ | idem (la misma aserción: la acción no se llamó antes de confirmar) · **mutación verificada**: si el botón borra directo, 13 casos en rojo |
| R14 | ✅ | «la confirmación identifica la plantilla por concepto y monto» + «el monto pasa por `money`: agrupa miles y no se pega crudo» · **mutación verificada** |
| R15 | ✅ | «enuncia las TRES consecuencias del borrado» |
| R16 | ✅ | «ofrece Desactivar como alternativa, con lo que la pausa conserva» |
| R17 | ✅ | «Cancelar cierra la confirmación sin llamar a la acción» |
| R18 | ✅ | «…tras ok, avisa y relee la página» (aviso + nueva lectura de la página al servidor) |
| R19 | ✅ | los cuatro estados, cada uno con su mensaje **y afirmando que los otros tres no están** + «los cuatro mensajes son distintos entre sí» |
| R20 | ✅ | «borrada la ÚNICA fila de la página 2, el panel muestra la página 1» + «si la página 2 tenía DOS filas, no se mueve» · **mutación verificada** |
| R21 | ✅ | `plantilla-gasto-fijo-borrado.guardia.test.ts` (a), sobre los 9 archivos del censo **y** el barrido de la carpeta de wallet |
| R22 | ✅ | idem (b): cuatro piezas en el ancla, tres en los otros ocho |
| R23 | ✅ | idem (c) el apéndice en los dos archivos de `specs/45` + (d) cuatro testigos verbatim |
| R24 | ✅ | idem (e): `db/migrations/**` fuera del censo con el motivo escrito, y la migración sigue intacta |
| R25 | ✅ | idem (f): el traspaso a la 333, en el docstring y en el design |
| R26 | **sin test, y es deliberado** | Comportamiento propiedad de la **ficha 333**, dueña de la tabla de pendientes. La 332 sólo promete R25 —que el contrato quede escrito—, y eso está hecho y verificado por (f). Probarlo aquí exigiría inventar el esquema de otra ficha, que es justo lo que `design.md §5` prohíbe. |

---

## 10. Verificación ejecutada en esta fase

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

LINT_EXIT=0
```
Las 127 son las mismas de la fase de backend (`_args`, `_input`… en dobles de test).
**Ninguna es de esta fase:** filtrando la salida por mis cuatro archivos no aparece ni un warning.

### `pnpm exec vitest related --run` sobre los dos archivos de producción tocados
```
$ pnpm exec vitest related --run \
    "app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx" \
    "app/(app)/wallet/_components/GastoFijoPlantillaDialog.tsx"

 Test Files  6 passed (6)
      Tests  79 passed (79)
   Duration  16.76s
```

### Corrida explícita por nombre de cada archivo de test creado o modificado
```
$ pnpm exec vitest run \
    tests/unit/components/wallet-gastos-fijos-panel.test.tsx \
    tests/unit/guards/plantilla-gasto-fijo-borrado.guardia.test.ts

 Test Files  2 passed (2)
      Tests  55 passed (55)
   Duration  6.88s
```
(27 del panel —12 que ya existían y 15 nuevos— y 28 de la guardia.)

### Todas las guardias del repo
```
$ pnpm exec vitest run guard

 Test Files  1 failed | 162 passed (163)
      Tests  1 failed | 2477 passed (2478)
```
El único rojo es `superficie-de-uso.guardia.test.ts` por **`obtenerTarifa`**, que es la deuda
ajena y previa ya registrada en `tests/baseline-rojos.json` (§7). Ninguna otra guardia —ni las de
dinero, ni las de censo de tablas, ni las de descarga— se movió con este cambio.

**Ningún test cayó por timeout en esta fase**, así que no hubo que aislar nada.

---

## 11. Lo que queda abierto (y por qué no lo cierro yo)

- **T20 · el gate completo** (`./init.sh`, con `INIT_EXIT=$?` dentro del log): lo corre **el
  leader**, con el árbol quieto. Aquí no se corrió, ni el rápido: el diff toca rutas con nombre de
  dinero y el rápido se niega solo.
- **T21 · el commit de esta bitácora**: el informe está escrito, pero **no commiteado** — no se
  ejecutó ningún comando de git que escriba. En este repo un informe sin commitear se lo lleva el
  primer `git checkout`, y ya pasó tres veces en un día.
- **T22 · el repaso a mano en el navegador**: sigue **abierta a propósito**. Un subagente no puede
  levantar un navegador, y esto es superficie visible nueva (botón destructivo + diálogo): hay que
  mirar que el concepto y el monto se lean de un vistazo, que las tres consecuencias se entiendan
  sin releer, que la alternativa «Desactivar» no se pierda en el texto y que el botón destructivo
  no se confunda con «Desactivar», que está justo al lado. **No se marca hecha por haber pasado
  los tests.**
- **T11 (del backend) no se re-ejecutó** en esta fase: no se tocó nada de lo que depende.

---

## 12. Veredicto de la fase

**T14–T19 cerradas y verdes.** El borrado tiene superficie: la guardia de superficie de uso ya no
señala `eliminarPlantillaAction`, la revocación está escrita donde se lee y vigilada por una
guardia que se vio roja bloque por bloque, y el texto original de `45/R25` sigue verbatim con su
apéndice detrás. Falta el gate completo (T20), el commit (T21) y el repaso a mano (T22).
