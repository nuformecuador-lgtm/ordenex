-- DOWN (ficha 375) — revierte EXACTAMENTE `migration.sql` y nada mas.
--
-- PERDIDA DE DATO DECLARADA: se va `codigo_dta` de las 585 filas. Nace en el `up` y no hay copia en
-- ninguna otra tabla de la base; lo que si queda es la FUENTE —`public/geografia-cr-completa.xlsx`,
-- columna `Codigo DTA`—, asi que volver a aplicar el `up` lo reconstruye entero salvo los codigos
-- que alguien hubiera puesto a mano despues.
--
-- ⚠️ CONSECUENCIA QUE HAY QUE DECIR EN VOZ ALTA: sin `codigo_dta`, `scripts/seed-zonas.ts` vuelve a
-- cruzar por NOMBRE (su respaldo declarado), y con ello vuelve el defecto que esta ficha cierra —un
-- nodo renombrado se duplica en la siguiente corrida del seed—. Revertir esto NO es inocuo si ya se
-- renombro algo: primero hay que decidir que pasa con los nombres cambiados.
--
-- Lo que NO pasa: NINGUNA fila de `provincia`, `canton`, `distrito` ni `zona_distrito` se borra ni
-- se modifica. `activo`, `nombre` y `zona_especial` quedan intactos. Solo se sueltan tres indices y
-- tres columnas.
--
-- `IF EXISTS` en las seis sentencias: correr el down dos veces es un no-op, no un error.
--
-- NINGUN `down.sql` ANTERIOR SE TOCA: son fotos historicas de lo que habia cuando se escribieron.
DROP INDEX IF EXISTS "distrito_codigo_dta_key";
DROP INDEX IF EXISTS "canton_codigo_dta_key";
DROP INDEX IF EXISTS "provincia_codigo_dta_key";

ALTER TABLE "distrito"  DROP COLUMN IF EXISTS "codigo_dta";
ALTER TABLE "canton"    DROP COLUMN IF EXISTS "codigo_dta";
ALTER TABLE "provincia" DROP COLUMN IF EXISTS "codigo_dta";
