# 184 — T0 y la parte BACKEND de la Tanda A (bodega satélite)

> Rama: `feature/184-deuda-170-listados` · Fecha: 2026-08-04 · Rol: BACKEND_DEV
>
> Alcance entregado: **T0.1, T0.2, A.1, A.2 y A.3**. `app/**` y `components/**` NO se tocan:
> A.4, A.5 y A.6 son del frontend y cierran la tanda.
>
> **Veredicto en una línea: el listado 10 tiene ya su conjunto propio y su comprobación de
> vigencia, los dos nacidos del MISMO fragmento SQL que la página, con 17 mutaciones ejecutadas
> y las 17 rojas — falta la pantalla, que es lo que convierte esto en deuda cerrada.**

---

## 1. Qué se hizo, tarea por tarea

### T0.1 — el censo declara los pendientes POR NOMBRE

`tests/components/paginacion/paginacion-transversal.test.tsx`: nace `PENDIENTES_184` con los
**doce** nombres del Anexo A, en el orden del Anexo III, y sustituye a las dos afirmaciones
agregadas de `:910-913` (la lista de los `completo` y el `toHaveLength(12)`):

```ts
expect(ANEXO_III.filter((l) => l.adaptador === "conjunto").map((l) => l.listado))
  .toEqual(PENDIENTES_184);
```

Ya no queda **ningún número escrito a mano sobre el reparto de adaptadores**: el que quedaba
—`toHaveLength(12)`— es justo el que se olvida a mitad de entrega. Los otros números del archivo
(`toHaveLength(13)` del Anexo III, `toHaveLength(3)` del Anexo IV) son de OTRA propiedad —el
censo completo, R29— y siguen donde estaban.

El archivo pasa **sin tocar ninguna pantalla**: el listado 10 sigue declarado `conjunto` y sigue
en la lista, porque su pantalla no ha migrado todavía. Quien lo saque de ahí es A.6, en el mismo
commit que A.4.

### T0.2 — la mitad negativa del censo, en los DOS

El adaptador que un listado declara pasa a ser el **único** que puede usar. En
`paginacion-transversal.test.tsx` y en `tests/components/descarga/WalletPropsDescarga.test.tsx`
(que además pasa a declarar su adaptador por nombre en vez de por regex suelta):

```ts
expect(fuente, `${listado}: se declara «${adaptador}» pero también llama al adaptador «${CONTRARIO[adaptador]}»`)
  .not.toMatch(ADAPTADOR[CONTRARIO[adaptador]]);
```

Sin esto, una pantalla migrada a medias —que llame a los dos adaptadores— pasaba verde con
cualquiera de las dos declaraciones, y el censo dejaba de decir cuánta deuda queda.

### A.1 — el criterio se extrae y nace el conjunto completo

`lib/repositories/OrdenRepository.ts`, tres helpers privados de módulo y un método privado:

| Pieza | Qué es |
| --- | --- |
| `condicionesSatelite(filtro)` | zona ∧ no borrada ∧ estados ∧ cantón ∧ distrito |
| `desdeSatelite(condiciones)` | el `FROM` + los tres JOINs + el `WHERE` |
| `ordenBodegaSatelite()` | grupo (`array_position`), prioridad, recencia, `id` |
| `hidratarSatelite(ids, zonaId)` | el `findMany` de proyección, con el acotamiento REPETIDO |

Los usan las **tres** consultas del dominio, no dos declaraciones parecidas:

| Método | Usa | Diferencia |
| --- | --- | --- |
| `findRecepcionSatelitePaginada` | condiciones + orden | `LIMIT`/`OFFSET` + `COUNT(*) OVER ()` |
| `findRecepcionSateliteCompleta` **(nuevo)** | condiciones + orden | sin recorte y sin conteo de ventana |
| `findIdsVigentesEnBodega` **(nuevo)** | condiciones | + `o."id" IN (…)`, `SELECT o."id"` y nada más |

