# Feature 123 — analítica: migración del rollup diario `analytics_daily` · tasks

> `[P]` = paralelizable con las tareas marcadas igual dentro del mismo bloque.
> Cada task lleva su **criterio de hecho**, verificable sin interpretación.
> Nada de código de producción antes del «aprobado» humano sobre el spec (`docs/specs.md`).

---

## T0 — PUERTA: preguntas abiertas · **CERRADA el 2026-07-30**

> Las ocho respuestas completas, con su evidencia y su propagación, están en
> `requirements.md > Decisiones del humano (2026-07-30)` (**D1–D8**). Aquí quedan marcadas resueltas
> con la respuesta al lado, porque la lección escrita en `progress/current.md` es literal: *«gate
> aprobado en la bitácora no es lo mismo que las preguntas del spec respondidas por escrito»*.

- [x] **T0.1 — Q1 → D1: el denominador de `primer_intento_ok` es `entregas` del mismo grano.** NO se
      añade `primer_intento_n`.
      *Propagado a:* **R23, R24, R25** (universo definido + `CHECK` que impide que la tasa pase de
      1) y `design.md §3.5`.
- [x] **T0.2 — Q2 → D2: `ordenes_por_estado` es un STOCK al corte, no sumable por fecha.** La
      partición flujo/stock no fue la decisión: `ordenes_creadas` sobrevive **solo** porque el
      catálogo la declara como métrica propia e independiente (verificado en `metrics.ts`). La
      columna del embudo se llama `ordenes_estado_stock` y la no-aditividad se impide por diseño en
      tres capas.
      *Propagado a:* **R16, R27, R28, R29, R30** y `design.md §3.3`.
- [x] **T0.3 — Q3 → D3: solo `incidentes` se materializa; `sin_gestionar` NO.** Razón escrita:
      sería dato duplicado que puede contradecir a su origen. Dónde se deriva: del embudo filtrando
      por el `estatus_id` del value `sin_gestionar`.
      *Propagado a:* **R18, R19** y `design.md §3.4`.
- [x] **T0.4 — Q4 → D4: el tiempo de ciclo se atribuye a la fecha del EVENTO TERMINAL.**
      Consecuencia elevada a invariante: **el rollup es inmutable hacia atrás**; la 124 solo escribe
      el día que agrega y solo la 125 recomputa fechas pasadas. Regalo a la 128: no existe
      invalidación de caché de días pasados.
      *Propagado a:* **R34, R35** y `design.md §6` (incluida la grieta de la anulación).
- [x] **T0.5 — Q5 → D5: retención y volumen, FUERA DE ALCANCE**, con follow-up escrito.
      *Propagado a:* `requirements.md > Fuera de alcance`, alternativa 9 y follow-up de
      `design.md §10`.
- [x] **T0.6 — Q6 → D6: `NULLS NOT DISTINCT` verificado en local** (las dos migraciones del repo que
      ya lo usan figuran APLICADAS en `localhost:5432/ordenex`). Abierto **solo para producción**,
      como riesgo de despliegue.
      *Propagado a:* **R14, R15** (firmes), `design.md §4.3` y riesgo de `design.md §10`.
- [x] **T0.7 — Q7 → D7: SÍ hay Postgres local** (`.env` → `localhost:5432/ordenex`, no compartida
      con producción). **R43 es ejecutable y NO se acepta como deuda.** La base tiene drift → task
      previa **T8.0**.
      *Propagado a:* **R43**, `design.md §8` (con la corrección de la premisa equivocada anterior).
- [x] **T0.8 — Q8 → D8: carpeta renombrada** a `specs/123-analitica-rollup-diario-migracion/`, que
      es el `spec_path` de la ficha. `feature_list.json` lo lleva el leader.

**Estado de la puerta: CERRADA.** No queda ninguna pregunta abierta. La feature puede pasar a
`spec_ready` y, tras el «aprobado» humano, a implementación.

---

## T1 — Preparación de la migración

- [x] **T1.1 [P]** Fijar el nombre de carpeta `db/migrations/<timestamp>_analytics_daily/` con
      `pnpm run db:migrate:create` (solo crea el `.sql`, no aplica).
      *Hecho:* la carpeta existe y `ls db/migrations | sort | tail -1` devuelve **esta** carpeta. Si
      no, se anota el conflicto: `scripts/db-rollback.ts` revierte **por nombre de carpeta**, no por
      última aplicada.
