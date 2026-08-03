-- Feature 173 (T A.1, R49/R50) — la caja principal pasa a modo TESORERIA: el libro
-- `wallet_movimiento` gana los DOS conceptos de dinero de TERCEROS, el que solo PASA por la
-- caja (design §2.1):
--   1) `ingreso_cod_recaudado`: el contra-entrega recaudado ENTRA al aprobar el cierre del dia.
--   2) `ingreso_reverso_pago_tienda`: anular un pago a una tienda DEVUELVE el dinero a la caja.
--
-- Por que son DOS y no uno (design §2.1 / §10-C): el reflejo era reusar `ingreso_ajuste` para
-- el reverso, que es lo que ya hace `reversarEgreso`. Seria un error caro: `ingreso_ajuste` es
-- de naturaleza PROPIA, asi que anular un pago a una tienda AUMENTARIA la ganancia de Ordenex
-- por el monto anulado. Con un valor propio, la anulacion devuelve el dinero a la caja y NO
-- roza la ganancia (R26).
--
-- `egreso_pago_tienda` YA existe (reservado desde la 42) y no necesita migracion: solo pasa a
-- tener emisor (tanda C).
--
-- Patron "enum-existente" (features 41/45/67/158): `ALTER TYPE ... ADD VALUE` no puede correr
-- en la misma transaccion que USE el valor; aqui NADIE lo usa (solo se anaden), asi que es
-- seguro. El `IF NOT EXISTS` lo hace idempotente si se reintenta.
--
-- ADITIVA: no renombra, no reordena y no borra ningun valor previo del enum, no altera filas
-- existentes (sin INSERT/UPDATE/DELETE) y no toca indices en el UP.
--
-- RLS: NO hay tabla nueva -> NO hay superficie RLS nueva. `wallet_movimiento` ya tiene RLS
-- habilitada sin policies (solo service role) desde 20260712160000 y sigue exactamente igual.
-- Esta migracion NO toca RLS ni policies (precedente identico: 20260730120000).

-- 1) El contra-entrega recaudado, como INGRESO de terceros de la caja principal (R11).
ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'ingreso_cod_recaudado';

-- 2) El reverso del pago a tienda, como INGRESO de terceros (R24/R26). NUNCA `ingreso_ajuste`.
ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'ingreso_reverso_pago_tienda';

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- T A.2 (R45/R46, design §2.2) — la restriccion tipo <-> categoria de la CAJA PRINCIPAL.
--
-- Es el encargo que la 172 dejo por escrito en su propia migracion
-- (`20260802120000_liquidacion_pago/migration.sql:123-126`): alli se le pusieron los dos CHECK
-- a los libros de tienda y de mensajero y se dejo la caja fuera a proposito, porque la 172 no
-- la escribia. La 173 SI la escribe (tandas B y C), asi que aqui se cierra.
--
-- IMPORTA MAS AQUI que en los otros dos libros: la clasificacion por naturaleza decide por
-- CATEGORIA (`NATURALEZA_POR_CATEGORIA`, lib/utils/caja-tesoreria.ts) y el signo lo da el
-- TIPO. Una fila incoherente caeria en la cubeta equivocada con el signo contrario y
-- descuadraria una de las dos cifras sin que nada fallara: no da un error, da un numero que
-- miente.
--
-- FALLA CERRADO (R46): es una DISYUNCION DE LISTAS CERRADAS, no una negacion. Un valor futuro
-- del enum que nadie clasifique no casa NINGUNA rama y el INSERT se rechaza (23514). Ruidoso a
-- proposito: mejor que la feature que anada el concepto tenga que tocar este CHECK —y de paso
-- el `Record` de naturaleza, que tampoco compilaria— a que su primera fila se cuele en la
-- cubeta equivocada.
--
-- VALIDA LAS FILAS EXISTENTES al aplicarse, y va DIRECTO (sin `NOT VALID` + `VALIDATE`): T A.0
-- lo midio por MCP contra PRODUCCION el 2026-08-03 —35 filas, 8 categorias, CERO que violarian
-- la restriccion, y las 8 cubiertas por alguna rama— asi que la validacion no puede rechazar
-- nada. Cifras y decision en `progress/medicion_TA0_173.md`. PREVIEW no es alcanzable por el
-- MCP desde estas sesiones: queda DECLARADO alli como riesgo residual, no asumido.
--
-- Las 17 combinaciones legitimas son exactamente las 17 categorias del enum, cada una con su
-- unico tipo valido: 9 en la rama `ingreso` y 8 en la rama `egreso`.
ALTER TABLE "wallet_movimiento" ADD CONSTRAINT "wallet_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'ingreso' AND "categoria" IN (
     'ingreso_flete','ingreso_flete_devolucion','ingreso_comision_cod',
     'ingreso_iva_flete','ingreso_iva_flete_devolucion','ingreso_iva_comision_cod',
     'ingreso_ajuste','ingreso_cod_recaudado','ingreso_reverso_pago_tienda'))
  OR
  ("tipo" = 'egreso' AND "categoria" IN (
     'egreso_pago_tienda','egreso_pago_mensajero','egreso_gasto','egreso_sueldo',
     'egreso_ajuste','egreso_gasto_fijo','egreso_gasto_variable','egreso_indemnizacion'))
);