`findRecepcionSatelitePaginada` **no cambia de comportamiento**: sus 11 casos previos siguen
verdes sin tocarse, y ahora además se ejecuta contra un Postgres real (ver §4).

### A.2 — la vigencia de identificadores

`findIdsVigentesEnBodega(filtro, ids)`: una consulta, una columna, sin orden ni recorte. El
acotamiento del listado se repite ENTERO en el `WHERE` aunque los ids vengan del cliente. Sin
`ids` —o sin estados— no consulta.

Devuelve los **vigentes**, no los caducados: así una respuesta corta, o ninguna, no puede leerse
nunca como «desmarca todo».

### A.3 — servicio, schemas, config y bordes

- **Servicio** (`RecepcionSateliteService`):
  - `listarOrdenesBodegaCompleto` — guard de rol ANTES del repositorio, zona desde
    `usuario.zona_id`, misma lista blanca (`estadosDelListado`), tope
    `descargaConfig.MAX_FILAS` evaluado aquí, mismo mapper y mismo lote de
    `contarIntentosEnLote` que la página. Por encima del tope no se pide el lote de intentos.
  - `listarIdsVigentesBodega` — mismo guard, misma zona, mismos filtros; `ids` vacío → `[]`
    **sin una sola consulta**; sin zona → `[]` sin tocar el listado.
- **Schemas** (`lib/types/recepcion-satelite.ts`), derivados y no reescritos:
  `listarOrdenesBodegaCompletoSchema = listarOrdenesBodegaPaginadoSchema.omit({ page, pageSize }).strict()`
  y `listarIdsVigentesBodegaSchema = …Completo.extend({ ids }).strict()`.
- **Config** (`lib/config/recepcion-satelite.ts`): `MAX_IDS_VIGENCIA`, sobreescribible por
  `RECEPCION_SATELITE_MAX_IDS_VIGENCIA`, **default 500** — la decisión Q2, tal cual.
- **Bordes** (`lib/actions/recepcion-satelite.ts`): `listarOrdenesBodegaCompleto` y
  `listarIdsVigentesBodega`, calcadas del borde de su página.

**Lo que el frontend encontrará listo** (A.4/A.5):
`listarOrdenesBodegaCompleto({ ...filtro })` devuelve `ListarCompletoResult<RecepcionSateliteDTO>`,
que es exactamente lo que `filasDesdeResultado` sabe traducir; `listarIdsVigentesBodega({ ...filtro, ids })`
devuelve `{ status: "ok"; ids }` para el `comprobarVigencia` del diseño (§4.2).

---

## 2. Archivos

**Nuevos (4)**

- `tests/fixtures/satelite-bodega-almacen.ts` — el almacén y el doble de repositorio que
  comparten los dos archivos de servicio de la tanda.
- `tests/unit/services/recepcion-satelite-completo.test.ts` — 11 casos.
- `tests/unit/services/recepcion-satelite-vigencia.test.ts` — 10 casos.
- `tests/integration/db/satelite-conjunto-sql-real.test.ts` — 3 casos (§4).

**Modificados — producción (5)**

- `lib/repositories/OrdenRepository.ts` — helpers compartidos + los dos métodos nuevos.
- `lib/interfaces/repositories/IOrdenRepository.ts` — los dos contratos.
- `lib/services/RecepcionSateliteService.ts` — los dos métodos de servicio.
- `lib/interfaces/services/IRecepcionSateliteService.ts` — entradas y resultados.
- `lib/actions/recepcion-satelite.ts` + `lib/types/recepcion-satelite.ts` +
  `lib/config/recepcion-satelite.ts` — bordes, schemas y la cota Q2.

**Modificados — tests (7)**

