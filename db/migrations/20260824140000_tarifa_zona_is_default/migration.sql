-- `tarifas`: vuelve `zona_id` (AHORA OPCIONAL) y nace `is_default`.
--
-- CONTEXTO QUE NO SE PUEDE OMITIR: `zona_id` YA EXISTIO en esta tabla y la migracion
-- `20260712100000_tarifa_tienda_status` la ELIMINO, cuando la tarifa dejo de colgar de la zona
-- (feature 24) y paso a colgar de la TIENDA. Esto NO deshace aquella decision: la tarifa sigue
-- siendo por-tienda (`tienda_id` sigue siendo NOT NULL y no se toca). Lo que se agrega es la
-- posibilidad de que una tienda tenga, ADEMAS de su tarifa general, tarifas ACOTADAS a una zona.
--
-- POR QUE `zona_id` ES NULLABLE Y NO PUEDE SER OTRA COSA. `NULL` significa «esta tarifa no esta
-- acotada a ninguna zona»: aplica a la tienda entera. Todas las filas existentes son exactamente
-- eso, asi que quedan en `NULL` sin backfill. Ponerla NOT NULL exigiria inventar una zona para
-- cada fila viva, que es un dato que nadie eligio.
--
-- POR QUE LA FK ES RESTRICT. Mismo patron que `orden.zona_id` y que la `zona_id` original de esta
-- misma tabla (ver la 20260712100000): no se permite borrar una zona que alguna tarifa referencia.
-- `ON UPDATE CASCADE` por coherencia con el resto de FKs del repo.
--
-- EL INDICE: `tarifas_zona_id_idx`, mismo nombre que tenia antes de que la 20260712100000 lo
-- soltara. La consulta que lo justifica es «las tarifas de esta zona»; sin el, un recorrido de
-- tabla. Es el mismo indice que ya vivio aqui, con el mismo nombre, para que quien lea el
-- historial vea que se REPONE y no que se inventa uno nuevo.
--
-- `is_default`: marca la tarifa que se usa cuando ninguna acotada por zona aplica. NOT NULL con
-- DEFAULT false, de modo que toda fila NUEVA nace NO siendo la de por defecto: elegir la default
-- es un acto explicito, no un accidente de insercion.
ALTER TABLE "tarifas" ADD COLUMN "zona_id" TEXT;
ALTER TABLE "tarifas" ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "tarifas_zona_id_idx" ON "tarifas"("zona_id");
ALTER TABLE "tarifas" ADD CONSTRAINT "tarifas_zona_id_fkey"
  FOREIGN KEY ("zona_id") REFERENCES "zona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BACKFILL — y aqui el DEFAULT y el dato historico dicen cosas distintas A PROPOSITO.
--
-- Toda fila que ya existia nacio ANTES de que hubiera tarifas por zona: no esta acotada a ninguna
-- (`zona_id IS NULL`) y es, por definicion, la tarifa que se le aplica hoy a esa tienda. Es decir:
-- YA ES la de por defecto, aunque la columna no existiera para decirlo. Dejarlas en `false` seria
-- escribir en la base algo que NO es cierto del sistema en produccion, y dejaria a cada tienda sin
-- ninguna tarifa marcada como default -sin fila a la que caer cuando ninguna zona aplique-.
--
-- Por eso el DEFAULT de la columna (`false`, para lo que venga) y el valor de las filas historicas
-- (`true`, para lo que ya hay) difieren: no es una inconsistencia, es la diferencia entre «una
-- tarifa nueva no es default hasta que alguien lo diga» y «las que ya existian si lo eran».
--
-- Se actualizan TODAS las filas, tambien las inactivas: para una fila que nadie lee el flag es
-- inerte, y acotar el UPDATE seria dejar un subconjunto con un valor que no significa nada. Sin
-- `WHERE`, tal como se pidio. (Las borradas en logico se purgan mas abajo, asi que el valor que
-- reciban aqui no sobrevive a esta misma migracion.)
UPDATE "tarifas" SET "is_default" = true;

