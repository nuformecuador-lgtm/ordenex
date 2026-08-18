-- DOWN — revierte EXACTAMENTE migration.sql. `DROP TABLE` arrastra la PK
-- (`orden_nota_pkey`), los dos indices (`orden_nota_orden_id_created_at_idx`,
-- `orden_nota_autor_id_idx`), las dos FK (a `orden` y a `usuario`) y la RLS. Mismo texto y
-- mismo razonamiento que el `down.sql` de `orden_mensajero_meta`.
--
-- No lleva DROP TYPE: `rol_value` es un enum PREEXISTENTE que esta migracion reutiliza y no
-- creo; soltarlo aqui se llevaria por delante `rol.value` y media base.
DROP TABLE IF EXISTS "orden_nota";
