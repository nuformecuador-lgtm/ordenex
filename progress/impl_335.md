# Ficha 335 — Bitácora del BLOQUE A (backend)

> Rama: `feature/335-mi-wallet-diseno-y-puerta`. Agente: `backend_dev`.
> Alcance ejecutado: **A1 → A13** (bloque A completo). **Los bloques B, C, D y E NO se tocaron.**
> Nada de `app/`, `components/`, `feature_list.json`, `progress/current.md` ni `specs/`.

---

## 0. Lo que resuelve este bloque, en una frase

`/mi-wallet` filtraba por cierre con un `<input type="text" placeholder="ID del cierre">` cuyo
valor nadie conoce. Para poder sustituirlo por un selector hacía falta una lectura que no existía
—ninguna action del árbol lista los cierres de UNA tienda; las de `lib/actions/cierre-bodega.ts`
son de admin/bodega—. Este bloque construye esa lectura, de punta a punta, con su alcance probado
donde vive.

---

## 1. Archivos creados / modificados

### Producción (7 modificados, 0 creados)

| Archivo | Tarea | Qué cambia |
| --- | --- | --- |
| `lib/config/wallet-tienda.ts` | A1 | `MAX_CIERRES_FILTRO` (env `WALLET_TIENDA_MAX_CIERRES_FILTRO`, default 200) con el `readPositiveInt` que ese archivo ya tenía |
| `lib/types/wallet-tienda.ts` | A2 | `CierreTiendaOpcionDTO = { cierreId; fecha; movimientos }`. **`listarMovimientosTiendaSchema` no se tocó** |
| `lib/interfaces/repositories/IWalletTiendaMovimientoRepository.ts` | A3 | `CierreDeTiendaAgregadoRow` + `listarCierresDeTienda(tiendaId, limite)` |
| `lib/repositories/WalletTiendaMovimientoRepository.ts` | A4 | implementación: **un** `groupBy`, `tiendaId` en el `WHERE` |
| `lib/interfaces/services/IWalletTiendaService.ts` | A6 | `ListarMisCierresServiceResult` + `listarMisCierres(actor)` con el docstring de R5/R3 |
| `lib/services/WalletTiendaService.ts` | A7 | implementación: guard antes del repo, `tope + 1`, recorte y `hayMas` |
| `lib/actions/wallet-tienda.ts` | A8 | `listarMisCierresAction(deps)` — la **novena**; las 8 existentes no se tocaron |

### Tests creados (4)

- `tests/unit/services/mi-wallet-cierres.test.ts` (A9)
- `tests/unit/actions/wallet-tienda-cierres-action.test.ts` (A10)
- `tests/integration/db/mi-wallet-cierres-alcance.test.ts` (A12)
- `tests/unit/guards/mi-wallet-335.guardia.test.ts` (A13)

### Tests modificados (13)

- `tests/unit/config/wallet-tienda-config.test.ts` (A1 — 4 casos nuevos)
- `tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts` (A11 — 7 casos nuevos)
- **A5, los dobles** (11 archivos): `tests/unit/actions/wallet-tienda-actions.test.ts`,
  `tests/unit/services/{wallet-tienda-service, mi-wallet-desglose}.test.ts`,
  `tests/unit/repositories/{cierres-admin-repository, cierres-admin-confirmacion-fisica,
  cierres-admin-anclaje-devolucion, cierres-admin-caja-cod, cierres-admin-indemnizacion,
  CierresAdminRepository.resolverCierre.devolucion}.test.ts`,
  `tests/integration/db/{cierre-detail-congelado, wallet-idempotencia}.test.ts`.

---

## 2. Tarea por tarea

### A1 — Tope configurable
`MAX_CIERRES_FILTRO` va **aparte** de `DEFAULT_PAGE_SIZE`/`MAX_PAGE_SIZE`: no es un tamaño de
página (el selector no pagina, se recorta), así que no entra en el censo de
`tests/unit/config/paginacion-dominios.test.ts` —que sigue verde **sin editarlo**, comprobado—.
El 200 va declarado en el código como **cota de seguridad y no como medida**: producción está
vacía desde el arranque comercial del 2026-08-25 y no hay percentil real que ofrecer.

### A2 — Contratos I/O
`CierreTiendaOpcionDTO` con **tres** campos y ni uno más. Las dos exclusiones van escritas junto
al tipo: sin importe (R9, se pide `_count` y nunca `_sum`) y sin el mensajero del cierre (costaría
dos consultas y le revelaría a la tienda quién movió su dinero).
`listarMovimientosTiendaSchema` quedó **byte a byte igual**: lo que cambia es quién produce el
string `cierreId`, no el contrato del filtro.

### A3 — Contrato del repositorio → el typecheck mordió, como pedía la tarea
`pnpm typecheck` falló **exit 2** enumerando uno a uno los dobles incompletos. Extracto real:

