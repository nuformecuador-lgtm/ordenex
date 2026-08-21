-- DOWN — suelta el rastro de la CORRECCION del desglose de pago (`pagos_editados_at` /
-- `pagos_editados_por`) de `gestion_orden`.
--
-- ⚠️ ESTE ARCHIVO SE ANADIO EL 2026-08-19, DESPUES de que la migracion aterrizara en `dev` (PR
-- #401, branch `ux`), porque venia SIN EL. La guardia de la 227
-- (`orden-mensajero-meta-drop-nota-migration.test.ts`) lo exige para toda migracion posterior a
-- `20260815120000_orden_nota`, y sin el `dev` estaba ROJO. El `migration.sql` NO se toco: editar
-- una migracion ya aplicada produce drift, porque lo anadido despues no llega nunca a la base
-- donde ya corrio.
--
-- PERDIDA DE DATO DECLARADA: se pierde QUIEN corrigio un desglose de pago y CUANDO. Los importes
-- corregidos NO se pierden —viven en `gestion_orden_pago`, que esta migracion no toca— asi que
-- revertir NO deshace ninguna correccion: solo borra su autoria. Es exactamente lo que el
-- `migration.sql` dice que estas columnas existen para impedir («una correccion legitima sin
-- autor»), asi que quien revierta esto tiene que saber que se queda sin ese rastro.
--
-- ORDEN INVERSO AL DEL `up`, que es lo que hace que se pueda correr: primero el indice, luego la
-- restriccion que lo usa, y al final las columnas. Soltar la columna antes se llevaria por delante
-- las dos por cascada de Postgres, pero dejarlo explicito documenta lo que habia.
--
-- `IF EXISTS` en los tres para que el rollback sea IDEMPOTENTE: se puede correr dos veces sin
-- fallar, igual que el down de la 238.
DROP INDEX IF EXISTS "gestion_orden_pagos_editados_por_idx";

ALTER TABLE "gestion_orden" DROP CONSTRAINT IF EXISTS "gestion_orden_pagos_editados_por_fkey";

ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "pagos_editados_por";
ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "pagos_editados_at";
