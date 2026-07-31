# Bitácora de implementación — Feature 123 · analítica: migración del rollup diario `analytics_daily`

- **Rama:** `feature/123-analitica-rollup-diario-migracion` (worktree `ordenex-wt-123`, base `3c127b57`)
- **Zona:** backend. Sin UI, sin Server Actions, sin servicios, sin repositorios.
- **Spec:** `specs/123-analitica-rollup-diario-migracion/` — aprobado por el humano en la puerta F1.4 el 2026-07-31.
- **Alcance entregado:** SOLO el DDL. `migration.sql` + `down.sql` + `model AnalyticsDaily` + tres archivos de test.
  **Cero filas escritas.** El job que puebla la tabla es la 124 y el backfill la 125 (R44).
- **Round-trip (R43):** `progress/roundtrip_123_analytics_daily.md` — ejecutado de verdad contra
  `localhost:5432/ordenex`, no aceptado como deuda.

---

## 1. Archivos creados / modificados

### Creados
| archivo | qué es |
|---|---|
| `db/migrations/20260731120000_analytics_daily/migration.sql` | DDL: tabla de 19 columnas, 3 CHECK, 4 FK, 4 índices, 10 comentarios, RLS |
| `db/migrations/20260731120000_analytics_daily/down.sql` | `DROP TABLE IF EXISTS "analytics_daily";` + cabecera |
| `tests/unit/analytics/analytics-daily-contrato.test.ts` | **U** — guard de contrato con el catálogo de la 135 (26 tests) |
| `tests/integration/db/analytics-daily-migration.test.ts` | **I** — test estático por regex sobre `.sql` + `schema.prisma` (57 tests) |
| `tests/integration/db/analytics-daily-guards.test.ts` | **G** — frontera R44 + tripwire de suma R29 (13 tests) |
| `progress/roundtrip_123_analytics_daily.md` | **RT** — evidencia medida del UP → DOWN → UP |

### Modificados
| archivo | cambio |
|---|---|
| `db/schema.prisma` | `+69 / -0`, puramente aditivo: `model AnalyticsDaily` + los lados inversos en `Usuario` (x2), `Zona` y `OrderStatus` |
| `specs/123-analitica-rollup-diario-migracion/tasks.md` | T1–T9 marcadas `[x]` |
| `progress/impl_123.md` | este archivo |

`feature_list.json` figura modificado en `git status`: **no es de esta feature**, venía así del leader.

### Por qué la carpeta se llama `20260731120000_analytics_daily`
`scripts/db-rollback.ts` elige la migración a revertir **por nombre de carpeta** (`readdirSync` +
`localeCompare`), no por la última aplicada. El timestamp `20260731120000` la deja como último
**directorio** de `db/migrations/`, por delante de `20260730150000_carga_name_reparacion`. Verificado
reproduciendo el criterio exacto del script (100 directorios, último = el de la 123), no con
`ls | tail -1`, que devuelve `migration_lock.toml` porque es un archivo y ordena después.

### Desviación deliberada de T1.1
La carpeta se creó **a mano** en vez de con `pnpm run db:migrate:create`. Ese comando genera el SQL
por diff del schema y no produce los `COMMENT ON`, los `CHECK` ni el `ENABLE ROW LEVEL SECURITY` que
exigen T2.2 / T2.5 / T2.6; además conecta a la base. El criterio de hecho de T1.1 (la carpeta existe y
es la última por nombre) se cumple igual.

---

## 2. Mapa `R<n> → test` — los 45

**Archivos:** **U** = `tests/unit/analytics/analytics-daily-contrato.test.ts` ·
**I** = `tests/integration/db/analytics-daily-migration.test.ts` ·
**G** = `tests/integration/db/analytics-daily-guards.test.ts` ·
**RT** = `progress/roundtrip_123_analytics_daily.md` (evidencia **ejecutada**)

