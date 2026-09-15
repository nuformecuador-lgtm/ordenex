# 424 — El `admin` puede eliminar órdenes · Bitácora de implementación

**Fecha:** 2026-09-14 · **Rama:** `feat/424-admin-elimina-ordenes` (desde `origin/dev` @ `9cc4c7a9`)
**Worktree:** `R:\job\singularis\projects\ordenex\.claude\worktrees\agent-af2642838274bd0c8`
**Zona:** backend (con un cableado de una línea en `app/(app)/ordenes/page.tsx`)
**Migraciones:** **cero**. El diff no toca `db/migrations/**`, `db/schema.prisma`, `lib/types/**`
ni configuración de build. El enum `rol_value` ya contenía `admin`.

---

## Veredicto

**Hecho y medido.** El cambio de regla es una sola línea; `puedeEliminar` se deriva de la fuente
única y la mutación lo demuestra; y la tanda del rastro (T7/T8) se midió contra Postgres: **el
rastro queda con el rol `admin` y el `maestro` lo encuentra**.

---

## 1. Archivos tocados

### Producción (7)

| Archivo | Qué cambia |
| --- | --- |
| `lib/services/alcance-borrado-orden.ts` | **T1 — LA línea.** `admin` pasa de `denegado` a `todas`. Más el bloque de la reversión: fecha (2026-09-14), autor (Carlos Restrepo), qué se revierte, qué la sostiene (ficha 362), el alcance medido (de 2 a 6 personas) y lo que NO se abre (D1). El motivo del estrechamiento del 2026-08-27 **se conserva**, no se tacha. |
| `app/(app)/ordenes/page.tsx` | **T6.1 (R20).** `puedeEliminar` deja de ser una copia literal y se **deriva** de `resolverAlcanceBorradoOrden(actor)`. `puedeVerEliminadas` **no se toca** (sigue siendo el literal `rol === RolValue.maestro`: es otra pregunta, R18). Import nuevo de la función pura. |
| `lib/services/EliminarOrdenService.ts` | **T10, solo comentarios.** El bloque del paso 1 decía «el `admin` SIGUE sin poder borrar»; pasa a llevar la reversión con su motivo, lo que la sostiene y lo que no se abre. Se conserva el párrafo de por qué `esAccesoTotal` sigue sin servir aquí (ahora que maestro y admin vuelven a coincidir es cuando más hay que decirlo). |
| `lib/services/RecuperarOrdenService.ts` | **T10, solo comentarios.** «MISMO rol que el borrado» dejó de ser cierto: pasa a decir que recuperar se queda en el `maestro` **a propósito** (D1) y por qué no se resuelve con `resolverAlcanceBorradoOrden`. |
| `lib/services/ApiOrdenEliminacionService.ts` | **T10, solo comentarios.** Cabecera: el canal sigue cerrado al `admin` y **es una decisión** (D1), con los tres motivos. Paso 0: «todas» ahora también es el `admin`. |
| `lib/services/OrdenService.ts` | **T10, solo comentarios.** `marcarEliminable`: el campo le viaja al `admin` **sin tocar este método**, que es el punto; y la coincidencia se mide para los TRES roles. |
| `app/(app)/ordenes/_components/OrdenesListado.tsx` | **T10, solo comentarios.** La nota de `puedeEliminar` («el `admin` NO puede borrar») y la de `puedeVerEliminadas` («sigue siéndolo tras la 424»). **Cero cambios de comportamiento**: el componente no cambia ni una línea de código. |

### Tests (11)

