# Round-trip real de la migración de la 123 — `20260731120000_analytics_daily`

> **Ejecutado el 2026-07-31** en el worktree `C:\Users\Cristian\Documents\trabajo\arc\ordenex-wt-123`
> (rama `feature/123-analitica-rollup-diario-migracion`), contra **Postgres local**:
> `localhost:5432`, base `ordenex`. **Producción no se tocó en ningún momento.**
>
> Los números de abajo están **medidos aquí**, con los comandos que se citan; no son un
> resultado reportado por un tercero. Cada paso que escribe en la base fue precedido por una
> verificación del destino: `prisma migrate status` (solo lectura) imprime el host sin exponer la
> credencial, y los scripts de medición **abortan** si `DATABASE_URL` no resuelve exactamente a
> `localhost:5432/ordenex`.
>
> Método y formato: `progress/roundtrip_155_migracion.md`.

## 0. Destino verificado

| dato | valor medido |
|---|---|
| host/base según `prisma migrate status` | `PostgreSQL database "ordenex", schema "public" at "localhost:5432"` |
| `DATABASE_URL` (solo host + path, sin credencial) | `localhost:5432/ordenex` |
| `DIRECT_URL` | **no definida** → el CLI usa `DATABASE_URL` (`prisma.config.ts`), o sea el mismo destino local |
| versión del motor | `PostgreSQL 16.1, compiled by Visual C++ build 1937, 64-bit` (`SELECT version()`) |

La versión **16.1** cierra por evidencia directa lo que **D6** sostenía por inferencia: `NULLS NOT
DISTINCT` es de Postgres **15+**, así que este motor lo soporta **por versión**, no porque "otras
migraciones del repo ya lo usan". Sigue abierto **solo para producción**, cuyo motor no se ha
consultado aquí.

Los scripts de medición llevan esta guarda, ejecutada antes de abrir la conexión:

```ts
const url = new URL(process.env.DATABASE_URL!);
if (url.host !== "localhost:5432" || url.pathname !== "/ordenex") { process.exit(1); }
```

## T8.0 — Drift de la base local: antes y después

Ejecutado por el leader **antes** de esta sesión, con `npx prisma migrate status --schema
db/schema.prisma`. Se registra aquí porque T8.0 lo exige por escrito; la re-confirmación del
estado **posterior** sí es propia (T8.1).

**ANTES del saneo:**

| concepto | valor |
|---|---|
| última migración común | `20260724150000_orden_historial_origen_devolucion_rechazada` |
| pendientes de aplicar (3) | `20260727120000_carga_orden_carga_id`, `20260730130000_orden_incidente`, `20260730150000_carga_name_reparacion` |
| aplicada en la base, ausente del árbol (1) | `20260728120000_orden_historial_origen_deshacer_asignacion` |

**Diagnóstico de la "ausente": fila fantasma de un re-timestamp.** La misma migración lógica existe
en el árbol como `20260729140000_orden_historial_origen_deshacer_asignacion`, y la base tiene **las
dos filas**. Medido por mí en esta sesión, consultando directamente `_prisma_migrations`:

```
npx tsx scripts/rt123-q.ts "SELECT migration_name, finished_at IS NOT NULL AS ok, rolled_back_at
                            FROM \"_prisma_migrations\" WHERE migration_name LIKE '%deshacer_asignacion%'"
```
```json
[ { "migration_name": "20260728120000_orden_historial_origen_deshacer_asignacion", "ok": true, "rolled_back_at": null },
  { "migration_name": "20260729140000_orden_historial_origen_deshacer_asignacion", "ok": true, "rolled_back_at": null } ]
```

Las dos con `finished_at` no nulo y ninguna marcada como revertida; el DDL está aplicado **una sola
vez**.

**Decisión explícita (T8.0 exige decidir): la fila fantasma SE DEJA.** Razones:

1. Borrarla es **cosmético**: el DDL ya está físicamente aplicado y no se aplicaría dos veces.
2. No afecta a `migrate deploy`, que solo aplica **carpetas del árbol ausentes de la tabla**; una
   fila sobrante en la tabla sin carpeta correspondiente no le da trabajo.
3. No afecta a `pnpm db:rollback`, que apunta **por nombre de carpeta** a la última del árbol —la de
   la 123—, nunca a una fila huérfana.

Coste asumido y **observado** aquí: mientras haya cualquier otro drift, `migrate status` la lista
como ruido ("The migration from the database are not found locally"). Con el árbol al día
desaparece del informe (ver estado final).

**Saneo ejecutado:** `npx prisma migrate deploy` aplicó las 3 pendientes. **DESPUÉS:** `migrate
status` responde *"Database schema is up to date!"*. Otros datos ya medidos por el leader antes de
T8.1: `analytics_daily` **no existía**.

## T8.1 — Re-confirmación propia del destino y del estado de partida

```
npx prisma migrate status --schema db/schema.prisma
```
```
Datasource "db": PostgreSQL database "ordenex", schema "public" at "localhost:5432"
100 migrations found in prisma/migrations
The last common migration is: 20260730150000_carga_name_reparacion
The migration have not yet been applied:
20260731120000_analytics_daily
The migration from the database are not found locally in prisma/migrations:
20260728120000_orden_historial_origen_deshacer_asignacion
```

**Host: `localhost:5432`, base `ordenex`. NO es producción.** El único pendiente es la migración de
la 123 (lo esperado tras el saneo) y la fila fantasma sigue ahí, como se decidió. Medición propia
del estado de partida de la tabla:

```
== TABLA EXISTE: false
== FILAS EN _prisma_migrations: 0
```

## T8.2 — La carpeta de la 123 es la última (deuda de `scripts/db-rollback.ts`)

`scripts/db-rollback.ts` elige la migración a revertir con `readdirSync` + `sort(localeCompare)`
sobre los **directorios**, no por la última aplicada. Reproducido con **el mismo criterio del
script** (nota: `ls db/migrations | sort | tail -1` devuelve `migration_lock.toml`, que es un
archivo; hay que filtrar directorios, que es lo que hace el script):

```
node -e "const fs=require('fs');const d=fs.readdirSync('db/migrations',{withFileTypes:true})
  .filter(e=>e.isDirectory()).map(e=>e.name).sort((a,b)=>a.localeCompare(b));
  console.log('total dirs',d.length);console.log('last',d[d.length-1]);"
```
```
total dirs 100
last 20260731120000_analytics_daily
```

Verificado **dos veces**: al empezar y de nuevo **inmediatamente antes** de T8.4, en el mismo
comando que lanzó el rollback. Corolario de esa deuda: **`pnpm db:rollback` se corrió UNA SOLA
VEZ**; una segunda pasada habría vuelto a revertir la misma carpeta (y con la tabla ya caída, el
`DROP TABLE IF EXISTS` sería NO-OP pero el `DELETE` de bookkeeping también, así que el daño real
sería nulo aquí — en otra migración no lo sería).

## T8.3 — UP real

```
npx prisma migrate deploy --schema db/schema.prisma
```
```
Applying migration `20260731120000_analytics_daily`
The following migration(s) have been applied:
  └─ 20260731120000_analytics_daily/
    └─ migration.sql
All migrations have been successfully applied.
```

Medición (`npx tsx scripts/rt123-measure.ts`, solo lectura sobre `information_schema`, `pg_indexes`,
`pg_index`, `pg_constraint`, `pg_class`, `pg_policies`, `pg_description` y `_prisma_migrations`):