| R | qué afirma | test |
|---|---|---|
| R1 | la tabla y el modelo existen | I (`CREATE TABLE`, `model AnalyticsDaily` + `@@map`) |
| R2 | grano = 6 columnas = unión de granos snapshot | **U** (derivado del catálogo) + I |
| R3 | sin columna `metodo_pago` | **U** (negativa, mutación comprobada) + I |
| R4 | nada `live` materializado | **U** (recorre `clase`) |
| R5 | sin columnas monetarias; float prohibido | I (negativa: ni `DECIMAL`, ni `REAL`, ni `DOUBLE`) + U |
| R6 | `fecha DATE NOT NULL` | I + RT (T8.3) |
| R7 | PK `id TEXT` uuid | I + RT (T8.3) |
| R8 | `created_at` / `updated_at` | I + RT (T8.3) |
| R9 | snake_case, `@@map`, nombre `analytics_daily` | I + **U** (coincide con `TablaRollup`) |
| R10 | `zona_id`/`tienda_id`/`estatus_id` NOT NULL | I + RT (T8.3) |
| R11 | `mensajero_id` nullable = sin asignar | I (nulabilidad + `COMMENT ON COLUMN`) |
| R12 | `causa_devolucion` nullable, enum existente | I |
| R13 | sin filas de totalización | I (ninguna columna/centinela de subtotal) + RT (T8.6) |
| R14 | único del grano con `NULLS NOT DISTINCT` | I (regex) + **RT (T8.6, mutación real)** |
| R15 | falla en el apply si el motor no lo soporta | I (sin fallback ni `IF NOT EXISTS`) + RT (T8.3, aplicó en PG 16.1) |
| R16 | las 10 medidas exactas, `NOT NULL DEFAULT 0` | I + **U** + RT (T8.3) |
| R17 | ninguna tasa/promedio almacenado | **U** + I (negativa) |
| R18 | `incidentes` materializada | **U** (la deriva de `definicion.razon`) |
| R19 | `sin_gestionar` NO materializada | **U** (negativa) + I |
| R20 | `seg_ciclo_acum` + `seg_ciclo_n` | I + **U** |
| R21 | `seg_ciclo_acum` es `BIGINT` | I + RT (T8.3: bigint) |
| R22 | `n = 0 ⇒ acum = 0` por `CHECK` | I (regex) + **RT (T8.7, rechazo por `analytics_daily_ciclo_coherente`)** |
| R23 | `primer_intento_ok` es conteo entero | I + **U** |
| R24 | universo `primer_intento_ok` ⊆ `entregas` | I (`COMMENT ON COLUMN`) + RT (T8.7) |
| R25 | `CHECK primer_intento_ok <= entregas`: la tasa no pasa de 1 | I (regex) + **RT (T8.7, rechazo por `analytics_daily_pio_lte_entregas`)** |
| R26 | medidas no negativas | I (regex) + **RT (T8.7, rechazo por `analytics_daily_medidas_no_negativas`)** |
| R27 | `ordenes_creadas` es flujo y lo exige el catálogo | **U** (existe como métrica propia) + I (`COMMENT`) |
| R28 | `ordenes_estado_stock`: nombre y stock al corte | I (nombre exacto + `COMMENT` con la frase de no sumar por fecha) + U + G |
| R29 | nadie la suma entre fechas | **G (T7.2, mutación comprobada con sonda aislada)** |
| R30 | comentarios en base (1 tabla + 9 columnas) | I + **RT (`pg_description` = 10, T8.3)** |
| R31 | zona/tienda desde la orden | I (`COMMENT` de `zona_id`/`tienda_id`) |
| R32 | origen de `mensajero_id` según tipo de hecho | I (`COMMENT` de `mensajero_id`) |
| R33 | `estatus_id` = estado al corte | I (`COMMENT` de `estatus_id`) |
| R34 | ciclo atribuido al evento terminal | I (`COMMENT` de `seg_ciclo_acum`) |
| R35 | rollup inmutable hacia atrás | I (`COMMENT ON TABLE`) + **G** (ningún escritor de fechas pasadas) |
| R36 | tolera el estatus huérfano | I (FK a `order_status`, sin CHECK ni lista cerrada de values) |
| R37 | 4 FKs RESTRICT/CASCADE | I + **RT (T8.3: las 4 con delete = restrict, update = cascade)** |
| R38 | RLS habilitada sin policies | I + **RT (relrowsecurity = true, 0 policies, T8.3)** |
| R39 | exactamente 4 índices, los declarados | I (conteo) + **RT (`pg_indexes`, T8.3 y T8.5)** |
| R40 | ningún índice sobre `estatus_id`/`causa_devolucion` | I (negativa) + RT |
| R41 | migración puramente aditiva | I (negativas: sin `ALTER TABLE` ajeno, sin DML) + RT |
| R42 | `down.sql` revierte exactamente | I (`DROP TABLE` y nada más) + `init.sh` §6 + **RT (T8.4)** |
| R43 | round-trip UP→DOWN→UP medido, no deuda | **RT (T8.0–T8.5, checksums idénticos)** |
| R44 | la tabla nace sin consumidores | **G (T7.1)** + RT (`SELECT count(*)` = 0) |
| R45 | guard de contrato con el catálogo | **U (T5.1, mutación comprobada)** |