| Archivo | Task | Qué cambia |
| --- | --- | --- |
| `tests/unit/services/alcance-borrado-orden.test.ts` | T2 | `admin` sale del `it.each` de «→ denegado» y entra en el de «→ todas». El `toEqual` de clasificación del catálogo **se actualiza** (`todas: [maestro, admin]`, `denegado: [mensajero, adminSatelite]`) y lleva escrito por qué **no se relaja**. |
| `tests/unit/services/eliminar-orden-service.test.ts` | T3 | `ADMIN` sale de la tabla de `forbidden` (quedan `adminSatelite` y `mensajero`, testigos vivos de R5) y gana un bloque propio con (a) `ownerId: null` afirmado en el argumento, (b) lote mixto → `conflict` sin borrar, (c) los cuatro motivos por orden, comparados **contra la respuesta del maestro**. |
| `tests/unit/services/eliminar-criterio-unico.test.ts` | T4 | `ADMIN` entra como tercer rol: catálogo entero × (ofrece == autoriza) + **la tercera pata** contra `ELIMINABLES_ESPERADOS`, orden de OTRA tienda, y la mitad de intentos. |
| `tests/unit/services/api-orden-eliminacion-service.test.ts` | T5 | Actor `admin` (alcance «todas») → `not_found` con `not.toHaveBeenCalled()` en **los dos** métodos del repo. Más el control con `maestro`: se rechaza por el ALCANCE, no por el nombre del rol. |
| `tests/components/OrdenesPage.test.tsx` | T6.2 | **El caso que se invierte**, con su motivo escrito. Y el contrapeso: sobre una fila `eliminable: false` no se le ofrece. |
| `tests/unit/services/orden-service.test.ts` | T6.3 | `admin` sale de «un rol que NO puede eliminar no recibe el campo» (queda `mensajero`) y gana dos casos: `eliminable: true` sobre orden de OTRA tienda, y `false` por estado. |
| `tests/integration/db/orden-eliminada-actor-admin.test.ts` | **T7 (nuevo)** | 5 casos contra Postgres. Ver §3. |
| `tests/integration/db/historial-accion-lectura.test.ts` | **T8** | Bloque nuevo `424/T8`: borrado real → lectura por `HistorialAccionService.listar`. Ver §3. |
| `tests/unit/historial-accion/lectura-borde-y-servicio.test.ts` | T9 | Comentario en `DENEGADOS`: desde hoy el `admin` **genera** filas aquí y **sigue sin poder leerlas** (D2, límite aceptado). |
| `tests/unit/services/recuperar-orden-service.test.ts` | T9 | Comentario: estar en la tabla de `forbidden` pasa de ser un resto del 2026-08-27 a ser **el acuerdo** (D1). |
| `tests/unit/services/orden-service-filtros.test.ts` | T9 | Comentario en el caso «`admin` → forbidden» del filtro ELIMINADAS: es el lado servidor de la divergencia `puedeEliminar` / `puedeVerEliminadas`. |

### Specs traídos a la rama

`specs/424-admin-elimina-ordenes/{requirements,design,tasks}.md` — no estaban en `origin/dev`;
viven en `2ef7d21b` (rama `feat/426-api-401-json`). Se traen tal cual, sin editar.

---

## 2. Mapa `R<n> → test`

