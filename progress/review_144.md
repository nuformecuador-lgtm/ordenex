# Review (RE-REVIEW) — Feature 144 · Componente de filtros parametrizable + su implementación en órdenes

> Reviewer. Worktree `../ordenex-wt-144`, rama `feature/144-filtros-ordenes`, HEAD `c606abf`.
> Esta es la **segunda pasada**. La primera (sobre `825b24d`) dio **RECHAZADO** por dos
> bloqueantes de verificación ejecutable. El commit `c606abf` los ataca; aquí se verifica
> si están realmente cerrados y se re-confirma el fondo.
> Diff de la feature: `git diff origin/dev...HEAD` = 63 archivos, +6859/-96.
> Delta desde la review anterior: `git diff 825b24d..HEAD` = **2 archivos, ambos de test,
> +19/-2**. Ni una línea de código de producción se movió.
> Todo lo de abajo está **medido en este worktree**, no citado de la bitácora.

---

## Veredicto

**OK** — 0 bloqueantes. 11 menores (9 heredados de la review anterior + 2 nuevos), ninguno
impide el merge; 2 son de cierre del leader.

Los dos bloqueantes están cerrados y los fixes son **correctos y proporcionados**: no
esconden el problema, no aflojan ninguna aserción y ninguno toca producción.

---

## 1. Estado de los dos bloqueantes

### BLOQUEANTE 1 (cerrado) — `tests/integration/db/notificacion-migration.test.ts`

