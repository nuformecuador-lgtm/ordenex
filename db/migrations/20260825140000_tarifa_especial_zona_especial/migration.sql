-- LA TARIFA ESPECIAL EMPIEZA A COBRAR. Hasta hoy `tarifas.tarifa_especial` y
-- `distrito.zona_especial` existian y NO tocaban ni un centimo: la feature 274 lo declaro
-- explicitamente fuera de alcance (R40) y dejo un test guardian para que nadie las conectara
-- "ya que estamos". Esta migracion es la decision de producto que ese R40 estaba esperando:
-- cuando el DISTRITO de la orden es especial, el flete deja de salir de `valor_flete` /
-- `valor_flete_gam` y sale del monto pactado.
--
-- La regla completa, para que se lea entera en un solo sitio:
--   distrito.zona_especial IS TRUE  AND  tarifas.tarifa_especial IS NOT NULL  -> flete = tarifa_especial
--   distrito.zona_especial IS TRUE  AND  tarifas.tarifa_especial IS NULL      -> flete NORMAL (con marca, ver abajo)
--   en cualquier otro caso                                                    -> flete NORMAL
-- El IVA del flete se aplica IGUAL sobre el monto especial (`iva_flete`), y la comision COD y
-- su IVA no se tocan: lo especial es el FLETE, no la factura entera.
--
-- ── 1. `tarifas.tarifa_especial_devuelta` ────────────────────────────────────────────────
-- La devolucion tiene su propio precio pactado, igual que ya lo tiene en la tabla normal
-- (`valor_flete_devuelto` es una columna aparte de `valor_flete`). Sin esta columna, un
-- distrito especial cobraria el pacto al entregar y la tarifa estandar al devolver, que es
-- justo la asimetria que la tabla normal evita.
--
-- NULLABLE Y SIN DEFAULT, por el mismo motivo que su hermana `tarifa_especial` (ver
-- 20260824120000_tarifa_especial): `NULL` = «no se pacto nada para la devolucion», que NO es
-- `0` (un pacto de cero colones es un dato distinto y real). Cero backfill: todas las filas
-- existentes quedan en NULL, que es la verdad.
--
-- Consecuencia deliberada: `tarifa_especial` y `tarifa_especial_devuelta` son INDEPENDIENTES.
-- Se puede pactar el flete de entrega y dejar la devolucion en la tarifa normal, y al reves.
-- Cada una cae por su cuenta al valor estandar cuando es NULL.
ALTER TABLE "tarifas" ADD COLUMN "tarifa_especial_devuelta" DECIMAL(12,2);

-- ── 2. `cierre_detail`: el snapshot tiene que congelar las nuevas entradas ───────────────
-- `cierre_detail` congela TODAS las entradas de la formula de derivacion (R6/R8) para que el
-- detalle que el admin ve hoy siga dando el mismo numero dentro de un ano, aunque la tarifa
-- se haya editado y aunque el distrito se haya desmarcado. Al entrar dos entradas nuevas en
-- la formula, entran tambien aqui: si no, el cierre re-derivaria con datos de HOY sobre una
-- orden de ENTONCES, que es exactamente el descuadre invisible que el snapshot existe para
-- impedir.
--
-- `es_zona_especial` es NOT NULL DEFAULT false y NO tri-valuado, a diferencia de
-- `distrito.zona_especial`. La diferencia es intencional y hay que decirla: en `distrito`,
-- `NULL` significa «nadie lo decidio». En el snapshot no existe esa duda — al congelar, la
-- pregunta «¿esta orden se cobro como especial?» YA tiene respuesta, y `distrito.zona_especial
-- IS TRUE` la reduce a dos valores. Las filas anteriores quedan en `false`, que es la verdad
-- historica: cuando se cerraron, la marca no cobraba nada.
--
-- Las dos columnas de monto son NULL-ables como sus siete hermanas `tarifa_*`: NULL = la
-- tienda no tenia ese pacto al solicitar (o no tenia tarifa vigente en absoluto, el gap R9).
-- Sin backfill posible ni deseable: la tarifa de entonces pudo cambiar.
ALTER TABLE "cierre_detail" ADD COLUMN "es_zona_especial" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "cierre_detail" ADD COLUMN "tarifa_especial" DECIMAL(12,2);
ALTER TABLE "cierre_detail" ADD COLUMN "tarifa_especial_devuelta" DECIMAL(12,2);

-- ADITIVA de punta a punta: no crea tablas ni enums, no renombra, no reordena, no borra, no
-- reescribe filas (Postgres 11+ guarda el DEFAULT en el catalogo), no toca indices ni RLS.
