# Revisión — Feature 123 (Analítica: migración del rollup diario `analytics_daily`)

> Reviewer. Rama `feature/123-analitica-rollup-diario-migracion`, worktree aislado
> `ordenex-wt-123`. Dos pasadas: la primera sobre `3a2b2500` (spec + implementación),
> la segunda acotada sobre `3a2b2500..e50916f8` (el arreglo del bloqueante).
> Fecha: 2026-07-31. **Veredicto final: APROBADO** — 1 bloqueante levantado y cerrado,
> 9 menores, ninguno vivo dentro del alcance de esta feature.
> Todo lo de abajo está medido en este worktree. Lo que el leader verificó por su cuenta
> va marcado; lo que no, va atribuido.

---

## 1. El bloqueante, que es la razón de ser de esta revisión

**B1 — El modelo Prisma no declaraba el único del grano, así que el próximo
`prisma migrate dev` habría propuesto `DROP INDEX "analytics_daily_grano_key"`.**

`db/schema.prisma` omitía a propósito el `@@unique`, con un comentario que lo justificaba
diciendo que Prisma no sabe expresar `NULLS NOT DISTINCT`. Es cierto, y es irrelevante: lo
que hace el `@@unique` con `map:` es que Prisma **reconozca** el índice y deje de creer que
sobra en la base. La cláusula sigue siendo invisible para el datamodel en cualquier caso.

Medido, no supuesto, con
`npx prisma migrate diff --from-empty --to-schema db/schema.prisma --script`
(en Prisma 7.8 el flag es `--to-schema`; `--to-schema-datamodel` fue retirado):

| | datamodel, antes | base, según `migration.sql` |
|---|---|---|
| único del grano | **no existe** | `analytics_daily_grano_key` |
| índice de tienda | `analytics_daily_tienda_id_fecha_idx` | `analytics_daily_tienda_fecha_idx` |
| índice de mensajero | `analytics_daily_mensajero_id_fecha_idx` | `analytics_daily_mensajero_fecha_idx` |
| índice de zona | `analytics_daily_zona_id_fecha_idx` | `analytics_daily_zona_fecha_idx` |

Cuatro objetos en desacuerdo, y el que sobraba era justo la protección central de la feature.

**Por qué es mayor y no cosmético.** El modo de fallo lo describe la cabecera de la propia
migración (`migration.sql:26-28`): sin el único, *el rollup se duplicaría **sin un solo
error***. Basta con que la 124 —o cualquier feature posterior— corra `pnpm db:migrate`
(que es `prisma migrate dev`) para que Prisma emita ese `DROP INDEX` mezclado con su cambio
legítimo, más tres renombres. R14 se pierde sin que nadie lo note, y ninguno de los tres
archivos de test de la 123 lo habría visto: los tres leen el `.sql` y el `.prisma`, no la base.

**Agravante: la red protegía el bug.** `analytics-daily-migration.test.ts:188` aseveraba
`expect(MODELO).not.toMatch(/@@unique/)`. Arreglar el modelo obligaba a tocar el test.

**Y el repo ya tenía el caso resuelto.** `db/migrations/20260711190000_tarifa_zona_mensajero_zona_vehiculo_unique/migration.sql:6`
dice literalmente *«El nombre del indice coincide con el que Prisma espera para
@@unique([zonaId, vehiculoId])»*, con su `@@unique` en `db/schema.prisma:952`. La 123 hizo
lo contrario sin argumentar el drift.

### Cómo se cerró

`@@unique([fecha, zonaId, tiendaId, mensajeroId, estatusId, causaDevolucion], map: "analytics_daily_grano_key")`
más `map:` en los tres `@@index`, comentario reescrito, aserción invertida, y —lo que de
verdad faltaba— **un test que cierra el agujero de raíz**: corre `migrate diff` y compara
objeto a objeto contra `migration.sql`, de modo que un drift futuro sale rojo en su propio PR
en vez de aparecer como un `DROP INDEX` escondido dentro del de otra feature.

