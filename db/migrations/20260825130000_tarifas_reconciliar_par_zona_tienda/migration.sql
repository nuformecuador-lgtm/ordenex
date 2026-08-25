-- `tarifas`: RECONCILIACION. Repone las tres cosas que la
-- `20260824140000_tarifa_zona_is_default` dice hacer y que en algunas bases NO se
-- hicieron: `tienda_id` OPCIONAL, el borrado FISICO (`deleted_at` fuera) y el unico
-- `(zona_id, tienda_id)` con NULLS NOT DISTINCT.
--
-- POR QUE EXISTE ESTA MIGRACION. El `.sql` de la 20260824140000 se EDITO despues de
-- haberse aplicado: la base de desarrollo local lo corrio el 2026-08-24 a las 10:03 UTC
-- con una version corta (solo `ADD COLUMN zona_id` + `is_default`) y el commit b7bd887a
-- le anadio la segunda mitad mas tarde ese mismo dia. Prisma registra la migracion POR
-- NOMBRE: una vez que la fila esta en `_prisma_migrations`, el archivo no se vuelve a
-- ejecutar nunca, por mucho que crezca.
--
-- Y NO HAY NINGUNA ALARMA QUE LO DIGA. Se comprobo, no se supone:
--   * `prisma migrate status` responde «Database schema is up to date!» sobre la base a
--     medias — solo mira la tabla de migraciones, no el esquema real.
--   * `prisma migrate deploy` responde «No pending migrations to apply.» aunque el
--     checksum guardado (f774cb92…) no coincida con el del archivo (d9bc4768…).
-- Es decir: toda base que aplicara la version corta se quedo sin la mitad del cambio y
-- ningun despliegue lo iba a delatar. El sintoma en la app era un 500 al crear una tarifa
-- de zona sin tienda (`tienda_id` NULL contra un NOT NULL que deberia haberse aflojado).
--
-- POR QUE UNA MIGRACION NUEVA Y NO «RE-APLICAR» LA VIEJA. Reescribir el checksum en
-- `_prisma_migrations` a mano, base por base, no deja rastro en el repo y hay que acertar
-- en todos los entornos. Una migracion nueva la aplica el mismo despliegue de siempre y
-- queda registrada donde se registra todo lo demas.
--
-- ES IDEMPOTENTE A PROPOSITO, y esa es la propiedad que la hace segura: no sabemos —ni
-- necesitamos saber— si una base concreta aplico la version corta o la larga. Cada bloque
-- comprueba el estado antes de tocar nada, asi que sobre una base YA correcta esta
-- migracion no ejecuta un solo DDL. CERO efecto donde ya esta bien; reparacion donde no.

