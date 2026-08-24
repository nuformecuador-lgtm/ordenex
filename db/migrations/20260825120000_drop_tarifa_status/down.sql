-- DOWN — repone el tipo `estado_tarifa` y la columna `tarifas.status NOT NULL DEFAULT 'activo'`.
--
-- PERDIDA DE DATO DECLARADA: ESTE `down` RESTAURA LA COLUMNA, NO LOS VALORES. Toda fila de
-- `tarifas` vuelve como `activo`, incluidas las que estuvieran en `inactivo` antes del `up`.
-- El `up` no copia esos valores a ninguna otra tabla, asi que no hay de donde traerlos: la
-- base queda con la FORMA anterior y no con el CONTENIDO anterior.
--
-- POR QUE ESO ES ACEPTABLE, Y NO UN DESCUIDO. Dos razones, y las dos son medidas, no
-- opiniones:
--   1. `status` NO participaba de ninguna decision de dinero en el camino de liquidacion:
--      nunca entro en el `WHERE` del resolver. Esa era literalmente la deuda (g) de la
--      feature 69. Restaurar todo a `activo` reproduce exactamente el comportamiento que ese
--      camino tenia, porque para el la columna era inerte.
--   2. La feature 70 midio CERO tarifas `inactivo` en produccion. El conjunto de valores que
--      este `down` no puede traer de vuelta esta, hoy, vacio.
-- Si algun dia se vuelve a introducir el concepto, la pregunta que hay que responder primero
-- es la que la 274 respondio con un no: que hace `status` en la seleccion de la fila vigente.
--
-- Orden: inverso al `up` -primero el tipo, porque la columna lo necesita para existir-.
-- Idempotente: el bloque `DO` traga el `duplicate_object` si el tipo ya esta, y la columna
-- usa `IF NOT EXISTS`. `CREATE TYPE` no admite `IF NOT EXISTS` en Postgres; de ahi el bloque.
DO $$ BEGIN
  CREATE TYPE "estado_tarifa" AS ENUM ('activo', 'inactivo');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "tarifas"
  ADD COLUMN IF NOT EXISTS "status" "estado_tarifa" NOT NULL DEFAULT 'activo';