- `tests/unit/repositories/satelite-paginado-where.test.ts` — +12 casos (11 → 23).
- `tests/unit/actions/recepcion-satelite-action.test.ts` — +14 casos (23 → 37).
- `tests/components/paginacion/paginacion-transversal.test.tsx` y
  `tests/components/descarga/WalletPropsDescarga.test.tsx` — T0.
- Cuatro archivos que declaran un doble COMPLETO de `IOrdenRepository`
  (`orden-service`, `bulk-orden-service`, `bulk-orden-service.carga-api`,
  `rol-admin-satelite-authz`): dos métodos más en el doble, obligados por el typecheck.

**Cero** cambios en `app/**`, `components/**`, `db/migrations/`, RLS, esquema y
`feature_list.json`. Cero cambios en la configuración de `useSWR` de ninguna pantalla (R33).

---

## 3. Las 17 mutaciones, con su salida

Cada una: se rompe el código de verdad, se corre, se restaura. Ninguna quedó aplicada
(`git status` limpio tras cada lote, verificado).

### Lote T0 (2 mutaciones)

**M-T0.a — cambiar a mano el adaptador declarado de UN listado del censo** (`Saldos de tiendas`:
`conjunto` → `completo`):

```
 ❯ tests/components/paginacion/paginacion-transversal.test.tsx:933:89
    931|     for (const { listado, ruta, adaptador } of ANEXO_III) {
    932|       const fuente = fuenteDe(ruta);
    933|       expect(fuente, `${listado}: su descarga no va al servidor por el…
 Test Files  1 failed (1)
      Tests  1 failed | 8 passed (9)
```

**M-T0.b — cambiarlo en la PANTALLA**: `SaldosTiendasTable.tsx` pasa a llamar también a
`filasDesdeResultado(` (la migración a medias). Es la mutación que mide la mitad NEGATIVA nueva:

```
 FAIL  tests/components/descarga/WalletPropsDescarga.test.tsx > las tres paginan y NINGUNA proyecta la página: releen el conjunto completo
AssertionError: app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx: se declara «conjunto» pero también llama al adaptador «completo»: expected '"use client";\r\n\r\nimport { useStat…' not to match /filasDesdeResultado\(/
 FAIL  tests/components/paginacion/paginacion-transversal.test.tsx > ninguno de los TRECE proyecta el array de la página: el archivo va al servidor
AssertionError: Saldos de tiendas: se declara «conjunto» pero también llama al adaptador «completo»: expected '"use client";\r\n\r\nimport { useStat…' not to match /filasDesdeResultado\(/
 Test Files  2 failed (2)
      Tests  2 failed | 12 passed (14)
```

El archivo de la pantalla se restauró con `git checkout --` y se comprobó `git status` limpio.

### Lote repositorio (6 mutaciones) — `satelite-paginado-where.test.ts`

```
=== M1 (A.1/R16) el conjunto pierde el ORDER BY compartido con la pagina
  × el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5) 5ms
  × el conjunto NO lleva LIMIT ni OFFSET, y tampoco el conteo de ventana (R15) 3ms
  Tests  2 failed | 21 passed (23)
=== M2 (A.1/R15) el conjunto recorta como si fuera una pagina
  × el conjunto NO lleva LIMIT ni OFFSET, y tampoco el conteo de ventana (R15) 6ms
  Tests  1 failed | 22 passed (23)
=== M3 (A.1/R4) la hidratacion deja de repetir la zona del actor
  × la consulta que hidrata repite el acotamiento y respeta el orden de la que ordenó 7ms
  × emite exactamente DOS consultas: la que ordena y la que hidrata (R15) 1ms
  Tests  2 failed | 21 passed (23)
=== M4 (A.2/R21) la vigencia se guarda SOLO con el IN de ids
  × el where lleva la ZONA del actor además del IN de ids (R21) 7ms
  × los filtros vigentes también acotan la vigencia: es el MISMO conjunto que el listado (R19) 1ms
  Tests  2 failed | 21 passed (23)
=== M5 (A.2/R23) la vigencia consulta aunque no haya ids
  × sin ids no consulta (R23) y sin estados tampoco 8ms
  Tests  1 failed | 22 passed (23)
=== M6 (A.1/R16) el criterio compartido pierde el `deleted_at IS NULL`
  × el acotamiento por zona del actor y las borradas van SIEMPRE en el where 9ms
  × los tres filtros se cruzan en AND y comparan por el nombre que ofrece el catálogo (R45) 2ms
  × el acotamiento del actor va en el where del conjunto, y los filtros solo lo estrechan (R4/R11) 1ms
  × el where lleva la ZONA del actor además del IN de ids (R21) 1ms
  Tests  4 failed | 19 passed (23)
=== arbol restaurado
```

**M6 tiene una lectura que conviene anotar:** una sola mutación en el criterio compartido pone
rojos a la vez la página, el conjunto y la vigencia. Eso es exactamente lo que R16 compra —el
criterio está escrito UNA vez— y es la razón de que la poda vaya en esta tanda y no aparte.

### Lote servicio y borde (10 mutaciones)

```
=== M7 (A.3/R4) el guard de rol se evalua DESPUES del repositorio
  × un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4) 6ms
  Tests  1 failed | 10 passed (11)
=== M8 (A.3/R6) el tope se aplica truncando en vez de rechazar
  × con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6) 192ms
  Tests  1 failed | 10 passed (11)
