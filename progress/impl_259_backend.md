# Feature 259 — bitácora del BLOQUE BACKEND (T0–T6)

> **Rama:** `feat/259-tablero-por-reparto` · **Fecha:** 2026-08-21 · **Alcance ejecutado:** T0–T6.
> **NO ejecutado a propósito:** T7 (los cuatro literales de la pantalla, son de `frontend_dev` y van
> DESPUÉS de que el criterio esté matado con mutaciones), T8 (aviso operativo, tarea de release) y
> T9 (gate y PR).
>
> Sin commit, sin PR y sin cambio de rama, como se pidió.

---

## T0 — Antes de tocar nada

**T0.1 — Estado de `origin/dev`.** `git fetch origin dev` ejecutado. La rama nace de
**`bbc369cddecdfd61c0e246b48e91e51622f68234`** (`Merge pull request #438 … chore/alta-259-260`), que
es a la vez `HEAD` y `merge-base` con `origin/dev`: **la rama no se ha quedado atrás**.

Features `in_progress` en `feature_list.json` en este momento: **255** (`cotización por API key`) y
**257** (`filtros del listado por API key`). Ninguna toca `lib/repositories/TableroDiaRepository.ts`.
La **260** —la que sí tocaría el detalle y `lib/types/tablero-dia.ts`— está en **`spec_ready`**, no
en `in_progress`: no hay nadie más escribiendo en este archivo.

**T0.2 — Postgres alcanzable y la integración EJECUTA, no se salta.**

