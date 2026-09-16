-- DOWN (ficha 429) — revierte EXACTAMENTE `migration.sql`: quita los dos `CHECK` y devuelve las
-- dos columnas a NULLABLE. NO borra ningun dato: los valores sembrados se quedan donde estan.
--
-- El `DO` del `up` no deja nada que revertir: solo comprueba y aborta.
--
-- `sinpe_revisado_at` no aparece porque el `up` no la toco.
--
-- Orden inverso al del `up`: primero las restricciones, luego la nulabilidad. Al reves, un
-- `DROP NOT NULL` con el `CHECK` todavia puesto funcionaria igual, pero el archivo dejaria de
-- leerse como el espejo de su `migration.sql`, que es lo unico que hace revisable un `down`.
--
-- `IF EXISTS` en los dos `DROP CONSTRAINT`: este archivo tiene que poder correr tambien sobre una
-- base donde el `up` fallo a mitad (el `DO` aborto antes de crear nada).

ALTER TABLE "zona" DROP CONSTRAINT IF EXISTS "zona_sinpe_nombre_check";
ALTER TABLE "zona" DROP CONSTRAINT IF EXISTS "zona_sinpe_numero_check";

ALTER TABLE "zona" ALTER COLUMN "sinpe_nombre" DROP NOT NULL;
ALTER TABLE "zona" ALTER COLUMN "sinpe_numero" DROP NOT NULL;
