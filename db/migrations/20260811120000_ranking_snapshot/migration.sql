-- Feature 196 (design §2, R1/R6/R8/R13/R17/R18/R37/R38): SNAPSHOT DIARIO del ranking de
-- mensajeros. Dos tablas nuevas, cabecera + detalle, patron `ruta_optimizada` /
-- `ruta_optimizada_parada`.
--
-- POR QUE SE CONGELA Y NO SE RECALCULA (design §1): los insumos del orden CAMBIAN — el
-- umbral del podio es configuracion de entorno (`RANKING_MIN_ASIGNADAS`), el premio es una
-- fila editable sin historia (`premio_ranking`) y el comparador es codigo. Recalcular «el
-- ranking del martes» con la configuracion del viernes produce un podio que NADIE vio el
-- martes y que, si hubo premio, contradice LO QUE SE PAGO. Ademas `analytics_daily` no
-- puede responder la pregunta: el denominador del ranking son las ordenes ASIGNADAS ese dia
-- (por la fecha de asignacion de la propia orden) y esa magnitud no tiene columna alli.
--
-- Esta migracion NO nombra la columna de asignacion de `orden` a proposito: no la crea, no
-- la altera y no la lee. Existe un guardia de la feature 192 que censa las migraciones que
-- la MENCIONAN, y citarla aqui —solo para explicar de donde sale el denominador— habria
-- ensuciado ese censo sin aportar nada que no diga ya el modelo de Prisma.
--
-- MIGRACION ADITIVA (R18/R37): dos `CREATE TABLE` nuevas, sus CHECK, sus FK, sus indices,
-- sus `COMMENT ON` y las dos sentencias de RLS. NINGUNA sentencia toca un objeto
-- preexistente: no hay `ALTER`/`DROP` sobre `usuario`, `premio_ranking` ni ninguna otra, y
-- no se mueve un solo dato (ni `INSERT`, ni `UPDATE`, ni `DELETE`). No se crea ningun enum.
--
-- El bloque de `CREATE TABLE` / `CREATE UNIQUE INDEX` / `ADD CONSTRAINT ... FOREIGN KEY` es
-- literalmente el DDL que Prisma deriva de `db/schema.prisma`
-- (`prisma migrate diff --from-schema <schema previo> --to-schema db/schema.prisma
-- --script`, sin conexion a ninguna base). Lo que va a mano detras es lo que Prisma NO sabe
-- expresar en el datamodel: los CHECK, el indice unico PARCIAL, los comentarios y la RLS.