- [x] **T1.2 [P]** Verificar contra `db/schema.prisma` que el enum `gestion_causa_devolucion` existe
      con sus tres valores (`not_found`, `wrong_number`, `wrong_address`).
      *Hecho:* confirmado; la migración **no** crea ningún enum nuevo (mantiene R41 aditiva y deja
      el `down.sql` en una sola sentencia).

## T2 — `migration.sql` (depende de T1)

- [x] **T2.1** `CREATE TABLE "analytics_daily"` con las **19 columnas** de `design.md §3.1`: 6 de
      grano, 10 medidas, `id`, `created_at`, `updated_at`.
      *Hecho:* el DDL coincide columna a columna con la tabla de §3.1; `seg_ciclo_acum` es `BIGINT`,
      la columna del embudo se llama `ordenes_estado_stock` y ninguna medida es de coma flotante ni
      `DECIMAL`.
- [x] **T2.2** Los tres `CHECK` estructurales: `primer_intento_ok <= entregas` (R25),
      `seg_ciclo_n > 0 OR seg_ciclo_acum = 0` (R22) y no negatividad de las diez medidas (R26).
      *Hecho:* tres `ADD CONSTRAINT ... CHECK` con nombre explícito
      (`analytics_daily_pio_lte_entregas`, `analytics_daily_ciclo_coherente`,
      `analytics_daily_medidas_no_negativas`).
- [x] **T2.3** Las cuatro FKs con `ON DELETE RESTRICT ON UPDATE CASCADE` (`zona`, `usuario`×2,
      `order_status`).
      *Hecho:* cuatro `ADD CONSTRAINT ... FOREIGN KEY`; ninguna `CASCADE`/`SET NULL` en `ON DELETE`.
- [x] **T2.4** Índice único del grano con `NULLS NOT DISTINCT` (§4.3), en el orden de columnas
      declarado, más los tres índices de recorte `(tienda_id, fecha)`, `(mensajero_id, fecha)`,
      `(zona_id, fecha)`.
      *Hecho:* exactamente **4** sentencias `CREATE [UNIQUE] INDEX`; la del único contiene
      literalmente `NULLS NOT DISTINCT` y empieza por `fecha`; ninguna sobre `estatus_id` ni
      `causa_devolucion` sueltos (R40).
- [x] **T2.5** Comentarios en la base: **1 `COMMENT ON TABLE`** con el invariante de inmutabilidad
      hacia atrás (R35) y **9 `COMMENT ON COLUMN`** (R30): las cuatro medidas delicadas
      (`ordenes_estado_stock` con la frase literal de **no sumar por `fecha`**; `seg_ciclo_acum` con
      la atribución al **evento terminal**, R34; `seg_ciclo_n`; `primer_intento_ok` con su universo
      ⊆ `entregas`, R24) y las cinco de grano (`zona_id`/`tienda_id` = de la orden R31;
      `mensajero_id` NULL = sin asignar R32; `estatus_id` = estado al corte R33; `causa_devolucion`
      NULL = sin causa tipificada R12).
      *Hecho:* 10 sentencias de comentario; `pg_description` las devuelve tras el UP (se verifica en
      T8.3).
- [x] **T2.6** `ALTER TABLE "analytics_daily" ENABLE ROW LEVEL SECURITY;` sin ninguna policy.
      *Hecho:* la sentencia está y no hay ningún `CREATE POLICY` en el archivo.
- [x] **T2.7** Cabecera de comentario al estilo del repo (`20260727120000_notificacion`): qué crea,
      por qué el grano es de 6 columnas, por qué `NULLS NOT DISTINCT`, por qué no hay dinero y por
      qué existen los tres `CHECK`.
      *Hecho:* la cabecera cita la feature 123, la 135 y las decisiones D1–D4 de este spec más
      D5/D9/D10 de la 135.

## T3 — `down.sql` (depende de T2)

- [x] **T3.1** `DROP TABLE IF EXISTS "analytics_daily";` con cabecera que explique que arrastra PK,
      índices, FKs, CHECKs, comentarios y RLS, y que la migración es aditiva (no toca nada
      preexistente ni retira enums).
      *Hecho:* el archivo existe, `./init.sh` no avisa por `down.sql` faltante, y el DOWN no
      contiene ninguna sentencia sobre tablas/enums preexistentes.