-- ---------------------------------------------------------------------------
-- 1. `tienda_id` OPCIONAL.
-- ---------------------------------------------------------------------------
-- NULL = «tarifa no acotada a ninguna tienda» (aplica a cualquiera), el nivel 3 de la
-- cascada de la feature 274. `DROP NOT NULL` sobre una columna que ya es nullable es un
-- no-op en Postgres: no hace falta condicionarlo, y no toca ni una fila.
ALTER TABLE "tarifas" ALTER COLUMN "tienda_id" DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Borrado FISICO: se va `deleted_at`.
-- ---------------------------------------------------------------------------
-- Todo el bloque va condicionado a que la columna EXISTA: en una base que ya aplico la
-- version larga, `deleted_at` no esta y aqui no se ejecuta nada. Las sentencias van por
-- EXECUTE (dinamico) para que Postgres no tenga que resolver el nombre de una columna
-- ausente ni siquiera al planificar.
--
-- LA DETECCION VA POR `'"tarifas"'::regclass`, NO POR `current_schema()`. Las dos aciertan en
-- un despliegue real, pero solo la primera es COMPROBABLE: el test de esta migracion aplica el
-- SQL en un esquema desechable reescribiendo los identificadores de tabla (`"tarifas"` ->
-- `"tmp"."tarifas"`), porque un `SET search_path` no viaja con la sentencia cuando el pool la
-- sirve por otra conexion. Con `current_schema()` las guardas mirarian `public` mientras el DDL
-- toca el esquema temporal, y el test pasaria en verde sin haber ejercido nada. `regclass`
-- resuelve la MISMA tabla que la sentencia va a modificar, aqui y alla.
--
-- PREFLIGHT, igual que en la migracion original: `cierre_detail.tarifa_id` referencia
-- `tarifas` con ON DELETE RESTRICT. Si una tarifa borrada en logico fue usada por un
-- cierre, el DELETE la rechazaria y abortaria la transaccion con un mensaje sobre una fila
-- suelta. Se comprueba antes para poder decirlo con palabras, y NO se resuelve de oficio:
-- aflojar esa FK romperia el vinculo auditable entre el cierre y la tarifa que lo produjo,
-- y eso es una decision de negocio sobre datos de dinero.
--
-- PERDIDA DE DATO DECLARADA: las filas borradas en logico se van FISICAMENTE, sin copia.
DO $$
DECLARE atadas integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = '"tarifas"'::regclass
      AND attname = 'deleted_at' AND attnum > 0 AND NOT attisdropped
  ) THEN
    EXECUTE $q$
      SELECT count(*) FROM "tarifas" t
      WHERE t."deleted_at" IS NOT NULL
        AND EXISTS (SELECT 1 FROM "cierre_detail" cd WHERE cd."tarifa_id" = t."id")
    $q$ INTO atadas;

    IF atadas > 0 THEN
      RAISE EXCEPTION
        'tarifas: % fila(s) borradas en logico estan referenciadas por cierre_detail (FK RESTRICT) y no se pueden purgar. Decida que pasa con esos cierres antes de aplicar esta migracion.',
        atadas;
    END IF;

    EXECUTE 'DELETE FROM "tarifas" WHERE "deleted_at" IS NOT NULL';
    EXECUTE 'ALTER TABLE "tarifas" DROP COLUMN "deleted_at"';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. El unico `(zona_id, tienda_id)` con NULLS NOT DISTINCT.
-- ---------------------------------------------------------------------------
-- `NULLS NOT DISTINCT` (PG15+) es OBLIGATORIO, no un adorno: por defecto Postgres cuenta
-- dos NULL como distintos, asi que un unico normal NO impediria dos «tarifas generales de
-- la tienda X» ni dos globales — justo los casos que el NULL habilita.
--
-- EL NOMBRE NO ES LIBRE: es el que Prisma espera para `@@unique([zonaId, tiendaId])` del
-- modelo `Tarifa`. Se declara alli para que el cliente exponga el `where` compuesto y se
-- crea aqui a mano porque Prisma no sabe expresar la clausula.
--
-- El preflight de duplicados corre DENTRO del `IF NOT EXISTS`: sobre una base que ya tiene
-- el indice no se cuenta nada (y no podria haber duplicados, el indice los impide). Sobre
-- una que no lo tiene, se aborta nombrando cuantos pares chocan en vez de dejar que falle
-- el `CREATE`: DECIDIR CUAL SOBREVIVE ES UNA ELECCION DE NEGOCIO.
DO $$
DECLARE dup_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = '"tarifas"'::regclass
      AND c.relname = 'tarifas_zona_id_tienda_id_key'
  ) THEN
    SELECT count(*) INTO dup_count FROM (
      SELECT 1 FROM "tarifas" GROUP BY "zona_id", "tienda_id" HAVING count(*) > 1
    ) d;

    IF dup_count > 0 THEN
      RAISE EXCEPTION
        'tarifas: % par(es) (zona_id, tienda_id) repetidos. Resuelva cual queda antes de aplicar esta migracion.',
        dup_count;
    END IF;

    EXECUTE 'CREATE UNIQUE INDEX "tarifas_zona_id_tienda_id_key" ON "tarifas" ("zona_id", "tienda_id") NULLS NOT DISTINCT';
  END IF;
END $$;
