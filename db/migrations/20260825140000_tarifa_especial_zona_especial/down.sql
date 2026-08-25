-- DOWN — suelta las cuatro columnas que el `up` agrego: el pacto de devolucion en `tarifas` y
-- las tres entradas congeladas en `cierre_detail`.
--
-- PERDIDA DE DATO DECLARADA, y no es simetrica en las dos tablas:
--
--   `tarifas.tarifa_especial_devuelta` — se va el monto pactado de devolucion de toda tienda que
--   lo tuviera. La columna nace en el `up` y no hay copia en ninguna otra tabla. Revertir es
--   soltarla; no existe un estado anterior al que devolverla. Ojo: `tarifa_especial` (la de
--   entrega) NO se toca aqui, porque no es de esta migracion (nace en 20260824120000).
--
--   `cierre_detail.*` — se va la parte del SNAPSHOT que dice como se cobro cada orden de un
--   cierre ya aprobado. Eso es peor que perder una configuracion: es perder la auditoria. Tras
--   este rollback, un cierre que hubiera cobrado un pacto especial se re-derivaria como si el
--   distrito nunca hubiera estado marcado, y su detalle mostraria un importe distinto del que
--   se liquido. Si hay que revertir con cierres ya cobrados bajo la regla nueva, hay que
--   exportar antes estas tres columnas: el rollback no las puede reconstruir.
--
-- No hay FK, indice ni constraint que retirar antes: el `up` solo agrega columnas. `IF EXISTS`
-- para que el rollback sea IDEMPOTENTE.
ALTER TABLE "cierre_detail" DROP COLUMN IF EXISTS "tarifa_especial_devuelta";
ALTER TABLE "cierre_detail" DROP COLUMN IF EXISTS "tarifa_especial";
ALTER TABLE "cierre_detail" DROP COLUMN IF EXISTS "es_zona_especial";
ALTER TABLE "tarifas" DROP COLUMN IF EXISTS "tarifa_especial_devuelta";