**45 requisitos, 45 mapeados. Ningún `R<n>` queda sin test.**

**Sin E2E, a propósito.** Justificado en `requirements.md > Fuera de alcance` y `design.md §9`: esta
entrega es DDL sin ningún camino de usuario en ejecución, y rige la decisión humana del 2026-07-30. El
riesgo sustituto lo cubre **RT**, que se ejecutó de verdad.

---

## 3. Verificaciones por mutación — comprobadas, no supuestas

El spec exige explícitamente que los guards demuestren que **se ponen rojos** al mutar lo que dicen
medir. Un guard que pasa en vacío no cubre su requisito. Las ocho mutaciones se ejecutaron y se
observó el rojo real:

| # | task | mutación aplicada | resultado real |
|---|---|---|---|
| 1 | T5.1 | quitar `causaDevolucion` del `model AnalyticsDaily` | **ROJO**, 2 tests (la dimensión `causa_devolucion` tiene columna + el grano es exactamente esa unión) |
| 2 | T5.1 | añadir `metodoPago String? @map("metodo_pago")` | **ROJO**, 2 tests (`metodo_pago`, exclusiva de métricas live, NO tiene columna + el del grano) |
| 3 | T7.2 | sonda real bajo `lib/` con `SUM(ordenes_estado_stock) ... WHERE fecha BETWEEN $1 AND $2` | **ROJO**, 3 tests (tripwire R29 + los 2 de frontera R44) |
| 3b | T7.2 | sonda **aislada** (solo la columna, sin nombrar la tabla) | **ROJO, 1 test: solo el de R29** → el tripwire discrimina por sí solo, no por rebote del guard de frontera |
| 4 | T8.6 | 2.ª fila idéntica con `mensajero_id`/`causa_devolucion` NULL | **RECHAZADA** (23505) por **`analytics_daily_grano_key`** |
| 5 | T8.6 | lo mismo sobre tabla copia con índice **sin** `NULLS NOT DISTINCT` | **ENTRÓ** (2 filas) → control que prueba que la aserción 4 no es vacía |
| 6 | T8.7 | `primer_intento_ok=2, entregas=1` | **RECHAZADO** (23514) por **`analytics_daily_pio_lte_entregas`** |
| 7 | T8.7 | `seg_ciclo_n=0, seg_ciclo_acum=5` | **RECHAZADO** (23514) por **`analytics_daily_ciclo_coherente`** |
| 8 | T8.7 | `entregas=-1` | **RECHAZADO** (23514) por **`analytics_daily_medidas_no_negativas`** |

Los nombres de constraint se capturaron del error de Postgres, no se infirieron. Las mutaciones de
base corrieron en transacción revertida con `SAVEPOINT` por intento; el schema y `lib/` se
restauraron tras las mutaciones de código (`git status` verificado después).

---

## 4. Baseline y resultado — el criterio es delta 0, no verde absoluto

Baseline **medido en esta sesión** sobre `3c127b57`, antes de tocar nada, con el cliente Prisma
regenerado desde el schema limpio (`pnpm db:generate`). No se citan los números de
`progress/current.md`: caducan con cualquier PR ajeno.