=== M9 (A.3/R6) el tope se corre una fila: `>=` en vez de `>`
  × con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6) 8ms
  Tests  1 failed | 10 passed (11)
=== M10 (A.3/R11) el conjunto ignora los filtros de geografia
  × el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5) 20ms
  × el alcance sale del ACTOR, no de la entrada (R4) 1ms
  × con un filtro de cantón el conjunto excluye las demás filas EN LA BASE (R11) 1ms
  × al repositorio le llega el filtro y NADA de recorte, ni la página lo contamina 1ms
  Tests  4 failed | 7 passed (11)
=== M11 (A.3/columna Intentos) el conjunto deja de pedir el lote de intentos
  × cada fila del archivo lleva su número de intentos, el 0 incluido (mismo mapper que la página) 8ms
  Tests  1 failed | 10 passed (11)
=== M12 (A.3/R19) la vigencia ignora los filtros vigentes del listado
  × la vigencia se decide sobre el CONJUNTO filtrado, no sobre la página visible (R19) 17ms
  Tests  1 failed | 9 passed (10)
=== M13 (A.3/R22) la vigencia devuelve los CADUCADOS en vez de los vigentes
  × la vigencia se decide sobre el CONJUNTO filtrado, no sobre la página visible (R19) 17ms
  × una orden que salió del listado vuelve como NO vigente (R18) 1ms
  × un id de OTRA zona vuelve como no vigente y no revela ningún dato de él (R21) 1ms
  × los filtros vigentes acotan la vigencia: es el conjunto que el usuario está viendo (R19) 1ms
  × la lista blanca de estados también rige aquí: un estado ajeno no amplía el conjunto 1ms
  Tests  5 failed | 5 passed (10)
=== M14 (A.3/R23) la vigencia consulta aunque no haya ids marcados
  × sin ids no se consulta NADA (R23, también en el servidor) 5ms
  Tests  1 failed | 9 passed (10)
=== M15 (A.3/R17) el borde del conjunto afloja la lista blanca
  × input vacío vale: el conjunto sin filtros, y sin page ni pageSize 6ms
  × una clave no declarada muere con validation_error sin tocar el service (R17) 2ms
  × los tres filtros vigentes llegan al service tal cual (R3) 1ms
  × los ids y los filtros vigentes llegan al service tal cual (R19) 1ms
  × una clave no declarada muere con validation_error sin tocar el service (R17) 1ms
  Tests  5 failed | 32 passed (37)
