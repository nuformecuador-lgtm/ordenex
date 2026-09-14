# 423 — Ordenar las tablas de órdenes por número de remisión · Bitácora de BACKEND

> Alcance de esta bitácora: **solo la capa de datos y el servidor** (tandas T1, T2.1/T2.2/T2.4,
> T4.1, T4.2 y T5). `app/` NO se tocó: el control de la pantalla (T2.3, T3.x, T4.3–T4.6) lo hace
> el `frontend_dev` después, y esta bitácora se amplía entonces.
>
> Rama `feat/423-ordenar-por-remision`. Base local: `localhost:5432`, base `ordenex`.

---

## 1. Archivos creados / modificados

| Archivo | Qué |
| --- | --- |
| `db/migrations/20260916120000_orden_clave_remision/migration.sql` | **nuevo** — columna generada `clave_remision` (`GENERATED ALWAYS … STORED`, `COLLATE "C"`) + índice parcial `orden_prioridad_clave_remision_idx` |
| `db/migrations/20260916120000_orden_clave_remision/down.sql` | **nuevo** — índice y luego columna, sin una sola sentencia DML |
| `db/schema.prisma` | `model Orden`: campo `claveRemision String? @default(dbgenerated())` + `@@index([prioridad(sort: Desc), claveRemision, id], map: …)`, con el comentario que dice **qué no puede expresar Prisma** (el predicado parcial y la collation) y dónde vive |
| `lib/repositories/OrdenRepository.ts` | `SORT_COLUMN`: `num_remision` pasa a traducir a `claveRemision`. El `orderBy` de `list` **no se tocó** |
| `lib/db/prisma-client.ts` | `PRISMA_OMIT` gana `claveRemision: true` (R16) |
| `tests/integration/db/orden-orden-remision-natural.test.ts` | **nuevo** — 12 casos contra Postgres real |
| `tests/integration/db/orden-clave-remision-no-lanza.test.ts` | **nuevo** — 4 casos contra Postgres real |
| `tests/unit/db/orden-clave-remision.guardia.test.ts` | **nuevo** — 16 casos estáticos sobre migración + modelo + censo del árbol |
| `tests/unit/guards/clave-remision-solo-lectura.guardia.test.ts` | **nuevo** — 12 casos: la clave ni se escribe ni viaja |
| `tests/unit/guards/orden-remision-alcance.guardia.test.ts` | **nuevo** — 9 casos: el alcance no se desborda |
| `tests/unit/db/prisma-omit-busqueda-texto.test.ts` | **modificado** — el literal del `omit` pasa de una columna a dos. Es EL contrato, así que se amplía a mano; no se deriva |
| `tests/unit/guards/busqueda-texto-solo-lectura.test.ts` | **modificado** — una línea de docstring que citaba la forma vieja de `PRISMA_OMIT` |

**T2.2 (R18) — verificado como task de NO hacer:**

```
$ git diff origin/dev -- lib/types/orden.ts
[vacío]
```

`SORT_FIELDS` y `listarOrdenesSchema` intactos. La clave pública `num_remision` no cambió; lo
que cambió es la columna a la que el repositorio la traduce.

---

## 2. Mapa `R<n> → test` (los que cubre el backend)