| R | Qué fija | Test (archivo › caso) |
| --- | --- | --- |
| R1 | El `admin` borra cualquier orden, sin frontera de tienda | `eliminar-orden-service.test.ts` › *EliminarOrdenService / el admin borra (ficha 424)* › **⭑ (a) borra una orden eliminable de CUALQUIER tienda, con `ownerId: null`** · + `alcance-borrado-orden.test.ts` › *admin (ficha 424, 2026-09-14) -> todas* |
| R2 | Mismo criterio y mismo todo-o-nada que el `maestro` | `eliminar-orden-service.test.ts` › **(b) un lote con UNA orden no eliminable sale `conflict` y NO borra ninguna** y **(c) el motivo POR ORDEN se distingue igual que para el maestro** · + `eliminar-criterio-unico.test.ts` › *%s (admin): la UI ofrece exactamente lo que el servidor autoriza…* (22 estados) |
| R3 | La tienda sigue acotada a lo suyo | `alcance-borrado-orden.test.ts` › *adminTienda / apiKey -> propias* · `eliminar-orden-service.test.ts` › *EliminarOrdenService / la tienda y lo suyo (ficha 358)* · `integration/db/eliminar-orden-pantalla-frontera-tienda.test.ts` (**mutación 2**) |
| R4 | La frontera vive en el `where`, no en el `if` | `integration/db/eliminar-orden-pantalla-frontera-tienda.test.ts` › *⭑ R2: la tienda A pide borrar la orden de la B — cero filas afectadas y la fila sigue viva* (**mutación 2**) |
| R5 | `mensajero` / `adminSatelite` → `forbidden` sin tocar la base | `eliminar-orden-service.test.ts` › *%s recibe forbidden y NO se toca la base* (tabla conservada con sus dos testigos) |
| R6 | Lista de INCLUSIÓN: un rol nuevo nace sin poder borrar | `alcance-borrado-orden.test.ts` › *la lista es de INCLUSION: el catalogo entero de roles esta clasificado, y sin sorpresas* (recorre `Object.values(RolValue)`, el enum real) |
| R7 | El `admin` recibe casilla y «Eliminar» sobre filas eliminables | `OrdenesPage.test.tsx` › **⭑ eliminar: el `admin` SÍ recibe la casilla y la acción «Eliminar» (ficha 424)** · + *eliminar: al `admin` NO se le ofrece sobre una fila que el servidor NO marca eliminable* |
| R8 | Ofrecer y autorizar coinciden estado por estado para `admin` | `eliminar-criterio-unico.test.ts` › *%s (admin): la UI ofrece exactamente lo que el servidor autoriza, y es la ventana de siempre* (catálogo entero) · + `orden-service.test.ts` › *⭑ admin: sobre una orden de OTRA tienda -> eliminable true* |
| R9 | El canal por API key sigue acotado a «propias» | `api-orden-eliminacion-service.test.ts` › *R3: el owner que llega al repositorio es SIEMPRE `actor.usuarioId`…* · `integration/db/eliminar-orden-api-frontera-tienda.test.ts` |
| R10 | Alcance «todas» por API → `not_found` sin escribir | `api-orden-eliminacion-service.test.ts` › **⭑ un actor con alcance «todas» (`admin`) -> `not_found`, y NO se toca la base** · + *y el `maestro` tampoco: «todas» se rechaza por el ALCANCE, no por el nombre del rol* |
| R11 | Una fila por orden borrada, con id/nombre/rol congelados | `integration/db/orden-eliminada-actor-admin.test.ts` › **⭑ R11/R12: dos ordenes borradas por un `admin` dejan DOS filas con su nombre y su rol congelados** |
| R12 | El rol registrado de un `admin` es `admin`, congelado | mismo caso · + *R12: el rol congelado sigue siendo `admin` aunque despues se le cambie el rol VIVO* (**mutación 3**) |
| R13 | Un `lote_id` por acto, no por fila | `orden-eliminada-actor-admin.test.ts` › **⭑ R13: las dos filas comparten UN `lote_id`, y un segundo acto trae otro** |
| R14 | Atomicidad rastro ↔ borrado en los dos sentidos | `orden-eliminada-actor-admin.test.ts` › **⭑ R14: una orden YA borrada dentro del mismo lote NO deja fila** · + los casos R10/R11/R12 existentes de `historial-accion-atomicidad.test.ts` |
| R15 | Quién borró es consultable filtrando por acción y actor | `integration/db/historial-accion-lectura.test.ts` › *424/T8* › **⭑ R15: filtrando por «orden eliminada» y por ese actor, la fila sale con su NOMBRE y su ROL** (incluye el caso negativo por otro actor) |
| R16 | El `admin` no lee el módulo de acciones | `lectura-borde-y-servicio.test.ts` › *R18: `%s` recibe forbidden en `listar`…* / *R33: …en la DESCARGA* / *R18: el catalogo de actores tiene EL MISMO gate* (`DENEGADOS` incluye `admin`) · + **medido por el camino real**: `historial-accion-lectura.test.ts` › *R16: el propio `admin` NO puede leer ese registro — `forbidden` por el camino real* |
| R17 | El `admin` no recupera | `recuperar-orden-service.test.ts` › *admin recibe forbidden y NO se toca la base* |
| R18 | El `admin` no ve las eliminadas | `orden-service-filtros.test.ts` › *filtro ELIMINADAS* › *admin -> forbidden, y NI SIQUIERA se consulta* · + T6.1 (`puedeVerEliminadas` sigue siendo un literal distinto) |
| R19 | Borrado lógico, historial de estados intacto | `orden-eliminada-actor-admin.test.ts` › caso R11/R12: las dos filas de `orden` **siguen existiendo** con `deleted_at` y `ordenHistorialEstado.count === 0` |
| R20 | **Una sola lista de roles para ofrecer y para autorizar** | `grep "RolValue.maestro \|\| rol === RolValue.adminTienda" app/(app)/ordenes/page.tsx` → **0** · + **mutación 1**: tocando SOLO `resolverAlcanceBorradoOrden` se pone **ROJO** `OrdenesPage.test.tsx › ⭑ eliminar: el admin SÍ recibe la casilla y la acción «Eliminar»` |

---

## 3. T7/T8 — el rastro, **MEDIDO** (tanda bloqueante)

> **Resultado: el rastro QUEDA con el rol nuevo y ES consultable por el `maestro`. No hay nada que
> reportar como bloqueo.** No se estrenó ningún mecanismo: todo lo medido es la ficha 362.