=== M16 (A.3/Q2) la cota de identificadores desaparece del borde
  × ids ausente, vacío o con un valor que no es uuid muere en el borde 5ms
  × la cota de identificadores se aplica en el BORDE exacto (Q2) 2ms
  Tests  2 failed | 35 passed (37)
=== arbol restaurado
```

**M11 es la del caso reciente del tope de indemnización**, traída a este dominio: si el conjunto
deja de pedir el lote de intentos y publica un `0` fijo, el xlsx sale igual de bien y la columna
«Intentos» miente. La mata un solo caso, y solo porque su almacén tiene una fila con un valor
distinto de 0.

**Mutación 17 — la que solo caza el Postgres real** (§4).

---

## 4. Lo que un doble de `$queryRaw` no puede ver

`tests/integration/db/satelite-conjunto-sql-real.test.ts` ejecuta las **tres** consultas del
dominio contra un Postgres de verdad (lectura pura, zona inexistente, sin sembrar nada; se salta
si no hay base alcanzable). Existe porque el doble acepta cualquier texto: una columna mal
escrita pasa verde en los 23 casos del `*-where.test.ts` y revienta la primera vez que alguien
descarga o poda en producción.

Medido, y es la evidencia de que aporta algo que ningún otro archivo aporta — añadir al criterio
compartido una condición sobre una columna **que no existe**:

```
=== M17 (SQL real) el criterio compartido gana una condicion sobre una columna QUE NO EXISTE
  × el where lleva la ZONA del actor además del IN de ids (R21) 4ms
  × el conjunto completo se ejecuta contra el esquema real, con y sin filtros de geografía 149ms
  × la vigencia de identificadores se ejecuta contra el esquema real 60ms
  × la página sigue ejecutándose igual tras compartir el criterio con las dos nuevas 41ms
  Test Files  2 failed | 2 passed (4)
      Tests  4 failed | 43 passed (47)