| medida | esperado | **medido** |
|---|---|---|
| tabla existe | sí | **sí** |
| columnas | 19 | **19** (6 grano + 10 medidas + `id`/`created_at`/`updated_at`) |
| `seg_ciclo_acum` | `BIGINT` | **bigint** |
| `fecha` | `DATE NOT NULL` | **date, NOT NULL** |
| `mensajero_id` / `causa_devolucion` | nullable | **nullable=YES** (el resto del grano `NO`) |
| medidas | `NOT NULL DEFAULT 0` | **las 10, `null=NO`, `def=0`** |
| índices declarados | 4 | **4** (+ `analytics_daily_pkey`, que es el índice implícito de la PK, no una `CREATE INDEX` del archivo) |
| único del grano | `NULLS NOT DISTINCT` | **`indnullsnotdistinct = true`** |
| FKs | 4, `ON DELETE RESTRICT ON UPDATE CASCADE` | **4**, todas `confdeltype='r'`, `confupdtype='c'` |
| CHECKs | 3 | **3** |
| `relrowsecurity` | `true` | **true** (`relforcerowsecurity=false`) |
| policies | 0 | **0** |
| comentarios | 10 (1 tabla + 9 columna) | **10 = 1 + 9** |
| fila en `_prisma_migrations` | 1 | **1**, `finished_at` no nulo, `rolled_back_at` nulo |
| filas en `analytics_daily` | 0 | **0** |

Detalle de los índices, tal como los devuelve la base:

```
analytics_daily_grano_key            | unique=true  | nulls_not_distinct=TRUE
    CREATE UNIQUE INDEX analytics_daily_grano_key ON public.analytics_daily USING btree
      (fecha, zona_id, tienda_id, mensajero_id, estatus_id, causa_devolucion) NULLS NOT DISTINCT
analytics_daily_mensajero_fecha_idx  | unique=false | nulls_not_distinct=false | btree (mensajero_id, fecha)
analytics_daily_tienda_fecha_idx     | unique=false | nulls_not_distinct=false | btree (tienda_id, fecha)
analytics_daily_zona_fecha_idx       | unique=false | nulls_not_distinct=false | btree (zona_id, fecha)
analytics_daily_pkey                 | unique=true  | nulls_not_distinct=false | btree (id)   ← implícito de la PK
```

Ningún índice sobre `estatus_id` ni `causa_devolucion` sueltos (R40): los cinco de arriba son
todos los que hay.

Las cuatro FKs:

```
analytics_daily_estatus_id_fkey    FOREIGN KEY (estatus_id)   REFERENCES order_status(id) ON UPDATE CASCADE ON DELETE RESTRICT
analytics_daily_mensajero_id_fkey  FOREIGN KEY (mensajero_id) REFERENCES usuario(id)      ON UPDATE CASCADE ON DELETE RESTRICT
analytics_daily_tienda_id_fkey     FOREIGN KEY (tienda_id)    REFERENCES usuario(id)      ON UPDATE CASCADE ON DELETE RESTRICT
analytics_daily_zona_id_fkey       FOREIGN KEY (zona_id)      REFERENCES zona(id)         ON UPDATE CASCADE ON DELETE RESTRICT
```

Los tres CHECK, como los normalizó el planificador:

```
analytics_daily_ciclo_coherente        CHECK (((seg_ciclo_n > 0) OR (seg_ciclo_acum = 0)))
analytics_daily_medidas_no_negativas   CHECK (((ordenes_creadas >= 0) AND (ordenes_estado_stock >= 0) AND (entregas >= 0)
                                         AND (devoluciones >= 0) AND (rechazos >= 0) AND (reprogramaciones >= 0)
                                         AND (incidentes >= 0) AND (primer_intento_ok >= 0) AND (seg_ciclo_acum >= 0)
                                         AND (seg_ciclo_n >= 0)))
analytics_daily_pio_lte_entregas       CHECK ((primer_intento_ok <= entregas))
```

Los 10 comentarios, por objeto: `<TABLA>`, `causa_devolucion`, `estatus_id`, `mensajero_id`,
`ordenes_estado_stock`, `primer_intento_ok`, `seg_ciclo_acum`, `seg_ciclo_n`, `tienda_id`,
`zona_id`.