| medición | baseline (antes) | final (después) | delta |
|---|---|---|---|
| `pnpm run typecheck` | **0 errores** | **0 errores** | **0** |
| `pnpm run lint` | **3 errores, 23 warnings** | **3 errores, 23 warnings** | **0** |
| `pnpm test` — archivos | 661 (2 fallan / 659 pasan) | 664 (2 fallan / 662 pasan) | **+3 archivos, todos verdes; 0 archivos rojos nuevos** |
| `pnpm test` — tests | 7939 (2 fallan / 7937 pasan) | 8035 (5 fallan / 8030 pasan) | **+96 tests nuevos, todos verdes; +3 rojos, todos en un solo archivo ajeno (ver §5)** |

**Tests nuevos:** U 26/26 · I 57/57 · G 13/13 → **96 pasan, 0 fallan.**

### Rojos heredados, que no son de esta feature
1. `app/(app)/ordenes/_components/OrdenesModule.tsx` **líneas 340:34, 345:7 y 345:21** —
   `react-hooks/preserve-manual-memoization`, "Compilation Skipped: Existing memoization could not be
   preserved". Son los **3 errores de lint** del baseline. Vienen de `dev`.
2. `tests/unit/guards/no-embalaje.test.ts:132` — 1 test rojo, referencias a embalaje fuera del
   whitelist. Rojo ya en el baseline.
3. `tests/unit/analytics/frontera.guardia.test.ts:211` — 1 test rojo en el baseline (pasa a 4; ver §5).

### Nota sobre la medición de la suite
Dos corridas intermedias salieron **degradadas** (653 y 658 archivos frente a los 661 reales, con
`unhandled errors` de workers que **omiten archivos enteros y parecen casi verdes**). Esas mediciones
se descartaron. Los números de la tabla vienen de corridas limpias, sin `unhandled errors`, con el
total de archivos consistente: 661 antes / 664 después = 661 + los 3 nuevos.

### `./init.sh`
**No termina en verde, y ya no lo hacía en el baseline**: aborta en el paso de `pnpm run lint` por los
3 errores heredados del punto 1. Es un rojo previo a esta feature, no una regresión.
El chequeo §6 (`down.sql` de toda migración) se reprodujo a mano porque `init.sh` aborta antes de
llegar a él: **OK, todas las migraciones tienen `down.sql`**, incluida la de la 123.

---

## 5. BLOQUEO / decisión del leader — colisión con el guard de la feature 135

**Es el único rojo nuevo y no lo puede resolver esta feature.**

`tests/unit/analytics/frontera.guardia.test.ts` es un guard de la **feature 135** (ya mergeada en
`dev`) que mide **el diff de la rama actual contra `origin/dev`** y asevera que ese diff **no añade
carpetas en `db/migrations/` y no toca `db/schema.prisma`**. Literalmente: "la 135 no crea
migraciones: analytics_daily es de la 123".

La 123 hace exactamente esas dos cosas, porque es su encargo. El guard pasa de **1 rojo (baseline) a 4**:

| test | estado |
|---|---|
| `el guardia mide un diff no vacio y sabe contra que compara` | **ya rojo en el baseline** (el diff de esta rama no contiene `lib/analytics/`) |
| `no anade ni modifica carpetas de migracion en db/migrations` | **rojo nuevo** (2 entradas: `migration.sql`, `down.sql`) |
| `no toca db/schema.prisma` | **rojo nuevo** |
| `todo el codigo tocado vive en lib/analytics...` | **rojo nuevo** (los 2 `.sql`, `db/schema.prisma` y los 2 tests de `tests/integration/db/`) |

**Diagnóstico.** El guard es correcto en su intención pero está mal alcanzado: es una aserción
**branch-scoped** (existe para constreñir el PR de la 135) que quedó **commiteada permanentemente** y
por tanto corre en toda rama posterior. Como `origin/dev` ya contiene la 135, en cualquier rama nueva
el `merge-base` es posterior a la 135 y el guard acaba juzgando el trabajo de **otra** feature. Esto
volverá a dispararse con la **124**, la **125** y la **126**, que también tocan `db/` — no es un
incidente puntual de la 123.