```
lib/repositories/WalletTiendaMovimientoRepository.ts(60,14): error TS2420: Class 'WalletTiendaMovimientoRepository' incorrectly implements interface 'IWalletTiendaMovimientoRepository'.
  Property 'listarCierresDeTienda' is missing in type 'WalletTiendaMovimientoRepository' but required in type 'IWalletTiendaMovimientoRepository'.
lib/actions/cierres-admin.ts(110,7):   error TS2345: ... Property 'listarCierresDeTienda' is missing ...
lib/actions/liquidacion.ts(102,5):     error TS2345: ... Property 'listarCierresDeTienda' is missing ...
lib/actions/wallet-tienda.ts(86,34):   error TS2345: ... Property 'listarCierresDeTienda' is missing ...
tests/integration/db/cierre-detail-congelado.test.ts(342,5):        error TS2345: ...
tests/integration/db/liquidacion-idempotencia.test.ts(642,5):       error TS2345: ...
tests/integration/db/premio-ranking-idempotencia.test.ts(566,9):    error TS2345: ...
tests/integration/db/wallet-idempotencia.test.ts(272,7):            error TS2345: ...
tests/unit/repositories/cierres-admin-anclaje-devolucion.test.ts(58,9):                    error TS2741: ...
tests/unit/repositories/cierres-admin-caja-cod.test.ts(200,5):                             error TS2345: ...
tests/unit/repositories/cierres-admin-confirmacion-fisica.test.ts(74,9):                   error TS2741: ...
tests/unit/repositories/cierres-admin-indemnizacion.test.ts(140,5):                        error TS2345: ...
tests/unit/repositories/cierres-admin-repository.test.ts(38,9):                            error TS2741: ...
tests/unit/repositories/CierresAdminRepository.resolverCierre.devolucion.test.ts(47,9):    error TS2741: ...
tests/unit/services/cierres-admin-service.test.ts(1061,7 y 1191,7):                        error TS2345: ...
tests/unit/services/mi-wallet-desglose.test.ts(61,3):                                      error TS2741: ...
tests/unit/services/wallet-tienda-desglose.test.ts(611,7):                                 error TS2345: ...
tests/unit/services/wallet-tienda-service.test.ts(19,3):                                   error TS2322: ...
```

**La lista real fue de 11 archivos de test, no de 7.** El `tasks.md` los enumeraba «de partida» y
acertó en el criterio (que la lista la da el typecheck) pero no en el conjunto: sobraban tres de
su lista (`wallet-tienda-descarga`, `saldos-tiendas-paginado`, `saldos-tiendas-completo`,
`liquidacion-service`, `liquidacion-anulacion`, `caja-cadena-pago-anulacion` — todos usan
`fakeRepo` de otro módulo o el repositorio real) y faltaban cuatro
(`cierres-admin-caja-cod`, `cierres-admin-indemnizacion`, `wallet-tienda-actions`,
`tests/integration/db/{cierre-detail-congelado, wallet-idempotencia}`). Se arreglaron los que el
compilador nombró, no los que la lista predecía.

### A4 — Implementación del repositorio
Un solo `groupBy` con `by: ["origenId"]`, `where: { tiendaId, origenTipo: "cierre_dia",
origenId: { not: null } }`, `_max.fechaMovimiento`, `_count._all`, `take: limite`.

**Desviación posible que NO hizo falta declarar:** el design §2.2 dejaba abierta la posibilidad de
que el ORM rechazara el `orderBy` compuesto agregado+escalar en un `groupBy`. **No la rechaza.**
`orderBy: [{ _max: { fechaMovimiento: "desc" } }, { origenId: "desc" }]` typechequea y corre, así
que el desempate de R7 lo hace **la base** y no una ordenación en memoria posterior al `take`.
Eso importa: ordenar después del recorte habría elegido filas distintas de las que se pintan.

Sin `_sum`, sin `Number(`, sin `parseFloat(`, sin `parseInt(`, sin `.toFixed(`. Lo único numérico
es el cardinal `_count._all`.

### A5 — Los dobles
Los 11 archivos ganaron `listarCierresDeTienda: vi.fn(async () => [])`, cada uno con su comentario
de por qué es no-op ahí. **Cero `as unknown as` para tapar el hueco.**

### A6 / A7 — Servicio
Guard `actor.rol !== ROL_TIENDA → forbidden` **antes** de tocar el repositorio; pide
`MAX_CIERRES_FILTRO + 1`; recorta a `MAX_CIERRES_FILTRO` y responde `hayMas`. Sin parámetro de
entrada: es la barrera de alcance, y va escrita como tal en los dos docstrings.

### A8 — Server Action
`listarMisCierresAction(deps)`, calcada de `verMiSaldoAction`: `withErrorHandler`, actor resuelto,
`UnauthenticatedError` **antes** de instanciar el servicio, sin zod (no hay entrada que validar) y
sin `toWalletTiendaActionError` (el único `AppErrorShape` posible es `UNAUTHORIZED`).

---

## 3. Mapa `R<n> → test` (bloque A)

| R | Test (nombre exacto del caso) | Estado |
| --- | --- | --- |
| **R1** | `tests/unit/services/mi-wallet-cierres.test.ts` › «R1/R6: devuelve un elemento por cierre, con su fecha más reciente y su número de movimientos, y nada más» | verde |
| **R2** | `tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts` › «R2: el groupBy de cierres lleva tiendaId, origenTipo cierre_dia y origenId no nulo en el WHERE» **+** `tests/integration/db/mi-wallet-cierres-alcance.test.ts` › «R2: la lista de la tienda A NO contiene el cierre que solo movió dinero de la tienda B» **+** `mi-wallet-cierres.test.ts` › «R2: el repositorio recibe EXACTAMENTE el `usuarioId` del actor como tienda» | verde |
| **R3** | `mi-wallet-cierres.test.ts` › «R3: un rol que no es la tienda recibe forbidden sin llamar al repositorio» **+** `wallet-tienda-cierres-action.test.ts` › «R3: el `forbidden` del servicio se devuelve tal cual, sin filas» | verde |
| **R4** | `tests/unit/actions/wallet-tienda-cierres-action.test.ts` › «R4: sin sesión responde `unauthenticated` y NO instancia el servicio» | verde |
| **R5** | `mi-wallet-cierres.test.ts` › «R5: el método no admite entrada» y «R5: un objeto colado como segundo argumento no cambia el conjunto ni el alcance» **+** `wallet-tienda-cierres-action.test.ts` › «R5: un objeto colado como argumento no cambia el conjunto…» | verde |
| **R6** | `mi-wallet-cierres.test.ts` › «R1/R6…» y «R6: la fecha del repositorio viaja SIN transformar» **+** `mi-wallet-cierres-alcance.test.ts` › «R6: el conteo de movimientos es el de ESA tienda en ESE cierre, no el del cierre entero» **+** `wallet-tienda-movimiento-repository.test.ts` › «R6: cada fila lleva el cierre, la fecha ISO…» | verde |
| **R7** | `wallet-tienda-movimiento-repository.test.ts` › «R7: ordena por el movimiento mas reciente, descendente, con desempate determinista» **+** (con datos reales) `mi-wallet-cierres-alcance.test.ts` › «control de no-vacuidad…» | verde |
| **R8** | `mi-wallet-cierres.test.ts` › «R8: con el tope N y N+1 cierres devuelve N elementos y `hayMas` en true», «R8: con N cierres exactos devuelve N y `hayMas` en false», «R8: sin cierres…» **+** `wallet-tienda-config.test.ts` › los 4 casos de `MAX_CIERRES_FILTRO` | verde |
| **R9** | `mi-wallet-cierres.test.ts` › «R9: ninguna clave de la respuesta es un importe» **+** `wallet-tienda-movimiento-repository.test.ts` › «R9: la consulta NO pide ninguna suma de dinero…» **+** `mi-wallet-cierres-alcance.test.ts` › «R9: ninguna fila devuelta trae un importe, con dinero REAL en la tabla» | verde |
| **R10** | `wallet-tienda-movimiento-repository.test.ts` › «R10: una sola llamada al ORM, sin consultas por elemento» | verde |
| **R11** | `tests/unit/guards/mi-wallet-335.guardia.test.ts` › «ninguna carpeta de `db/migrations/` corresponde a esta ficha» + su contraprueba + «el esquema NO gana ningun objeto propio de esta ficha» | verde |
| **R16** (parte backend) | `mi-wallet-335.guardia.test.ts` › «barrido `Number(`/`parseFloat(`/`parseInt(`/`.toFixed(` sobre los archivos que la 172 no alcanza» + contraprueba **+** `tests/unit/guards/liquidacion-money-safe.test.ts` (existente, **sin editar**) | verde |
| **R17** | `mi-wallet-335.guardia.test.ts` › «ningun archivo de `app/(app)/mi-wallet/**` importa una action de mutacion» + contraprueba | verde |