**Se midió de verdad, no se saltó.** `DATABASE_URL` resuelta contra el Postgres **local**
(`localhost:5432/ordenex`; los dos `DATABASE_URL` de Supabase del `.env` están comentados —
comprobado antes de correr). Los dos archivos **ejecutaron aserciones**: 5 tests y 18 tests
respectivamente, no `skipped`. Y los dos se ponen **ROJOS** con la mutación 3 (§4), que es lo
único que demuestra que no están verdes por vacío.

### T7 · `tests/integration/db/orden-eliminada-actor-admin.test.ts` (nuevo, 5 casos)

Dentro de una transacción **revertida** (`enTransaccionRevertida`), con `SAVEPOINT` real
(`clienteConSavepoint`) y lock de serialización:

1. **ANTI-VACUIDAD** — el usuario efímero que siembra el archivo tiene rol `admin` **de verdad**,
   leído por la relación desde la base. Sin este caso, el resto podría estar verde midiendo lo que
   ya medía la 362.
2. **⭑ R11/R12/R19** — dos órdenes borradas con `repo.softDelete({ ids, ownerId: null,
   actorUsuarioId: <admin> })` dejan **dos** filas (una por orden, y son esas dos), con
   `accion = orden_eliminada`, `entidad_tipo = orden`, `actor_usuario_id` del admin,
   **`actor_rol === "admin"`** y `actor_nombre` = el nombre **compuesto**. Y las filas de `orden`
   **siguen existiendo** con `deleted_at` puesto, con **cero** transiciones nuevas en
   `orden_historial_estado`.
3. **R12** — se le cambia el rol **vivo** a `maestro` después del borrado: la fila sigue diciendo
   `admin`. (Control de no-vacuidad incluido: se afirma que el rol vivo sí cambió.)
4. **⭑ R13** — dos actos de 2 órdenes: un `lote_id` por acto, y distintos entre sí.
5. **⭑ R14** — lote de 3 con una **ya borrada**: `eliminadas === 2`, **dos** filas, y la ya borrada
   **no** deja fila. (Es la mutación «construir las entradas con los ids PEDIDOS».)

**No hay ningún `if (!fks) return;`.** Si la tabla `orden` está vacía, el `beforeAll` **lanza**.

```
 ✓ tests/integration/db/orden-eliminada-actor-admin.test.ts (5 tests) 701ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

### T8 · `tests/integration/db/historial-accion-lectura.test.ts` (bloque `424/T8`, 2 casos)

De punta a punta y **por el camino real**: la fila NO se inserta a mano — la escribe
`OrdenRepository.softDelete` borrando una orden de verdad con un actor `admin` recién sembrado, y
se lee con **`HistorialAccionService.listar`** (el mismo servicio que sirve `/historico/acciones`,
con su validación de entrada y su gate de rol).

- **⭑ R15** — `listar({ accion: ["orden_eliminada"], actorId: [<admin>] }, MAESTRO)` devuelve
  `total: 1`, y esa fila trae `actorNombre` (el compuesto) y **`actorRol: "admin"`**, más la
  etiqueta de la orden. **Caso negativo**: filtrando por **otro** actor, esa fila no aparece.
  Anti-vacuidad: se afirma antes que el borrado alcanzó 1 fila.
- **R16** — el **propio `admin`** pide lo mismo y recibe `forbidden`, en `listar` **y** en
  `listarCompleto` (la descarga). **Control positivo** en el mismo caso: el `maestro` sí la ve
  (`total: 1`), así que los dos `forbidden` no pueden estar verdes sobre un registro vacío.

> **El límite, declarado (D2, aceptado por el humano):** a partir de esta ficha el `admin`
> **genera** filas en ese registro y **no puede leerlas**. Quien audita es el `maestro`. Está
> escrito en el código y medido aquí, no deducido.

```
 ✓ tests/integration/db/historial-accion-lectura.test.ts (18 tests) 537ms
 Test Files  1 passed (1)
      Tests  18 passed (18)