-- CreateTable
CREATE TABLE "ranking_snapshot_dia" (
    "id" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "generado_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "min_asignadas_podio" INTEGER NOT NULL,
    "filas" INTEGER NOT NULL,

    CONSTRAINT "ranking_snapshot_dia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranking_snapshot_fila" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "puesto" INTEGER NOT NULL,
    "posicion" INTEGER,
    "mensajero_id" TEXT NOT NULL,
    "mensajero_nombre" TEXT NOT NULL,
    "entregadas" INTEGER NOT NULL,
    "asignadas" INTEGER NOT NULL,
    "premio_monto" DECIMAL(12,2),
    "premio_descripcion" TEXT,

    CONSTRAINT "ranking_snapshot_fila_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- R13: `fecha` UNIQUE ES la idempotencia del cron. La reejecucion choca contra la BASE
-- (P2002), no contra un `if` del codigo: no hay ventana de carrera entre dos invocaciones
-- simultaneas. No hace falta ningun indice suelto de `fecha`: este ya sirve la unica
-- consulta que existe (igualdad por fecha).
CREATE UNIQUE INDEX "ranking_snapshot_dia_fecha_key" ON "ranking_snapshot_dia"("fecha");

-- CreateIndex
-- R13: un mensajero no puede aparecer dos veces dentro del mismo snapshot. Es ademas el
-- indice de lectura del historico: «todas las filas de un snapshot_id» lo usa por prefijo.
CREATE UNIQUE INDEX "ranking_snapshot_fila_snapshot_id_mensajero_id_key" ON "ranking_snapshot_fila"("snapshot_id", "mensajero_id");

-- CreateIndex
-- R13: dos filas del mismo snapshot no pueden ocupar el mismo puesto.
CREATE UNIQUE INDEX "ranking_snapshot_fila_snapshot_id_puesto_key" ON "ranking_snapshot_fila"("snapshot_id", "puesto");

-- AddForeignKey
-- ON DELETE CASCADE: una fila no significa NADA sin su cabecera (patron
-- `ruta_optimizada_parada`).
ALTER TABLE "ranking_snapshot_fila" ADD CONSTRAINT "ranking_snapshot_fila_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "ranking_snapshot_dia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- R17 — ON DELETE RESTRICT, igual que las cuatro FK de `analytics_daily`: borrar un usuario
-- con historia congelada debe FALLAR, no dejar el snapshot huerfano ni reescribirlo. El
-- nombre congelado (`mensajero_nombre`, R16) resuelve el caso real —el renombrado— sin
-- necesidad de una FK nullable con SET NULL.
ALTER TABLE "ranking_snapshot_fila" ADD CONSTRAINT "ranking_snapshot_fila_mensajero_id_fkey" FOREIGN KEY ("mensajero_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ==========================================================================================
-- LO QUE PRISMA NO EXPRESA EN EL DATAMODEL (va a mano, y por eso lleva su motivo escrito)
-- ==========================================================================================

-- R13 — UNIQUE PARCIAL: dos filas del mismo snapshot no pueden ocupar la misma posicion de
-- PODIO, pero SI puede haber muchas filas con `posicion IS NULL` (todo el que no hizo podio).
-- Prisma NO sabe expresar un indice parcial (no hay `WHERE` en `@@unique`), asi que este
-- indice queda HUERFANO del datamodel. Precedentes explicitos del repo:
-- `wallet_movimiento_origen_categoria_uq`, `cierre_bodega_zona_solicitado_uq` y los dos de
-- `20260803140000_purga_pdf_indices`. Consecuencia conocida y ACEPTADA: un
-- `prisma migrate dev --create-only` futuro puede proponer un `DROP INDEX` fantasma de este
-- indice. Eso NUNCA se resuelve borrando el indice: se descarta la migracion propuesta.
-- (Declararlo como `@@unique([snapshotId, posicion])` no seria equivalente: seria un indice
-- TOTAL y cargaria con todas las filas fuera de podio sin ninguna necesidad.)
CREATE UNIQUE INDEX "ranking_snapshot_fila_snapshot_id_posicion_uq"
  ON "ranking_snapshot_fila" ("snapshot_id", "posicion")
  WHERE "posicion" IS NOT NULL;

-- R1 — el umbral congelado es el APLICADO en la corrida, y un umbral de podio menor que 1
-- no significa nada.
ALTER TABLE "ranking_snapshot_dia"
  ADD CONSTRAINT "ranking_snapshot_dia_min_asignadas_podio_check"
  CHECK ("min_asignadas_podio" >= 1);

-- R1/R11 — el conteo congelado nunca es negativo; `0` es un valor LEGITIMO (dia sin
-- actividad), distinto de la ausencia de cabecera.
ALTER TABLE "ranking_snapshot_dia"
  ADD CONSTRAINT "ranking_snapshot_dia_filas_check"
  CHECK ("filas" >= 0);

-- R6/R25 — el puesto es 1..N: no existe el puesto 0 ni el negativo.
ALTER TABLE "ranking_snapshot_fila"
  ADD CONSTRAINT "ranking_snapshot_fila_puesto_check"
  CHECK ("puesto" >= 1);

-- R6/R9 — la posicion de podio, si existe, es 1, 2 o 3 y ninguna otra. `NULL` significa
-- «listado sin podio» (no alcanzo el umbral, o el podio ya estaba lleno), nunca «se
-- desconoce».
ALTER TABLE "ranking_snapshot_fila"
  ADD CONSTRAINT "ranking_snapshot_fila_posicion_check"
  CHECK ("posicion" IS NULL OR "posicion" IN (1, 2, 3));

-- Conteos no negativos. NO hay CHECK `entregadas <= asignadas`, y es DELIBERADO (design
-- §2.2): las dos magnitudes salen de fuentes distintas (la fecha de la gestion vs la fecha
-- de asignacion de la orden), asi que una orden asignada ayer y entregada hoy hace
-- `entregadas > asignadas` legitimamente y el `pct` pasa de 100. Es el comportamiento del
-- ranking en vivo; un CHECK aqui tumbaria el cron un dia cualquiera.
ALTER TABLE "ranking_snapshot_fila"
  ADD CONSTRAINT "ranking_snapshot_fila_conteos_no_negativos"
  CHECK ("entregadas" >= 0 AND "asignadas" >= 0);

-- R8 — SIN PODIO, SIN PREMIO. Una fila que no ocupa posicion de podio no puede llevar
-- monto ni descripcion de premio congelados. La regla vive en la BASE y no solo en el
-- service porque es justo el dato que hace auditable lo que se pago: un premio pegado a una
-- fila sin podio seria dinero atribuido a nadie.
ALTER TABLE "ranking_snapshot_fila"
  ADD CONSTRAINT "ranking_snapshot_fila_premio_sin_posicion_check"
  CHECK ("posicion" IS NOT NULL OR ("premio_monto" IS NULL AND "premio_descripcion" IS NULL));

-- ==========================================================================================
-- SEMANTICA EN LA BASE (patron `analytics_daily`): lo que un lector del esquema no puede
-- deducir mirando los tipos.
-- ==========================================================================================

COMMENT ON TABLE "ranking_snapshot_dia" IS
  'Feature 196 — CABECERA del ranking CONGELADO de una fecha calendario de Costa Rica. INMUTABLE: una vez escrita no se actualiza NUNCA (por eso no hay updated_at). La existencia de la cabecera y su conteo `filas` son dos hechos DISTINTOS: sin cabecera = el cron no corrio esa fecha, y cabecera con filas = 0 = ese dia no hubo actividad.';

COMMENT ON COLUMN "ranking_snapshot_dia"."fecha" IS
  'Fecha calendario de COSTA RICA (UTC-6 fijo) a medianoche UTC, convencion DATE del repo. NO es el `desde` de la ventana del dia. UNIQUE: esta restriccion ES la idempotencia del cron.';

COMMENT ON COLUMN "ranking_snapshot_dia"."generado_at" IS
  'Instante en que el cron congelo esta fecha. Es la evidencia de que corrio y de CUANDO, y lo que deja auditable el desfase del premio: el premio se congela tal como este vigente en ESTE instante, no a las 23:59 CR del dia congelado (premio_ranking no tiene historia).';

COMMENT ON COLUMN "ranking_snapshot_dia"."min_asignadas_podio" IS
  'Umbral minimo de asignadas APLICADO en esta corrida (RANKING_MIN_ASIGNADAS). Se congela porque es configuracion de entorno: sin el, un cambio de la variable haria inexplicable el podio de las fechas ya congeladas.';

COMMENT ON COLUMN "ranking_snapshot_dia"."filas" IS
  'Numero de filas congeladas. 0 es un valor LEGITIMO y significa "ese dia no hubo actividad", que no hay que confundir con la ausencia de cabecera, que significa "el cron no corrio esa fecha".';

COMMENT ON TABLE "ranking_snapshot_fila" IS
  'Feature 196 — DETALLE: una fila por mensajero CON ACTIVIDAD (entregadas > 0 o asignadas > 0) en la fecha congelada. INMUTABLE y de SOLO LECTURA: fuera del congelado del cron ninguna superficie del sistema escribe aqui. El snapshot es redundante respecto de los datos crudos y PUEDE divergir de lo que hoy calcularia el ranking en vivo: eso no es un defecto, es el objetivo.';

COMMENT ON COLUMN "ranking_snapshot_fila"."puesto" IS
  'Posicion en la lista completa congelada (1..N), exista o no podio. EL ORDEN CONGELADO ES DATO, NO DERIVACION: la lectura hace ORDER BY puesto y JAMAS reordena ni recalcula posiciones.';

COMMENT ON COLUMN "ranking_snapshot_fila"."posicion" IS
  'Posicion de PODIO (1, 2 o 3) o NULL. NULL significa "listado sin podio" —no alcanzo el umbral min_asignadas_podio, o el podio ya estaba ocupado por tres elegibles—, NUNCA "se desconoce". Unico parcial: dentro de un snapshot no se repite una posicion no nula.';

COMMENT ON COLUMN "ranking_snapshot_fila"."mensajero_nombre" IS
  'Nombre del mensajero TAL COMO ESTABA al congelar. Un renombrado posterior NO reescribe la historia: el historico se lee de aqui, nunca de usuario.nombre.';

COMMENT ON COLUMN "ranking_snapshot_fila"."entregadas" IS
  'Numerador del dia: entregas vigentes contadas por el ranking (por gestion_orden.created_at en la ventana CR). El porcentaje NO se persiste: se deriva de entregadas/asignadas con el mismo redondeo que el ranking en vivo.';

COMMENT ON COLUMN "ranking_snapshot_fila"."asignadas" IS
  'Denominador del dia: ordenes asignadas al mensajero en la ventana CR (por la fecha de asignacion de la orden). Puede ser MENOR que entregadas —fuentes distintas: una orden asignada ayer y entregada hoy— y entonces el porcentaje pasa de 100. Por eso NO existe un CHECK entregadas <= asignadas.';

COMMENT ON COLUMN "ranking_snapshot_fila"."premio_monto" IS
  'Monto del premio congelado, en colones, solo para filas de podio (CHECK ranking_snapshot_fila_premio_sin_posicion_check). NULL en una fila de podio significa "esa posicion no tenia premio configurado", que es distinto de cero.';

-- R38 — RLS habilitada SIN policies (solo service role), patron ruta_optimizada /
-- geocode_cache / analytics_daily. Este repo no usa Supabase Auth (sesion propia, sin
-- `auth.uid()`), asi que el recorte por rol lo aplica el servidor. Son datos de rendimiento
-- de PERSONAS IDENTIFICADAS: no se acceden desde el cliente bajo ninguna circunstancia.
ALTER TABLE "ranking_snapshot_dia" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ranking_snapshot_fila" ENABLE ROW LEVEL SECURITY;