| R | Qué fija | Test | Resultado |
| --- | --- | --- | --- |
| R2 | Ordena el conjunto, no la página | `orden-orden-remision-natural` → «R2 — pagina 1 trae las MAS BAJAS del conjunto…» y «R2 — por el SERVICIO…» | ✅ |
| R3 | `NA-107` antes que `NA-1069` | `orden-orden-remision-natural` → «R3+R4 — ascendente…» | ✅ |
| R4 | Series: numéricas, `BS-`, `NA-`, `SC-` | `orden-orden-remision-natural` → «R3+R4 — ascendente…» | ✅ |
| R5 | Remisión fuera de patrón no bloquea la creación | `orden-clave-remision-no-lanza` (3 casos) + `orden-clave-remision.guardia` → «NO contiene ningun cast a numero» | ✅ |
| R6 | Mismo orden en cualquier entorno | `orden-clave-remision.guardia` → «la columna lleva `COLLATE "C"`» + «NO usa rangos ni clases dependientes de la collation» | ✅ |
| R7 | `prioridad` sigue delante | `orden-orden-remision-natural` → «R7 — `prioridad` sigue mandando…» | ✅ |
| R8 | Paginar no repite ni pierde | `orden-orden-remision-natural` → los dos casos «R8 — …241 claves EMPATADAS…» | ✅ |
| R9 | Las dos direcciones (servidor) | `orden-orden-remision-natural` → «R9 — descendente devuelve el sentido opuesto exacto» | ✅ |
| R13 | La descarga en el orden de la pantalla | `orden-orden-remision-natural` → «R13 — la DESCARGA sale exactamente en el mismo orden…» | ✅ |
| R15 | Las demás superficies no cambian de orden | `orden-remision-alcance.guardia` (9 casos) + `orden-orden-remision-natural` → «R15 — el orden por FECHA no cambio» | ✅ |
| R16 | La clave no viaja a ningún DTO ni descarga | `clave-remision-solo-lectura.guardia` (12 casos) + `orden-orden-remision-natural` → «R16/T2.4 — el `omit` global NO impide el `orderBy`…» | ✅ |
| R17 | Ninguna escritura de la app la fija | `orden-clave-remision-no-lanza` → «R17 — un intento de ESCRIBIR la clave lo rechaza la BASE» + `clave-remision-solo-lectura.guardia` | ✅ |
| R18 | El contrato público no se amplía | T2.2 (diff vacío) + `orden-remision-alcance.guardia` → «`SORT_FIELDS` sigue siendo exactamente las tres claves» | ✅ |
| R19 | Reversible sin perder datos | Rollback EJECUTADO (§4) + `orden-clave-remision.guardia` → «down.sql — reversible sin perder dato de negocio» | ✅ |

**Pendientes del `frontend_dev`, y NO cubiertos aquí:** R1, R10, R11, R12, R14, R20, y el lado
cliente de R2/R9.

---

## 3. T4.1 — la contraprueba por mutación (sin esto, un test de orden no vale)

Un test que afirma un orden **tiene que poder ponerse rojo**. Se mutó `SORT_COLUMN` devolviendo
`num_remision` a la columna cruda (`"numRemision"`) y se corrió el archivo tal cual:

```
--- MUTADO ---
 FAIL  tests/integration/db/orden-orden-remision-natural.test.ts
AssertionError: expected [ '72912', '73636', 'BS-00001', …(9) ] to deeply equal [ … ]
- Expected
+ Received
    "NA-001",
-   "NA-107",
    "NA-1067",
    "NA-1069",
+   "NA-107",
    "NA-1070",

 Test Files  1 failed (1)
      Tests  7 failed | 5 passed (12)
EXIT_MUTADO=1
```

El rojo dice literalmente el defecto de la ficha: `NA-107` cayendo entre `NA-1069` y `NA-1070`.

```
--- RESTAURADO ---
 Test Files  1 passed (1)
      Tests  12 passed (12)
EXIT_RESTAURADO=0
```

**Las tres guardias también se mataron una por una** (T5.1/T5.2/T5.3 lo exigen):

| Mutación | Guardia | Resultado |
| --- | --- | --- |
| Quitar `COLLATE "C"` de `migration.sql` | `orden-clave-remision.guardia` | 1 failed \| 15 passed → restaurado 16 passed |
| Añadir `claveRemision` al `orderBy` de `findRecepcionSateliteByZona` | `orden-remision-alcance.guardia` | 2 failed \| 7 passed → restaurado 9 passed |
| Colar `claveRemision: "colada"` en un `data:` de `OrdenRepository` | `clave-remision-solo-lectura.guardia` | 1 failed \| 11 passed → restaurado 12 passed |
| Crear `app/_tmp423-fuga.ts` con `claveRemision` | `clave-remision-solo-lectura.guardia` | 2 failed \| 10 passed → borrado, 12 passed |

---

## 4. T1.2 / R19 — el rollback, EJECUTADO contra la base local

