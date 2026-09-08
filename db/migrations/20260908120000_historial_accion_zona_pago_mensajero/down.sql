-- DOWN (ficha 380) — revierte EXACTAMENTE `migration.sql`: quita el valor
-- `zona_pago_mensajero_cambiado` de `historial_accion_tipo`.
--
-- POR QUE ES UN `CREATE TYPE` Y NO UN `DROP VALUE`: Postgres NO soporta
-- `ALTER TYPE ... DROP VALUE`. La unica via es RECREAR el tipo con la lista PREVIA y recastear la
-- columna que lo usa. Patron IDENTICO al de
-- `20260907130000_historial_accion_zona_central_cambiada/down.sql`. Se comprobo cual es la forma
-- del `down` de ESTE enum: RECREA-CON-LISTA, no dropea el tipo —el unico que lo dropea entero es el
-- de `20260902120000_historial_accion`, que tambien lo crea entero—.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ AVISO, Y NO ES TEORICO: ESTA LISTA ES UNA FOTO DEL 2026-09-08.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- Un `down.sql` de enum recrea el tipo con la lista COMPLETA, asi que ejecutarlo sobre una base
-- que ya avanzo BORRA EN SILENCIO, SIN UN SOLO ERROR, los valores que se añadieron despues de
-- escribirse este archivo. MEDIDO EN ESTE REPO EL 2026-09-07: el `down.sql` de una rama ramificada
-- antes del merge de la 376 se llevo por delante `zona_central_cambiada` de la base local; el
-- sintoma fueron 7 tests rojos en 6 archivos ajenos, y ni un mensaje de Postgres.
--
-- ANTES DE CORRER ESTE ARCHIVO, MIDE EL CATALOGO DE HOY:
--     SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
--      WHERE t.typname = 'historial_accion_tipo' ORDER BY e.enumsortorder;
-- Si esa consulta devuelve algo que NO sea «los 49 de abajo mas
-- `zona_pago_mensajero_cambiado`», este `down.sql` esta RANCIO y borrara lo que falte.
-- `tests/integration/db/historial-accion-zona-pago-mensajero-migration.test.ts` no se fia de esta
-- frase: reconstruye el estado previo ejecutando las migraciones REALES anteriores —descubiertas
-- leyendo `db/migrations`, no escritas a mano— y COMPARA valor a valor y en orden.
--
-- DE DONDE SALE LA LISTA, sin lugar a duda: LOS 49 = los 48 del `CREATE TYPE` de
-- `20260907130000_historial_accion_zona_central_cambiada/down.sql` MAS `'zona_central_cambiada'`,
-- que es justamente el valor que AQUELLA migracion añadio y que su propio `down` no podia listar.
-- `ADD VALUE` sin `BEFORE`/`AFTER` APENDE, asi que ese es el `enumsortorder` real; y ademas se
-- MIDIO contra la base local el 2026-09-08 (49 valores, en este mismo orden).
--
-- `historial_accion_entidad` NO SE TOCA: esta migracion no lo amplia. `zona` ya estaba entre sus
-- 17 valores originales y sus 20 de hoy se quedan como estan.
--
-- NINGUN `down.sql` ANTERIOR SE TOCA: son fotos historicas de lo que habia cuando se escribieron.
--
-- ⚠️ PRECONDICION RUIDOSA: NINGUNA fila de "historial_accion" con
-- `accion = 'zona_pago_mensajero_cambiado'`. Si quedara alguna, el `USING` del `ALTER COLUMN` falla
-- RUIDOSAMENTE al no poder castear ese valor al tipo recreado y el rollback ABORTA. Eso es lo
-- CORRECTO: esa fila es lo unico que dice quien cambio lo que cobra una persona por entregar —y,
-- por la firma de Q2, ya no dice de cuanto a cuanto—. Primero se decide que hacer con esas filas.
--
-- La columna que usa este enum es exactamente una: "historial_accion"."accion".

ALTER TYPE "historial_accion_tipo" RENAME TO "historial_accion_tipo_old";
CREATE TYPE "historial_accion_tipo" AS ENUM (
  -- mueve dinero (25)
  'cierre_dia_aprobado',
  'cierre_dia_rechazado',
  'cierre_dia_pagos_editados',
  'cierre_bodega_aprobado',
  'cierre_bodega_rechazado',
  'pago_mensajero_registrado',
  'pago_tienda_registrado',
  'pago_anulado',
  'reparto_mensajero_registrado',
  'reparto_anulado',
  'wallet_movimiento_manual_registrado',
  'egreso_administrativo_registrado',
  'egreso_administrativo_reversado',
  'tarifa_creada',
  'tarifa_actualizada',
  'incidente_aprobado',
  'incidente_rechazado',
  'cobro_gasto_fijo_aprobado',
  'cobro_gasto_fijo_rechazado',
  'cobro_rechazo_tienda_aprobado',
  'cobro_rechazo_tienda_rechazado',
  'premio_ranking_registrado',
  'premio_ranking_anulado',
  'orden_ubicacion_corregida',
  'usuario_fulfillment_cambiado',
  -- hace desaparecer algo (6)
  'orden_eliminada',
  'orden_recuperada',
  'tarifa_borrada',
  'zona_borrada',
  'vehiculo_borrado',
  'plantilla_eliminada',
  -- cambia quien puede hacer que (11)
  'usuario_creado',
  'usuario_rol_cambiado',
  'usuario_zona_cambiada',
  'usuario_estado_cambiado',
  'usuario_contrasena_restablecida',
  'postulacion_aprobada',
  'postulacion_rechazada',
  'api_key_generada',
  'api_key_rotada',
  'api_key_activada',
  'api_key_desactivada',
  -- añadido por la ficha 366, DESPUES del bloque de la 362 (asi lo apende `ADD VALUE`)
  'orden_zona_reconciliada',
  -- añadido por la ficha 371, despues del anterior
  'gestion_fecha_reprogramacion_corregida',
  -- añadido por la ficha 373, despues del anterior
  'api_key_eliminada',
  -- añadidos por la ficha 374, despues del anterior
  'nodo_geografico_desactivado',
  'nodo_geografico_activado',
  -- añadido por la ficha 375, despues de los anteriores
  'nodo_geografico_renombrado',
  -- añadido por la ficha 376, despues del anterior. ES EL ULTIMO DE LA FOTO DEL 2026-09-08: si
  -- entre esa fecha y el dia en que se corra este `down` alguna ficha ampliara el enum, su valor
  -- NO esta en esta lista y se perderia en silencio. Ver el aviso de arriba.
  'zona_central_cambiada'
);

ALTER TABLE "historial_accion"
  ALTER COLUMN "accion" TYPE "historial_accion_tipo"
  USING ("accion"::text::"historial_accion_tipo");

DROP TYPE "historial_accion_tipo_old";
