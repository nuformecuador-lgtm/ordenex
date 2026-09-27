-- DOWN (ficha 429) — revierte EXACTAMENTE `migration.sql`: quita las tres columnas de `zona`.
--
-- ⚠️ DATO PERDIDO AL REVERTIR, DECLARADO: los SINPE por bodega y las fechas de revision. Es
-- aceptable porque `scripts/seed-sinpe-inicial.ts` los puede reconstruir a un estado EQUIVALENTE
-- al de antes de esta ficha (uno solo para todas, el de la variable de entorno), que es
-- exactamente lo que habia. Lo que NO se puede reconstruir son las correcciones que cada bodega
-- haya hecho por su cuenta desde el despliegue: si alguna ya corrigio su numero, este `down`
-- se la lleva. Primero se mira `historial_accion` con `accion = 'zona_sinpe_cambiado'`.
--
-- `IF EXISTS` en las tres: este `down` tiene que poder correr tambien cuando el `down` de
-- `20260918120200_zona_sinpe_no_nulo` ya quito los `CHECK` y dejo las columnas nullables — que es
-- el orden real de un rollback (`db:rollback` va de la ULTIMA hacia atras).
--
-- NO se toca ninguna otra columna de `zona`, ni la RLS, ni ningun indice.

ALTER TABLE "zona" DROP COLUMN IF EXISTS "sinpe_revisado_at";
ALTER TABLE "zona" DROP COLUMN IF EXISTS "sinpe_nombre";
ALTER TABLE "zona" DROP COLUMN IF EXISTS "sinpe_numero";