**Poder discriminante reproducido por el reviewer**, mutando una copia en scratchpad y
corriendo el mismo comando que ejecuta el test:

| variante | resultado |
|---|---|
| base (`e50916f8`) | 9 objetos idénticos a `migration.sql` → verde, correctamente |
| sin `map:` en `@@unique` | **rojo**: aparece `analytics_daily_fecha_zona_id_tienda_id_mensajero_id_estatu_key` |
| sin `@@unique` (el bug original) | **rojo**: 8 objetos, falta `grano_key` |
| sin `map:` en un `@@index` | **rojo**: reaparece `..._tienda_id_fecha_idx` |

El nombre por defecto **se trunca a 63 caracteres**. El `map:` no es cosmético: sin él el
índice nunca habría coincidido.

El guardia tiene además su propia red anti-vacío (`:653`, `expect(enLaMigracion.length).toBe(9)`)
y **no se salta si el CLI falta**: lanza con motivo escrito (`:576-600`). Es lo correcto para
un guardia de drift.

**Verificado también por el leader**, de forma independiente: el diff del datamodel emite hoy
los cuatro índices con los nombres exactos de la base, único incluido.

---

## 2. Checklist de `CHECKPOINTS.md`

### Especificación
- [x] `requirements.md` con R1-R45 en EARS numerados. T0 CERRADA (D1-D8).
- [x] `design.md` con alternativas descartadas y su porqué, incluida la de sacar el stock
      a otra tabla (rechazada porque `TablaRollup` es un literal **cerrado** en el contrato
      de la 135 y habría obligado a modificar la dependencia y las otras diez features).
- [x] `tasks.md` con las 45 tasks `[x]`.

### Trazabilidad
- [x] Los 45 `R<n>` mapean a un test concreto. **Pero no todos discriminan**: ver M-1.
- [x] `progress/impl_123.md` contiene el mapa `R<n> -> test` real y **no miente** en ninguna
      fila; la partición honesta 33/12 se añadió tras el hallazgo M-1.

### Calidad de código (medido por el reviewer)
- [x] `pnpm db:generate` + `pnpm run typecheck` → **0 errores**.
- [x] `pnpm run lint` → 3 errores / 23 warnings. Los 3 errores son heredados de `dev`
      (`app/(app)/ordenes/_components/OrdenesModule.tsx` 340:34, 345:7, 345:21, React
      Compiler). **Delta 0.**
- [x] `pnpm test` → **664 archivos, 8038 tests**, corrida NO degradada (sin `unhandled
      errors`, total de archivos consistente). 1 rojo determinista, ajeno:
      `tests/unit/guards/no-embalaje.test.ts`, que dispara por texto en
      `specs/135-analitica-catalogo-kpis-rangos/tasks.md:187`.
- [x] Los 3 archivos de la 123 aislados: **99/99 verdes**.
- [ ] `./init.sh` en verde. **NO**: aborta en `pnpm run lint` por los 3 errores heredados.
      Única casilla sin marcar, y no depende de esta feature. El chequeo §6 (`down.sql` de
      toda migración) se reprodujo a mano: **100/100 presentes**.

### Verificación contra la base real
Script propio con guarda de host, transacción revertida, `localhost:5432/ordenex`, PG **16.1**
medido con `version()`. Producción no se tocó en ningún momento.

19 columnas · **0 filas** (R44) · `analytics_daily_grano_key` con `indnullsnotdistinct = true`
· los 3 índices de recorte · PK · 3 CHECK · 4 FK todas `confdeltype='r'` / `confupdtype='c'`
· `relrowsecurity = true` con 0 policies · 10 comentarios · 1 fila de bookkeeping sin
`rolled_back_at`. **Coincide punto por punto con `roundtrip_123_analytics_daily.md`.**