-- ============================================================================
-- `tienda_id` PASA A OPCIONAL, el borrado de `tarifas` PASA A SER FISICO, y nace
-- el unico `(zona_id, tienda_id)`.
-- ============================================================================
--
-- QUE SIGNIFICA CADA NULL AHORA. Las dos columnas del par son opcionales y cada
-- NULL quiere decir «sin acotar por esa dimension»:
--   (tienda, zona) -> tarifa de esa tienda acotada a esa zona.
--   (tienda, NULL) -> tarifa general de esa tienda, cualquier zona.
--   (NULL,  zona)  -> tarifa de esa zona para cualquier tienda.
--   (NULL,  NULL)  -> tarifa global; el ultimo lugar donde caer.
-- Esto NO reabre la discusion de la 20260712100000 (la tarifa dejo de colgar de
-- la zona y paso a colgar de la tienda): la tienda sigue siendo la dimension
-- principal. Lo que se admite es que una fila no la fije, para poder expresar
-- reglas mas generales sin duplicar una tarifa por cada tienda.
--
-- POR QUE `DROP NOT NULL` Y NO UNA COLUMNA NUEVA: el dato de las filas vivas no
-- cambia -todas siguen apuntando a su tienda-, solo se relaja la exigencia para
-- las que vengan. No hay backfill: aflojar un NOT NULL no toca ninguna fila.
-- La FK a `usuario` y el indice `tarifas_tienda_id_idx` se quedan como estan;
-- una FK con valor NULL simplemente no se comprueba.
ALTER TABLE "tarifas" ALTER COLUMN "tienda_id" DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- HARD DELETE: `tarifas` deja de borrar en logico.
-- ---------------------------------------------------------------------------
--
-- Hasta hoy borrar una tarifa era escribir `deleted_at` y filtrarla en cada
-- lectura (R19/R24/R25). Se abandona ese esquema: borrar una tarifa es sacarla
-- de la tabla. Sin esto el unico de mas abajo no podria ser TOTAL -una fila
-- borrada seguiria ocupando su par `(zona, tienda)` para siempre, haciendo
-- imposible volver a crear esa tarifa-, y la unicidad tendria que ser parcial,
-- que es justo lo que Prisma no sabe expresar.
--
-- PERDIDA DE DATO DECLARADA, IRREVERSIBLE: las filas que hoy estan borradas en
-- logico se van FISICAMENTE. No hay copia en ninguna otra tabla. El `down` NO
-- las puede traer de vuelta y asi lo dice.
--
-- QUE NO SE PIERDE: la tarifa que liquido un cierre NO vive aqui. `cierre_detail`
-- CONGELA sus montos en columnas propias (`tarifa_valor_flete`, etc., R8), asi
-- que la auditoria de la deuda sobrevive a que la fila de origen desaparezca.
--
-- PREFLIGHT. `cierre_detail.tarifa_id` referencia `tarifas` con ON DELETE
-- RESTRICT: si una tarifa borrada en logico fue usada por un cierre, el DELETE
-- la rechaza y aborta la transaccion. Se comprueba antes para poder decirlo con
-- palabras -y NO se resuelve de oficio: aflojar esa FK a SET NULL romperia el
-- vinculo auditable entre el cierre y la tarifa que lo produjo, y esa es una
-- decision de negocio sobre datos de dinero, no un tramite de esta migracion.
DO $$
DECLARE atadas integer;
BEGIN
  SELECT count(*) INTO atadas
  FROM "tarifas" t
  WHERE t."deleted_at" IS NOT NULL
    AND EXISTS (SELECT 1 FROM "cierre_detail" cd WHERE cd."tarifa_id" = t."id");
  IF atadas > 0 THEN
    RAISE EXCEPTION
      'tarifas: % fila(s) borradas en logico estan referenciadas por cierre_detail (FK RESTRICT) y no se pueden purgar. Decida que pasa con esos cierres antes de aplicar esta migracion.',
      atadas;
  END IF;
END $$;

DELETE FROM "tarifas" WHERE "deleted_at" IS NOT NULL;

-- La columna se va con ellas: dejarla sin que nadie la escriba seria peor que no
-- tenerla -invita a filtrar por un dato que ya no significa nada-.
ALTER TABLE "tarifas" DROP COLUMN "deleted_at";

-- ---------------------------------------------------------------------------
-- EL UNICO `(zona_id, tienda_id)`.
-- ---------------------------------------------------------------------------
--
-- PREFLIGHT. Con `NULLS NOT DISTINCT` dos tarifas de la misma tienda sin zona
-- pasan a ser un duplicado, y hasta hoy nada lo impedia. Si las hay, el
-- `CREATE UNIQUE INDEX` fallaria igual, pero con un mensaje que nombra una fila
-- suelta y no el problema. Se aborta antes y se dice cuantos pares chocan:
-- DECIDIR CUAL SOBREVIVE ES UNA ELECCION DE NEGOCIO, no de esta migracion, y
-- borrar tarifas vivas por nuestra cuenta no esta sobre la mesa. Corre DESPUES
-- de la purga, para que las ya borradas no cuenten como conflicto.
DO $$
DECLARE dup_count integer;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT 1 FROM "tarifas"
    GROUP BY "zona_id", "tienda_id"
    HAVING count(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'tarifas: % par(es) (zona_id, tienda_id) repetidos. Resuelva cual queda antes de aplicar esta migracion.',
      dup_count;
  END IF;
END $$;

-- `NULLS NOT DISTINCT` (PG15+) es OBLIGATORIO aqui, no un adorno. Por defecto
-- Postgres considera que dos NULL son distintos, asi que un unico normal NO
-- impediria dos «tarifas generales de la tienda X» ni dos «tarifas globales»:
-- dejaria sin proteger justo los casos que el NULL habilita. Mismo patron y
-- misma razon que `tarifa_zona_mensajero_zona_id_vehiculo_id_key` (feature 24).
--
-- EL NOMBRE NO ES LIBRE: es el que Prisma espera para `@@unique([zonaId,
-- tiendaId])` en el modelo `Tarifa`. Se declara alli para que el cliente exponga
-- el `where` compuesto, y se CREA aqui porque Prisma no expresa NULLS NOT
-- DISTINCT; si el nombre no coincidiera, `migrate` veria un indice de mas y uno
-- de menos y volveria a crearlo sin la clausula.
CREATE UNIQUE INDEX "tarifas_zona_id_tienda_id_key"
  ON "tarifas" ("zona_id", "tienda_id")
  NULLS NOT DISTINCT;
