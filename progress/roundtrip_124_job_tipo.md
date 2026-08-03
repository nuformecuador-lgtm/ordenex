# Round-trip de `20260801100000_job_tipo_analitica_rollup_diario` (T8.2)

> Evidencia MEDIDA contra la base **local** `localhost:5432/ordenex`, el 2026-08-01.
> Produccion no se toco ni para leer. Cada paso lleva el host confirmado y la fila de
> `_prisma_migrations` observada, no inferida.

## 0. Host y estado de partida

```
HOST localhost:5432/ordenex
```

`_prisma_migrations` (ultimas 4, por nombre descendente):

| migration_name | finished_at |
|---|---|
| 20260731160000_orden_busqueda_trgm | 2026-08-01 17:05:24 |
| 20260731140000_orden_historial_idx_actor_origen_created | 2026-07-31 13:25:13 |
| 20260731130000_order_status_recolectando | 2026-07-31 13:25:13 |
| 20260731120000_orden_historial_origen_asignacion_recoleccion | 2026-07-31 13:25:13 |

Enum `job_tipo` (por `enumsortorder`):

```
liberar_reprogramadas, geocodificacion, optimizacion_ruta, webhook_estado,
whatsapp_template_sync, whatsapp_chat_envio
```

`SELECT count(*) FROM analytics_daily` = **0**. Filas de `jobs` con
`tipo = 'analitica_rollup_diario'` = **0** (el valor todavia no existia en el enum).

**Drift preexistente, ajeno a esta feature y no saneado aqui:** `prisma migrate status`
reporta que la base tiene aplicada `20260728120000_orden_historial_origen_deshacer_asignacion`,
que en el arbol se llama `20260729140000_orden_historial_origen_deshacer_asignacion`. Es un
renombrado de otra feature; `migrate deploy` lo trata como aviso y aplica lo pendiente sin
problema. Se deja anotado porque esa base la comparten varias sesiones.

## 1. UP — `prisma migrate deploy`

```
$ pnpm exec prisma migrate deploy --schema db/schema.prisma
Datasource "db": PostgreSQL database "ordenex", schema "public" at "localhost:5432"
105 migrations found in prisma/migrations
Applying migration `20260801100000_job_tipo_analitica_rollup_diario`
The following migration(s) have been applied:
migrations/
  └─ 20260801100000_job_tipo_analitica_rollup_diario/
    └─ migration.sql
All migrations have been successfully applied.
```

Estado observado tras el UP:

| migration_name | finished_at |
|---|---|
| **20260801100000_job_tipo_analitica_rollup_diario** | **2026-08-01 20:37:56** |
| 20260731160000_orden_busqueda_trgm | 2026-08-01 17:05:24 |

```
job_tipo: liberar_reprogramadas, geocodificacion, optimizacion_ruta, webhook_estado,
          whatsapp_template_sync, whatsapp_chat_envio, analitica_rollup_diario
```

El valor nuevo entra **al final** del orden del enum, que es lo que hace `ADD VALUE` sin
`BEFORE`/`AFTER`, y es lo que el `down.sql` asume al recrear el tipo con los seis previos.

## 2. Comprobacion EXIGIDA antes del DOWN: la carpeta sigue siendo la ultima

Criterio reproducido de `scripts/db-rollback.ts` (`readdirSync` con `withFileTypes`, filtrado a
directorios, `sort((a,b) => a.name.localeCompare(b.name))`, ultimo elemento). **No** `ls | tail`:
`ls` incluye `migration_lock.toml`, que es un archivo, y ordena con la collation del shell.

```
ULTIMA POR NOMBRE (criterio db-rollback.ts): 20260801100000_job_tipo_analitica_rollup_diario
```

Sin esta comprobacion, `pnpm db:rollback` habria revertido **otra** migracion y este documento
estaria midiendo algo que no es esta feature. La asercion vive tambien en
`tests/integration/db/job-tipo-analitica-rollup-migration.test.ts`, y su mutacion (renombrar la
carpeta a `20260730100000_...`) se observo en rojo:
`AssertionError: expected '20260731160000_orden_busqueda_trgm' to be '20260730100000_job_tipo_analitica_rol…'`.