R12–R15 y R18–R36 son de los bloques B, C y D: **no** los toca este agente.

---

## 4. LA MUTACIÓN DEL `WHERE` — salida ROJA real

Declararlo no cuenta. Se quitó a mano `tiendaId` del `where` de
`WalletTiendaMovimientoRepository.listarCierresDeTienda` y se corrieron las dos redes.

```
$ npx vitest run tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts \
                 tests/integration/db/mi-wallet-cierres-alcance.test.ts
EXIT=1

 ❯ tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts (24 tests | 1 failed) 28ms
     × R2: el groupBy de cierres lleva tiendaId, origenTipo cierre_dia y origenId no nulo en el WHERE 7ms
 ❯ tests/integration/db/mi-wallet-cierres-alcance.test.ts (4 tests | 3 failed) 365ms
     × control de no-vacuidad: la tienda A tiene al menos un cierre en su lista 60ms
     × R2: la lista de la tienda A NO contiene el cierre que solo movió dinero de la tienda B 11ms
     × R6: el conteo de movimientos es el de ESA tienda en ESE cierre, no el del cierre entero 11ms

⎯⎯⎯ Failed Tests 4 ⎯⎯⎯

 FAIL  … > control de no-vacuidad: la tienda A tiene al menos un cierre en su lista
AssertionError: expected [ …(6) ] to deeply equal [ …(2) ]
- Expected
+ Received
  [
+   "70ebf5e2-8f69-4bb5-9367-814f73545e29",
    "82ec05c9-913e-488b-ae13-2db07f1d4ea4",
+   "942993c5-9c11-4153-a207-9af086b22fc3",
    "c06f0028-11ef-4fe2-b588-5f9aebe9acd2",
+   "f4c93d88-3fbc-44e5-8ff6-e0b532fd6266",
+   "fea9e3d1-b232-4dd9-b3d7-6e347e0781fc",
  ]

 FAIL  … > R2: la lista de la tienda A NO contiene el cierre que solo movió dinero de la tienda B
AssertionError: expected [ …(6) ] to not include '041812d7-3185-492e-976e-8177b2ad753e'
 ❯ tests/integration/db/mi-wallet-cierres-alcance.test.ts:170:22

 FAIL  … > R6: el conteo de movimientos es el de ESA tienda en ESE cierre, no el del cierre entero
AssertionError: expected 4 to be 3 // Object.is equality
- Expected
+ Received
- 3
+ 4
 ❯ tests/integration/db/mi-wallet-cierres-alcance.test.ts:196:39

 FAIL  … > R2: el groupBy de cierres lleva tiendaId, origenTipo cierre_dia y origenId no nulo en el WHERE
AssertionError: expected { origenTipo: 'cierre_dia', …(1) } to deeply equal { tiendaId: 't1', …(2) }
- Expected
+ Received
  {
    "origenId": {
      "not": null,
    },
    "origenTipo": "cierre_dia",
-   "tiendaId": "t1",
  }
 ❯ tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts:460:23

 Test Files  2 failed (2)
      Tests  4 failed | 24 passed (28)
```

**Lo que esta salida enseña, y que no era obvio de antemano:** contra Postgres real, la tienda A
pasó de ver **2** cierres (los suyos) a ver **6** — los suyos, el de la tienda B **y los de otras
filas que ya vivían en la base**. Ése es exactamente el fallo que la ficha existe para no
cometer: sin `tienda_id` en el `WHERE`, el selector de una tienda ofrece los cierres de todas.

Restaurado el `tiendaId` inmediatamente después, y reverificado en verde:

```
$ npx vitest run tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts \
                 tests/integration/db/mi-wallet-cierres-alcance.test.ts
 Test Files  2 passed (2)
      Tests  28 passed (28)
```

**Honestidad sobre el alcance de la mutación en la capa unitaria:** de los 7 casos nuevos del test
de repositorio, sólo **uno** enrojece (el de R2). Los otros siguen verdes **y es correcto**: miden
el orden, el número de consultas y el mapeo, que la mutación no cambia. El comentario del bloque
en ese archivo lo dice así, no «los tres se ponen rojos».