```
--- ANTES DEL ROLLBACK ---
[ { ordenes: 70, remisiones: 70, huella: 'a278d058db43f98575bd7883a2275738' } ]
[ { tiene_columna: 1 } ]
[ { tiene_indice: 1 } ]

$ pnpm run db:rollback
Aplicando rollback: 20260916120000_orden_clave_remision
Script executed successfully.
Rollback completado: 20260916120000_orden_clave_remision

--- DESPUES DEL ROLLBACK ---
[ { ordenes: 70, remisiones: 70, huella: 'a278d058db43f98575bd7883a2275738' } ]
[ { tiene_columna: 0 } ]
[ { tiene_indice: 0 } ]

$ pnpm exec prisma migrate deploy
Applying migration `20260916120000_orden_clave_remision`
All migrations have been successfully applied.

--- REAPLICADA ---
[ { ordenes: 70, remisiones: 70, huella: 'a278d058db43f98575bd7883a2275738' } ]
[ { tiene_columna: 1 } ]
[ { tiene_indice: 1 } ]
```

La `huella` es `md5(string_agg(num_remision, '|' ORDER BY id))`: **idéntica en los tres momentos**.
Revertir deja `orden` sin la columna ni el índice y no toca ni una remisión (R19).

---

## 5. T1.3 — `schema.prisma` sin drift

```
$ pnpm exec prisma migrate diff --from-config-datasource --to-schema db/schema.prisma --exit-code
Loaded Prisma config from prisma.config.ts.

No difference detected.

EXIT=0
```

La columna, tal y como la dejó Postgres (leído de `pg_attribute` / `pg_indexes`):

```
attname: 'clave_remision', typname: 'text', collname: 'C', attgenerated: 's', attnotnull: false

CREATE INDEX orden_prioridad_clave_remision_idx ON public.orden
  USING btree (prioridad DESC, clave_remision, id) WHERE (deleted_at IS NULL)
```

`attgenerated: 's'` = STORED. `collname: 'C'` = la comparación es byte a byte. El índice es
**parcial**, que es justo lo que Prisma no sabe escribir y por eso el modelo lo explica.

---

## 6. T2.4 — la medida del `omit` (esto era «medir antes de decidir», no suponer)

El comentario vigente de `lib/db/prisma-client.ts` afirmaba que el `omit` **no afecta al `where`**;
sobre el `orderBy` no decía nada — y esta columna existe exactamente para eso. Medido contra
Postgres real con el cliente `omit`-ado de producción
(`orden-orden-remision-natural`, caso «R16/T2.4 …»):

- `tx.orden.findMany({ orderBy: [{ claveRemision: "asc" }, { id: "asc" }] })` devuelve las 12
  remisiones en el orden natural literal → **el `omit` NO impide el `orderBy`**;
- ninguna de esas filas crudas trae la propiedad `claveRemision` (`clavesEnPayload === 0`);
- ningún `OrdenListItemDTO` del listado la trae (`clavesEnDto === 0`).

**Decisión: el `omit` se queda.** No hizo falta el plan B del design §2.6. El `omit` recorta la
PROYECCIÓN, no la cláusula de orden.

---

## 7. La expresión, medida valor a valor contra el Postgres local

Los valores del design §2.1/§2.2 **no se dieron por buenos: se midieron**. Los dos últimos no
estaban en el design y se añaden aquí porque ahora son hechos:

| `num_remision` | `clave_remision` |
| --- | --- |
| `72912` | `000000000000072912` |
| `BS-00001` | `BS000000000000000001` |
| `NA-107` | `NA000000000000000107` |
| `NA-1069` | `NA000000000000001069` |
| `SC-050` | `SC000000000000000050` |
| `SIN NUMERO` | `SINNUMERO000000000000000000` |
| `---` | `000000000000000000` |
| `NA-` | `NA000000000000000000` |
| `📦-5` | `000000000000000005` |
| `0` | `000000000000000000` |
| 25 dígitos | `123456789012345678` (truncada a 18, **sin error**) |
| `␣␣42␣␣` (espacios al borde) | `42000000000000000000` |

Las dos últimas filas y los pares `---`/`0` y `NA-1`/`N-A1` son las **colisiones conocidas y
aceptadas**: la clave no es una identidad, es una clave de orden, y el desempate por `id` (ficha
352) mantiene la paginación estable. Están ancladas en un test para que queden **dichas**, no
descubiertas.

---

## 8. Salida real del gate parcial que me tocaba

```
$ pnpm run typecheck
> tsc --noEmit
TYPECHECK_EXIT=0
```

```
$ pnpm run lint
✖ 184 problems (0 errors, 184 warnings)
LINT_EXIT=0
```

