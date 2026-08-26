-- `tarifas`: las FKs a `zona` y a `usuario` (tienda) pasan de RESTRICT a CASCADE.
--
-- EL PROBLEMA QUE CIERRA. Una zona con tarifas asociadas era INBORRABLE: el
-- `DELETE FROM zona` chocaba con `tarifas_zona_id_fkey` (RESTRICT) y la UI
-- devolvia un conflicto que no daba salida -para borrar la zona habia que
-- borrar a mano cada tarifa acotada a ella, sin pantalla que lo permitiera-.
-- Mismo caso con la tienda (`tarifas_tienda_id_fkey`).
--
-- POR QUE CASCADE ES LO CORRECTO AQUI Y NO UNA EXCEPCION. Una fila de `tarifas`
-- no es un dato con vida propia: describe el precio del par (tienda, zona). Si
-- el par deja de existir, la fila no significa nada y no hay a quien aplicarla.
-- La alternativa (SET NULL) seria PEOR: una tarifa acotada a la zona X pasaria
-- silenciosamente a ser la tarifa general de la tienda -o, con ambas columnas en
-- NULL, la global-, cambiando lo que se le cobra a alguien sin que nadie lo
-- decidiera. Ver la cascada de resolucion (tienda+zona / tienda / zona) descrita
-- en `db/schema.prisma`.
--
-- LA AUDITORIA NO SE PIERDE, Y ESTO ES DELIBERADO. `cierre_detail.tarifa_id`
-- SIGUE siendo ON DELETE RESTRICT (feature 69/R8: la tarifa congelada hace
-- auditable la deuda). Es decir: si alguna tarifa de la zona ya fue LIQUIDADA en
-- un cierre, la cascada choca contra ese RESTRICT y el borrado de la zona FALLA
-- entero, dentro de su transaccion. Se cambia «no se puede borrar una zona con
-- tarifas» por «no se puede borrar una zona cuyas tarifas ya se cobraron», que
-- es la regla que de verdad se queria. El repositorio sigue traduciendo el P2003
-- a `referenced` -> conflict, asi que ese caso conserva su mensaje.
--
-- `ON UPDATE CASCADE` se mantiene, por coherencia con el resto de FKs del repo.

ALTER TABLE "tarifas" DROP CONSTRAINT IF EXISTS "tarifas_zona_id_fkey";
ALTER TABLE "tarifas" ADD CONSTRAINT "tarifas_zona_id_fkey"
  FOREIGN KEY ("zona_id") REFERENCES "zona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tarifas" DROP CONSTRAINT IF EXISTS "tarifas_tienda_id_fkey";
ALTER TABLE "tarifas" ADD CONSTRAINT "tarifas_tienda_id_fkey"
  FOREIGN KEY ("tienda_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