---

## 5. Verificación — salidas reales

### `pnpm typecheck`

```
$ pnpm typecheck
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit
TYPECHECK_EXIT=0
```

> **Nota de entorno, ajena a la ficha.** La primera corrida salió con 4 errores `TS2307` por
> `yet-another-react-lightbox` en `app/(app)/mis-asignaciones/_components/chat/VistaPreviaMedia.tsx`:
> el paquete está en `package.json` y en `pnpm-lock.yaml` pero **no estaba instalado** en este
> árbol. Se resolvió con `pnpm install --frozen-lockfile` (lockfile intacto, `+1 paquete`). No es
> el modo de fallo de `.next/dev` que avisaba el encargo; era una dependencia sin instalar.

### `pnpm lint`

```
$ pnpm lint
LINT_EXIT=0
✖ 127 problems (0 errors, 127 warnings)
```

**0 errores.** Los 127 warnings son preexistentes (`no-unused-vars` en tests ajenos,
`no-img-element` en `Sidebar.tsx`); **ninguno cae en un archivo de esta ficha**.

### `pnpm exec vitest related --run` sobre los 7 archivos de producción tocados

```
$ pnpm exec vitest related --run lib/config/wallet-tienda.ts lib/types/wallet-tienda.ts \
    lib/interfaces/repositories/IWalletTiendaMovimientoRepository.ts \
    lib/interfaces/services/IWalletTiendaService.ts \
    lib/repositories/WalletTiendaMovimientoRepository.ts \
    lib/services/WalletTiendaService.ts lib/actions/wallet-tienda.ts
RELATED_EXIT=0

 Test Files  81 passed (81)
      Tests  1242 passed | 17 skipped (1259)
   Duration  113.85s
```

### Corrida explícita POR NOMBRE de los 18 archivos de test creados o modificados

(`vitest related` no alcanza a los que sólo importan tipos; se corren aparte, más
`paginacion-dominios.test.ts`, que A1 exige que siga verde sin editarlo.)

```
$ pnpm exec vitest run \
    tests/unit/config/wallet-tienda-config.test.ts \
    tests/unit/config/paginacion-dominios.test.ts \
    tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts \
    tests/unit/services/mi-wallet-cierres.test.ts \
    tests/unit/actions/wallet-tienda-cierres-action.test.ts \
    tests/integration/db/mi-wallet-cierres-alcance.test.ts \
    tests/unit/guards/mi-wallet-335.guardia.test.ts \
    tests/unit/actions/wallet-tienda-actions.test.ts \
    tests/integration/db/cierre-detail-congelado.test.ts \
    tests/integration/db/wallet-idempotencia.test.ts \
    tests/unit/repositories/cierres-admin-anclaje-devolucion.test.ts \
    tests/unit/repositories/cierres-admin-caja-cod.test.ts \
    tests/unit/repositories/cierres-admin-confirmacion-fisica.test.ts \
    tests/unit/repositories/cierres-admin-indemnizacion.test.ts \
    tests/unit/repositories/cierres-admin-repository.test.ts \
    tests/unit/repositories/CierresAdminRepository.resolverCierre.devolucion.test.ts \
    tests/unit/services/mi-wallet-desglose.test.ts \
    tests/unit/services/wallet-tienda-service.test.ts
NOMBRADOS_EXIT=0

 Test Files  18 passed (18)
      Tests  221 passed (221)
```

### Los dos guardias que las tareas nombran como criterio

```
$ pnpm exec vitest run tests/unit/guards/liquidacion-money-safe.test.ts
MONEYSAFE_EXIT=0
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

```
$ pnpm exec vitest run tests/unit/guards/superficie-de-uso.guardia.test.ts
SUPERFICIE_EXIT=1
 ❯ (18 tests | 1 failed)
     × ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotación `@sin-superficie`