## T4 — Modelo Prisma (depende de T2; `[P]` con T3)

- [x] **T4.1 [P]** `model AnalyticsDaily` en `db/schema.prisma` con `@@map("analytics_daily")`,
      `@map` snake_case en todos los campos, `fecha DateTime @db.Date`,
      `segCicloAcum BigInt @map("seg_ciclo_acum")`, `ordenesEstadoStock Int
      @map("ordenes_estado_stock")`, `causaDevolucion GestionCausaDevolucion?`, relaciones a
      `Zona`/`Usuario`×2/`OrderStatus` con sus lados inversos, y los tres `@@index` normales.
      *Hecho:* `pnpm db:generate` pasa; el modelo **no** declara `@@unique` del grano y lleva un
      comentario apuntando a que el único con `NULLS NOT DISTINCT` y los tres `CHECK` viven en el
      SQL (patrón `gestion_orden` / `orden_incidente`).
- [x] **T4.2 [P]** `pnpm run typecheck` con el cliente regenerado desde el schema limpio.
      *Hecho:* 0 errores nuevos respecto del baseline **medido en esta misma sesión** (no del citado
      en `progress/current.md`).

## T5 — Guard de contrato con la 135 (`[P]`, puede escribirse antes que T2)

- [x] **T5.1 [P]** `tests/unit/analytics/analytics-daily-contrato.test.ts`: importa `METRICAS` de
      `lib/analytics/metrics.ts`, deriva (a) la unión de `granos` de las métricas con
      `fuente.tipo === "rollup"` y (b) las dimensiones exclusivas de métricas `clase: "live"`, y las
      contrasta con las columnas declaradas en `db/schema.prisma`.
      *Hecho:* el test pasa; y **falla** si se le quita a mano `causa_devolucion` del modelo o si se
      le añade `metodo_pago` (mutación comprobada, no supuesta).
- [x] **T5.2 [P]** En el mismo archivo: asertar que no hay columna monetaria ni `REAL`/`DOUBLE`, que
      los componentes de toda `definicion.razon` del catálogo están entre las medidas (incluida
      `incidentes`), que `ordenes_creadas` **existe en el catálogo** como métrica propia (R27) y que
      **no** existe columna para `sin_gestionar` (R19).
      *Hecho:* el test enumera los componentes desde el catálogo, no desde una lista escrita a mano.

## T6 — Test estático de la migración (depende de T2, T3, T4)

- [x] **T6.1** `tests/integration/db/analytics-daily-migration.test.ts`, patrón
      `notificacion-migration.test.ts`: lee `migration.sql`, `down.sql` y `db/schema.prisma` y los
      contrasta por regex.
      *Hecho:* cubre los requisitos que le asigna el mapa de abajo y pasa.
- [x] **T6.2** Aserciones negativas explícitas: ningún `CREATE POLICY`, ningún
      `DECIMAL`/`REAL`/`DOUBLE`, ningún `ALTER TABLE` sobre tabla preexistente, ningún
      `INSERT`/`UPDATE`/`DELETE` de datos, exactamente 4 índices y exactamente 3 `CHECK`.
      *Hecho:* las seis aserciones negativas están y pasan.

## T7 — Guards de frontera y de suma (`[P]` con T6)

- [x] **T7.1 [P]** `tests/integration/db/analytics-daily-guards.test.ts` — **frontera (R44)**:
      ninguna referencia a `analytics_daily` / `analyticsDaily` fuera de `db/`, `specs/`, `tests/` y
      `lib/analytics/types.ts` (donde el literal existe como tipo `TablaRollup` de la 135).
      *Hecho:* el guard pasa y deja la frontera con la 124 verificada, no prometida.
- [x] **T7.2 [P]** En el mismo archivo — **tripwire de suma (R29)**: rastrea `lib/` y `app/`
      buscando agregaciones de `ordenes_estado_stock` (`SUM(`, `_sum`, `sum:`) que no estén acotadas
      a una fecha única, y falla si aparece alguna.
      *Hecho:* pasa hoy en vacío **y discrimina**: con una cadena de prueba que simule
      `SUM(ordenes_estado_stock)` sobre un rango, el guard se pone rojo (mutación comprobada). Sin
      esa comprobación, el guard es una aserción vacía y no cuenta como cobertura de R29.

