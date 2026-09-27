-- DOWN (ficha 429) — revierte EXACTAMENTE `migration.sql`: quita el valor `zona_sinpe_cambiado`
-- de `historial_accion_tipo`.
--
-- POR QUE ES UN `CREATE TYPE` Y NO UN `DROP VALUE`: Postgres NO soporta `ALTER TYPE … DROP VALUE`.
-- La unica via es RECREAR el tipo con la lista PREVIA y recastear la columna que lo usa. Se
-- comprobo cual es la forma del `down` de ESTE enum: RECREA-CON-LISTA, no dropea el tipo — el
-- unico que lo dropea entero es el de `20260902120000_historial_accion`, que tambien lo crea
-- entero.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ AVISO, Y NO ES TEORICO: ESTA LISTA ES UNA FOTO DEL 2026-09-15.
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
-- Si esa consulta devuelve algo que NO sea «los 52 de abajo mas `zona_sinpe_cambiado`», este
-- `down.sql` esta RANCIO y borrara lo que falte.
-- `tests/integration/db/historial-accion-zona-sinpe-migration.test.ts` no se fia de esta frase:
-- reconstruye el estado previo ejecutando las migraciones REALES anteriores —descubiertas leyendo
-- `db/migrations`, no escritas a mano— y COMPARA valor a valor y en orden.
--
-- DE DONDE SALE LA LISTA, MEDIDA Y NO COPIADA: se corrio la consulta de arriba contra la base
-- local el 2026-09-15 y devolvio 52 etiquetas, EN ESTE ORDEN. Coincide con los 42 del `CREATE TYPE`
-- de `20260902120000_historial_accion` mas las diez ampliaciones posteriores (366, 371, 373, 374
-- ×2, 375, 376, 380, 381 y 398), que es lo que `ADD VALUE` sin `BEFORE`/`AFTER` deja: APENDE.
--
-- `historial_accion_entidad` NO SE TOCA: esta migracion no lo amplia.
--
-- NINGUN `down.sql` ANTERIOR SE TOCA: son fotos historicas de lo que habia cuando se escribieron.
--
-- ⚠️ PRECONDICION RUIDOSA: NINGUNA fila de "historial_accion" con `accion = 'zona_sinpe_cambiado'`.
-- Si quedara alguna, el `USING` del `ALTER COLUMN` falla RUIDOSAMENTE al no poder castear ese valor
-- al tipo recreado y el rollback ABORTA. Eso es lo CORRECTO: esa fila es lo unico que dice a que
-- numero se le estuvo pidiendo dinero a los clientes de una bodega, y desde cuando. Primero se
-- decide que hacer con esas filas.
--
-- La columna que usa este enum es exactamente una: "historial_accion"."accion".

ALTER TYPE "historial_accion_tipo" RENAME TO "historial_accion_tipo_old";
CREATE TYPE "historial_accion_tipo" AS ENUM (
  -- mueve dinero (25, los del CREATE TYPE original de la 362)
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
  -- añadido por la ficha 376, despues del anterior
  'zona_central_cambiada',
  -- añadido por la ficha 380, despues del anterior
  'zona_pago_mensajero_cambiado',
  -- añadido por la ficha 381, despues del anterior
  'cobro_tienda_registrado',
  -- añadido por la ficha 398. ES EL ULTIMO DE LA FOTO DEL 2026-09-15: si entre esa fecha y el dia
  -- en que se corra este `down` alguna ficha ampliara el enum, su valor NO esta en esta lista y se
  -- perderia en silencio. Ver el aviso de arriba.
  'cierre_dia_gestion_corregida'
);

ALTER TABLE "historial_accion"
  ALTER COLUMN "accion" TYPE "historial_accion_tipo"
  USING ("accion"::text::"historial_accion_tipo");

DROP TYPE "historial_accion_tipo_old";
