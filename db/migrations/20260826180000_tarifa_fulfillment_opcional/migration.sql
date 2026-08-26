-- `tarifas.fulfillment` pasa a NULLABLE (2026-08-26).
--
-- EL PROBLEMA QUE CIERRA. El formulario de ZONA (configuracion/tarifas) dejo de pedir el
-- monto de fulfillment: una tarifa acotada a una zona describe lo que cuesta REPARTIR ahi,
-- no el servicio de bodega de una tienda concreta. Con la columna NOT NULL la unica forma de
-- guardar esa tarifa era inventarle un cero, que es exactamente el dato que no se tiene.
--
-- NULL Y 0 SON EL MISMO HECHO, Y ESO ES DELIBERADO. A diferencia de `tarifa_especial` -donde
-- NULL ("sin pacto") y 0 ("se pacto cobrar cero") son dos cosas distintas-, aqui ambos
-- valores responden lo mismo: esta tarifa NO lleva fulfillment. El predicado del dominio
-- sigue siendo el MONTO (`tieneFulfillment`: > 0), asi que los lectores normalizan NULL a 0
-- en la frontera y ninguna formula aguas abajo ve un `null`. Por eso NO se hace backfill ni
-- se toca una sola fila existente: los ceros que ya hay siguen significando lo que decian.
--
-- SIN DEFAULT A PROPOSITO. Poner `DEFAULT 0` volveria a fabricar el cero que se quiere
-- evitar en el INSERT que omite la columna; el repositorio escribe NULL explicito.

ALTER TABLE "tarifas" ALTER COLUMN "fulfillment" DROP NOT NULL;