## T8 — Round-trip real UP → DOWN → UP (depende de T2, T3, T4) — **obligatorio, no es deuda (D7)**

> Método y formato: `progress/roundtrip_155_migracion.md`. Base **local** `localhost:5432/ordenex`.
> **Producción no se toca en ningún momento.**

- [x] **T8.0** **Sanear el drift de la base local antes de medir nada** (D7): la base tiene
      2 migraciones sin aplicar y 1 aplicada que no está en el árbol local (el checkout está en
      `ux`). Diagnosticar con `npx prisma migrate status --schema db/schema.prisma`, dejar por
      escrito el estado de partida y resolverlo (aplicar las pendientes y decidir explícitamente qué
      hacer con la aplicada-ausente) **antes** de T8.1.
      *Hecho:* `migrate status` reporta la base al día respecto del árbol de esta rama, y el estado
      de partida —antes y después del saneo— queda escrito en el archivo de round-trip. Sin esta
      task, T8.4 revertiría la migración equivocada.
- [x] **T8.1** Confirmar el destino con `npx prisma migrate status --schema db/schema.prisma` (solo
      lectura; imprime el host sin exponer credenciales) y anotar host/base.
      *Hecho:* el host anotado es `localhost:5432/ordenex` y **no** es el de producción.
- [x] **T8.2** Confirmar que `ls db/migrations | sort | tail -1` sigue siendo la carpeta de la 123
      (deuda conocida de `scripts/db-rollback.ts`: revierte por nombre, no por última aplicada).
      *Hecho:* verificado **inmediatamente antes** de T8.4; si no lo es, T8 se detiene y se escala.
- [x] **T8.3** `npx prisma migrate deploy` (UP real). Medir: existencia de la tabla, índices
      (`pg_indexes`), FKs, CHECKs (`pg_constraint`), `relrowsecurity`, comentarios
      (`pg_description`) y fila en `_prisma_migrations`.
      *Hecho:* 4 índices, 4 FKs, 3 CHECKs, RLS `true`, 10 comentarios (1 de tabla + 9 de columna) y
      1 fila de bookkeeping.
- [x] **T8.4** `pnpm db:rollback` (DOWN real). **Una sola vez.**
      *Hecho:* la tabla no existe, `_prisma_migrations` ya no tiene la fila y `migrate status` la
      vuelve a listar como pendiente.
- [x] **T8.5** `npx prisma migrate deploy` (re-aplicación).
      *Hecho:* el estado medido es **idéntico** al de T8.3, comparado por checksum del conjunto
      índices + FKs + CHECKs + comentarios, no a ojo.
- [x] **T8.6** **Verificación por mutación del único (R14).** Insertar dos filas idénticas con
      `mensajero_id IS NULL`, dentro de una transacción revertida.
      *Hecho:* la segunda es **rechazada** por `analytics_daily_grano_key`; y con el índice mutado
      en memoria a `NULLS DISTINCT`, la segunda **entra** → la aserción no es vacía.
- [x] **T8.7** **Verificación por mutación de los CHECK (R22, R25, R26).** Intentar, en transacción
      revertida: `primer_intento_ok = 2, entregas = 1`; `seg_ciclo_n = 0, seg_ciclo_acum = 5`; y una
      medida negativa.
      *Hecho:* los tres `INSERT` son **rechazados** por su constraint nombrada. Es la prueba de que
      la tasa de `primer_intento_ok` no puede pasar de 1 ni siquiera con un job mal escrito.
- [x] **T8.8** Escribir `progress/roundtrip_123_analytics_daily.md` con las tablas de medidas, los
      comandos exactos, el estado del drift antes/después de T8.0, el estado final de la base local
      y una sección **«lo que esto NO demuestra»**.
      *Hecho:* el archivo existe y sus números están **medidos**, no reportados por terceros.

## T9 — Cierre