## 3. Siembra antes del DOWN (para que el DOWN tenga algo que limpiar)

```
$ node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/seed-jobs-analitica-rollup-diario.ts
Seed analitica_rollup_diario: fila sembrada (run_after=2026-08-02T06:30:00.000Z, dedupe_key=analitica_rollup_diario:2026-08-01).

$ (de nuevo)
Seed analitica_rollup_diario: la fila ya existia (idempotente, sin cambios).
```

`jobs` con ese tipo = **1** despues de las **dos** ejecuciones. La `dedupe_key` es la del dia
**objetivo** (`2026-08-01`), no la de la corrida (`2026-08-02`).

## 4. DOWN — `pnpm db:rollback`

```
$ pnpm run db:rollback
Aplicando rollback: 20260801100000_job_tipo_analitica_rollup_diario
Script executed successfully.   (down.sql)
Script executed successfully.   (DELETE de _prisma_migrations)
Rollback completado: 20260801100000_job_tipo_analitica_rollup_diario
```

Estado observado tras el DOWN:

| migration_name | finished_at |
|---|---|
| 20260731160000_orden_busqueda_trgm | 2026-08-01 17:05:24 |
| 20260731140000_orden_historial_idx_actor_origen_created | 2026-07-31 13:25:13 |

La fila de `_prisma_migrations` de esta feature **desaparecio** (asi la deja `db-rollback.ts`:
la borra para que `migrate deploy` la vuelva a ver pendiente).

```
job_tipo: liberar_reprogramadas, geocodificacion, optimizacion_ruta, webhook_estado,
          whatsapp_template_sync, whatsapp_chat_envio
```

Enum de vuelta a **seis** valores, en el **mismo orden** que antes del UP. `jobs` con
`tipo = 'analitica_rollup_diario'` = **0**: el `DELETE FROM "jobs"` que abre el `down.sql` se
llevo la fila sembrada, que es precisamente por lo que el `ALTER TABLE ... USING` no fallo.
Sin ese `DELETE`, el rollback habria abortado con la fila viva.

## 5. UP otra vez — `prisma migrate deploy`

```
The following migration(s) have been applied:
migrations/
  └─ 20260801100000_job_tipo_analitica_rollup_diario/
    └─ migration.sql
All migrations have been successfully applied.
```

| migration_name | finished_at |
|---|---|
| **20260801100000_job_tipo_analitica_rollup_diario** | **2026-08-01 20:42:26** |
| 20260731160000_orden_busqueda_trgm | 2026-08-01 17:05:24 |

```
job_tipo: liberar_reprogramadas, geocodificacion, optimizacion_ruta, webhook_estado,
          whatsapp_template_sync, whatsapp_chat_envio, analitica_rollup_diario
```

Nueva `finished_at` (20:42:26 frente a 20:37:56 del primer UP): es una aplicacion **real**, no
un registro reciclado.

## 6. Veredicto y estado en que queda la base

**Round-trip completo y verde: UP → DOWN → UP, con el enum volviendo exactamente a sus seis
valores en el DOWN y a los siete en el UP.**

Estado de `localhost:5432/ordenex` al cerrar:

- Migracion `20260801100000_job_tipo_analitica_rollup_diario` **aplicada**.
- `jobs` con `tipo = 'analitica_rollup_diario'`: **0** (el DOWN limpio la siembra de prueba y
  no se volvio a sembrar).
- `analytics_daily`: **22 filas de la fecha `2026-07-31`**, y esto **no** es el estado en que
  se encontro la base (empezo en 0). Las escribio la invocacion manual de T4.6 corrida contra
  datos reales de la base local:
  `Rollup 2026-07-31: filasEscritas=22 filasRetiradas=0 ms=936`, y una segunda corrida
  idempotente `filasEscritas=22 filasRetiradas=0 ms=873`. Son la **primera medicion de volumen
  que existe en el repo** (D9/R47) y por eso se dejan; si alguna sesion necesita la tabla
  vacia, el borrado es un `DELETE FROM analytics_daily WHERE fecha = '2026-07-31'` y no
  arrastra nada mas.
