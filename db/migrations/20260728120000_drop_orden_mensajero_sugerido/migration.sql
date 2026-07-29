-- Retira por completo el flujo de "mensajero sugerido" (feature 15/16).
--
-- Motivo: la sugerencia de mensajero se capturaba en la carga masiva (columna
-- opcional del archivo / API) y se confirmaba en un tercer paso del modal
-- ("Asignar mensajero"), pero NUNCA era la asignacion real: el mensajero
-- efectivo se decide en "Generar guia" y vive en `mensajero_asignado_id`
-- (feature 17). El campo solo servia como preseleccion, duplicaba el concepto
-- de "mensajero de la orden" y obligaba a mantener un paso de UI, un service,
-- una server action y una columna de listado propios.
--
-- Se elimina el dato, no se conserva: `mensajero_asignado_id` es la unica
-- fuente de verdad del mensajero de una orden.
--
-- Orden de las sentencias: primero la FK (depende de la columna), luego el
-- indice, luego la columna. `IF EXISTS` en las tres para que sea idempotente
-- sobre bases donde algo ya se hubiera retirado a mano.

ALTER TABLE "orden" DROP CONSTRAINT IF EXISTS "orden_mensajero_sugerido_id_fkey";

DROP INDEX IF EXISTS "orden_mensajero_sugerido_id_idx";

ALTER TABLE "orden" DROP COLUMN IF EXISTS "mensajero_sugerido_id";