**Checksum A (tras el UP):**

```
sha256, 23 elementos (5 índices + 4 FK + 3 CHECK + 1 PK + 10 comentarios), ordenados:
1be5347fd47248c031d46c0e1085182cb3d24e091500fe2cbe6de1c86b5fb9f0
```

Es un hash reproducible del conjunto **ordenado** de las definiciones textuales
(`pg_get_constraintdef`, `indexdef` + `indnullsnotdistinct`, y el texto íntegro de cada comentario),
no de un conteo: si cambiara una sola cláusula `ON DELETE`, una columna de un índice o una letra de
un comentario, el hash cambia.

## T8.4 — DOWN real (`pnpm db:rollback`, **una sola vez**)

```
pnpm db:rollback
```
```
Aplicando rollback: 20260731120000_analytics_daily
Script executed successfully.          ← down.sql
Script executed successfully.          ← DELETE FROM "_prisma_migrations"
Rollback completado: 20260731120000_analytics_daily
```

| medida | **medido** |
|---|---|
| tabla existe | **false** |
| filas en `_prisma_migrations` para la 123 | **0** |
| `migrate status` | vuelve a listar `20260731120000_analytics_daily` en *"The migration have not yet been applied"* |

El `DROP TABLE` se llevó con él la PK, los 4 índices, las 4 FKs, los 3 CHECK, los 10 comentarios y
la RLS: la medición posterior no encuentra la relación, así que ninguno de esos objetos sobrevive
(no puede sobrevivir un índice sin su tabla). No se tocó ninguna tabla preexistente ni el enum
`gestion_causa_devolucion`, que sigue en uso por `gestion_orden`.

## T8.5 — Re-aplicación

```
npx prisma migrate deploy --schema db/schema.prisma      → "All migrations have been successfully applied."
npx tsx scripts/rt123-measure.ts
```

**Checksum B (tras el re-deploy):**

```
1be5347fd47248c031d46c0e1085182cb3d24e091500fe2cbe6de1c86b5fb9f0
```

| | tabla | col. | índices | FK | CHECK | RLS / policies | comentarios | `_prisma_migrations` | filas | checksum |
|---|---|---|---|---|---|---|---|---|---|---|
| 0. base | no | — | — | — | — | — | — | 0 | — | — |
| 1. tras UP (T8.3) | **sí** | 19 | 4 (+PK) | 4 | 3 | **true / 0** | 10 | **1** | 0 | **A** |
| 2. tras `db:rollback` (T8.4) | **no** | — | — | — | — | — | — | **0** | — | — |
| 3. tras re-deploy (T8.5) | **sí** | 19 | 4 (+PK) | 4 | 3 | **true / 0** | 10 | **1** | 0 | **B = A** |

**A == B**, comparado por hash, no a ojo. Además, la salida completa de las dos mediciones se
contrastó con `diff`, línea a línea: **idéntica**.

## T8.6 — Verificación por mutación del índice único (R14)

Todo dentro de **una transacción revertida** (`ROLLBACK` deliberado al final), con `SAVEPOINT` por
intento para que un error no aborte el resto. Ids **reales leídos de la base**:

```
zona          = 35798f60-5f5f-4411-a458-63b8f980bc8c
usuario       = 08d36f9e-da96-4804-ab51-4f36a6242204   (sirve de tienda_id)
order_status  = 19fa5aef-5aec-498e-8193-8f5c4b1f9ec1   (value: entregada)
```

Dos filas **idénticas** con `mensajero_id IS NULL` y `causa_devolucion IS NULL` (los dos NULL con
significado de dominio):

| intento | resultado | constraint que rechazó |
|---|---|---|
| fila 1 | **ENTRÓ** | — |
| fila 2, idéntica | **RECHAZADA** | **`analytics_daily_grano_key`** |

Error literal (Postgres `23505`, `UniqueConstraintViolation`):