**No se tocó el archivo, ni se puso en skip, ni se modificó nada bajo `lib/analytics/`**: aflojar el
guard de una dependencia ya mergeada es un cambio de spec ajeno y no corresponde a esta feature.
**Queda a decisión del leader.** Opciones visibles, sin recomendación implícita:
(a) acotar el guard de la 135 para que solo corra en su propia rama; (b) aceptarlo como ruido heredado
conocido y documentarlo; (c) retirarlo, ya que su PR está cerrado y su función preventiva caducó.

Nota útil: `tests/unit/analytics/analytics-daily-contrato.test.ts` **no** dispara el guard, porque vive
en `tests/unit/analytics/`, prefijo que el propio guard permite.

---

## 6. Deudas vivas y lo que no se pudo verificar

### FOLLOW-UP (D5) — retención y purga de `analytics_daily`
**Fuera de alcance por decisión del humano**, y sigue **abierto**. No hay en el repo ni política de
retención ni volumen esperado, y esta feature no los inventa. Consecuencias: no se particiona por
`fecha` (alternativa 9 de `design.md §7`) y **la tabla crece sin poda, sin que nadie haya medido a qué
ritmo**. Falta abrir el ticket que decida cuántos días se conservan; de esa respuesta depende si algún
día conviene particionar. Mitigación disponible y barata: la tabla es **derivada y reconstruible** por
la 125, así que migrar a particionada más tarde no arriesga datos irrecuperables.

### RIESGO DE DESPLIEGUE (D6) — `NULLS NOT DISTINCT` en producción
**En local queda cerrado, y con evidencia más fuerte que la del spec**: el motor es
**PostgreSQL 16.1** (medido con `version()`, no inferido de que otras migraciones estuvieran
aplicadas), y el índice se creó con `indnullsnotdistinct = true` verificado en `pg_index`.
**Para producción sigue SIN confirmar.** Hay que comprobar la versión del Postgres de producción
**antes** de aplicar allí. Si fuera < 15 la migración **falla en el apply** (R15, falla cerrado, que
es el comportamiento querido: nunca crea un único que no deduplique), y la única salida sin usuario
fantasma sería el juego de índices parciales de `design.md §4.3`. Es riesgo de despliegue, no de
diseño.

### La grieta de la anulación (`design.md §6`)
Declarada y no resuelta aquí: una gestión anulada días después deja el rollup por **exceso** en las
medidas de gestión de ese día, y R35 dice que el job **no** lo corrige. La corrección deliberada es
recomputar con la 125. **Aviso dirigido a la 124 y la 125:** si el volumen de anulaciones resultara
alto, la respuesta correcta **no** es aflojar R35 en el job diario, sino programar la 125 sobre una
ventana explícita. La diferencia es que la segunda es visible y la primera vuelve el rollup no
reproducible.

### Cardinalidad no medida
Al añadir `estatus_id` y `causa_devolucion` al grano, cada día genera del orden de "cubos
(zona × tienda × mensajero × estatus) con actividad". Está acotado por las órdenes vivas del día pero
**no está medido** (consecuencia de D5).

### Lo que NO se pudo verificar
- **La versión del Postgres de producción** — habría implicado tocarla. Producción no se tocó en
  ningún momento; el único destino de escritura fue `localhost:5432/ordenex`, verificado antes de cada
  comando.
- **Las FK RESTRICT en ejecución** — se verificó su *definición*, no se intentó borrar una
  zona/tienda/mensajero/estatus con filas agregadas: no había filas y crearlas habría tocado catálogos
  reales.
- **La RLS en ejecución** — `relrowsecurity = true` y 0 policies están medidos, pero no se abrió
  sesión con un rol no privilegiado para comprobar el bloqueo efectivo.
- **Concurrencia, rendimiento y utilidad real de los 3 índices de recorte** — la tabla está vacía: no
  hay planes de ejecución ni coste de escritura medidos. Los índices están justificados por diseño
  (`design.md §5`), no por medición.
- **El `ON CONFLICT` del job de la 124** — el único del grano es la agarradera que ese job necesitará,
  pero aquí no existe job que lo ejerza.
- **El esquema local frente al de producción, objeto por objeto** — el drift local se saneó, no se
  auditó.

La lista completa está en la sección "lo que esto NO demuestra" (10 puntos) de
`progress/roundtrip_123_analytics_daily.md`.