```

Los **dos archivos de servicio quedaron verdes** con esa mutación (los 43 que pasan): sus dobles
no ven SQL. Los tres casos que la cazan son los de este archivo.

---

## 5. Mapa `R<n>` → archivo + nombre del caso

Construido **leyendo el caso**, no contando `R\d+` en títulos: varios casos cubren un requisito
sin nombrarlo, y varios títulos citan requisitos de la **feature 170** (`R41`, `R44`, `R45`,
`R46`, `R51`), cuyo espacio de nombres se cruza con el de esta. Ese cruce ya produjo aquí un
falso «68/68».

| R | Archivo | Caso | Estado |
| --- | --- | --- | --- |
| R1 | — | el conjunto dedicado existe (A.1/A.3); que la PANTALLA lo use es A.4 | **parcial: cierra en A.4** |
| R2 | `tests/unit/services/recepcion-satelite-completo.test.ts` | «con un filtro de cantón el conjunto excluye las demás filas EN LA BASE (R11)» + «al repositorio le llega el filtro y NADA de recorte, ni la página lo contamina» | backend ✔ (la mitad de cliente, en A.4) |
| R3 | `tests/unit/actions/recepcion-satelite-action.test.ts` | «los tres filtros vigentes llegan al service tal cual (R3)» | backend ✔ (el closure del filtro vigente es A.4) |
| R4 | `…/recepcion-satelite-completo.test.ts` | «un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)» + «el alcance sale del ACTOR, no de la entrada (R4)»; y en el borde, «una clave no declarada muere con validation_error sin tocar el service (R17)» | ✔ |
| R5 | `tests/unit/repositories/satelite-paginado-where.test.ts` | «el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)» (la página es el conjunto + `LIMIT`/`OFFSET`, afirmado sobre los valores) + `…-completo.test.ts` «el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)» | ✔ |
| R6 | `…/recepcion-satelite-completo.test.ts` | «con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)» + acción «limite_excedido del service pasa tal cual: conteos y NINGUNA fila (R6)» | ✔ |
| R7 | `tests/unit/actions/recepcion-satelite-action.test.ts` | «forbidden del service pasa tal cual, sin filas ni total» + «sin actor -> unauthenticated, sin tocar el service» (el mensaje al usuario lo redacta el adaptador, y sus casos ya existen) | backend ✔ |
| R8 | — | es de pantalla (montar no llama a la acción) | **A.4/A.5** |
| R11 | `…/recepcion-satelite-completo.test.ts` | «con un filtro de cantón el conjunto excluye las demás filas EN LA BASE (R11)» | ✔ |
| R12 | — | textos y columnas del archivo: no se tocan (los casos existentes siguen verdes) | ✔ sin cambios |
| R13 | `tests/components/paginacion/paginacion-transversal.test.tsx` | «ninguno de los TRECE proyecta el array de la página: el archivo va al servidor» — los declarados `conjunto` DEBEN seguir llamando a `filasDelConjuntoCompleto(` | ✔ |
| R14 | `tests/unit/repositories/satelite-paginado-where.test.ts` | «el acotamiento del actor va en el where del conjunto, y los filtros solo lo estrechan (R4/R11)» y «el where lleva la ZONA del actor además del IN de ids (R21)» — ejecutan el repositorio REAL y afirman sobre los argumentos de la consulta | ✔ |
| R15 | idem | «el conjunto NO lleva LIMIT ni OFFSET, y tampoco el conteo de ventana (R15)», «emite exactamente DOS consultas: la que ordena y la que hidrata (R15)», «es UNA sola consulta de UNA sola columna, sin orden ni recorte (R15)» | ✔ |
| R16 | idem | «el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)» y «los filtros vigentes también acotan la vigencia: es el MISMO conjunto que el listado (R19)» (el fragmento de la vigencia ES el del conjunto + el `IN`) | ✔ |
| R17 | `tests/unit/actions/recepcion-satelite-action.test.ts` | «una clave no declarada muere con validation_error sin tocar el service (R17)» — dos casos, uno por acción; incluyen `page`/`pageSize`, que es lo que hace de la lista blanca una DERIVADA | ✔ |
| R18 | `tests/unit/services/recepcion-satelite-vigencia.test.ts` | «una orden que salió del listado vuelve como NO vigente (R18)» | **parcial: el desmarcado en pantalla es A.5** |
| R19 | idem | «la vigencia se decide sobre el CONJUNTO filtrado, no sobre la página visible (R19)» + «los filtros vigentes acotan la vigencia: es el conjunto que el usuario está viendo (R19)» | ✔ |
| R20 | — | de pantalla | **A.5** |
| R21 | `…/recepcion-satelite-vigencia.test.ts` + `…/satelite-paginado-where.test.ts` | «un id de OTRA zona vuelve como no vigente y no revela ningún dato de él (R21)» y «el where lleva la ZONA del actor además del IN de ids (R21)» | ✔ |
| R22 | `…/recepcion-satelite-vigencia.test.ts` + acción | «devuelve un SUBCONJUNTO de lo preguntado, y en ningún caso algo que no se preguntó» (se devuelven los vigentes, luego un fallo no puede desmarcar) + «la cota de identificadores se aplica en el BORDE exacto (Q2)» (pasarse NO toca la selección) | **parcial: la intersección del cliente es A.5** |
| R23 | `…/recepcion-satelite-vigencia.test.ts` + `…/satelite-paginado-where.test.ts` | «sin ids no se consulta NADA (R23, también en el servidor)» y «sin ids no consulta (R23) y sin estados tampoco» | ✔ servidor (el «no invocar» del cliente es A.5) |
| R24–R28 | — | de pantalla; el servidor aporta «comprobar la vigencia no lee el listado ni cuenta intentos: UNA consulta acotada (R28)» | **A.5** |
| R29 | `paginacion-transversal.test.tsx` | los dos casos ya existentes del censo, sin tocar | ✔ sin cambios |
| R30 | `paginacion-transversal.test.tsx` | «ninguno de los TRECE proyecta el array de la página: el archivo va al servidor» → `expect(los de adaptador "conjunto").toEqual(PENDIENTES_184)` | ✔ |
| R31/R32 | — | la guardia nueva es **tanda H** | fuera de esta tanda |
| R33 | — | no se tocó la configuración de `useSWR` de ninguna pantalla (cero archivos `app/**` modificados) | ✔ |
| R34 | este archivo | el mapa de arriba | ✔ |

**Requisitos que NO se pueden cubrir aquí, con su motivo:** R1 (parcial), R8, R20, R24, R25,
R26, R27 y R28 son de **pantalla** —viven en `app/**`, fuera del alcance de BACKEND_DEV— y R31 y
R32 son de la **tanda H**, que solo puede correr cuando A–G están dentro. R18 y R22 quedan
cubiertos por el lado del servidor; su mitad de cliente (desmarcar y la intersección) es A.5.

---

## 6. Puertas (medición real)

```
$ pnpm run typecheck
> tsc --noEmit
=== typecheck exit: 0 ===

$ pnpm exec eslint .
✖ 44 problems (0 errors, 44 warnings)
=== eslint exit: 0 ===

$ pnpm exec vitest run <los 17 archivos tocados y sus vecinos del dominio satélite>
 Test Files  17 passed (17)
      Tests  327 passed (327)
   Duration  10.76s

$ pnpm exec vitest run guard
 Test Files  61 passed (61)
      Tests  830 passed (830)
   Duration  6.37s

$ pnpm exec vitest run tests/integration/db
 Test Files  96 passed (96)
      Tests  1165 passed (1165)
   Duration  8.98s
```

**Rojos: cero, ni propios ni ajenos.**

Las **44 warnings de lint son AJENAS y PREEXISTENTES**: es el mismo número que midió
`progress/chore_deuda_170.md §6` el 2026-08-03 sobre el árbol limpio. En los archivos que toqué,
`eslint` reporta 2 warnings, las dos en líneas que **ya existían** antes de esta tanda
(`satelite-paginado-where.test.ts`, los `_args` de los dobles de `findMany` en `:63` y `:257`
del árbol de partida, verificado con `git show 342ddecb:`). Delta propio: **cero**.

**La suite completa NO se corre aquí**: el gate (`./init.sh`) lo corre el LEADER.

---

## 7. Qué queda, y para quién

| Tarea | De quién | Qué falta exactamente |
| --- | --- | --- |
| **A.4** | frontend | `RecepcionSateliteModule.tsx`: borrar `conjuntoFiltrado` (`:113-124`) y el import de `filtrarOrdenesSatelite`; `obtenerFilasDescarga` pasa a `filasDesdeResultado(listarOrdenesBodegaCompleto({ ...filtro }), filaDescargaSatelite)` |
| **A.5** | frontend | el callback `comprobarVigencia(ids)` sobre `listarIdsVigentesBodega({ ...filtro, ids })` y la intersección en `SateliteOrdenesListado` |
| **A.6** | frontend | listado 10 a `adaptador: "completo"` y fuera de `PENDIENTES_184`, en el MISMO commit que A.4 (quedan 11) |

**Q-K6 (rama B) sigue bloqueada hasta que A.4 cierre el listado 10**, como dice el `tasks.md`: el
segundo consumidor de `listarRecepcionSatelite()` es justo la descarga que A.4 sustituye. Desde
el backend no queda nada por hacer para desbloquearla.

**Nota para quien haga A.5:** la acción de vigencia devuelve `validation_error` si llegan más de
`MAX_IDS_VIGENCIA` (500) identificadores. En ese caso, por R22, la selección **no se toca** — es
decir, el cliente debe tratar esa respuesta igual que un fallo: no podar.