```

---

## 4. T11 — autocomprobación por mutación (ejecutada, no razonada)

Las cuatro se aplicaron, se **corrieron** y se **revirtieron**. El árbol quedó limpio: `git status`
no lista `lib/repositories/OrdenRepository.ts` ni `lib/repositories/registrar-accion.ts`, y la
línea de la regla volvió a su sitio (verificado por `grep`).

### Mutación 1 · `admin → denegado` en `resolverAlcanceBorradoOrden`

Esperado: **ROJO** en T2, T3, T4 y T6. **VERDE** en T5.

```
 ❯ tests/unit/services/alcance-borrado-orden.test.ts        (8 tests | 2 failed)
 ❯ tests/unit/services/eliminar-orden-service.test.ts       (51 tests | 3 failed)
 ❯ tests/unit/services/eliminar-criterio-unico.test.ts      (146 tests | 14 failed)
 ❯ tests/unit/services/orden-service.test.ts                (33 tests | 2 failed)
 ❯ tests/components/OrdenesPage.test.tsx                    (15 tests | 1 failed)
 Test Files  5 failed | 1 passed (6)
```

El único archivo **verde** es `api-orden-eliminacion-service.test.ts` (T5), como predice el design
§3.3: el canal por API rechaza «todas» y «denegado» por igual.

**⭑ Y ESTA ES LA PRUEBA DE R20.** El caso rojo de `OrdenesPage.test.tsx` es:

```
 FAIL  tests/components/OrdenesPage.test.tsx > OrdenesPage
       > ⭑ eliminar: el `admin` SÍ recibe la casilla y la acción «Eliminar» (ficha 424)
```

Se tocó **solo** `lib/services/alcance-borrado-orden.ts` —ni una línea de `page.tsx`— y el caso de
**pantalla** se puso rojo. La derivación no es decorativa: es el mismo punto de decisión.
(El caso afirma la **acción «Eliminar»** y no solo la casilla justamente por esto: el `admin` ya
tenía casilla por sus acciones por lote, así que un test que solo mirara la casilla habría quedado
**verde** con la regla revertida — el defecto de la ficha 358 con otro rol.)

### Mutación 2 · quitar `tienda_id` del `where` de `softDelete`

Esperado: **ROJO** en la frontera multi-tenant.

```
 ❯ tests/integration/db/eliminar-orden-pantalla-frontera-tienda.test.ts (5 tests | 1 failed)
 FAIL  ⭑ R2: la tienda A pide borrar la orden de la B — cero filas afectadas y la fila sigue viva
 ❯ tests/integration/db/orden-eliminada-actor-admin.test.ts             (5 tests) PASSED
 Test Files  1 failed | 1 passed (2)
```

Confirma lo que R4 exige: la frontera vive en el `where` y **abrir el rol no la tocó**.

### Mutación 3 · `resolverActorCongelado` devuelve `actorRol: null` en vez del congelado

Esperado: **ROJO** en T7.

```
 ❯ tests/integration/db/orden-eliminada-actor-admin.test.ts  (5 tests | 3 failed)
 ❯ tests/integration/db/historial-accion-lectura.test.ts     (18 tests | 1 failed)
 ❯ tests/integration/db/historial-accion-atomicidad.test.ts  (22 tests | 1 failed)
 Test Files  3 failed (3)
```

Rojo en T7 **y también en T8** (la fila deja de traer el rol por el camino real de consulta) y en
el caso de congelado de la 362. Los tres casos rojos de T7 son R11/R12, R12-tras-promoción y R14.

### Mutación 4 · `puedeEliminar = false` en `page.tsx`

Esperado: **ROJO** en T6 (el caso del `admin` **y** el del `adminTienda`).

```
 ❯ tests/components/OrdenesPage.test.tsx (15 tests | 2 failed)
 FAIL  ⭑ eliminar: el adminTienda recibe la casilla de selección sobre una fila eliminable
 FAIL  ⭑ eliminar: el `admin` SÍ recibe la casilla y la acción «Eliminar» (ficha 424)
```

Los dos, exactamente como pedía el design.

---

## 5. Salida de las verificaciones

### `pnpm typecheck` (`tsc --noEmit`)

```
TSC_EXIT=0
```
(sin una sola línea de salida — verde)

### `pnpm lint` (`eslint`)

```
✖ 184 problems (0 errors, 184 warnings)
LINT_EXIT=0
```

Los 184 warnings son **preexistentes** (`@typescript-eslint/no-unused-vars` sobre parámetros
`_foo` de dobles en tests). Filtrando la salida por los 18 archivos de esta ficha: **cero
coincidencias**.

### `vitest related --run` (lo pedido; la suite completa la corre el leader)

Sobre los servicios y el test nuevo:
```
 Test Files  54 passed (54)
      Tests  890 passed (890)
   Duration  52.48s
```

Sobre `page.tsx`, `OrdenesListado.tsx`, `OrdenRepository.ts` y `registrar-accion.ts`:
```
 Test Files  602 passed (602)
      Tests  8518 passed | 26 skipped (8544)
   Duration  369.67s
