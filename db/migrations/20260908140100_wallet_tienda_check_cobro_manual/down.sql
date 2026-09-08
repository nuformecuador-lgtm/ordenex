-- DOWN (ficha 381, 2 de 2) — revierte EXACTAMENTE `migration.sql`: el CHECK vuelve a su lista sin
-- `cobro_manual`, y los dos enums del historial pierden los valores que aquella migracion añadio.
--
-- ⚠️ EL CHECK VA PRIMERO, Y EL ORDEN NO ES ESTETICO: nombra `cobro_manual`, que es un valor que el
-- `down.sql` de `20260908140000_wallet_tienda_categoria_cobro_manual` retira DESPUES —en un
-- rollback los downs corren del mas NUEVO al mas VIEJO—. Devolverlo aqui a su lista original deja
-- la restriccion sin referencia al valor que esta a punto de desaparecer.
--
-- POR QUE LOS ENUMS SON UN `CREATE TYPE` Y NO UN `DROP VALUE`: Postgres NO soporta
-- `ALTER TYPE … DROP VALUE`. La unica via es RECREAR el tipo con la lista PREVIA y recastear la
-- columna que lo usa. Patron IDENTICO al de
-- `20260908120000_historial_accion_zona_pago_mensajero/down.sql`.
--
-- SE COMPROBO CUAL ES LA FORMA DEL `down` DE CADA ENUM TOCADO, no se supuso: los dos del historial
-- RECREAN-CON-LISTA en todos sus downs previos; el unico que los dropea entero es el de
-- `20260902120000_historial_accion`, que tambien los crea entero.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ AVISO, Y NO ES TEORICO: ESTAS DOS LISTAS SON UNA FOTO DEL 2026-09-08.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- Un `down.sql` de enum recrea el tipo con la lista COMPLETA, asi que ejecutarlo sobre una base
-- que ya avanzo BORRA EN SILENCIO, SIN UN SOLO ERROR, los valores que se añadieron despues de
-- escribirse este archivo. MEDIDO EN ESTE REPO EL 2026-09-07: el `down.sql` de una rama ramificada
-- antes del merge de la 376 se llevo por delante `zona_central_cambiada` de la base local; el
-- sintoma fueron 7 tests rojos en 6 archivos ajenos, y ni un mensaje de Postgres. Y unas horas
-- antes de escribir esto, la ficha 380 añadio `zona_pago_mensajero_cambiado`.
--
-- ANTES DE CORRER ESTE ARCHIVO, MIDE LOS CATALOGOS DE HOY:
--     SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
--      WHERE t.typname = 'historial_accion_tipo' ORDER BY e.enumsortorder;
--     SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
--      WHERE t.typname = 'historial_accion_entidad' ORDER BY e.enumsortorder;
-- Si la primera devuelve algo que NO sea «los 50 de abajo mas `cobro_tienda_registrado`», o la
-- segunda algo que NO sea «los 20 de abajo mas `wallet_tienda_movimiento`», este `down.sql` esta
-- RANCIO y borrara lo que falte.
-- `tests/integration/db/historial-accion-cobro-tienda-migration.test.ts` no se fia de estas frases:
-- reconstruye el estado previo ejecutando las migraciones REALES anteriores —descubiertas leyendo
-- `db/migrations`, no escritas a mano— y COMPARA valor a valor y en orden.
--
-- DE DONDE SALEN LAS LISTAS, sin lugar a duda:
--   · LOS 50 de `historial_accion_tipo` = los 49 del `CREATE TYPE` de
--     `20260908120000_historial_accion_zona_pago_mensajero/down.sql` MAS
--     `'zona_pago_mensajero_cambiado'`, que es justamente el valor que AQUELLA migracion añadio y
--     que su propio `down` no podia listar. `ADD VALUE` sin `BEFORE`/`AFTER` APENDE, asi que ese es
--     el `enumsortorder` real; y ademas se MIDIO contra la base local el 2026-09-08 con la consulta
--     de arriba (50 valores, en este mismo orden).
--   · LOS 20 de `historial_accion_entidad` = los 17 del `CREATE TYPE` original de
--     `20260902120000_historial_accion` MAS `'provincia'`, `'canton'` y `'distrito'` (ficha 374).
--     Tambien MEDIDOS el 2026-09-08 (20 valores, en este mismo orden).
--
-- NINGUN `down.sql` ANTERIOR SE TOCA: son fotos historicas de lo que habia cuando se escribieron.
--
-- ⚠️ PRECONDICION RUIDOSA, PARA LAS DOS COLUMNAS DE "historial_accion": ninguna fila con
-- `accion = 'cobro_tienda_registrado'` ni con `entidad_tipo = 'wallet_tienda_movimiento'`. Si
-- quedara alguna, el `USING` del `ALTER COLUMN` falla RUIDOSAMENTE y el rollback ABORTA. Eso es lo
-- CORRECTO: esa fila es lo unico que dice quien le cobro a una tienda, cuanto y cuando. Primero se
-- decide que hacer con esas filas.