+ [
+   "lib/actions/tarifas.ts:67 obtenerTarifa",
+   "lib/actions/wallet-tienda.ts:205 listarMisCierresAction",
+ ]
```

**Los dos rojos, uno por uno:**

1. `listarMisCierresAction` — **esperado y previsto por A8**: entre A8 y B1 la action no tiene
   consumidor porque `page.tsx` todavía no la llama. **B1 lo cierra.** El `tasks.md` es explícito:
   *no se anota `@sin-superficie`*. Si tras B1 siguiera rojo, el problema es la implementación.
2. `obtenerTarifa` — **rojo ajeno preexistente**, no de esta ficha. Está catalogado en
   `tests/baseline-rojos.json`, en `docs/release.md:420` y en `progress/current.md`.
   `lib/actions/tarifas.ts` no aparece ni en `git status --porcelain` ni en
   `git diff --name-only origin/dev...HEAD` de esta rama.

---

## 6. Decisiones, límites y desviaciones declaradas

1. **El `orderBy` compuesto del `groupBy` SÍ lo admite el ORM.** El design §2.2 preveía tener que
   degradar a un desempate en memoria; no hizo falta. **Cero desviaciones respecto al design.**
2. **La lista de dobles del `tasks.md` era una predicción, no el conjunto.** 11 archivos, no 7
   (§2/A3). Se siguió el criterio del propio `tasks.md`: la lista la da `pnpm typecheck`.
3. **Límite conocido del `describe.skip` de A12.** Se ejercitó **con base alcanzable**: los 4
   casos corren y pasan (483 ms de tiempo real de consulta). La rama «sin base» usa la línea
   estándar del arnés (`HAY_BASE_DE_DATOS ? describe : describe.skip`, idéntica a
   `premio-ranking-idempotencia.test.ts`) y **no se pudo forzar localmente**: `process.loadEnvFile()`
   no sobreescribe una `DATABASE_URL` ya presente en el entorno, así que ponerla vacía no produce
   `undefined` sino `""`. Es una propiedad del arnés compartido, no de este test. Lo que sí está
   cerrado es el modo de fallo que preocupa: **no hay ningún `if (!x) return;`** que reporte
   *passed* sin comprobar nada, y sin catálogo el `beforeAll` falla **ruidosamente**.
4. **La lectura NO nombra al mensajero del cierre** (decisión del leader, no reabierta). Dos
   cierres del mismo día se desambiguan con el conteo y con la hora, que ya vienen en la misma
   consulta.
5. **Sin migración y sin índice nuevo** (R11). El `WHERE` arranca por `tienda_id`, cabecera de
   `@@index([tiendaId, fechaMovimiento])`. La guardia de A13 afirma que ese índice sigue ahí: sin
   él, «sin migración» seguiría siendo cierto pero la consulta se quedaría sin plan.
6. **Un archivo del bloque A queda compartido con el bloque D.**
   `tests/unit/guards/mi-wallet-335.guardia.test.ts` lo creó A13 y D6 le añadirá los dos casos de
   R33. Está escrito con secciones separadas por requisito para que ese añadido no toque nada.

---

## 7. Lo que le queda al siguiente agente (frontera del bloque A)

El backend está completo y verde. B1 tiene que añadir `listarMisCierresAction()` al `Promise.all`
de `app/(app)/mi-wallet/page.tsx` y degradar —no `notFound()`— cuando no responda `ok`. Ese import
es además lo que cierra el rojo esperado de `superficie-de-uso.guardia.test.ts`.

**Veredicto:** bloque A (A1–A13) completo; typecheck y lint en verde, 221 tests nombrados y 1.242
relacionados en verde, y el alcance por tienda probado contra Postgres real con su mutación en
rojo pegada arriba.

---
---

# Ficha 335 — Bitácora de los BLOQUES B, C y D (frontend + la puerta)

> Continúa la bitácora del bloque A (arriba). El bloque A ya estaba commiteado (`6f83a697`) y
> **no se tocó una línea de `lib/` del módulo `wallet-tienda`**.
> Orden ejecutado, que es el que pidió el humano: **B (presentación) → C (selector) → D (la
> puerta)**. El ítem de menú entró EL ÚLTIMO, con la pantalla ya terminada.

---

## B/C/D.0 — Archivos creados / modificados

### Producción (4 modificados, 1 creado)

| Archivo | Qué |
| --- | --- |
| `app/(app)/mi-wallet/page.tsx` | B1: tercera lectura en el `Promise.all` + degradación (no `notFound`) + prop. D1: el gate lee `ROLES_MI_WALLET` |
| `app/(app)/mi-wallet/_components/MiWalletModule.tsx` | B2: dos `Card` hermanas, `gap-6`, banda de filtros, `CardFooter` con la paginación |
| `app/(app)/mi-wallet/_components/MiWalletFiltros.tsx` | B3 (bloque → barra) + C2 (el `Select` sustituye al `<Input placeholder="ID del cierre">`) |
| `app/(app)/mi-wallet/_components/mi-wallet-cierres.ts` | **CREADO** (C1): `CierresDeLaTienda`, `CIERRE_TODOS_OPTION`, `opcionesDeCierre` |
| `lib/auth/menu-visibility.ts` | D1: `ROLES_MI_WALLET`. D2: el ítem «Mi wallet», después de «Wallet» |

### Tests creados (2)

- `tests/components/MiWalletFiltros.test.tsx` (C3) — 13 casos.
- `tests/unit/components/mi-wallet-cierres-opciones.test.ts` (C4) — 13 casos.

### Tests modificados (5)

- `tests/integration/mi-wallet-page.test.tsx` (B4 + D5): `listarMisCierresAction` en el `vi.mock`
  y sembrada en `beforeEach`; 18 casos nuevos. **De 11 a 29, y los 11 originales sin tocar una
  aserción.**
- `tests/unit/auth/menu-visibility.test.ts` (D3 + D4): el literal del `adminTienda` a mano + 3
  casos nuevos.
- `tests/unit/guards/pwa-manifiesto-atajos.guardia.test.ts` (D3): `adminTienda: 3 -> 4`, a mano.
- `tests/unit/guards/mi-wallet-335.guardia.test.ts` (D6): 5 casos nuevos de R33.
- `tests/components/descarga/WalletDescarga.test.tsx`: le faltaba la prop `cierres`, **requerida y
  sin default**. Lo cazó `pnpm typecheck`, no un test en rojo — ruidoso, que es como este repo lo
  prefiere. No estaba en la lista del `tasks.md`; la lista la da el compilador.

---

## B/C/D.1 — Tarea por tarea

### B1 — la tercera lectura, y la degradación

`page.tsx` pide `listarMisCierresAction()` **sin argumentos** dentro del `Promise.all` existente y
construye `CierresDeLaTienda`. **NO hay un tercer `notFound()`**: cuando esa lectura no responde
`ok` la pantalla se pinta igual y lo único que se degrada es el selector. El saldo y el libro SON
la pantalla; el filtro es una comodidad, y que se caiga una comodidad no puede esconderle a la
tienda su dinero. Está probado en las dos direcciones (M5, abajo).

`CierresDeLaTienda` vive en `mi-wallet-cierres.ts` y no en `MiWalletModule.tsx`: el filtro también
lo necesita, y declararlo en el módulo habría creado un import circular de tipos entre módulo y
filtro. **Consecuencia de secuencia declarada:** el archivo de C1 se creó durante B1 porque B1
necesita ese tipo; su lógica de etiquetado (`opcionesDeCierre`) es lo que se verificó en C.

### B2 — la gramática de `/wallet`, copiada; sus piezas, NO

Se copió el lenguaje visual (`Card` / `CardHeader` con título / banda de filtros / `CardFooter` con
la paginación) y **no se importó ni un componente de `/wallet`**:
`tests/unit/guards/caja-173-alcance.guardia.test.ts` lo prohíbe y sigue verde sin editarlo.

`sticky={false}` en la `Pagination` **no es cosmético**: en modo pegajoso el control devuelve un
fragmento de DOS elementos (envoltorio + centinela de 1px) y el `display:flex` del pie los
colocaría como dos columnas. El caso R15 lo afirma midiendo que el pie tiene **un solo hijo**.

`SaldoTiendaCard` **no se tocó por dentro** (ni un byte): solo desapareció el envoltorio
`lg:max-w-md` que la encajonaba en media pantalla. Las seis aserciones de la 172 que navegan ese
árbol siguen verdes.

### B3 / C2 — de bloque a barra, y el UUID fuera

El contrato del componente (`onAplicar`/`onLimpiar`/`disabled`) no cambia; gana `cierres`,
**requerida y sin default** en los dos eslabones. El `htmlFor` del rótulo apunta a un `id` **real**
del trigger — el defecto que `/wallet` documentó haber arreglado y que aquí no se repite.

El aviso bajo el selector **no lleva `role="note"`**. La pantalla tiene exactamente uno (el de la
tarjeta del saldo) y `mi-wallet-page.test.tsx` lo busca en **singular**: un segundo `note` habría
puesto rojos dos casos de la 172 sin hacer la pantalla más accesible. Se afirma explícitamente
(`getAllByRole("note")` con longitud 1, y que el aviso del tope **no** es ese).

### C1 / C4 — el etiquetado

`Cierre del 2026-07-12 · 4 movimientos`. El día sale de `fechaDiaISO`, **la misma función** que usa
la descarga y que produce el mismo día que el `slice(0, 10)` de la columna «Fecha» — se compara
contra la función, no contra un literal escrito a mano. Trampa horaria declarada: los dos son el
día **UTC**; un formateador de calendario local haría que la opción dijera un día y las filas de al
lado otro.

Cuando dos etiquetas base coinciden, se les añade la hora **a las dos** (no solo a la repetida:
marcar una sola haría creer que la otra es «la del día»). **Límite declarado y con test propio:**
la hora colapsa al minuto, así que dos cierres del mismo minuto comparten etiqueta — sus `value`
siguen siendo distintos, así que el filtro funciona igual.

**Decisión del leader, implementada sin reabrir:** la opción NO nombra al mensajero del cierre.

### D1–D6 — la puerta, al final

- `ROLES_MI_WALLET` es **una sola constante**, leída por el ítem (`roles:`) y por el gate de la
  ruta. `page.tsx` no contiene **ningún** literal de rol, y D6 lo afirma con su contraprueba.
- El ítem va **después de «Wallet»**, o sea después de «Órdenes» y de «Novedades». El aterrizaje
  post-login del `adminTienda` sigue siendo `/ordenes`, y hay un caso que lo afirma **con su
  contraprueba** (con el ítem arriba, `primerDestino` devolvería `/mi-wallet`). No lleva
  `destinoInicial: false`, porque `destino-post-login.test.ts` afirma que los marcados son
  exactamente `["/analitica","/monitoreo"]`.
- Los **dos contratos literales** se actualizaron A MANO, con su motivo escrito al lado, y sin
  relajarse a `toContain`.

**Desvío pequeño y declarado (D1):** el ensanchado del tipo se escribe
`readonly Actor["rol"][]` y no `readonly RolValue[]` como el precedente del histórico. Motivo
medido: la guardia A13 de esta misma ficha prohíbe que un archivo de `/mi-wallet` importe de
`@prisma/client` —es la vía por la que `Prisma.Decimal` llega al navegador— y ese barrido **no
distingue un `import type`**. Se prefirió no tocar la guardia (relajarla para que pase el código
nuevo es exactamente el anti-patrón) y usar el tipo del propio actor, que además es de lo que se
habla. `Actor["rol"]` **es** `RolValue`: el gate no se debilita.

---

## B/C/D.2 — Mapa `R<n> → test`, con la salida real

| R | Test | Estado |
| --- | --- | --- |
| R12 | `mi-wallet-page.test.tsx` «R12: el saldo y el libro son dos tarjetas hermanas…» + «R12: el saldo ya NO va encajonado…» | ✅ |
| R13 | `mi-wallet-page.test.tsx` «R13: la tarjeta del libro lleva un título visible» | ✅ |
| R14 | `mi-wallet-page.test.tsx` «R14: los filtros se renderizan dentro de la tarjeta…» | ✅ |
| R15 | `mi-wallet-page.test.tsx` «R15: la paginación está en el pie…» | ✅ |
| R16 | `liquidacion-money-safe.test.ts` (sin editar) + `mi-wallet-335.guardia.test.ts` | ✅ |
| R17 | `mi-wallet-335.guardia.test.ts` «ningun archivo de `/mi-wallet` importa una action de mutacion» | ✅ |
| R18 | `wallet-tienda-descarga-columnas.test.ts` (sin editar) | ✅ |
| R19 | `mi-wallet-page.test.tsx`, bloque R55 (sin editar) | ✅ |
| R20 | `MiWalletFiltros.test.tsx` «R20: los textos del selector están en voseo y sin jerga» + «el tuteo peninsular no se cuela» | ✅ |
| R21 | `desglose-tienda-labels.test.ts` (sin editar) | ✅ |
| R22 | `MiWalletFiltros.test.tsx` «R22: el filtro de cierre es un `combobox`…» + «el rótulo cuelga de un `id` REAL» | ✅ |
| R23 | `mi-wallet-cierres-opciones.test.ts` «R23: la etiqueta lleva el día…» + «el día es el MISMO que la columna Fecha» | ✅ |
| R24 | `mi-wallet-cierres-opciones.test.ts` «R24: dos cierres del MISMO día…» + «CONTRAPRUEBA: cuando no hay colisión, NO lleva hora» | ✅ |
| R25 | `MiWalletFiltros.test.tsx` «R25: la primera opción es “Todos los cierres”…» | ✅ |
| R26 | `MiWalletFiltros.test.tsx` «R26: al elegir un cierre y aplicar, se emite su `cierreId`» | ✅ |
| R27 | `MiWalletFiltros.test.tsx` «R27: “Limpiar” devuelve el selector a “Todos los cierres”» | ✅ |
| R28 | `mi-wallet-page.test.tsx` «R28: sin cierres, el selector queda deshabilitado y la pantalla lo dice» | ✅ |
| R29 | `mi-wallet-page.test.tsx` «R29: … el saldo y el libro siguen en pantalla y NO hay notFound» (+ el caso `unauthenticated`) | ✅ |
| R30 | `mi-wallet-page.test.tsx` «R30: con `hayMas`, la pantalla avisa… y sin un segundo `role=note`» | ✅ |
| R31 | `menu-visibility.test.ts` «R31: existe exactamente UN ítem con href `/mi-wallet`…» | ✅ |
| R32 | `menu-visibility.test.ts` «R32: ningún rol distinto de `adminTienda` lo ve, ni el actor ausente» | ✅ |
| R33 | `mi-wallet-335.guardia.test.ts` «`page.tsx` no contiene NINGUN literal de rol» + «el `roles` del ítem es la MISMA referencia» | ✅ |
| R34 | `mi-wallet-page.test.tsx` «R34: `<rol>` recibe notFound()…» (5 casos derivados de la constante, `apiKey` incluida) | ✅ |
| R35 | `destino-post-login.test.ts` + `menu-historico.test.ts` (sin editar) + `menu-visibility.test.ts` «R35: el ítem va DESPUÉS…» | ✅ |
| R36 | `rastreo-sin-ruta-nueva.guardia.test.ts` (sin editar) | ✅ |

---

## B/C/D.3 — LAS CINCO MUTACIONES, con su salida ROJA real

Ninguna guardia se declara sin verla caer. Cada mutación se aplicó al árbol, se corrió, se anotó y
se revirtió; al final se reverificó el verde.

### M1 — el selector manda el TEXTO en vez del `cierreId`

`mi-wallet-cierres.ts`: `value: cierre.cierreId` → `value: base[i]`.

```
     × CONTROL: el identificador SÍ viaja, pero en el `value`, que es lo que el filtro usa 6ms
     × LÍMITE DECLARADO: dos cierres del mismo MINUTO … pero no el mismo valor 1ms
     × respeta el orden del servidor (más reciente primero) … 2ms
     × R26: al elegir un cierre y aplicar, se emite su `cierreId` 259ms
     × R26: cada opción emite SU identificador, no siempre el primero 199ms