Las cuatro mutaciones de base, reproducidas por el reviewer en una sola transacción con
`ROLLBACK` y 0 filas residuales:

```
fila legitima              => ENTRO
duplicado exacto (NULLs)   => RECHAZADO por analytics_daily_grano_key            23505
pio > entregas             => RECHAZADO por analytics_daily_pio_lte_entregas     23514
seg_ciclo_n=0 acum=5       => RECHAZADO por analytics_daily_ciclo_coherente      23514
entregas = -1              => RECHAZADO por analytics_daily_medidas_no_negativas 23514
```

---

## 3. Lo que está bien, dicho sin adornos

- **La migración es puramente aditiva de verdad.** Cero `ALTER TABLE` sobre tabla
  preexistente (el único es sobre `analytics_daily`), cero DML, cero `CREATE POLICY`, cero
  `CREATE TYPE`, cero columna monetaria o de coma flotante. `down.sql` es una sola sentencia
  y no retira el enum preexistente. Verificado leyendo el SQL y midiendo la base, no solo por
  los regex del test.
- **Tres promesas se volvieron estructura.** `primer_intento_ok <= entregas` se cumple fila a
  fila, así que la suma también: **la tasa no puede pasar de 1 en ninguna agregación**. Los
  otros dos CHECK impiden segundos acumulados con denominador vacío y medidas negativas.
- **La mutación de control de T8.6** —tabla copia con `NULLS DISTINCT` donde la fila duplicada
  **sí** entra— es la que convierte R14 en cobertura real y no en aserción vacía.
- **El round-trip cumple todo:** host verificado con guarda que aborta si no coincide, drift
  T8.0 documentado antes y después con la decisión explícita sobre la fila fantasma, comandos
  exactos, checksum sha256 de 23 elementos idéntico entre las dos aplicaciones, y una sección
  «lo que esto NO demuestra» de 10 puntos que es honesta y específica: incluye que las FK
  RESTRICT y la RLS no se ejercitaron y que la concurrencia no se probó.
- **El orden de columnas del único coincide en las tres caras** (`.sql`, `.prisma`, diff
  derivado) y el test **no lo escribe a mano**: lo deriva del `.sql` y lo traduce.

---

## 4. Menores (ninguno bloqueante)

- **M-1 — Trazabilidad nominal en 12 de los 45 R.** Cubiertos por una aserción que
  discrimina: 33. Cubiertos **solo por regex sobre el texto** del `.sql`/`.prisma`: **R11,
  R12, R13, R15, R24, R28, R31, R32, R33, R34, R35, R36**. Asseveran que existe un `COMMENT`,
  no un comportamiento. Es aceptable en una feature de solo-DDL —no hay dato ni job que
  pueda falsarlos— pero `tasks.md` los presentaba con la misma tinta que los medidos. La
  partición ya está escrita en `impl_123.md` y **la deuda de verificación va dirigida a la 124**.
- **M-2 — Grieta hermana no declarada** (la más importante de las abiertas). `design.md §6`
  declara bien la grieta de la gestión anulada. Pero el mismo mecanismo abre otra que el spec
  no mencionaba: R31/R32/R33 sacan `zona_id`, `tienda_id`, `mensajero_id` y `estatus_id` de la
  orden **en el corte**, y esos campos cambian después (reasignación de mensajero, corrección
  de estado, cambio de zona). Consecuencia: **la 125 recomputando el día D no reproduce lo que
  la 124 escribió ese día**, aunque R35 venda inmutabilidad y §6 le regale a la 128 que «lo
  calculado una vez sigue valiendo». No es defecto del DDL; es una declaración incompleta.
  Dirigida a la 124/125, con la disyuntiva planteada: congelar coordenadas o rebajar R35.
- **M-3 — R13 sin contención de ninguna clase.** Lo único verificado es que no hay columna
  centinela. Nada impide que la 124 escriba una fila de totalización usando una zona o un
  estatus reales como «todos». Pagaré de la 124.
