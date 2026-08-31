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