AssertionError: expected 'Cierre del 2026-07-12 · 4 movimientos' to be 'c-2'
AssertionError: expected 'Cierre del 2026-08-01 · 7 movimientos' to be 'c-1'
 Test Files  2 failed (2)
      Tests  5 failed | 21 passed (26)
```

### M2 — el ítem aparece para un rol que NO es `adminTienda`

`ROLES_MI_WALLET = ["adminTienda", "mensajero"]`.

```
     × mensajero ve Entregas + Recolección + Ranking + Cierre del día, NO … 8ms
     × R31: existe exactamente UN ítem con href `/mi-wallet` y su `roles` es la CONSTANTE 1ms
     × R32: ningún rol distinto de `adminTienda` lo ve, ni el actor ausente 1ms
     × hoy no hay ni un destino que vean todos los roles: por eso son cero atajos 9ms
     × roles != adminTienda NO ven su wallet (notFound), sin pre-fetch de datos 729ms
     × CONTROL DE NO-VACUIDAD: hay roles denegados y `adminTienda` no está entre ellos 1ms
AssertionError: expected [ 'adminTienda', 'mensajero' ] to deeply equal [ 'adminTienda' ]
AssertionError: promise resolved "{ …(10) }" instead of rejecting
 Test Files  3 failed | 1 passed (4)
      Tests  6 failed | 92 passed (98)