- **M-4 a M-6 — Puntos ciegos del guardia de drift**, nombrados a petición del leader:
  - *n1*: compara el datamodel contra el **texto de `migration.sql` de la 123**, no contra el
    historial. El día en que una migración posterior toque legítimamente `analytics_daily`,
    el test se pondrá **rojo sin que haya drift** — y la salida más rápida a ese rojo sería
    *editar el `migration.sql` ya aplicado*, que es justo lo que nunca debe hacerse. **La 124
    debe cambiar el conjunto de referencia a la unión de las migraciones que tocan la tabla.**
  - *n2*: compara **solo nombres** de índice/PK/FK. Un drift de tipo, nulabilidad o `default`
    no lo ve este bloque; lo cubren de forma textual las aserciones de arriba.
  - *n3*: no dice nada de la base **real**. Un índice borrado a mano allí sigue siendo
    invisible; haría falta `--from-url`.
  - La elección de `--from-empty` sobre `--from-migrations` **se sostiene y se verificó**:
    el segundo falla con *«You must set `datasource.shadowDatabaseUrl`…»* y no cae de vuelta
    al datasource. Exigiría tocar config compartida más una base viva.
- **M-7 — Contabilidad inconsistente** en `impl_123.md` entre §4 y §5 sobre el número de
  archivos rojos en baseline. Corregida.
- **M-8 — Los flaky se mueven.** Tres corridas, tres resultados: 2 rojos flaky, 1, y 0.
  Cayeron `recuperar-contrasena-form.test.tsx` y `LoginForm.test.tsx` en corridas distintas;
  **aislados pasan los dos**. Hipótesis confirmada: presión de recursos, no regresión.
  **Para el próximo baseline: 1 rojo determinista (`no-embalaje`)**, y todo archivo de
  `tests/components/` o de formularios que caiga por `findByText`/timeout es ruido hasta
  comprobarlo aislado.
- **M-9 — Cosmético.** `tests/integration/db/analytics-daily-guards.test.ts` no toca Postgres
  (lee el árbol de archivos); vive bajo `tests/integration/db/` por vecindad, no por naturaleza.

---

## 5. El guardia de frontera de la 135 — episodio cerrado por `dev`

Durante esta feature, `tests/unit/analytics/frontera.guardia.test.ts` puso 4 rojos. No era la
123 cruzando una frontera: era un guardia **branch-scoped por diseño** que quedó commiteado en
`dev`, con lo que pasó a juzgar el diff de toda rama posterior. Estaba rojo **en `dev` mismo**,
por diff vacío, y su propio mensaje lo delataba: *«el diff no contiene el propio módulo de la
feature: la base no es la de esta rama»*.

Esta rama lo acotó con un `skipIf` (verificado: no aflojó ninguna aserción; listas, `esCodigo`,
`codigoPermitido` y `resolverBase` intactos, y los dos `it` de lógica pura rescatados a un
`describe` que corre siempre). **En paralelo, otra sesión lo borró entero en `dev`**
(`8699443d`, 321 líneas) por caducado.

El merge resolvió el conflicto modify/delete **aceptando el borrado**: las dos salidas atacaban
el mismo problema, y resucitar el archivo aquí habría revertido en silencio la decisión ajena.

---

## 6. Veredicto

**APROBADO.** B1 cerrado con arreglo que no es cosmético: cambia el datamodel, mata la
aserción que protegía el bug y añade el único test de la feature que mira la *relación* entre
el `.sql` y el `.prisma` en vez de cada uno por su lado.

Quedan abiertos, todos menores y todos escritos en `impl_123.md`: los 12 R nominales, la
grieta hermana de reproducibilidad, R13 sin contención, los tres puntos ciegos del guardia de
drift, y `./init.sh` rojo por deuda de lint heredada de `dev`.