Las 184 son el baseline del árbol (`no-unused-vars` de dobles en tests ajenos). Sobre **solo los
archivos de esta feature**:

```
$ pnpm exec eslint <los 9 archivos tocados>
LINT_MIOS_EXIT=0        # ni un warning
```

```
$ pnpm exec vitest related --run <los archivos tocados>
 Test Files  762 passed (762)
      Tests  10656 passed | 26 skipped (10682)
   Duration  439.54s
VITEST_RELATED_EXIT=0
```

**Los `skipped` revisados, porque «init OK» no basta:** ninguno de los 26 es de esta feature. Los
dos archivos de `tests/integration/db/**` se EJECUTARON —16 casos, uno a uno, con `.env` presente
y base alcanzable—:

```
$ pnpm exec vitest run tests/integration/db/orden-orden-remision-natural.test.ts \
                      tests/integration/db/orden-clave-remision-no-lanza.test.ts --reporter=verbose
 ✓ … > las NUEVE remisiones raras se crean UNA A UNA, sin una sola excepcion
 ✓ … > las dos COLISIONES conocidas conviven: dos remisiones, una sola clave, cero error
 ✓ … > un LOTE con una fila rara en medio entra COMPLETO (la carga masiva no se cae)
 ✓ … > R17 — un intento de ESCRIBIR la clave lo rechaza la BASE, y la orden no nace
 ✓ … > el corpus queda aislado: cada ventana del 2001 solo contiene lo sembrado
 ✓ … > R3+R4 — ascendente: numericas, BS-, NA-, SC-, y `NA-107` ANTES que `NA-1069`
 ✓ … > R9 — descendente devuelve el sentido opuesto exacto, con el mismo total
 ✓ … > R2 — pagina 1 trae las MAS BAJAS del conjunto, no las 5 primeras reordenadas
 ✓ … > R7 — `prioridad` sigue mandando por delante del orden por remision
 ✓ … > R8 — con 241 claves EMPATADAS, paginar no repite ni pierde una sola fila (asc)
 ✓ … > R8 — lo mismo en descendente, y la misma pagina pedida dos veces es identica
 ✓ … > R13 — la DESCARGA sale exactamente en el mismo orden que la pantalla
 ✓ … > R2 — por el SERVICIO, el listado paginado da el mismo orden que el repositorio
 ✓ … > R16/T2.4 — el `omit` global NO impide el `orderBy`, y la clave NO viaja en el payload
 ✓ … > la clave que Postgres calculo es la del design, y el indice PARCIAL existe
 ✓ … > R15 — el orden por FECHA no cambio: sigue siendo el default y sigue mandando
 Test Files  2 passed (2)
      Tests  16 passed (16)
```

**El gate completo (`./init.sh`, T6.1) NO lo corrí**: me lo reservó quien me lanzó, y el modo
rápido se negaría solo porque el diff toca `db/migrations/**` y `db/schema.prisma`.

---

## 9. Notas para quien siga

1. **La base local YA tiene la migración aplicada.** Otro agente con un worktree sobre la misma
   base verá su `prisma migrate status` desincronizado hasta que mergee. Es el efecto conocido de
   compartir base local, no un defecto de esta rama.
2. **Orden de despliegue: migración primero, código después.** El código viejo funciona contra la
   columna nueva; al revés, el `orderBy` apuntaría a una columna inexistente y el listado ENTERO
   respondería error, no solo el orden por remisión. La reversión va al revés.
3. **El aviso de series (R20) NO puede leer `clave_remision`.** La guardia
   `clave-remision-solo-lectura.guardia` pone rojo cualquier archivo de `app/` que la nombre. La
   serie se deriva del `numRemision` que el DTO ya trae; es la tentación obvia y está bloqueada a
   propósito.
4. **`tasks.md` no tiene casillas `[ ]`** que marcar: sus tareas son encabezados `### T<n>`. No se
   modificó el archivo; el estado de cada task de backend queda dicho en esta bitácora.

---

## Veredicto

Capa de datos y servidor completas y verificadas contra Postgres real: los 14 requisitos de
backend tienen test ejecutado, la mutación del `ORDER BY` los pone rojos y el rollback deja la
tabla sin la columna y con las 70 remisiones intactas; falta solo la pantalla.
