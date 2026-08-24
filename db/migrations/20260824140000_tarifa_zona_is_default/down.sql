-- DOWN — suelta `is_default`, `zona_id` y el unico `(zona_id, tienda_id)`; repone `deleted_at`
-- y el `NOT NULL` de `tienda_id`.
--
-- ⚠️ LO QUE ESTE `down` NO PUEDE DESHACER: el `up` BORRO FISICAMENTE las tarifas que estaban
-- marcadas como borradas en logico. Esas filas no vuelven. La columna `deleted_at` se repone
-- vacia, de modo que la base queda con la FORMA anterior pero no con el CONTENIDO anterior: para
-- el codigo viejo -que filtra `deleted_at IS NULL`- eso se ve exactamente igual que antes, porque
-- justamente esas filas eran las que ese codigo nunca leia. Es la unica lectura bajo la cual la
-- reversion es honesta, y por eso se escribe aqui y no se deja al lector deducirla.
--
-- PERDIDA DE DATO DECLARADA: ademas se pierden el acotado por zona de toda tarifa que lo tuviera
-- y la marca de cual era la de por defecto. Ambas columnas nacen en el `up`, asi que revertirlo
-- es soltarlas; no hay copia en ninguna otra tabla.
--
-- ⚠️ EL BACKFILL DE `is_default` NO SE PUEDE DESHACER, Y NO HACE FALTA. El `up` puso
-- `is_default = true` en todas las filas existentes; el `down` no intenta restaurar el `false`
-- previo porque ese `false` nunca fue un dato del sistema -era el DEFAULT de una columna recien
-- creada, no una eleccion de nadie-. Al soltar la columna entera la pregunta desaparece con ella.
--
-- Orden: inverso al `up`. `IF EXISTS` en todo para que sea IDEMPOTENTE.

-- 1) El unico se suelta sin mas: es una regla, no un dato.
DROP INDEX IF EXISTS "tarifas_zona_id_tienda_id_key";

-- 2) Vuelve `deleted_at`, nullable y sin default: toda fila viva queda en NULL, que es
-- precisamente «no borrada». No hay nada que backfillear -las que estaban borradas ya no estan-.
ALTER TABLE "tarifas" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

-- 3) ⚠️ ESTE PASO PUEDE FALLAR, Y DEBE FALLAR. Reponer el `NOT NULL` de `tienda_id` es
-- imposible si mientras la columna fue opcional alguien creo tarifas sin tienda (las generales
-- por zona o las globales, que es justo para lo que se abrio). Postgres aborta la transaccion
-- nombrando la columna. NO se resuelve aqui de oficio: inventarle una tienda a esas filas o
-- borrarlas son decisiones de negocio, y esta tabla es de dinero. Si el rollback tropieza aqui,
-- hay que decidir primero que pasa con esas filas y volver a correrlo.
ALTER TABLE "tarifas" ALTER COLUMN "tienda_id" SET NOT NULL;

-- 4) `is_default` y `zona_id`: primero la FK, luego el indice, luego las columnas (soltar la
-- columna se llevaria ambos por delante, pero se hace explicito para que el rollback se lea igual
-- que el alta). El estado resultante es el que dejo la `20260712100000`, que ya habia soltado una
-- `zona_id` con este mismo nombre de indice y de FK. `status` y las columnas de dinero no se tocan
-- ni aqui ni en el `up`.
ALTER TABLE "tarifas" DROP CONSTRAINT IF EXISTS "tarifas_zona_id_fkey";
DROP INDEX IF EXISTS "tarifas_zona_id_idx";
ALTER TABLE "tarifas" DROP COLUMN IF EXISTS "zona_id";
ALTER TABLE "tarifas" DROP COLUMN IF EXISTS "is_default";