-- (1) El CHECK vuelve a su LISTA ORIGINAL (la de `20260802120000_liquidacion_pago`), SIN
--     `cobro_manual`. Va primero: ver el aviso de arriba sobre el orden del rollback.
ALTER TABLE "wallet_tienda_movimiento" DROP CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check";
ALTER TABLE "wallet_tienda_movimiento" ADD CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'credito' AND "categoria" IN ('cod_recaudado','ajuste_credito'))
  OR
  ("tipo" = 'debito' AND "categoria" IN ('flete','flete_devolucion','comision_cod','iva_flete','iva_flete_devolucion','iva_comision_cod','pago_tienda','ajuste_debito'))
);

-- (2) `historial_accion_tipo` vuelve a sus 50 valores previos.
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
  -- añadido por la ficha 376, despues del anterior
  'zona_central_cambiada',
  -- añadido por la ficha 380, unas horas antes que esta. ES EL ULTIMO DE LA FOTO DEL 2026-09-08:
  -- si entre esa fecha y el dia en que se corra este `down` alguna ficha ampliara el enum, su valor
  -- NO esta en esta lista y se perderia en silencio. Ver el aviso de arriba.
  'zona_pago_mensajero_cambiado'
);

ALTER TABLE "historial_accion"
  ALTER COLUMN "accion" TYPE "historial_accion_tipo"
  USING ("accion"::text::"historial_accion_tipo");

DROP TYPE "historial_accion_tipo_old";

-- (3) `historial_accion_entidad` vuelve a sus 20 valores previos.
ALTER TYPE "historial_accion_entidad" RENAME TO "historial_accion_entidad_old";
CREATE TYPE "historial_accion_entidad" AS ENUM (
  -- los 17 del `CREATE TYPE` original de `20260902120000_historial_accion`
  'orden',
  'usuario',
  'tarifa',
  'zona',
  'vehiculo',
  'plantilla_mensaje',
  'cierre_dia',
  'cierre_bodega',
  'gestion_orden',
  'liquidacion_pago',
  'liquidacion_reparto',
  'wallet_movimiento',
  'orden_incidente',
  'gasto_fijo_cobro',
  'rechazo_tienda_cobro',
  'ranking_snapshot_fila',
  'api_key',
  -- añadidos por la ficha 374, en este orden. `distrito` ES EL ULTIMO DE LA FOTO DEL 2026-09-08:
  -- ver el aviso de arriba.
  'provincia',
  'canton',
  'distrito'
);

ALTER TABLE "historial_accion"
  ALTER COLUMN "entidad_tipo" TYPE "historial_accion_entidad"
  USING ("entidad_tipo"::text::"historial_accion_entidad");

DROP TYPE "historial_accion_entidad_old";
