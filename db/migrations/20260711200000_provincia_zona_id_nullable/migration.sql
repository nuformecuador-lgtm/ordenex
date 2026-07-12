-- Geografia poblable sin zonas: la asignacion de zona es posterior/opcional, asi
-- que provincia.zona_id pasa a ser NULLABLE. Permite sembrar provincia/canton/
-- distrito (seed geografico) sin depender del catalogo de zonas.
ALTER TABLE "provincia" ALTER COLUMN "zona_id" DROP NOT NULL;