```
llave duplicada viola restricción de unicidad «analytics_daily_grano_key»
```

Conteo dentro de la transacción tras los dos intentos: **1 fila**.

**Control contra la aserción vacía.** En la misma transacción, una tabla copia
(`CREATE TEMP TABLE analytics_daily_mut (LIKE analytics_daily INCLUDING DEFAULTS) ON COMMIT DROP`)
con el **mismo** índice único sobre las **mismas seis** columnas pero **sin** `NULLS NOT DISTINCT`
(verificado: `indnullsnotdistinct = false`):

| intento | resultado |
|---|---|
| copia, fila 1 | **ENTRÓ** |
| copia, fila 2 **idéntica** | **ENTRÓ** — 2 filas |

Es decir: con la semántica UNIQUE por defecto de Postgres las dos filas duplicadas **conviven**, y
la que las rechaza en `analytics_daily` es exactamente la cláusula `NULLS NOT DISTINCT`. La
aserción **discrimina**; no es una aserción vacía. Ese es, textualmente, el modo de fallo que
describe la cabecera de la migración: sin ella el `ON CONFLICT` del upsert de la 124 no encontraría
con qué chocar y el rollup se duplicaría **sin un solo error**.

## T8.7 — Verificación por mutación de los tres CHECK (R25, R22, R26)

Misma transacción revertida, con la fila legítima borrada antes para probar en limpio. Los tres
`INSERT` ilegales, cada uno rechazado **por su constraint nombrada** (nombre capturado del error,
no inferido):

| intento | valores | resultado | **constraint que rechazó** | código |
|---|---|---|---|---|
| R25 | `primer_intento_ok = 2`, `entregas = 1` | **RECHAZADO** | **`analytics_daily_pio_lte_entregas`** | `23514` |
| R22 | `seg_ciclo_n = 0`, `seg_ciclo_acum = 5` | **RECHAZADO** | **`analytics_daily_ciclo_coherente`** | `23514` |
| R26 | `entregas = -1` | **RECHAZADO** | **`analytics_daily_medidas_no_negativas`** | `23514` |

Errores literales:

```
el nuevo registro para la relación «analytics_daily» viola la restricción «check» «analytics_daily_pio_lte_entregas»
el nuevo registro para la relación «analytics_daily» viola la restricción «check» «analytics_daily_ciclo_coherente»
el nuevo registro para la relación «analytics_daily» viola la restricción «check» «analytics_daily_medidas_no_negativas»
```

Lo que esto prueba, más allá del DDL: **la tasa de `primer_intento_ok` no puede pasar de 1 ni
siquiera con un job de la 124 mal escrito**, porque la fila mala no se persiste — la transacción
falla. Y nunca habrá un promedio de ciclo sobre denominador cero.

Conteo al final de la transacción: **0 filas**. Después, `ROLLBACK` deliberado.

## Estado final de la base local

```
npx prisma migrate status --schema db/schema.prisma
```
```
Datasource "db": PostgreSQL database "ordenex", schema "public" at "localhost:5432"
100 migrations found in prisma/migrations
Database schema is up to date!
```

```json
{ "filas_analytics_daily": 0, "tabla": "analytics_daily", "copia_residual": null, "filas_bookkeeping": 1 }
```

- **La migración de la 123 queda APLICADA** (fin de T8.5), como pide el arnés: dejarla sin aplicar
  dejaría el cliente Prisma de esta rama describiendo una tabla inexistente.
- **`analytics_daily` está VACÍA** (`SELECT count(*) = 0`), coherente con **R44**: nace sin
  productor (124) ni consumidor (126).
- **Sin residuos** de las mutaciones: la tabla copia `analytics_daily_mut` **no existe**
  (`to_regclass` → `null`); era `TEMP ... ON COMMIT DROP` dentro de una transacción revertida.
- Con el árbol al día, `migrate status` **ya no menciona** la fila fantasma del re-timestamp: solo
  la reporta cuando hay algún otro drift. Confirma que la decisión de dejarla no cuesta nada
  operativo.