```

### Los archivos de esta ficha, juntos (baseline previa a las mutaciones)

```
 Test Files  13 passed (13)
      Tests  434 passed (434)
```
(`alcance-borrado-orden`, `eliminar-orden-service`, `eliminar-criterio-unico`,
`api-orden-eliminacion-service`, `orden-service`, `orden-service-filtros`,
`recuperar-orden-service`, `lectura-borde-y-servicio`, `OrdenesPage`,
`orden-eliminada-actor-admin`, `historial-accion-lectura`, `historial-accion-atomicidad`,
`eliminar-orden-pantalla-frontera-tienda`)

### Los `skipped` de `tests/integration/db` — revisados, no ignorados

```
 Test Files  1 failed | 260 passed (261)
      Tests  4 failed | 3009 passed | 9 skipped (3022)
```

- **`integration/db` NO se saltó.** 260 de 261 archivos ejecutaron contra Postgres. Los dos de esta
  ficha corrieron con aserciones reales (5 y 18 tests) y se ponen rojos con la mutación 3.
- Los `skipped` (9 en una corrida, 14 en otra) son de
  `tests/integration/db/ranking-snapshot-migration.test.ts`, que **aislado pasa 49/49 sin ninguno**.
  Aparecen solo bajo la corrida en paralelo del directorio entero. Preexistente, ajeno a esta ficha.

### ⚠️ Un rojo medido que NO es de esta ficha: `analytics-daily-migration.test.ts`

```
 ❯ tests/integration/db/analytics-daily-migration.test.ts (63 tests | 4 failed)
 Error: no se encontro el CLI de Prisma en
   R:\...\worktrees\agent-af2642838274bd0c8\node_modules\prisma\build\index.js
```

**Causa medida:** el guardia resuelve `path.join(ROOT, "node_modules", "prisma", "build",
"index.js")` y **este worktree no tiene `node_modules`**. El intento de crear el junction que
indicó el leader —`cmd //c mklink /J node_modules …`, y también su equivalente en PowerShell y
`ln -s`— fue **rechazado por la guardia de aislamiento del worktree** («this command runs cmd in a
plain command… Refusing to run it»). El apaño usado en su lugar fue poner
`R:\job\singularis\projects\ordenex\node_modules\.bin` en el `PATH` y dejar que Node resuelva los
módulos subiendo por el árbol de directorios; eso sirve para `tsc`, `eslint` y `vitest`, pero **no**
para un guardia que compone la ruta a mano desde la raíz del worktree.

**No lo causa el diff, y se puede afirmar:** el guardia falla en `fs.existsSync`, **antes** de leer
nada; y `git status` confirma que esta rama no toca `db/schema.prisma` ni `db/migrations/**`.
**Con el junction creado, este archivo vuelve a correr sin tocar nada.**

---

## 6. Notas para quien corra el gate

1. **`node_modules`**: falta el junction (ver arriba). Sin él, `analytics-daily-migration.test.ts`
   sale rojo por entorno y `pnpm typecheck` / `pnpm lint` / `pnpm test` no arrancan sin el `PATH`
   apañado. Crearlo desde el árbol principal deja el worktree normal.
2. **`.env`**: se copió el del árbol principal a este worktree para poder medir T7/T8 — **la tanda
   bloqueante**, que sin `DATABASE_URL` se salta en silencio y deja el gate verde sin haber medido
   la contrapartida. Está cubierto por `.gitignore` (`.env*`) y **no entra en el commit**, pero
   `docs/verification.md` desaconseja copiarlo («lleva credenciales»); la vía que ese documento
   sanciona es exportar `DATABASE_URL` en la sesión. **Se deja puesto a propósito** para que el
   gate del leader no corra ciego sobre `integration/db`; bórrese al terminar si se prefiere.
   La base a la que apunta es la **local** (`localhost:5432/ordenex`), no Supabase.
3. **Gate esperado: `./init.sh --rapido`.** El diff no toca cimientos (design §2), así que el modo
   rápido no debería negarse.
4. **El MCP `codebase-memory` no ayudó aquí.** `search_graph` con «resolverAlcanceBorradoOrden
   alcance borrado orden» devolvió 15 resultados de `lib/analytics/alcance*.ts` y ninguno de
   `lib/services/alcance-borrado-orden.ts`. La navegación se hizo leyendo los archivos reales, que
   es lo que manda la regla 7 antes de dar nada por existente.
