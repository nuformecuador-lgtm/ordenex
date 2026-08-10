-- DOWN (R37): revierte EXACTAMENTE `migration.sql` y deja el esquema previo, ni mas ni
-- menos. Los dos `DROP TABLE` arrastran consigo TODO lo que el UP creo sobre esas tablas:
-- las PKs, los cuatro indices (los tres unicos totales y el unico PARCIAL de `posicion`),
-- las dos FKs, los seis CHECK, los doce `COMMENT ON` y la configuracion de RLS. Patron del
-- down.sql de `ruta_optimizada` / `analytics_daily`.
--
-- EL ORDEN NO ES COSMETICO: primero el DETALLE, que tiene la FK hacia la cabecera; despues
-- la cabecera. Al reves, el `DROP TABLE "ranking_snapshot_dia"` fallaria por la dependencia
-- (y `CASCADE` no se usa a proposito: si algun dia existiera una dependencia no prevista,
-- lo correcto es que el rollback FALLE y no que arrastre en silencio un objeto ajeno).
--
-- SIN `DROP TYPE`: la migracion no crea ningun enum.
-- SIN `ALTER TABLE` sobre ninguna tabla preexistente: `usuario` no se toco en el UP, asi que
-- tampoco aqui. Revertir esta migracion NO pierde ningun dato ajeno al snapshot.
DROP TABLE IF EXISTS "ranking_snapshot_fila";
DROP TABLE IF EXISTS "ranking_snapshot_dia";