- [x] **T9.1** `./init.sh` en verde (incluye el chequeo de `down.sql` de toda migración).
      *Hecho, con salvedad honesta:* **`init.sh` NO termina en verde, y tampoco lo hacía en el
      baseline**: aborta en `pnpm run lint` por los 3 errores heredados de
      `app/(app)/ordenes/_components/OrdenesModule.tsx` (340:34, 345:7, 345:21,
      `react-hooks/preserve-manual-memoization`), que vienen de `dev`. Delta 0, no verde absoluto.
      Como el script aborta antes del paso §6, el chequeo de `down.sql` se reprodujo a mano con su
      mismo criterio: **todas las migraciones tienen `down.sql`**, incluida la de la 123. Sin `warn`.
- [x] **T9.2** `pnpm run typecheck`, `pnpm run lint`, `pnpm test` sin regresión respecto del baseline
      medido en esta sesión.
      *Hecho:* delta 0 frente a la medición propia previa a tocar nada — typecheck 0→0 errores; lint
      3 errores/23 warnings → 3/23; suite 661→664 archivos con **0 archivos rojos nuevos** y **99**
      tests nuevos todos verdes (96 + 3 del `describe` de drift añadido tras la revisión).
      La colisión con el guard *branch-scoped* de la 135 (`frontera.guardia.test.ts`), escalada como
      bloqueo, **quedó RESUELTA por el leader** en `3a2b2500` acotando el censo a su propia rama; hoy
      ese archivo es verde (`3 passed | 6 skipped`). Detalle en `progress/impl_123.md §5`.
- [x] **T9.3** `progress/impl_123.md` con el mapa `R<n> → test` completo (los **45**) y las deudas
      vivas (el follow-up de retención D5 y el riesgo de despliegue D6).
      *Hecho:* ningún `R<n>` sin test; el reviewer rechaza si falta uno (`CHECKPOINTS.md`).
      Tras la revisión, el mapa distingue además los **33 medidos** de los **12 nominales**
      (R11/R12/R13/R15/R24/R28/R31/R32/R33/R34/R35/R36, cubiertos por regex sobre el texto), y recoge
      los pagarés dirigidos a la 124/125 (m3 grieta hermana de reproducibilidad, m4 R13 sin contención).
- [x] **T9.5 (post-revisión)** **B1 corregido:** el datamodel no declaraba el único del grano, así que
      `prisma migrate diff --from-empty --to-schema` omitía `analytics_daily_grano_key` y renombraba
      los tres índices; el primer `migrate dev` de la 124 habría emitido un `DROP INDEX` y el rollup se
      habría duplicado sin un solo error.
      *Hecho:* `@@unique(..., map: "analytics_daily_grano_key")` + `map:` en los tres `@@index`,
      comentario reescrito citando el precedente de `tarifa_zona_mensajero`, la aserción que exigía
      `not.toMatch(/@@unique/)` invertida, y un `describe` nuevo que compara datamodel contra
      `migration.sql` objeto a objeto. **Criterio de hecho medido:** nada aparece solo en el datamodel
      (9 objetos coinciden; solo los 3 CHECK viven únicamente en el `.sql`). Mutación comprobada:
      quitar el `map:` pone el test rojo. `migration.sql` no se tocó, así que R43 sigue válido.
- [x] **T9.4** Todas las tasks de este archivo marcadas `[x]`.

---

## Mapa previsto `R<n> → test`

Archivos:
- **U** = `tests/unit/analytics/analytics-daily-contrato.test.ts`
- **I** = `tests/integration/db/analytics-daily-migration.test.ts`
- **G** = `tests/integration/db/analytics-daily-guards.test.ts`
- **RT** = `progress/roundtrip_123_analytics_daily.md` (evidencia **ejecutada**)

