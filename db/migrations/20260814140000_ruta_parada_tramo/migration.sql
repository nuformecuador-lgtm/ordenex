-- Feature 92 (seguimiento) — el trazado, ademas de entero, partido en TRAMOS.
--
-- Que hace: anade TRES columnas NULLABLE a `ruta_optimizada_parada`. Nada mas.
--
-- POR QUE AQUI Y NO EN LA CABECERA. Un tramo es «lo que hay entre la parada anterior y ESTA»,
-- asi que su dueño natural es la fila de la parada. Guardarlos como un array en la cabecera
-- obligaria a mantener a mano la correspondencia posicion<->tramo, y esa correspondencia es
-- justamente lo que ya garantizan los dos indices unicos de esta tabla. La fila 1 guarda el
-- tramo origen -> primera parada; la fila N, el de la parada N-1 -> N.
--
-- ⚠️ NO CUESTA UNA LLAMADA MAS. Google devuelve los `legs` en la MISMA respuesta que la
-- polilinea global; solo habia que pedirlos en el `FieldMask`. Esta migracion no habilita
-- ningun gasto nuevo: habilita APROVECHAR lo que ya se estaba pagando y se tiraba.
--
-- ADITIVA Y NO BLOQUEANTE: `ADD COLUMN` nullable y sin DEFAULT no reescribe la tabla.
--
-- ⛔ SIN BACKFILL, por lo mismo que la migracion del trazado: no hay tramo que asignar a las
-- rutas ya calculadas y reconstruirlo exigiria volver a pagar. Se llenan en la siguiente
-- sincronizacion. Mientras tanto son NULL y la UI se comporta como antes.
--
-- INVALIDACION: estas columnas NO necesitan limpieza propia. `reemplazarSecuencia` BORRA las
-- filas enteras de esta tabla y las vuelve a insertar en cada recalculo, asi que un tramo
-- viejo no puede sobrevivir a un cambio de secuencia — que es el fallo que si habia que evitar
-- a mano en la cabecera.
--
-- PII (R14): un tramo es la geometria entre dos domicilios. Misma postura que el resto de la
-- tabla, que ya tiene RLS habilitada sin policies (solo service role) y no se toca aqui. No se
-- loguea NUNCA.

-- Polilinea codificada del tramo que LLEGA a esta parada.
ALTER TABLE "ruta_optimizada_parada" ADD COLUMN "tramo_polilinea" TEXT;

-- Metros del tramo. NULL si el proveedor no los devolvio.
ALTER TABLE "ruta_optimizada_parada" ADD COLUMN "tramo_distancia_m" INTEGER;

-- Segundos del tramo. NULL si el proveedor no los devolvio, y siempre NULL cuando el trazado
-- salio del fallback local: sin calles no hay tiempo de viaje que estimar.
ALTER TABLE "ruta_optimizada_parada" ADD COLUMN "tramo_duracion_s" INTEGER;
