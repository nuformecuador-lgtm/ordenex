-- Feature 178 (T2, R26) — SOLO INDICES. Cero DDL sobre datos.
--
-- Esta migracion no crea ni altera ninguna tabla, columna, constraint, tipo ni fila: crea
-- exactamente DOS indices PARCIALES que dan soporte a la seleccion de cargas purgables
-- (`design.md` §3). Su `down.sql` los suelta en orden inverso y nada mas.
--
-- POR QUE `carga("created_at")` Y NO `fecha_carga`: la ventana de retencion de R5 se mide sobre
-- `carga.created_at` (decision (a) de la puerta F1.4). Hoy `carga` indexa `usuario_carga` y
-- `fecha_carga`, que es una columna DISTINTA: el corte de la purga no tiene ningun indice que lo
-- sirva.
--
-- POR QUE PARCIALES: con el tiempo la inmensa mayoria de las cargas estaran YA purgadas
-- (`download_storage_path` y `download_url` a NULL). Un indice total sobre `created_at` obligaria
-- a recorrer todo el historico limpio —de lo mas viejo a lo mas nuevo— evaluando el predicado de
-- "referencia viva" hasta juntar las `limite` candidatas: el coste de la purga creceria con el
-- historico acumulado en vez de con el trabajo pendiente. El indice parcial solo contiene las
-- filas PENDIENTES. Lo mismo en `orden`: responde "¿esta carga aun tiene alguna orden con
-- referencia viva?" (R8) sin recorrer las ordenes ya limpias del lote.
--
-- POR QUE NO ESTAN EN `db/schema.prisma`: **Prisma no sabe expresar indices parciales** (no hay
-- forma de declarar un `WHERE` en `@@index`). Van a mano aqui y quedan HUERFANOS del datamodel.
-- Precedente explicito del repo: los indices reales de `jobs` son parciales y estan documentados
-- asi en `db/schema.prisma` (~1619-1625). Consecuencia conocida y ACEPTADA: un
-- `prisma migrate dev --create-only` futuro puede proponer un `DROP INDEX` fantasma de estos dos.
-- Eso NUNCA se resuelve borrando el indice: se descarta la migracion propuesta.
-- Medicion del drift (T3): ver `progress/impl_178.md` §Bloque A.
--
-- SIN `CONCURRENTLY`: Prisma corre cada migracion dentro de una transaccion y
-- `CREATE INDEX CONCURRENTLY` no puede correr ahi (mismo motivo que las features 126 y 167).
--
-- `IF NOT EXISTS` en AMBAS sentencias para que la migracion sea idempotente: no crea nada mas,
-- asi que volver a aplicarla sobre una base que ya tiene los indices no puede fallar (mismo
-- criterio que `20260803090000_gestion_orden_idx_created_at`, y su espejo `IF EXISTS` en el DOWN).
--
-- Sin tablas nuevas => SIN RLS nueva. `carga` y `orden` conservan la que ya tenian.
CREATE INDEX IF NOT EXISTS "carga_purga_pendiente_idx" ON "carga" ("created_at")
  WHERE "download_storage_path" IS NOT NULL OR "download_url" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "orden_purga_pendiente_idx" ON "orden" ("carga_id")
  WHERE "carga_id" IS NOT NULL
    AND ("download_storage_path" IS NOT NULL OR "download_url" IS NOT NULL);