| R | qué afirma | test |
|---|---|---|
| R1 | la tabla y el modelo existen | I (`CREATE TABLE`, `model AnalyticsDaily` + `@@map`) |
| R2 | grano = 6 columnas = unión de granos snapshot | **U** (derivado del catálogo) + I |
| R3 | sin columna `metodo_pago` | **U** (negativa) + I |
| R4 | nada `live` materializado | **U** (recorre `clase`) |
| R5 | sin columnas monetarias; float prohibido | I (negativa: ni `DECIMAL`, ni `REAL`, ni `DOUBLE`) |
| R6 | `fecha DATE NOT NULL` | I |
| R7 | PK `id TEXT` uuid | I |
| R8 | `created_at` / `updated_at` | I |
| R9 | snake_case, `@@map`, nombre `analytics_daily` | I (+ U: coincide con `TablaRollup`) |
| R10 | `zona_id`/`tienda_id`/`estatus_id` NOT NULL | I |
| R11 | `mensajero_id` nullable = sin asignar | I (nulabilidad + `COMMENT ON COLUMN`) |
| R12 | `causa_devolucion` nullable, enum existente | I |
| R13 | sin filas de totalización | I (ninguna columna/centinela de subtotal) + RT (T8.6) |
| R14 | único del grano con `NULLS NOT DISTINCT` | I (regex) + **RT (T8.6, con mutación)** |
| R15 | falla en el apply si el motor no lo soporta | I (sin fallback ni `IF NOT EXISTS`) + RT (T8.3) |
| R16 | las 10 medidas exactas, `NOT NULL DEFAULT 0` | I + **U** |
| R17 | ninguna tasa/promedio almacenado | **U** + I (negativa) |
| R18 | `incidentes` materializada | **U** (la deriva de `definicion.razon`) |
| R19 | `sin_gestionar` NO materializada | **U** (negativa) + I |
| R20 | `seg_ciclo_acum` + `seg_ciclo_n` | I + **U** |
| R21 | `seg_ciclo_acum` es `BIGINT` | I |
| R22 | `n = 0 ⇒ acum = 0` por `CHECK` | I (regex del CHECK) + **RT (T8.7, mutación)** |
| R23 | `primer_intento_ok` es conteo entero | I + **U** |
| R24 | universo `primer_intento_ok` ⊆ `entregas` | I (`COMMENT ON COLUMN`) + RT (T8.7) |
| R25 | `CHECK primer_intento_ok <= entregas`: la tasa no pasa de 1 | I (regex) + **RT (T8.7, mutación)** |
| R26 | medidas no negativas | I (regex) + RT (T8.7) |
| R27 | `ordenes_creadas` es flujo y lo exige el catálogo | **U** (existe como métrica propia) + I (`COMMENT`) |
| R28 | `ordenes_estado_stock`: nombre y stock al corte | I (nombre exacto + `COMMENT` con la frase de no sumar por fecha) |
| R29 | nadie la suma entre fechas | **G (T7.2, con mutación)** |
| R30 | comentarios en base (1 tabla + 9 columnas) | I + RT (`pg_description`, T8.3) |
| R31 | zona/tienda desde la orden | I (`COMMENT` de `zona_id`/`tienda_id`) |
| R32 | origen de `mensajero_id` según tipo de hecho | I (`COMMENT` de `mensajero_id`) |
| R33 | `estatus_id` = estado al corte | I (`COMMENT` de `estatus_id`) |
| R34 | ciclo atribuido al evento terminal | I (`COMMENT` de `seg_ciclo_acum`) |
| R35 | rollup inmutable hacia atrás | I (`COMMENT ON TABLE`) + **G** (ningún escritor de fechas pasadas) |
| R36 | tolera el estatus huérfano | I (FK a `order_status`, sin CHECK ni lista cerrada de values) |
| R37 | 4 FKs RESTRICT/CASCADE | I + RT (T8.3) |
| R38 | RLS habilitada sin policies | I + RT (`relrowsecurity`, T8.3) |
| R39 | exactamente 4 índices, los declarados | I (conteo) + RT (`pg_indexes`, T8.3/T8.5) |
| R40 | ningún índice sobre `estatus_id`/`causa_devolucion` | I (negativa) |
| R41 | migración puramente aditiva | I (negativas: sin `ALTER TABLE` ajeno, sin DML) + RT |
| R42 | `down.sql` revierte exactamente | I (`DROP TABLE` y nada más) + `./init.sh` + RT (T8.4) |
| R43 | round-trip UP→DOWN→UP medido, no deuda | **RT** (T8.0–T8.5) |
| R44 | la tabla nace sin consumidores | **G (T7.1)** |
| R45 | guard de contrato con el catálogo | **U (T5.1, con mutación comprobada)** |

**45 requisitos, 45 mapeados.** Ningún `R<n>` queda sin test.

**Sin E2E, a propósito.** Justificado en `requirements.md > Fuera de alcance` y en `design.md §9`:
no hay camino de usuario en ejecución que recorrer y rige la decisión humana del 2026-07-30. El
riesgo sustituto lo cubre **RT**, que además ya no es opcional (D7).
