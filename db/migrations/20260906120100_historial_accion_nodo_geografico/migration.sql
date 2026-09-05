-- FICHA 374 — el rastro de retirar y devolver un nodo del catalogo geografico.
--
-- QUE REGISTRA: que un maestro RETIRO (o devolvio) una provincia, un canton o un distrito. El alta
-- NO se registra (R53): es aditiva e inocua, igual que `vehiculo_creado`, que tampoco existe.
--
-- POR QUE SE AUDITA DESACTIVAR SI EL PRECEDENTE DE VEHICULOS NO AUDITA `vehiculo_creado`. Lo que
-- decide no es el nombre de la operacion sino su PAPEL: en esta pantalla, desactivar ocupa el
-- lugar que el borrado ocupa en las demas —es la operacion que quita—, asi que auditarla SIGUE el
-- precedente en vez de hacerle una excepcion. Y la asimetria del coste lo cierra: auditar de mas
-- cuesta este `ALTER TYPE`; no auditar y necesitarlo despues es IRRECUPERABLE, porque el pasado no
-- se reconstruye — y el efecto de retirar un distrito aparece lejos (una tienda cuyas cargas
-- empiezan a rechazarse semanas mas tarde) sin nada que diga quien lo decidio.
--
-- DOS TIPOS Y NO UNO CON UN BOOLEANO: con un solo valor habria que abrir el detalle de la fila
-- para saber que paso. El par se lee en el listado, que es donde se mira.
--
-- TRES ENTIDADES Y NO UNA: `historial_accion_entidad` mapea 1:1 con tablas en sus 17 valores
-- actuales, y esto no es la excepcion. Ademas deja filtrar «que le paso a este distrito» por el
-- indice ([entidad_tipo, entidad_id]) que ya existe.
-- ⚠️ ES LA PRIMERA AMPLIACION DE `historial_accion_entidad`: nacio con 17 valores en
-- `20260902120000_historial_accion` (lineas 136-154) y ninguna migracion posterior lo habia
-- tocado.
--
-- VA APARTE de `20260906120000_geografia_activo_y_unicidad`: Postgres prohibe USAR un valor de
-- enum en la misma transaccion que lo añade (55P04), y separarlas deja cada `down.sql` con una
-- sola cosa que revertir.
--
-- ADITIVA: no crea ni altera tablas, columnas ni indices. La RLS de `historial_accion` no se toca.
ALTER TYPE "historial_accion_tipo"    ADD VALUE IF NOT EXISTS 'nodo_geografico_desactivado';
ALTER TYPE "historial_accion_tipo"    ADD VALUE IF NOT EXISTS 'nodo_geografico_activado';
ALTER TYPE "historial_accion_entidad" ADD VALUE IF NOT EXISTS 'provincia';
ALTER TYPE "historial_accion_entidad" ADD VALUE IF NOT EXISTS 'canton';
ALTER TYPE "historial_accion_entidad" ADD VALUE IF NOT EXISTS 'distrito';