```
$ pnpm exec prisma migrate status
Datasource "db": PostgreSQL database "ordenex", schema "public" at "localhost:5432"
139 migrations found in prisma/migrations
Database schema is up to date!

$ pnpm exec vitest run tests/integration/tablero-dia-conteo.test.ts
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

**13 casos EJECUTADOS**, cero `skipped`. `describeSiHayBase` no degradó a `describe.skip`.

**T0.3 — Cabeceras leídas.** Las dos, enteras: la de `TableroDiaRepository` (con el argumento de D10
que había que responder, no ignorar) y la de `RankingRepository` (de donde se copia el predicado y
donde vive su porqué).

---

## Archivos tocados

| Archivo | Qué cambia |
| --- | --- |
| `lib/repositories/TableroDiaRepository.ts` | `cteIdsDelDia` (las dos ramas + la cláusula de la rama de recolección) y **la cabecera** (D10 revertida). Además, en el docstring de `contarPorMensajero`, la nota de índices: el prefijo del índice sirve a la **rama (b)**, y la rama (a) no tiene ninguno que empiece por `fecha_reparto`. |
| `specs/246-asignacion-por-dia/requirements.md` | **Sólo se AÑADE** el apéndice fechado al final de §D10. Ni una palabra del texto original se toca (T2.4 lo comprueba en las dos direcciones). |
| `tests/integration/_semilla-tablero-dia.ts` | `SemillaOrden` gana `fechaReparto?: Date \| null`, `crearOrden` lo escribe, y entra el helper `diaReparto(fecha)` (**medianoche UTC**, convención `@db.Date`, NO las 06:00Z). |
| `tests/unit/repositories/tablero-dia-universo-sql.test.ts` | **Nuevo.** Los tests de FORMA del criterio (T2.1). |
| `tests/unit/tablero-dia/d10-revertida.guardia.test.ts` | **Nueva guardia** (T2.4): el código y el spec de la 246, en las dos direcciones. |
| `tests/integration/tablero-dia-dia-reparto.test.ts` | **Nuevo.** C1–C7 contra Postgres real (T3.2). |
| `tests/integration/tablero-dia-recoleccion.test.ts` | **+2 casos**: C9 (el de la secuencia 08:00 Ana / 14:00 Beto, con el mensajero CAMBIADO) y C10. C8 ya existía y sigue verde sin tocarlo. |
| `tests/integration/tablero-dia-detalle-cuadre.test.ts` | **+1 caso** (R14): el cuadre mezclando rama (a), rama (b) y recolección. |
| `tests/integration/tablero-dia-ritmo.test.ts` | **+1 caso** (R15): el último acumulado con órdenes de las dos ramas. |
| `tests/integration/tablero-dia-aislamiento.test.ts` | **+1 caso** (R16): una orden reservada para hoy en la zona B no se ve desde la A. |

**NO tocados, y es parte del resultado:** `lib/types/tablero-dia.ts`,
`lib/interfaces/repositories/ITableroDiaRepository.ts`, `lib/services/TableroDiaService.ts`, la caché,
la Server Action, `RankingRepository`, `db/**` (ni migración ni índice, R20) y los tres tests de forma
que ya existían (`tablero-dia-sql`, `tablero-dia-detalle-sql`, `tablero-dia-ritmo-sql`).

### Sobre `tablero-dia-detalle-cuadre.test.ts` — el aviso del encargo

Ese archivo afirma `detalle.total === fila.asignadas`, y esta ficha mueve un lado de la igualdad.
**No hubo que aflojar nada, y el motivo es medible:** ningún caso que ya existía fija
`fecha_reparto`, así que **todos ejercitan la rama (b)** y las dos consultas se mueven a la vez —
comparten literalmente `cteIdsDelDia`. Los tres casos originales pasan **sin editarlos**. Lo que sí
faltaba era un caso que ejercitara la rama (a) **y** la de recolección a la vez, y ése es el que se
añade. La mutación **M2** confirma que el caso nuevo mide de verdad: al volver a D10 se pone rojo.

---

## Mapa `R<n> → test` (verificado uno a uno)

| R | Test que lo cubre | Estado |
| --- | --- | --- |
| **R1** | `tablero-dia-universo-sql` (las dos ramas en las tres consultas) + C1/C4 | ✅ |
| **R2** | C1 (`tablero-dia-dia-reparto`) | ✅ |
| **R3** | C2 — y **M2** demuestra que el caso mide | ✅ |
| **R4** | C3 | ✅ |
| **R5** | C6 — y **M4** | ✅ |
| **R6** | C4 y C5 — y **M1** | ✅ |
| **R7** | C7 (las tres ventanas, cada orden una vez) — y **M3** | ✅ (ver la nota de **M7** abajo) |
| **R8** | `tablero-dia-universo-sql` (sin `COALESCE` sobre `fecha_reparto`, sin zona horaria, sin `startOfDayCR`) + `frontera.guardia` (a) | ✅ |
| **R9** | `tablero-dia-universo-sql` (el parámetro de la rama (a) **es** `ventana.fecha`, con `::date`; la fecha no aparece como literal) — y **M6** | ✅ (con hallazgo, ver M6) |
| **R10** | C8 y C10 (`tablero-dia-recoleccion`) | ✅ |
| **R11** | C9 — y **M5** | ✅ |
| **R12** | `sumaDeLosOcho` afirmado en cada caso de T3.2 y T3.3 | ✅ |
| **R13** | `tablero-dia-universo-sql` (el fragmento es **literalmente idéntico** en las tres) + el cuadre y el ritmo | ✅ |
| **R14** | caso nuevo de `tablero-dia-detalle-cuadre` | ✅ |
| **R15** | caso nuevo de `tablero-dia-ritmo` | ✅ |
| **R16** | `tablero-dia-sql` (una sola aparición de `"zona_id"`, después de `ids_del_dia`) + `tablero-dia-aislamiento` + el caso nuevo | ✅ |
| **R17** | `asignado-at-solo-lectura.guardia` (ni una escritura en el árbol) | ✅ |
| **R18** | `frontera.guardia` (d): sin `findMany`, tres consultas `["agregada","paginada","agregada"]` | ✅ |
| **R19** | `pnpm typecheck` + `tablero-dia-accion` / `tablero-dia-detalle-accion` verdes **sin editarlos** | ✅ |
| **R20** | `asignado-at-solo-lectura.guardia` (la lista blanca de migraciones no cambia) | ✅ |
| **R21** | `d10-revertida.guardia`, bloque (1) | ✅ |
| **R22** | C2, segunda mitad (la misma siembra contada con la ventana de mañana, sin ninguna escritura) | ✅ |
| **R23–R25** | **Tanda T7 — `frontend_dev`.** Fuera de este bloque. | ⏳ pendiente |
| **R26** | `d10-revertida.guardia`, bloque (2): el apéndice está **y** el texto original sigue verbatim | ✅ |

---

## Salida real de los comandos

### `pnpm run typecheck`

```
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit

TYPECHECK_EXIT=0
```

### `pnpm run lint`

```
LINT_EXIT=0
✖ 99 problems (0 errors, 99 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

**0 errores.** Las 99 advertencias son preexistentes (`_input`, `_origenes`… en tests ajenos) y
**ninguna cae en un archivo de esta ficha**: `grep` sobre el log por `tablero-dia|d10-revertida`
devuelve **0** líneas.

### Los tests de la feature

```
$ pnpm exec vitest run tests/unit/tablero-dia tests/unit/repositories tests/unit/services \
    tests/integration/tablero-dia-*.test.ts

 Test Files  312 passed (312)
      Tests  5029 passed (5029)
```

### Las guardias enteras

```
$ pnpm run test:guardias        # vitest run guard

 Test Files  128 passed (128)
      Tests  1927 passed (1927)
```

**128 guardias ejecutadas.** Ninguna se aflojó ni se tocó. Interesan especialmente
`frontera.guardia` (sigue clasificando las tres consultas como `["agregada","paginada","agregada"]`,
sin `findMany` y sin `startOfDayCR`) y `asignado-at-solo-lectura.guardia` (ni una escritura; la lista
blanca de migraciones **sin cambios**; el repositorio sigue **leyendo** la columna).

### Casos EJECUTADOS por archivo (no «passed»: ejecutados)

```
$ pnpm exec vitest run --reporter=verbose <los 7 de integración + los 2 nuevos de unidad>
 Test Files  9 passed (9)
      Tests  79 passed (79)
```

| Archivo | Casos ejecutados |
| --- | --- |
| `tests/integration/tablero-dia-dia-reparto.test.ts` | **7** (C1–C7) |
| `tests/integration/tablero-dia-recoleccion.test.ts` | **12** (10 previos + C9 + C10) |
| `tests/integration/tablero-dia-conteo.test.ts` | **13** (sin editar) |
| `tests/integration/tablero-dia-detalle-cuadre.test.ts` | **4** (3 previos + el de R14) |
| `tests/integration/tablero-dia-ritmo.test.ts` | **9** (8 previos + el de R15) |
| `tests/integration/tablero-dia-aislamiento.test.ts` | **4** (3 previos + el de R16) |
| `tests/integration/tablero-dia-detalle-aislamiento.test.ts` | **7** (sin editar) |
| `tests/unit/repositories/tablero-dia-universo-sql.test.ts` | **11** |
| `tests/unit/tablero-dia/d10-revertida.guardia.test.ts` | **12** |

Ninguno `skipped`. Ningún caso tiene salida temprana del tipo `if (!fks) return;`.

---

## T5 — Matar el `WHERE` con mutaciones

**Cómo se hizo, para que se pueda repetir.** Cada mutación se aplica **sola** sobre el
`cteIdsDelDia` REAL con un reemplazo **literal** (nunca regex: el escapado inline ya mordió a este
repo), **abortando si la cadena buscada no aparece exactamente una vez** —un arnés que «aplica» una
mutación inexistente reporta supervivientes sin haber mutado nada—, se corre la batería, y se
**restaura**. Al terminar, `diff` contra la copia original: **idéntica**.

**Batería de cada corrida (7 archivos, 67 casos):** `tablero-dia-dia-reparto`,
`tablero-dia-recoleccion`, `tablero-dia-conteo`, `tablero-dia-detalle-cuadre`, `tablero-dia-ritmo`,
`tablero-dia-universo-sql`, `tablero-dia-sql`.

**Autocomprobación de que los tests se EJECUTARON:** la corrida **BASELINE** (sin mutar) de esa
misma batería da `Test Files 7 passed (7) · Tests 67 passed (67)`. Cada corrida mutada reporta
también sus 67 casos: los rojos salen de ahí, no de una suite vacía.

| # | Mutación en `cteIdsDelDia` | Veredicto | Qué se puso rojo | Mensaje real |
| --- | --- | --- | --- | --- |
| **M1** | quitar la **rama (b)** entera | **MUERTA** — 26 de 67 rojos | **C4**, **C5**, **C7**, los 13 casos históricos de `tablero-dia-conteo`, los 3 del cuadre, los 6 del ritmo y 2 de forma | `AssertionError: expected [] to have a length of 1 but got +0` — `tablero-dia-dia-reparto.test.ts:150` (C4, `expect(hoy).toHaveLength(1)`) |
| **M2** | en la rama (a), contar por `asignado_at` (**volver a D10**) | **MUERTA** — 6 rojos | **C2**, **C3**, C7, C9, el cuadre de R14 y el ritmo de R15 | C2: `AssertionError: expected [ { …(11) } ] to deeply equal []` · C3: `AssertionError: expected [] to have a length of 1 but got +0` |
| **M3** | quitar `fecha_reparto IS NULL` de la rama (b) | **MUERTA** — 6 rojos | **C7**, C2, C9, el cuadre de R14, el ritmo de R15 y la forma de la rama (b) | C7: `AssertionError: expected [ …(3) ] to deeply equal [ …(2) ]` con un id **de más** — la orden C2 aparece en DOS días |
| **M4** | en la rama (a), `=` → `<=` | **MUERTA** — 2 rojos | **C6** y C7 | C6: `AssertionError: expected [ { …(11) } ] to deeply equal []` (la reserva de ayer se cuela en hoy) |
| **M5** | quitar la cláusula de `ids_recoleccion` (la de R11) | **MUERTA** — 3 rojos | **C9**, el cuadre de R14 y la forma de R11 | C9: `AssertionError: expected [ { …(11) } ] to deeply equal []` — la orden reaparece hoy **en la tarjeta de Beto** |
| **M6** | pasar `ventana.desde` en vez de `ventana.fecha` y sin `::date` | **MUERTA, pero sólo por FORMA** — 2 rojos, **cero en integración** | `tablero-dia-universo-sql` (rama (a) y el enlace del parámetro) | `AssertionError: contarPorMensajero: expected 'ids_reparto AS (…' to match /o\."fecha_reparto"\s*=\s*\$\d+::date/` |
| **M7** | `UNION` → `UNION ALL` **dentro de `ids_reparto`** | **SOBREVIVE a los de conteo** (lo esperado) y **mata los de forma** | los 5 archivos de integración **verdes**; rojos `tablero-dia-sql` y `tablero-dia-universo-sql` | `AssertionError: expected '\n      WITH \n    ids_reparto AS (\n…' not to match /\bUNION\s+ALL\b/` |

### ⚠️ HALLAZGO 1 (M6) — la primera versión del test de forma se dejaba engañar

**M6 sobrevivió en la primera pasada, y el motivo no era el `WHERE`: era mi test.** La aserción de
la rama (a) se aplicaba al fragmento ENTERO del universo, donde también vive la cláusula de la
recolección (`o2."fecha_reparto" = $N::date`). Es decir: **la aserción de la rama (a) la satisfacía
la OTRA cláusula**, y quitarle a la rama (a) su `::date` pasaba en verde.

**Arreglado y vuelto a medir:** el test recorta ahora `ids_reparto` (sin `ids_recoleccion`), exige el
alias `o.` y —esto es lo que de verdad lo cierra— **sigue el número del placeholder de la rama (a)
hasta su valor** y afirma que ese valor es `ventana.fecha`. Con eso, M6 muere. Queda escrito en el
propio archivo, junto a la función `ramasDeReparto`, para que nadie lo «simplifique» de vuelta.

**Y la segunda mitad del hallazgo, que hay que decir aunque incomode:** con M6 aplicada, **los cinco
archivos de integración siguen verdes**. Es decir, en esta máquina el comportamiento **no cambia**:
el driver serializa `ventana.desde` como texto y Postgres lo reduce a la misma fecha calendario. Lo
que protege el `::date` no es el resultado de *hoy aquí*, sino que el resultado **deje de depender
del `TimeZone` de la sesión y del offset local del proceso** (la trampa que documenta
`lib/utils/dia-reparto.ts`). Esa propiedad **sólo la puede afirmar un test de forma** — ninguna
siembra de integración la puede cazar en una máquina donde ya coinciden. Dicho aquí para que nadie
lea el rojo de M6 como «la integración lo cubre».

### ⚠️ HALLAZGO 2 (M7) — sobrevive, pero por una razón MÁS FUERTE que la que el spec le atribuye

El spec espera que M7 sobreviva «porque las dos ramas son disjuntas». **Es cierto que lo son** —C7 lo
mide, y M3 demuestra que C7 mide de verdad—, pero **la supervivencia de M7 está sobredeterminada**:
`ids_del_dia` hace `SELECT id FROM ids_reparto UNION SELECT id FROM ids_recoleccion`, y ese `UNION`
exterior **deduplica igualmente**. O sea que M7 sobreviviría aunque las ramas **no** fueran
disjuntas. **M7 no es evidencia de la disjunción; la evidencia es C7 (matada por M3).** Lo que M7 sí
demuestra —y para eso vale— es que el `UNION` interior está protegido por los tests de forma y no por
casualidad.

---

## T4.1 — El `EXPLAIN`, anotado por lo que es

> **⚠️ ESTOS PLANES MIDEN *FORMA*, NO COSTE.** La base local tiene **67 órdenes vivas**. A esa escala
> el planificador hace `Seq Scan` con índice y sin él —lo dice la propia migración de la 246, que
> midió producción con 141 órdenes vivas—. Un `EXPLAIN` de hoy no puede decir nada sobre si esto
> aguantará con volumen.
>
> **⚠️ Y NO CONFIRMAN EL ARGUMENTO DE INDEXABILIDAD DE `design.md` §3.1.** Ese párrafo —el que
> sostiene «dos `SELECT` en vez de un `OR`»— **no está medido en esta ficha**, y el propio design lo
> dice en un recuadro. Se apoya en los cuatro planes de `progress/impl_246.md`, que son de **OTRA
> consulta** (el denominador del ranking, que agrupa y no proyecta `o."id"`), tomados con
> `enable_seqscan = off` para forzar la **forma**, sobre una base de decenas de filas. Lo único
> estructural y no medido-ni-necesitado-de-medir es que aquí un `Index Only Scan` es imposible,
> porque `o."id"` no está en el índice. **Si dentro de un año alguien necesita apoyarse en esto,
> tiene que volver a medirlo con volumen.** Que nadie cite este anexo como si fuera esa medición.
>
> **Dónde mirar el día que la pantalla vaya lenta** (`design.md` §6): la **rama (a)** no tiene ningún
> índice que empiece por `fecha_reparto`. El que existe es
> `(mensajero_asignado_id, asignado_at, fecha_reparto)`, cuyo prefijo sirve a la rama (b). **Esta
> ficha no crea ninguno (R20)**, y no por descuido: la 246 midió que un índice liderado por
> `fecha_reparto` hace atractivo un `BitmapOr` que **degrada el plan del denominador del ranking**,
> que es una consulta con dinero detrás.

**Lo que sí se ve en los planes de abajo, y es lo que se venía a comprobar:** las dos ramas aparecen
como **dos `Seq Scan` separados bajo un `Append`** con su `Unique` encima —la forma «dos `SELECT`
unidos» del design, no un `OR` colapsado en un solo `Filter`—, cada uno con **su propio `Filter`
completo**:

```text
->  Append
      ->  Seq Scan on orden o_1
            Filter: ((mensajero_asignado_id IS NOT NULL) AND (fecha_reparto = '2026-08-21'::date))
      ->  Seq Scan on orden o_2
            Filter: ((mensajero_asignado_id IS NOT NULL) AND (fecha_reparto IS NULL) AND (asignado_at >= …) AND (asignado_at < …))
```

y la rama de recolección entra por `orden_historial_estado` con su `Index Scan` de siempre, ahora con
el `JOIN "orden" o2` cuyo `Filter` es la cláusula de R11:

```text
->  Seq Scan on orden o2
      Filter: ((fecha_reparto IS NULL) OR (fecha_reparto = '2026-08-21'::date))
->  Index Scan using orden_historial_estado_orden_id_created_at_idx on orden_historial_estado h
      Index Cond: ((orden_id = o2.id) AND (created_at >= …) AND (created_at < …))
      Filter: (origen_tipo = 'asignacion_recoleccion'::orden_historial_origen_tipo)
```

Los tres planes completos, tal cual salieron (`EXPLAIN`, **sin** `ANALYZE`), de las consultas que
**emite el repositorio** —capturadas espiando `$queryRaw`, no escritas a mano—:

```text
# EXPLAIN de las tres consultas — dia representado: 2026-08-21
# ordenes vivas en la base local: 67

===== contarPorMensajero (alcance global) =====
Sort  (cost=48.98..48.98 rows=1 width=151)
  Sort Key: (count(*)) DESC, (TRIM(BOTH FROM concat_ws(' '::text, u.nombre, u.primer_apellido))), a.mensajero_id
  CTE asignadas
    ->  Nested Loop  (cost=32.27..43.07 rows=1 width=106)
          ->  Hash Join  (cost=32.12..39.82 rows=1 width=111)
                Hash Cond: (o.id = o_1.id)
                ->  Seq Scan on orden o  (cost=0.00..7.67 rows=13 width=111)
                      Filter: ((mensajero_asignado_id IS NOT NULL) AND (deleted_at IS NULL))
                ->  Hash  (cost=32.08..32.08 rows=3 width=32)
                      ->  Unique  (cost=32.02..32.08 rows=3 width=32)
                            ->  Merge Append  (cost=32.02..32.07 rows=3 width=32)
                                  Sort Key: o_1.id
                                  ->  Unique  (cost=15.86..15.87 rows=2 width=32)
                                        ->  Sort  (cost=15.86..15.87 rows=2 width=32)
                                              Sort Key: o_1.id
                                              ->  Append  (cost=0.00..15.85 rows=2 width=32)
                                                    ->  Seq Scan on orden o_1  (cost=0.00..7.84 rows=1 width=37)
                                                          Filter: ((mensajero_asignado_id IS NOT NULL) AND (fecha_reparto = '2026-08-21'::date))
                                                    ->  Seq Scan on orden o_2  (cost=0.00..8.00 rows=1 width=37)
                                                          Filter: ((mensajero_asignado_id IS NOT NULL) AND (fecha_reparto IS NULL) AND (asignado_at >= '2026-08-21 06:00:00'::timestamp without time zone) AND (asignado_at < '2026-08-22 06:00:00'::timestamp without time zone))
                                  ->  Unique  (cost=16.15..16.16 rows=1 width=37)
                                        ->  Sort  (cost=16.15..16.16 rows=1 width=37)
                                              Sort Key: h.orden_id
                                              ->  Nested Loop  (cost=0.27..16.14 rows=1 width=37)
                                                    ->  Seq Scan on orden o2  (cost=0.00..7.84 rows=1 width=37)
                                                          Filter: ((fecha_reparto IS NULL) OR (fecha_reparto = '2026-08-21'::date))
                                                    ->  Index Scan using orden_historial_estado_orden_id_created_at_idx on orden_historial_estado h  (cost=0.27..8.29 rows=1 width=37)
                                                          Index Cond: ((orden_id = o2.id) AND (created_at >= '2026-08-21 06:00:00'::timestamp without time zone) AND (created_at < '2026-08-22 06:00:00'::timestamp without time zone))
                                                          Filter: (origen_tipo = 'asignacion_recoleccion'::orden_historial_origen_tipo)
          ->  Index Scan using order_status_pkey on order_status s  (cost=0.15..3.24 rows=1 width=64)
                Index Cond: (id = o.estatus_id)
  ->  GroupAggregate  (cost=5.82..5.89 rows=1 width=151)
        Group Key: a.mensajero_id, u.nombre, u.primer_apellido
        ->  Sort  (cost=5.82..5.83 rows=1 width=83)
              Sort Key: a.mensajero_id, u.nombre, u.primer_apellido
              ->  Nested Loop Left Join  (cost=3.68..5.81 rows=1 width=83)
                    Join Filter: (g.orden_id = a.orden_id)
                    ->  Hash Join  (cost=0.03..2.14 rows=1 width=111)
                          Hash Cond: (u.id = a.mensajero_id)
                          ->  Seq Scan on usuario u  (cost=0.00..2.07 rows=7 width=52)
                          ->  Hash  (cost=0.02..0.02 rows=1 width=96)
                                ->  CTE Scan on asignadas a  (cost=0.00..0.02 rows=1 width=96)
                    ->  Unique  (cost=3.64..3.65 rows=1 width=86)
                          ->  Sort  (cost=3.64..3.65 rows=1 width=86)
                                Sort Key: g.orden_id, g.created_at DESC, g.id DESC
                                ->  Nested Loop  (cost=0.00..3.63 rows=1 width=86)
                                      Join Filter: (a_1.orden_id = g.orden_id)
                                      ->  Seq Scan on gestion_orden g  (cost=0.00..3.60 rows=1 width=86)
                                            Filter: ((anulada_at IS NULL) AND (created_at >= '2026-08-21 06:00:00'::timestamp without time zone) AND (created_at < '2026-08-22 06:00:00'::timestamp without time zone))
                                      ->  CTE Scan on asignadas a_1  (cost=0.00..0.02 rows=1 width=32)

===== listarOrdenesDelDia (alcance zona) =====
Limit  (cost=56.84..56.85 rows=1 width=164)
  ->  Sort  (cost=56.84..56.85 rows=1 width=164)
        Sort Key: (COALESCE(o.asignado_at, ((InitPlan 1).col1), '2026-08-21 06:00:00'::timestamp without time zone)) DESC, o.id
        ->  WindowAgg  (cost=44.45..56.83 rows=1 width=164)
              Window: w1 AS ()
              ->  Nested Loop  (cost=44.45..56.82 rows=1 width=156)
                    Join Filter: (o.id = o_1.id)
                    ->  Nested Loop Left Join  (cost=12.42..24.70 rows=1 width=156)
                          ->  Nested Loop Left Join  (cost=4.13..16.39 rows=1 width=148)
                                ->  Nested Loop  (cost=0.42..12.65 rows=1 width=144)
                                      ->  Index Scan using orden_zona_id_idx on orden o  (cost=0.27..4.47 rows=1 width=149)
                                            Index Cond: (zona_id = '11111111-1111-4111-8111-111111111111'::text)
                                            Filter: ((deleted_at IS NULL) AND (mensajero_asignado_id = '22222222-2222-4222-8222-222222222222'::text))
                                      ->  Index Scan using order_status_pkey on order_status s  (cost=0.15..8.17 rows=1 width=64)
                                            Index Cond: (id = o.estatus_id)
                                ->  Limit  (cost=3.71..3.71 rows=1 width=49)
                                      ->  Sort  (cost=3.71..3.71 rows=1 width=49)
                                            Sort Key: g.created_at DESC, g.id DESC
                                            ->  Seq Scan on gestion_orden g  (cost=0.00..3.70 rows=1 width=49)
                                                  Filter: ((anulada_at IS NULL) AND (created_at >= '2026-08-21 06:00:00'::timestamp without time zone) AND (created_at < '2026-08-22 06:00:00'::timestamp without time zone) AND (orden_id = o.id))
                          ->  Result  (cost=8.29..8.30 rows=1 width=8)
                                InitPlan 1
                                  ->  Limit  (cost=0.27..8.29 rows=1 width=8)
                                        ->  Index Scan using orden_historial_estado_orden_id_created_at_idx on orden_historial_estado h_1  (cost=0.27..8.29 rows=1 width=8)
                                              Index Cond: ((orden_id = o.id) AND (created_at >= '2026-08-21 06:00:00'::timestamp without time zone) AND (created_at < '2026-08-22 06:00:00'::timestamp without time zone))
                                              Filter: (origen_tipo = 'asignacion_recoleccion'::orden_historial_origen_tipo)
                    ->  Unique  (cost=32.02..32.08 rows=3 width=32)
                          ->  Merge Append  (cost=32.02..32.07 rows=3 width=32)
                                Sort Key: o_1.id
                                ->  Unique  (cost=15.86..15.87 rows=2 width=32)
                                      ->  Sort  (cost=15.86..15.87 rows=2 width=32)
                                            Sort Key: o_1.id
                                            ->  Append  (cost=0.00..15.85 rows=2 width=32)
                                                  ->  Seq Scan on orden o_1  (cost=0.00..7.84 rows=1 width=37)
                                                        Filter: ((mensajero_asignado_id IS NOT NULL) AND (fecha_reparto = '2026-08-21'::date))
                                                  ->  Seq Scan on orden o_2  (cost=0.00..8.00 rows=1 width=37)
                                                        Filter: ((mensajero_asignado_id IS NOT NULL) AND (fecha_reparto IS NULL) AND (asignado_at >= '2026-08-21 06:00:00'::timestamp without time zone) AND (asignado_at < '2026-08-22 06:00:00'::timestamp without time zone))
                                ->  Unique  (cost=16.15..16.16 rows=1 width=37)
                                      ->  Sort  (cost=16.15..16.16 rows=1 width=37)
                                            Sort Key: h.orden_id
                                            ->  Nested Loop  (cost=0.27..16.14 rows=1 width=37)
                                                  ->  Seq Scan on orden o2  (cost=0.00..7.84 rows=1 width=37)
                                                        Filter: ((fecha_reparto IS NULL) OR (fecha_reparto = '2026-08-21'::date))
                                                  ->  Index Scan using orden_historial_estado_orden_id_created_at_idx on orden_historial_estado h  (cost=0.27..8.29 rows=1 width=37)
                                                        Index Cond: ((orden_id = o2.id) AND (created_at >= '2026-08-21 06:00:00'::timestamp without time zone) AND (created_at < '2026-08-22 06:00:00'::timestamp without time zone))
                                                        Filter: (origen_tipo = 'asignacion_recoleccion'::orden_historial_origen_tipo)

===== contarEntregasPorHora (alcance global) =====
GroupAggregate  (cost=41.59..41.62 rows=1 width=12)
  Group Key: ((floor((EXTRACT(epoch FROM (r.at - '2026-08-21 06:00:00'::timestamp without time zone)) / 3600.000000)))::integer)
  ->  Sort  (cost=41.59..41.59 rows=1 width=4)
        Sort Key: ((floor((EXTRACT(epoch FROM (r.at - '2026-08-21 06:00:00'::timestamp without time zone)) / 3600.000000)))::integer)
        ->  Subquery Scan on r  (cost=41.54..41.58 rows=1 width=4)
              Filter: (r.resultado = 'entregada'::gestion_resultado)
              ->  Unique  (cost=41.54..41.55 rows=1 width=86)
                    ->  Sort  (cost=41.54..41.55 rows=1 width=86)
                          Sort Key: g.orden_id, g.created_at DESC, g.id DESC
                          ->  Nested Loop  (cost=32.26..41.53 rows=1 width=86)
                                ->  Hash Join  (cost=32.12..39.82 rows=1 width=69)
                                      Hash Cond: (o.id = o_1.id)
                                      ->  Seq Scan on orden o  (cost=0.00..7.67 rows=13 width=37)
                                            Filter: ((mensajero_asignado_id IS NOT NULL) AND (deleted_at IS NULL))
                                      ->  Hash  (cost=32.08..32.08 rows=3 width=32)
                                            ->  Unique  (cost=32.02..32.08 rows=3 width=32)
                                                  ->  Merge Append  (cost=32.02..32.07 rows=3 width=32)
                                                        Sort Key: o_1.id
                                                        ->  Unique  (cost=15.86..15.87 rows=2 width=32)
                                                              ->  Sort  (cost=15.86..15.87 rows=2 width=32)
                                                                    Sort Key: o_1.id
                                                                    ->  Append  (cost=0.00..15.85 rows=2 width=32)
                                                                          ->  Seq Scan on orden o_1  (cost=0.00..7.84 rows=1 width=37)
                                                                                Filter: ((mensajero_asignado_id IS NOT NULL) AND (fecha_reparto = '2026-08-21'::date))
                                                                          ->  Seq Scan on orden o_2  (cost=0.00..8.00 rows=1 width=37)
                                                                                Filter: ((mensajero_asignado_id IS NOT NULL) AND (fecha_reparto IS NULL) AND (asignado_at >= '2026-08-21 06:00:00'::timestamp without time zone) AND (asignado_at < '2026-08-22 06:00:00'::timestamp without time zone))
                                                        ->  Unique  (cost=16.15..16.16 rows=1 width=37)
                                                              ->  Sort  (cost=16.15..16.16 rows=1 width=37)
                                                                    Sort Key: h.orden_id
                                                                    ->  Nested Loop  (cost=0.27..16.14 rows=1 width=37)
                                                                          ->  Seq Scan on orden o2  (cost=0.00..7.84 rows=1 width=37)
                                                                                Filter: ((fecha_reparto IS NULL) OR (fecha_reparto = '2026-08-21'::date))
                                                                          ->  Index Scan using orden_historial_estado_orden_id_created_at_idx on orden_historial_estado h  (cost=0.27..8.29 rows=1 width=37)
                                                                                Index Cond: ((orden_id = o2.id) AND (created_at >= '2026-08-21 06:00:00'::timestamp without time zone) AND (created_at < '2026-08-22 06:00:00'::timestamp without time zone))
                                                                                Filter: (origen_tipo = 'asignacion_recoleccion'::orden_historial_origen_tipo)
                                ->  Index Scan using gestion_orden_orden_id_idx on gestion_orden g  (cost=0.14..1.70 rows=1 width=86)
                                      Index Cond: (orden_id = o.id)
                                      Filter: ((anulada_at IS NULL) AND (created_at >= '2026-08-21 06:00:00'::timestamp without time zone) AND (created_at < '2026-08-22 06:00:00'::timestamp without time zone))
```

---

## Lo que queda abierto, y lo que NO hizo este bloque

1. **T7 — los cuatro literales de la pantalla (R23, R24, R25).** No se tocaron: son de
   `frontend_dev` y la secuencia es deliberada (el texto se escribe cuando el criterio ya está
   probado y matado con mutaciones). Siguen **vivos y falsos** en `TableroDiaEstados.tsx`,
   `MensajeroCard.tsx`, `DetalleMensajeroPanel.tsx` y `TableroDiaModule.tsx`.
2. **T8 — el aviso a quien opera.** Tarea de release, **bloquea el despliegue** y no el PR. Sin
   hacer.
3. **T9 — gate y PR.** Sin hacer, por encargo. El gate de esta ficha es `./init.sh --rapido` y **no
   se niega solo**: no hay migración, no se tocó `db/schema.prisma`, ni `lib/types/**`, ni
   configuración de build.
4. **El argumento de indexabilidad de `design.md` §3.1 sigue SIN MEDIR**, y esta bitácora no lo
   mide. Ver el aviso del anexo: los planes de aquí son de forma, con 67 órdenes.
5. **Nada obligó a desviarse del design.** El criterio (§2), la forma del SQL (§3), el parámetro del
   día (§3.2), la identidad de los ocho sumandos (§8) y el «ningún índice» (§6) quedaron tal cual.
   Los dos únicos añadidos respecto de lo escrito son consecuencia de T5 y están explicados arriba:
   el recorte de `ramasDeReparto` en el test de forma (hallazgo de M6) y la nota de honestidad sobre
   por qué M7 sobrevive (hallazgo 2).

## Veredicto

**El criterio del día cambia por `fecha_reparto` con las dos ramas disjuntas y la cláusula de R11, y
está probado contra Postgres real y matado con seis mutaciones** — `typecheck` y `lint` sin errores,
5029 tests verdes en el árbol de la feature, 1927 en las 128 guardias, y las dos únicas
supervivencias (M6 en su primera pasada, M7) están explicadas y una de ellas obligó a **reforzar el
test**, no a bajar la exigencia.

---

# Adenda — cierre de los menores de la revisión (2026-08-21, después de la aprobación 26/26)

La revisión salió aprobada sin bloqueantes. Se cierran cuatro menores, **todos de la misma familia:
un documento (o una aserción) que afirma algo que ya no es cierto**. Sin commit, misma rama.

## M-1 · `tasks.md` atribuía a M7 un valor probatorio que yo mismo desmentí

La fila **R7** del mapa decía «**M7** confirma la disjunción». **No la confirma**, y lo medí en T5:
el `UNION` de `ids_del_dia` deduplica igualmente, así que M7 sobreviviría aunque las ramas se
solaparan. La corrección vivía sólo aquí, en la bitácora, y quien lea el mapa dentro de un año no la
leería.

**Arreglado en dos sitios, no en uno:**

- **la fila R7 del mapa** remite ahora a **C7** y a **M3** —que es la que demuestra que C7 mide— y
  dice con todas las letras que M7 **no** es evidencia de la disjunción, con la fecha y el puntero a
  esta bitácora;
- **el enunciado de T5.2**, que llevaba la misma premisa («los de conteo siguen verdes **porque** las
  ramas son disjuntas»), gana una **corrección fechada** debajo. El texto original no se borra: se
  marca como corregido, que es como este repo envejece sus decisiones.

## M-2 · `progress/impl_259.md` no existe: se corrigen las CITAS, no los archivos

La ficha tiene dos bitácoras (`_backend` y `_frontend`), y ésa es la decisión correcta. Cada cita
pasa a nombrar la que le toca:

| Cita | Ahora apunta a |
| --- | --- |
| `tasks.md` T0.1, T3.2, T4.1, T5.1, T6.1 | `progress/impl_259_backend.md` |
| `tasks.md` T7.3 | `progress/impl_259_frontend.md` |
| `tasks.md` T8.1 | `progress/impl_259_frontend.md` (la última bitácora de la ficha), nombrando además dónde vive el bloque backend |
| `design.md` §6 y §11 (riesgos) | `progress/impl_259_backend.md` |

⚠️ **La única que elegí y no deduje es la de T8.1.** El aviso operativo no es ni backend ni
frontend: es de release, y la ficha no tiene una tercera bitácora. Apunté a la del frontend por ser
la última de la ficha. **Si el coordinador prefiere otro sitio, es cambiar una palabra.**

## M-3 · T8 y T9 siguen SIN marcar, y T8.1 ya dice que es condición de despliegue

Las casillas de T8.1, T9.1 y T9.2 quedan en `[ ]`: son del coordinador. Lo que sí se refuerza es que
T8.1 no se pueda leer como un extra — su criterio de hecho lleva ahora, además del `Bloquea:` que ya
tenía:

> ⛔ **ES CONDICIÓN DE DESPLIEGUE, NO UN EXTRA:** mientras este aviso no esté enviado y anotado, la
> 259 **NO se despliega a `prod`**. No es una recomendación ni una cortesía: es la puerta.

## M-9 · una aserción que no podía fallar, en `tablero-dia-universo-sql.test.ts`

**El defecto, exacto:** el caso «el día viaja como TEXTO» hacía
`expect(fechas).not.toContain(VENTANA.fecha)` donde `fechas` es un `Date[]` y `VENTANA.fecha` un
`string`. **Un `Date` nunca es igual a un `string`: verde pasara lo que pasara.** Las otras dos
aserciones del caso sí medían —y M6 mata por otras vías, así que no había hueco real—, pero es
justo la línea que hace parecer más fuerte a un test de lo que es.

**Arreglado, no borrado**, porque el caso quería decir algo que **ningún otro dice**: que el día
calendario no viaja nunca como `Date`. Ahora compara **instantes contra instantes**:

- ningún parámetro `Date` de la consulta es la **medianoche UTC** de `ventana.fecha` — que es
  exactamente lo que devuelven `startOfDayCR(fecha)` y `new Date("YYYY-MM-DD")`, el desfase de seis
  horas que cerró la ficha 166;
- y la cláusula **no es vacía**: se afirma que los `Date` que sí viajan son las **cotas de la
  ventana** (`desde` y `hasta`). Sin esto, una consulta sin ningún parámetro `Date` pasaría el
  primer assert por vacío.

Las otras dos aserciones del caso viejo se retiran por redundantes, y esto es la comprobación de que
no dejan hueco: `expect(typeof VENTANA.fecha).toBe("string")` medía la fixture, no el SQL; y
`expect(sql.values.includes(VENTANA.fecha)).toBe(true)` está **subsumida y superada** por el caso de
R9, que no se conforma con «la fecha está en algún `values`» sino que **sigue el número del
placeholder de la rama (a) hasta su valor**.

### Y se comprueba con mutaciones, como se pidió

Copia intacta fuera del repo + `sha256` antes y después. **Hash idéntico al restaurar en las dos:**
`7ab831100b33b0144270d333e212454e884d3b1149a5d14b8239ef81a1daf8c7`.

| # | Mutación | Veredicto | Mensaje real |
| --- | --- | --- | --- |
| **M8** | rama (a): `${ventana.fecha}::date` → `${new Date(ventana.fecha)}` (el día pasa a viajar como `Date`) | **MUERTA** — 3 de 11 rojos, y el caso reescrito es uno de ellos | `AssertionError: contarPorMensajero: el día se coló como Date (medianoche UTC): expected [ 1786147200000, 1786168800000, …(5) ] to not include 1786147200000` |
| **M8b** | **la que AÍSLA:** la rama (a) no se toca; el `Date` de medianoche UTC se cuela en la **cláusula de recolección**, conservando su `::date` para que el test de forma de R11 siga verde | **MUERTA — y exactamente 1 rojo: el caso reescrito** | `AssertionError: contarPorMensajero: el día se coló como Date (medianoche UTC): expected [ 1786168800000, 1786255200000, …(5) ] to not include 1786147200000` |

**Por qué hacía falta M8b y no bastaba M8.** M8 pone rojos tres casos a la vez, así que no distingue
«el caso nuevo mide» de «el caso nuevo viaja de gorra con los otros dos». M8b deja verdes a los
otros dos por construcción —la rama (a) intacta, el `::date` de la recolección intacto— y **sólo
puede caer el reescrito**. Cae. Es decir: **mide algo que ninguna otra aserción del archivo cubre.**

## Verificación de la adenda

```
$ pnpm run typecheck
TYPECHECK_EXIT=0

$ pnpm run lint
LINT_EXIT=0
✖ 99 problems (0 errors, 99 warnings)     # las mismas de siempre, ninguna en archivos de la 259

$ pnpm exec vitest run tests/unit/repositories/tablero-dia-universo-sql.test.ts
 Test Files  1 passed (1)
      Tests  11 passed (11)

$ pnpm exec vitest run tests/unit/tablero-dia tests/unit/repositories \
    tests/integration/tablero-dia-*.test.ts
 Test Files  124 passed (124)
      Tests  1793 passed (1793)
```

**Veredicto de la adenda:** los cuatro menores cerrados. Ninguno tocó el criterio: tres eran
documentos que habían envejecido mal y el cuarto era una aserción decorativa, ahora sustituida por
una que mide —y probada con una mutación que la aísla—.

Y las guardias, que no se tocaron pero se vuelven a correr porque la adenda editó `tasks.md`,
`design.md` y el spec de la 246 no (ese quedó intacto desde el bloque backend):

```
$ pnpm run test:guardias
 Test Files  128 passed (128)
      Tests  1927 passed (1927)
```
