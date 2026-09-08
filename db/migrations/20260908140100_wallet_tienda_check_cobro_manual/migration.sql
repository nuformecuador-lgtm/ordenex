-- FICHA 381 (2 de 2) — el CHECK admite el cobro manual, y el historial gana donde apuntarlo.
--
-- TRES cosas, y ninguna depende de las otras dos:
--
--  (1) EL CHECK `wallet_tienda_movimiento_tipo_categoria_check` gana `cobro_manual` en la rama
--      `debito`. EL CHECK NO SE EXTIENDE SOLO: un valor nuevo del enum queda RECHAZADO por la base
--      hasta que la lista lo nombre. Eso es una RED, no un estorbo — la 172 la escribio a proposito
--      para que «elegir otro par no de un saldo raro, sino un INSERT rechazado» (R60). La lista es
--      la de `20260802120000_liquidacion_pago` MAS `cobro_manual`, sin quitar ni reordenar nada.
--      `cobro_manual` va en `debito` y solo ahi: un cobro BAJA el disponible de la tienda. Un
--      `credito` con `cobro_manual` lo rechaza la base, y hay un test que lo comprueba contra
--      Postgres real.
--
--      ⚠️ VALIDA LAS FILAS EXISTENTES al aplicarse (sin `NOT VALID`), igual que el CHECK original.
--      Es una AMPLIACION de la lista: toda fila que pasaba el CHECK viejo pasa el nuevo, asi que el
--      recorrido no puede fallar por datos preexistentes.
--
--  (2) `historial_accion_tipo` gana `cobro_tienda_registrado` — el rastro de la DECISION humana de
--      cobrarle a una tienda. Entra en «mueve dinero» (`CATEGORIA_POR_ACCION`, R17 de la 362:
--      exactamente una categoria por tipo). El criterio no lo inventa esta ficha: la 362 dejo
--      escrito que se registra LA DECISION, no sus asientos — los ~34 asientos automaticos de
--      aprobar un cierre NO se registran; los que nacen de una decision humana sobre dinero SI.
--
--  (3) `historial_accion_entidad` gana `wallet_tienda_movimiento` — la tabla del asiento. DOS
--      entidades y no una: los 20 valores previos mapean 1:1 con tablas, y apuntar el rastro al
--      `usuario` de la tienda dejaria la fila sin poder señalar QUE asiento se escribio, que es
--      para lo que sirve el indice `[entidad_tipo, entidad_id]`.
--
-- POR QUE VA APARTE DE `20260908140000_wallet_tienda_categoria_cobro_manual`: Postgres prohibe USAR
-- un valor de enum en la misma transaccion que lo añade (55P04), Prisma Migrate corre cada
-- `migration.sql` en su propia transaccion, y este CHECK NOMBRA `cobro_manual` — o sea, lo usa.
-- Precedente: `20260906120100_historial_accion_nodo_geografico/migration.sql`.
--
-- ADITIVA en lo que importa: no crea ni altera tablas ni columnas, no crea ni borra indices, y no
-- escribe ni borra datos. Lo unico que reemplaza es la restriccion, por una MAS PERMISIVA. La RLS
-- de las dos tablas —habilitada y sin policies, solo service role— no se toca. NO HAY BACKFILL y no
-- puede haberlo: no existe ningun cobro manual anterior, esta ficha es la que los crea.

-- (1) El CHECK con `cobro_manual` en la rama `debito`.
ALTER TABLE "wallet_tienda_movimiento" DROP CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check";
ALTER TABLE "wallet_tienda_movimiento" ADD CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'credito' AND "categoria" IN ('cod_recaudado','ajuste_credito'))
  OR
  ("tipo" = 'debito' AND "categoria" IN ('flete','flete_devolucion','comision_cod','iva_flete','iva_flete_devolucion','iva_comision_cod','pago_tienda','ajuste_debito','cobro_manual'))
);

-- (2) y (3) Los dos valores del historial.
ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'cobro_tienda_registrado';
ALTER TYPE "historial_accion_entidad" ADD VALUE IF NOT EXISTS 'wallet_tienda_movimiento';