```

Cae en las **tres** capas a la vez: el menú, el contrato literal del PWA y el gate de la ruta.

### M3 — el aviso del tope NO sale con `hayMas: true`

`MiWalletFiltros.tsx`: se borra la rama `cierres.hayMas ? …`.

```
     × R30: con más cierres de los que caben, avisa de que solo ofrece los recientes 23ms
     × R30: con `hayMas`, la pantalla avisa … y sin un segundo `role=note` 30ms
TestingLibraryElementError: Unable to find an element with the text:
  Mostramos los cierres más recientes.
 Test Files  2 failed (2)
      Tests  2 failed | 40 passed (42)
```

### M4 — el ítem se coloca ANTES de «Órdenes» (el incidente que el spec temía)

Se mueve la entrada al principio de `SIDEBAR_ITEMS`.

```
     × adminTienda aterriza en /ordenes (NO en /analitica, aunque ese ítem le sea visible…) 5ms
     × adminTienda ve Analítica + Órdenes + Novedades + Mi wallet, NO Configuración… 7ms
     × R54: el aterrizaje post-login de CADA rol es el mismo que antes de añadir el ítem 2ms
     × R35: el ítem va DESPUÉS de «Órdenes» y de «Novedades», así que no mueve el aterrizaje 0ms
     × adminTienda sigue aterrizando en /ordenes 5ms
AssertionError: expected '/mi-wallet' to be '/ordenes'
 Test Files  3 failed (3)
      Tests  5 failed | 69 passed (74)
```

**Es el cambio que el spec avisaba que ocurriría EN SILENCIO** — y hoy ya no puede: lo cazan
`destino-post-login`, `menu-historico` y el caso propio de D4.

### M5 — un tercer `notFound()` cuando la lectura de cierres falla

`page.tsx`: se añade `|| cierresResult.status !== "ok"` al guard de defensa en profundidad.

```
     × R29: si la lectura de cierres no responde ok, el saldo y el libro siguen en pantalla y NO hay notFound 5ms
     × R29: el estado `unauthenticated` de esa lectura tampoco tumba la pantalla 1ms