### Desviación documentada en T7.1
T7.1 dice que la única excepción de la frontera es `lib/analytics/types.ts`, pero
`lib/analytics/metrics.ts` nombra `analytics_daily` **14 veces** (los `fuente.tablas` de la 135, ya
mergeada) y esta feature no puede tocar `lib/analytics/`. El guard admite ambos archivos y, a cambio,
endurece la aserción: exige que en `metrics.ts` **toda** ocurrencia fuera de comentarios esté dentro de
un `tablas: ["analytics_daily"]` (14 = 14) y que en ningún archivo de código exista un acceso real
(`prisma.analyticsDaily`, `FROM/INTO/UPDATE/JOIN analytics_daily`, `AnalyticsDailyRepo|Service`). El
compromiso está escrito en el propio archivo de test.

### Dos decisiones de redacción del SQL que conviene conocer
1. El comentario de `ordenes_estado_stock` incluye además la cláusula que lo distingue del FLUJO
   `ordenes_creadas`. El mapa previsto asigna R27 a I vía `COMMENT`, pero T2.5 solo autoriza **9**
   comentarios de columna y `ordenes_creadas` no está entre ellos: meter la frase en el comentario del
   stock resuelve la contradicción sin añadir una 11.ª sentencia.
2. La cabecera evita el token literal `DECIMAL` (dice "tipo numérico EXACTO de 12 dígitos con 2
   decimales"), porque la aserción negativa de T6.2 sobre tipos de coma flotante habría chocado con la
   propia justificación escrita.

---

## 7. Estado de la base local al cerrar

- Host: `localhost:5432/ordenex` (PostgreSQL 16.1). **Producción no se tocó en ningún momento.**
- **T8.0 — drift saneado.** Estado de partida: última común
  `20260724150000_orden_historial_origen_devolucion_rechazada`; 3 pendientes
  (`20260727120000_carga_orden_carga_id`, `20260730130000_orden_incidente`,
  `20260730150000_carga_name_reparacion`); 1 aplicada ausente del árbol
  (`20260728120000_orden_historial_origen_deshacer_asignacion`).
  *Corrección al spec:* eran **3** pendientes, no 2.
- **La "aplicada ausente" resultó ser una fila fantasma de un re-timestamp**, diagnosticada
  consultando `_prisma_migrations`: la misma migración lógica existe en el árbol como
  `20260729140000_orden_historial_origen_deshacer_asignacion` y **la base tiene las dos filas**, ambas
  con `finished_at` no nulo. Su DDL está aplicado una sola vez.
  **Decisión explícita (T8.0 exige decidir): la fila fantasma se deja.** (a) Borrarla es cosmético, el
  DDL ya está aplicado; (b) no afecta a `migrate deploy`, que solo aplica carpetas del árbol ausentes
  de la tabla; (c) no afecta a `pnpm db:rollback`, que apunta por nombre de carpeta a la última, que
  es la de la 123. Con el árbol al día, `migrate status` ya no la menciona.
- Estado final: `Database schema is up to date!`, migración de la 123 **aplicada**,
  `SELECT count(*) FROM analytics_daily` = **0** (R44), 1 fila de bookkeeping.
- Round-trip: checksum sha256 del conjunto ordenado de 23 elementos (índices + FK + CHECK + PK +
  comentarios) **idéntico** antes y después del ciclo DOWN→UP:
  `1be5347fd47248c031d46c0e1085182cb3d24e091500fe2cbe6de1c86b5fb9f0`.
- **Aviso de recurso compartido:** esa base local la comparten varias sesiones del arnés. El saneo de
  T8.0 aplicó 3 migraciones de `dev` que faltaban; era lo que T8.0 exige y deja la base coincidiendo
  con `dev`, pero conviene saberlo si otra sesión medía contra el estado anterior.

---

## 8. Commit

**Pendiente: lo hace el leader.** Esta bitácora se entrega con el árbol sin commitear; no se ejecutó
ningún comando git de escritura (`add`, `commit`, `checkout`, `switch`, `stash`, `reset`, `worktree`)
en ningún momento, ni en el worktree ni en el checkout principal.
