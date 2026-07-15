-- DOWN: revierte EXACTAMENTE migration.sql de esta carpeta, en orden inverso.
-- NO toca las policies RLS de `gestion_orden` (la migracion tampoco las tocó).
--
-- Precondicion (documentada, F1.4-b): NINGUNA fila de "orden_historial_estado" debe tener
-- `origen_tipo = 'deshacer_gestion'`. Postgres no soporta DROP VALUE de un enum, asi que el
-- tipo se RECREA sin ese valor; si existiera una fila con el, el USING cast
-- ('deshacer_gestion'::text::"orden_historial_origen_tipo") FALLA y el rollback aborta con
-- un error claro. Es lo CORRECTO: revertir borrando rastro de auditoria no es seguro.

-- 3) Enum: recrear "orden_historial_origen_tipo" con los 11 valores originales (sin
-- 'deshacer_gestion'). Una SOLA columna usa el enum (`orden_historial_estado.origen_tipo`) y
-- NO tiene DEFAULT -> no hay defaults que soltar/restaurar ni indices parciales con
-- predicado sobre el enum (a diferencia del down de 20260712150000_cierre_estado_vencido).
ALTER TYPE "orden_historial_origen_tipo" RENAME TO "orden_historial_origen_tipo_old";

CREATE TYPE "orden_historial_origen_tipo" AS ENUM (
  'carga_masiva',
  'creacion_manual',
  'generacion_guia',
  'asignacion_bodega',
  'ruteo_satelite',
  'recepcion_satelite',
  'asignacion_satelite',
  'recoleccion',
  'gestion',
  'liberacion_reprogramada',
  'ajuste_estado'
);

ALTER TABLE "orden_historial_estado" ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"
  USING ("origen_tipo"::text::"orden_historial_origen_tipo");

DROP TYPE "orden_historial_origen_tipo_old";

-- 2) Indice parcial de la ruta caliente (ya sin uso: la columna anulada_at desaparece abajo).
DROP INDEX IF EXISTS "gestion_orden_mensajero_pendiente_idx";

-- 1) Columnas de anulacion (+ su indice y su FK). Al soltar las columnas se pierde el rastro
-- de las anulaciones: es el reverso exacto de la migracion (la feature deja de existir).
DROP INDEX IF EXISTS "gestion_orden_anulada_por_idx";
ALTER TABLE "gestion_orden" DROP CONSTRAINT IF EXISTS "gestion_orden_anulada_por_fkey";
ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "anulada_por";
ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "anulada_at";