El fix excluye `_orden_indices_filtros` del cálculo de `previas`, con comentario que dice
por qué. Verificado que es **exactamente el patrón que el repo ya usa**:
`zonas-migration.test.ts:124-217` mantiene una lista de ~15 exclusiones (features 17, 30,
... 138, 139, 146) y compara con el mismo razonamiento ("el invariante es que la carpeta
propia NO sea ANTERIOR a las previas"). El fix no inventa un patrón nuevo ni desactiva el
test: sigue afirmando el orden contra todas las migraciones anteriores.

Medido: `notificacion-migration.test.ts` + `zonas-migration.test.ts` +
`orden-indices-filtros-migracion.test.ts` + `OrdenesPageFiltros.test.tsx` -> **75/75 verdes**,
y verde en las corridas completas de la suite (ver 2).

Matiz honesto: el mensaje del commit dice "una migracion con timestamp ANTERIOR sin excluir
sigue fallando". Leyendo el assert, lo que se conserva es lo contrario y lo útil: una
migración **posterior** no excluida hace fallar el test (es justo lo que pasó con la 144), y
una anterior lo deja pasar correctamente. La semántica protegida es la buena; solo la frase
del commit está torcida. No es hallazgo.

### BLOQUEANTE 2 (cerrado) — `tests/components/OrdenesPageFiltros.test.tsx`

El fix añade `configure({ asyncUtilTimeout: 10000 })` en la cabecera del archivo, con
comentario que explica que los `findBy*` NO se rigen por el `testTimeout: 20000` de vitest
sino por el `asyncUtilTimeout` de `waitFor` (default 1000 ms).

**¿Enmascara una espera rota o es margen legítimo?** Es margen legítimo. Razones medidas:

1. **El diagnóstico es verificablemente correcto.** `findByRole` = `waitFor` + `getBy`; su
   timeout es el de testing-library, no el de vitest. El archivo pasaba siempre en
   aislamiento y fallaba solo bajo la suite completa: eso es contención de CPU, no una
   promesa que no resuelve.
2. **No afloja lo que se afirma.** Las aserciones son idénticas (`toBeEnabled`,
   `toBeDisabled`, `toBeNull`, `toHaveBeenCalledWith`). Un `findBy` genuinamente roto sigue
   fallando: a los 10 s en vez de a 1 s, y siempre por debajo del `testTimeout` de 20 s.
   **La red de seguridad no se retira, se le da holgura.**
3. **Es el mismo razonamiento que el repo ya aceptó** y documentó en `vitest.config.ts:12-19`
   para `testTimeout: 20000` ("un test genuinamente colgado sigue fallando a los 20s; esto
   solo da holgura para la contencion, para que ./init.sh sea un gate confiable"). El fix es
   la pieza que faltaba de esa misma decisión, aplicada a la otra familia de timeouts.
4. **No hay fuga a otros archivos.** `configure()` es global al registro de módulos, pero
   `vitest.config.ts` no desactiva `isolate` ni fija `pool`: cada archivo corre en su propio
   entorno aislado (pool forks, isolate true por defecto en vitest 4.1.10).

Riesgo residual aceptado: si esa espera se rompe de verdad, tardará ~10 s por caso en
delatarlo. Coste de diagnóstico, no de detección.

---

## 2. Verificación ejecutable — lo que medí YO en este worktree

| Comando | Resultado |
| --- | --- |
| `pnpm typecheck` | **0 errores** |
| `pnpm lint` (dentro de `./init.sh`) | **0 errores**, 145 warnings, ninguno de archivos de la 144 |
| `pnpm test` — corrida 1 | **554 archivos / 5839 tests verdes**, exit 0, 238 s |
| `./init.sh` (typecheck + lint + test + down.sql + .env) | **VERDE**, `== init OK ==`, exit 0. Suite dentro: 5839/5839 |
| `pnpm test` — corrida 3 | **2 fallos en 1 archivo**, exit 1 — `tests/integration/recuperar-contrasena-form.test.tsx`, que la 144 NO toca (ver menor 11) |
| `git diff origin/dev...HEAD -- package.json pnpm-lock.yaml` | **VACÍO** (cero dependencias nuevas, T6.3 OK) |
| `git status --short` al terminar | limpio salvo este propio archivo |

Aislamientos:
- Los 2 archivos del fix + los 2 tests de invariante de migración: **75/75 verdes**.
- `recuperar-contrasena-form.test.tsx` aislado: **7/7 verdes en 6,8 s**.

**Ningún archivo de la feature 144 falló en ninguna de mis corridas.** `OrdenesPageFiltros`
—el flaky del BLOQUEANTE 2— pasó en las tres corridas completas y en aislamiento.

---

## 3. Veredicto sobre el `EnvironmentTeardownError` y sobre la corrida 3

El leader reportó, en una de sus tres corridas post-fix, un `EnvironmentTeardownError:
[vitest-worker]: Closing rpc while "onUserConsoleLog" was pending` atribuido a
`OrdenesPageFiltros.test.tsx`, sin ningún test fallado pero con exit code distinto de 0. En
mi corrida 3 apareció un síntoma distinto de la misma familia: 2 fallos en
`recuperar-contrasena-form.test.tsx`, en un `await screen.findByLabelText(...)`.

**Juicio: NO bloquea el merge.** Fundamento:

1. **No es defecto de esta feature.** El `EnvironmentTeardownError` es una carrera del worker
   de vitest (se cierra el canal RPC mientras un console en vuelo intenta reenviarse); vitest
   lo atribuye al archivo cuyo entorno estaba desmontando, que no es necesariamente el
   culpable. Verificado que **no hay ni un `console.*` en el código de producción de la 144**
   ni en sus tests, y que el único camino de error del árbol (`resolverCatalogoFiltros`)
   **captura** la excepción (`app/(app)/ordenes/page.tsx:37-44`), así que no hay rechazo sin
   manejar que dispare un log tardío.
2. **La flakiness de la suite es deuda del arnés, anterior a esta rama y documentada.**
   `recuperar-contrasena-form.test.tsx` figura como flaky bajo contención en
   `progress/impl_120.md:174`, `progress/impl_143-descargar-errores-carga-masiva.md:25`,
   `progress/impl_146_backend.md:268-269` y `progress/impl_144_backend.md:165` — features que
   ya estaban en `dev` antes de la 144. Pasa 7/7 en aislado. Su fallo es literalmente el mismo
   mecanismo del BLOQUEANTE 2 (un `findBy*` con el default de 1000 ms), en un archivo ajeno.
3. **Bloquear la 144 no arreglaría nada.** No hay cambio posible en esta feature que elimine
   ese ruido; el arreglo real es de arnés (menor 11). Exigirle a esta rama que cierre deuda
   preexistente de todo el repo sería mover la portería.

Lo que sí anoto, sin maquillar: **`./init.sh` en este repo no es hoy un gate 100 %
determinista**, y eso es independiente de la 144. El leader debe contar con que la corrida de
merge puede necesitar repetirse, y con que el fix de raíz merece su propio chore.

---

## 4. Checklist (CHECKPOINTS.md)

### Especificación
- [x] `specs/144-filtros-ordenes/requirements.md` con EARS numerados `R1`-`R65`.
- [x] `design.md` (806 líneas) con alternativas descartadas y su porqué (0: el date-range de
      shadcn descartado con la dependencia medida; Server Action cacheada descartada frente al
      `Promise.all` en el Server Component).
- [x] `tasks.md`: **todas** las tasks marcadas `[x]` (0 casillas sin marcar, verificado por grep).

### Trazabilidad
- [x] Los **65** `R<n>` mapean a un test concreto **con aserciones reales** (verificado en la
      primera pasada leyendo las aserciones, no los nombres — ver 6; sigue vigente porque
      `c606abf` no tocó ninguna aserción de requisito).
- [~] `progress/impl_<feature>.md` con el mapa `R->test`: existe **solo el del backend**
      (`impl_144_backend.md`, mapa completo de R30-R54 con nombres exactos). **No existe
      `progress/impl_144_frontend.md`** pese a que `tasks.md` lo cita. -> menor 1.

### Calidad de código
- [x] `pnpm typecheck`: **0 errores**.
- [x] `pnpm lint`: **0 errores**, 145 warnings, ninguno de archivos de la 144.
- [x] `pnpm test`: **5839/5839** en 2 de mis 3 corridas y dentro de `./init.sh`. La tercera
      cayó por un flaky ajeno y preexistente (3, menor 11). **Cero fallos atribuibles a la
      144 en cualquiera de ellas.**
- [x] E2E no aplica: la feature es lectura del listado; no toca auth, pagos, recaudo, ingesta
      de órdenes ni webhooks.

### Datos y seguridad (Supabase)
- [x] Sin tablas nuevas, sin RLS nueva que declarar.
      `db/migrations/20260728120000_orden_indices_filtros/migration.sql` es **solo índices**:
      4 `CREATE INDEX` sobre `orden(zona_id|provincia_id|canton_id|distrito_id)`, cero DDL de
      tablas/columnas/constraints. Releído en esta pasada.
- [x] `down.sql` **coherente**: 4 `DROP INDEX IF EXISTS`, uno por `CREATE`, en orden inverso e
      idempotentes. Los 4 `@@index` correspondientes están en `db/schema.prisma`.
- [~] `pnpm db:rollback` **no se ejercitó contra la base** (documentado en `tasks.md` TB5.1:
      el `.env` del worktree apunta a una base compartida con producción). -> menor 8.
- [x] Sin secretos hardcodeados.
- [x] Webhooks: no aplica.

### Patrón de capas
- [x] `lib/actions/filtros-ordenes.ts` (borde) no ejecuta queries: resuelve actor, cablea repos
      y delega.
- [x] `FiltrosOrdenesService` / `OrdenService` no conocen HTTP.
- [x] `GeoRepository` / `UserRepository` / `ZonaRepository` / `OrdenRepository` solo ejecutan
      Prisma.
- [x] Interfaces nuevas en `lib/interfaces/repositories/` y `lib/interfaces/services/`.
- [x] Anti-patrón "queries sin índice en rutas calientes" (`docs/architecture.md`): **evitado a
      propósito**, de ahí la migración de índices.
- [~] Regla "solo se promueve a `shared/` cuando DOS features lo necesitan"
      (`docs/architecture.md:143`): `FilterComponent` vive en `components/shared/` con **un**
      consumidor hoy. Es una **excepción explícita aprobada por el humano** en la puerta F1.4
      (punto (n) de la entrada de `feature_list.json`), con la 145 declarada como segundo
      consumidor. Aceptada, no es hallazgo.

### Permisos
- [x] `app/(app)/ordenes/page.tsx` valida rol server-side (`resolveActorFromSession`) y resuelve
      el catálogo **tras** sus guardias (releído en esta pasada).
- [x] El catálogo baja por props; el cliente no fetchea datos sensibles.
- [x] Sin API routes nuevas; el transporte es la Server Action existente.

### Multi-país / configuración
- [~] `lib/utils/fecha-cr.ts` codifica UTC-6 como constante para Costa Rica. Deuda **heredada**
      de la feature 46; la 144 la extiende con tres helpers. -> menor 7.

### Verificación final
- [x] `./init.sh` termina en verde (medido por mí en esta pasada: `== init OK ==`).
- [x] `progress/review_144.md` existe y su veredicto es **OK**: este archivo.
- [ ] Entrada en `progress/history.md`: no existe. -> menor 4 (cierre del leader).

---

## 5. Hallazgos

### Bloqueantes
**Ninguno.**

### menor 1 (abierto) — `progress/impl_144_frontend.md` no existe
`tasks.md:322-323` declara dos bitácoras; solo existe `impl_144_backend.md`. Todo el bloque A
(R1-R29), B3, B4 y el cierre se entregan sin bitácora propia: sin baseline medido, sin delta,
sin el detalle de las decisiones del frontend. El mapa `R->test` de esos bloques vive solo en
la tabla de `tasks.md`. Checkpoint de trazabilidad **cumplido a medias**. No lo elevo a
bloqueante porque los 65 requisitos SÍ tienen test verificado uno a uno y el mapa existe (en
`tasks.md`), que es lo que el checkpoint protege de verdad.

### menor 2 (abierto) — `progress/impl_144-filtros-ordenes.md`, citado en T6.3, tampoco existe
El criterio de hecho de T6.3 pide pegar ahí la salida de la verificación final. No hay tal
archivo; los números los medí yo desde cero. La tabla de la sección 2 sirve como evidencia en
disco.

### menor 3 (abierto) — se modificó un assert existente (T6.1 afirma que no)
`tests/unit/types/orden-filter.test.ts` cambió el assert R8 de la feature 63
(`toEqual(["status_id"])` -> `toContain("status_id")`). El cambio está **justificado y
documentado en el propio test** (la whitelist crece a 9 claves por R30; el censo exacto se
movió a `orden-filter-144.test.ts` y los tests de rechazo de claves ajenas quedaron intactos).
No es una regresión encubierta, pero T6.1 dice literalmente "sin modificar sus asserts" y está
marcada `[x]` sin anotar la excepción. Drift de bookkeeping.

Los demás cambios a tests existentes son inevitables y correctos: mocks del método nuevo en los
dobles de `IUserRepository`/`IGeoRepository`/`IZonaRepository` y el `vi.mock` de
`@/lib/actions/filtros-ordenes` en `OrdenesPage.test.tsx`. Ningún assert tocado.

### menor 4 (abierto, cierre del leader) — sin entrada en `progress/history.md`
CHECKPOINTS lo exige. La bitácora de la 144 vive en `progress/current.md`.

### menor 5 (abierto, cierre del leader) — `feature_list.json` deja la 144 en `in_progress`
Esperable a esta altura; pasa a `done` al mergear. La misma entrada reconcilia la 142 a `done`
y anota la revalidación de la 145: ambos cambios correctos y justificados en el propio JSON.

### menor 6 (abierto, sin acción) — la tabla `R->test` de `tasks.md` usa "idem"
T6.4 pedía "archivo y nombre exactos"; da archivo exacto siempre y nombre exacto casi nunca.
Verifiqué la correspondencia a mano en la primera pasada: en los 65 casos existe el test con
aserción real. `impl_144_backend.md` sí da nombres exactos para R30-R54.

### menor 7 (abierto, deuda heredada) — UTC-6 hardcodeado para Costa Rica
`lib/utils/fecha-cr.ts` fija el offset como constante (feature 46); la 144 lo extiende con
`inicioDelDiaCREnUtc`, `inicioDelDiaSiguienteCREnUtc` e `inicioDeUltimosNDiasCREnUtc`. CR no
tiene DST, así que hoy es correcto; el día que haya un segundo país esto es una feature de
configuración. Anotado, no cargado a la 144.

### menor 8 (abierto, acción de despliegue) — la migración no se aplicó contra ninguna base
`pnpm db:migrate` / `pnpm db:rollback` no se ejercitaron (documentado y bien razonado en
`tasks.md` TB5.1). La validación es estática (10 tests de forma sobre el SQL y el
`schema.prisma`). Deja el checkpoint "db:rollback funciona" sin verificación ejecutable.
**Pendiente al desplegar: `prisma migrate deploy`.**

### menor 9 (abierto, observación) — la action es un `"use server"` con parámetro de DI
`lib/actions/filtros-ordenes.ts` exporta `obtenerCatalogoFiltrosOrdenes` con un `deps`
opcional. Sigue el patrón ya establecido en el repo (`api-keys.ts`, `auth.ts`,
`cierre-dia.ts`...). **Sin hueco de seguridad**: las funciones no son serializables y la
autorización vive en el service, que devuelve `unauthenticated`/`forbidden` **antes** de
disparar ninguna lectura.

### menor 10 (NUEVO, abierto) — el test de migración de la propia 144 arrastra la misma trampa que acaba de arreglarse
`tests/integration/db/orden-indices-filtros-migracion.test.ts:90-98`:

    const previas = dirs.filter((d) => d !== esta);
    expect(esta >= previas[previas.length - 1]).toBe(true);

`previas` incluye **todas** las demás carpetas, así que la primera feature que añada una
migración con timestamp posterior romperá este test, exactamente igual que la 144 rompió el de
la 146. **Esto corrige una afirmación de la review anterior**, que dio por bueno este test como
"el patrón a replicar": no lo es; tiene el mismo defecto, solo que aún no ha detonado. No es
bloqueante (la suite está verde hoy y el arreglo es una línea en la feature 147), pero conviene
que quede escrito para que nadie lo tome de modelo.

### menor 11 (NUEVO, abierto, deuda de arnés — NO de la 144) — el `asyncUtilTimeout` por defecto hace la suite no determinista
El mismo mecanismo del BLOQUEANTE 2 sigue vivo en archivos ajenos: en mi corrida 3,
`tests/integration/recuperar-contrasena-form.test.tsx` cayó 2 tests en un
`await screen.findByLabelText(...)` bajo contención (7/7 verde en aislado). Está documentado
como flaky desde antes de esta rama. El `EnvironmentTeardownError` que vio el leader es de la
misma familia.

**Recomendación (chore aparte, NO en esta feature):** subir `asyncUtilTimeout` de forma global
en `tests/setup/jest-dom.ts`, con el mismo comentario justificativo que ya lleva
`vitest.config.ts:12-19`. Eso vuelve `./init.sh` un gate confiable para todas las features.
Meterlo en la 144 sería ensanchar su superficie a un archivo compartido por todo el repo, así
que **está bien que el implementer NO lo hiciera**.

---

## 6. Trazabilidad — los 65 requisitos (vigente; verificado en la 1a pasada, re-muestreado)

**65/65 con test real.** Verificado leyendo las aserciones, no los nombres. Ningún test vacío,
ningún `expect(true).toBe(true)`, ninguna aserción tautológica. `c606abf` no tocó ninguna
aserción de requisito (solo la exclusión del invariante de la 146 y una línea de configuración
de timeout), así que este análisis sigue íntegro.

Bloque A (R1-R29), sin dominio — 4 archivos con filtros de fantasía (color/talla/acabado/
periodo): `filter-component.test.tsx`, `date-range-filter.test.tsx`, `filter-dependencies.test.ts`,
`multi-select-filter-grupos.test.tsx`.

Bloque B (R30-R65) — 13 archivos: `orden-filter-144.test.ts`, `orden-service-filtros.test.ts`,
`orden-repository-filtros.test.ts`, `fecha-cr-filtros.test.ts`, `filtros-ordenes-service.test.ts`,
`catalogo-filtros-ordenes.test.ts`, `filtros-ordenes-action.test.ts`, `ordenes-filtros-def.test.ts`,
`seleccion-a-filter.test.ts`, `ordenes-listado-filtros.test.tsx`, `ordenes-module-filter-key.test.tsx`,
`OrdenesPageFiltros.test.tsx`, `orden-indices-filtros-migracion.test.ts`.

Los de mayor consecuencia:

- **R36/R37 (el scoping por rol manda sobre el filtro).** 6 tests. Afirman el `where`
  construido, no el resultado: `adminTienda` con `filter.tienda_id: ["store2","store3"]` ->
  `where.tiendaId === "store1"` **escalar** (`Array.isArray` explícitamente `false`); el caso
  venenoso "su tienda + otra" también colapsa al escalar. `mensajero` conserva
  `mensajeroAsignadoId`. Re-leído el código en esta pasada: `OrdenService.listar` escribe el rol
  **después** del filtro (`lib/services/OrdenService.ts:247`), con el comentario que explica que
  ese orden ES el mecanismo de seguridad.
- **R44 (`count` con el mismo `where`).** No se conforma con `toEqual`: afirma
  `expect(count).toBe(findMany)`, misma identidad de objeto.
- **R41/R42 (bordes CR).** `hasta` inclusivo verificado por instantes concretos:
  `hasta=2026-07-15` **incluye** `2026-07-16T05:59:59Z` y **excluye** `2026-07-16T06:00:00Z`.
  Hay un test explícito del error clásico.
- **R40 (exclusión preset/rango).** Falla cerrado en el schema, sin precedencia silenciosa.
- **R35 (nunca degradar a "sin filtro").** Lista vacía de un filtro nuevo -> `IN ()`, clave
  presente; lista vacía de `estatusId` -> sin clave (retrocompatibilidad de la 63). Los dos
  comportamientos testeados y deliberadamente distintos.
- **R52/R53.** Afirman que **ninguna de las cinco lecturas se invoca** cuando la autorización
  falla, no solo el `status` devuelto.
- **R47 (paralelismo).** Comprueba que las cinco lecturas se invocan antes de que resuelva la
  primera.
- **R54 (sin PII).** Afirma el `select` de Prisma **y** las claves del DTO, y la ausencia de
  email/teléfono/cédula/hash en ambos.
- **R64 (el catálogo caído no rompe la página).** Tres casos (`forbidden`, `unauthenticated`,
  excepción propagada) que afirman barra deshabilitada + tabla viva + el listado pidiendo
  órdenes sin los filtros nuevos.

---

## 7. Regla dura de aislamiento del bloque A — CUMPLE (re-verificada)

Re-comprobado por imports reales en esta pasada:

- `components/shared/FilterComponent.tsx`: `react`, `ui/button`, `ui/select`, `@/lib/utils`,
  `@/lib/utils/filter-dependencies`, `./DateRangeFilter`, `./MultiSelectFilter`.
- `components/shared/DateRangeFilter.tsx`: `react`, `lucide-react`, `ui/button`, `ui/input`,
  `ui/label`, `ui/select`, `@/lib/utils`.
- `lib/utils/filter-dependencies.ts`: **cero imports** (tipos estructurales a propósito).

Ninguno importa `lib/types/orden`, `lib/actions/*` ni `app/(app)/ordenes/*`. Sus cuatro archivos
de test tampoco. La dirección de la dependencia es la correcta: `ordenes-filtros-def.ts` y
`seleccion-a-filter.ts` (superficie) importan `FilterComponent`, nunca al revés. **La 145 puede
montar el componente sin arrastrar órdenes.**

---

## 8. Pruebas de mutación — 5 lanzadas en la 1a pasada, **5 muertas** (vigentes)

No las repetí: `git diff 825b24d..HEAD` demuestra que **el código de producción es idéntico byte
a byte** al que se mutó, y los tests que las cazaron no fueron tocados por `c606abf`. La
evidencia sigue siendo válida.

| # | Mutación | Archivo | Resultado |
| --- | --- | --- | --- |
| M1 | El scoping por rol deja de pisar el filtro | `lib/services/OrdenService.ts` | **MUERTA** — 3 fallos de R36 |
| M2 | Se elimina el `.refine` de exclusión preset/rango | `lib/types/orden.ts` | **MUERTA** — 4 fallos de R40 |
| M3 | `count` usa un `where` distinto al de `findMany` | `lib/repositories/OrdenRepository.ts` | **MUERTA** — 2 fallos de R44 |
| M4 | Se rompe la poda transitiva | `lib/utils/filter-dependencies.ts` | **MUERTA** — 2 fallos de R26 |
| M5 | `hasta` deja de ser inclusivo | `lib/utils/fecha-cr.ts` | **MUERTA** — 7 fallos (R41/R42) |

Observación de M4: la cazan los tests de `filter-dependencies.test.ts`, no
`filter-component.test.tsx` (su caso de poda es de un solo nivel). La red de seguridad de la
transitividad está en el módulo puro, no en el orquestador: importa si alguien reescribe el
componente.

---

## 9. Lo que está bien hecho (para que no se pierda)

- **El orden de escritura del `where` está documentado en el propio código** como el mecanismo
  que garantiza R36/R37. Es autodefensivo: quien lo mueva rompe 3 tests y lee por qué.
- **La trampa de `startOfDayCR`** (medianoche UTC vs. 00:00 CR = 06:00 UTC) está explicada en el
  JSDoc de los helpers nuevos, con el error clásico nombrado y un test que lo reproduce.
- **`MultiSelectFilter` con grupos** mantiene el camino plano con markup y ARIA idénticos; los
  tests del filtro de estado de la 63 pasan sin tocarse.
- **Cero dependencias nuevas**, confirmado con el diff vacío de `package.json` y `pnpm-lock.yaml`.
  El `dateRange` se construyó con dos `<Input type="date">` al estilo de `WalletFiltros`, como
  exigía el gate.
- **La página no se rompe si el catálogo falla** (`resolverCatalogoFiltros` nunca lanza), con el
  fallback decidido en la page y no en el service.
- La migración es **solo índices**, con `down.sql` simétrico y un test que afirma que no hay DDL
  de tablas/columnas y que no se duplican índices existentes.
- **Los dos fixes de `c606abf` son quirúrgicos**: 19 líneas, ambas en tests, ambas con el porqué
  escrito al lado. Ninguna aserción debilitada.

---

## 10. Para el leader, antes de mergear

1. Añadir la entrada en `progress/history.md` (menor 4).
2. Pasar la 144 a `done` en `feature_list.json` (menor 5).
3. Contar con que la corrida de merge puede toparse con el flaky ajeno de
   `recuperar-contrasena-form.test.tsx` (menor 11): si cae **solo** ese archivo, no es la 144;
   si cae cualquier archivo de la feature, sí lo es.
4. Abrir un chore para el `asyncUtilTimeout` global en `tests/setup/jest-dom.ts` (menor 11) y
   otro, o una nota en la 147, para el invariante de `orden-indices-filtros-migracion.test.ts`
   (menor 10).
5. Al desplegar: `prisma migrate deploy` (menor 8).