- Los tres scripts auxiliares de medición (`scripts/rt123-*.ts`) eran **temporales** y se
  eliminaron; no forman parte del entregable. Ninguno de ellos escribe fuera de la transacción
  revertida de T8.6/T8.7.

## Lo que este round-trip NO demuestra

Dicho para que nadie lo lea como más de lo que es:

1. **No dice absolutamente nada del Postgres de producción (riesgo D6, vivo).** Lo medido es
   Postgres **16.1 en Windows, local**. `NULLS NOT DISTINCT` exige **15+**; la versión del motor de
   producción **no se consultó** en esta sesión —consultarla habría implicado tocar producción— así
   que el riesgo de despliegue sigue exactamente donde estaba. Lo único que cambia es que en local
   ya no es una conjetura. Si allí el motor fuera 14 o anterior, la migración **falla en el apply**
   (R15, por diseño: sin fallback y sin `IF NOT EXISTS`) y no se aplica a medias.
2. **No prueba que el job de la 124 use bien el `ON CONFLICT`.** Aquí se demostró que el índice
   único **existe y deduplica** contra `NULL`; nada más. Un upsert que apunte a un conflict target
   equivocado, que omita `ON CONFLICT`, o que escriba con un grano distinto del de la tabla, seguirá
   siendo un bug de la 124 y este round-trip no lo caza.
3. **No hay ni un dato real agregado.** La tabla nace y queda vacía. No se ejercitó ninguna
   consulta de la 126, ningún plan de ejecución, ninguna utilidad real de los tres índices de
   recorte: que sean los correctos es un argumento de diseño (§5), no una medición. Tampoco se
   midió el coste de escritura de los cuatro índices bajo el volumen del job diario.
4. **El rendimiento no se midió.** Ni el tiempo del `CREATE TABLE` (irrelevante en vacío) ni, sobre
   todo, el de los upserts futuros contra un índice único de seis columnas, dos de ellas nullable.
5. **Las FKs `RESTRICT` no se ejercitaron.** Se verificó su **definición** (`confdeltype='r'`), no
   se intentó borrar una zona, una tienda, un mensajero o un estatus con historia agregada — no
   había filas con las que hacerlo, y crearlas para borrarlas habría tocado catálogos reales de la
   base local. Que `RESTRICT` bloquee el borrado es comportamiento estándar del motor, pero **no
   está medido aquí**.
6. **La RLS no se ejercitó, solo se comprobó habilitada.** `relrowsecurity = true` con **0
   policies** significa que solo el rol propietario/`service_role` (y `BYPASSRLS`) lee la tabla. No
   se abrió una sesión con un rol no privilegiado para comprobar que efectivamente no ve nada; el
   repo no usa Supabase Auth y ese recorte lo hace la 122 en el repositorio, no la base.
7. **La concurrencia no se probó.** Dos escritores simultáneos sobre el mismo grano (dos pasadas
   del job solapadas) producirían el conflicto que el único debe arbitrar; aquí los dos `INSERT`
   fueron **secuenciales y en la misma transacción**.
8. **El drift de partida se saneó, no se auditó.** Se aplicaron las tres migraciones pendientes y
   `migrate status` quedó limpio, pero **no** se verificó objeto por objeto que el esquema físico
   de esta base local coincida con el de producción. La base local puede arrastrar diferencias
   anteriores a esta sesión.
9. **La fila fantasma sigue en `_prisma_migrations`.** Es una decisión, no un descuido, y es
   inofensiva para `deploy` y para `db:rollback`; pero cualquier herramienta futura que audite esa
   tabla por igualdad exacta con el árbol la verá y se quejará.
10. **No cubre `./init.sh`, typecheck, lint ni la suite de tests** (eso es T9). Este archivo prueba
    el comportamiento de la migración **en la base**, no el estado del repo.