AssertionError: promise rejected "NotFoundError: NEXT_NOT_FOUND" instead of resolving
 Test Files  1 failed (1)
      Tests  2 failed | 27 passed (29)
```

**Reversión comprobada:** tras deshacer las cinco, `git diff --stat` vuelve a 9 archivos y los 7
archivos de test corren en verde (144/144).

---

## B/C/D.4 — El hueco de `superficie-de-uso.guardia`, cerrado y MEDIDO

Este es el dato que cierra el trabajo, y se mide **antes y después** porque el gate compara **por
archivo** y el archivo YA está en `tests/baseline-rojos.json`: sin esta comprobación explícita, un
`listarMisCierresAction` olvidado habría salido **verde mintiendo**.

**ANTES de B1** (el hueco esperado entre A8 y B1):

```
+ [
+   "lib/actions/tarifas.ts:67 obtenerTarifa",
+   "lib/actions/wallet-tienda.ts:205 listarMisCierresAction",
+ ]
```

**DESPUÉS de B1** (`page.tsx` la importa y la llama):

```
+ [
+   "lib/actions/tarifas.ts:67 obtenerTarifa",
+ ]
```

Queda **solo la deuda ajena preexistente**, que es exactamente el motivo escrito en el baseline
(`"La guardia de superficie de uso senala lib/actions/tarifas.ts:67 obtenerTarifa. Ajeno a las
features de chat; probablemente de la ficha 274"`, desde `2026-08-28`).
**No se anotó `@sin-superficie` en ningún sitio**, como prohíbe el `tasks.md`.

---

## B/C/D.5 — Verificación

### `pnpm typecheck`

```
> ordenex@0.1.0 typecheck
> tsc --noEmit
```

Verde. En su primera pasada **mordió**, que era la señal correcta:

```
tests/components/descarga/WalletDescarga.test.tsx(293,6): error TS2741: Property 'cierres' is
missing in type '{ … }' but required in type 'MiWalletModuleProps'.
```

Es la prop requerida sin default haciendo su trabajo: el compilador garantiza la inyección, no la
buena voluntad de quien monte el módulo mañana.

### `pnpm lint`

```
✖ 127 problems (0 errors, 127 warnings)
```

**0 errores.** Los 127 warnings son `no-unused-vars` preexistentes en archivos ajenos; un grep por
`mi-wallet`, `MiWallet`, `menu-visibility`, `pwa-manifiesto` y `WalletDescarga` sobre esa salida
devuelve **cero líneas**.

### `pnpm exec vitest related --run` (los 5 archivos de producción tocados)

```
 Test Files  34 passed (34)
      Tests  466 passed | 17 skipped (483)
   Duration  26.26s
```

### Corrida explícita POR NOMBRE de los 7 archivos de test creados o modificados

```
 Test Files  7 passed (7)
      Tests  144 passed (144)
   Duration  10.99s
```

### D7 — los ocho que tenían que seguir verdes SIN tocarlos

```
 Test Files  8 passed (8)
      Tests  99 passed (99)
```

`destino-post-login.test.ts`, `menu-historico.test.ts`, `rastreo-sin-ruta-nueva.guardia.test.ts`,
`wallet-tienda-descarga-columnas.test.ts`, `desglose-tienda-labels.test.ts`,
`caja-173-alcance.guardia.test.ts`, `mi-wallet-desglose.test.ts` y
`liquidacion-money-safe.test.ts`. **Ninguno aparece en `git status --porcelain`**, comprobado.

### Finales de línea

Tres archivos quedaron en CRLF al editarlos con un script; el repo manda `* text=auto eol=lf` en
`.gitattributes`. Se normalizaron a LF **antes** de terminar, para no dejar un diff de archivo
entero por un cambio de tres líneas.

---

## B/C/D.6 — Límites y decisiones declaradas

1. **La lista de cierres se lee UNA vez, en la carga.** Es el catálogo del libro, no depende de los
   filtros vigentes, así que `recargar()` no la vuelve a pedir. Precio aceptado y escrito: un
   cierre que entre con la pantalla abierta no aparece hasta recargar la ruta.
2. **La hora del desempate colapsa al minuto.** Dos cierres del mismo minuto comparten etiqueta;
   sus `value` no. Tiene test propio, para que quien quiera bajar al segundo sepa qué se decidió.
3. **El filtro de cierre solo alcanza movimientos de origen `cierre_dia`.** Los de `pago_tienda` y
   `manual` quedan fuera de cualquier opción — es una propiedad del filtro que ya existía
   (`cierreId` casa contra `origen_tipo = 'cierre_dia'`), no algo que esta ficha introduzca. La
   pregunta abierta 4 del `requirements.md` sigue abierta.
4. **`Actor["rol"]` en vez de `RolValue`** en `page.tsx` (§B/C/D.1, D1–D6). Es el mismo tipo; el
   motivo es la guardia de imports de la propia ficha.
5. **`mi-wallet-cierres.ts` se creó durante B1**, no durante C1, porque B1 necesita el tipo
   `CierresDeLaTienda` y ponerlo en `MiWalletModule.tsx` habría creado un ciclo de tipos con
   `MiWalletFiltros.tsx`. El etiquetado (lo que C1 aporta de verdad) se verificó en el bloque C.
6. **`WalletDescarga.test.tsx` entró en el diff sin estar en el `tasks.md`.** Lo exigió el
   typecheck, no un test rojo. La lista de consumidores la da el compilador, igual que pasó con
   los dobles del bloque A.

**Veredicto de los bloques B, C y D:** completos (B1–B4, C1–C4, D1–D7). Typecheck y lint en verde,
144 tests nombrados y 466 relacionados en verde, los 8 intocables verdes y fuera del diff, cinco
mutaciones con su rojo pegado, y el hueco de `superficie-de-uso` cerrado y medido. El bloque E
(cierre y gate) es del leader.
