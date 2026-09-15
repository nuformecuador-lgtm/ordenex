-- FICHA 425 (B1, design §4.1/§4.2, R1-R4/R21) -- tabla NUEVA `cierre_rechazo_tienda`: el VINCULO DE
-- REVISION entre un cierre del dia y cada RECHAZO DE TIENDA que ese cierre pone delante de quien lo
-- aprueba.
--
-- EL DEFECTO. La 139 hace que la unica salida de `rechazada` sea APROBAR UN CIERRE del mensajero, y
-- la 337 saco del cierre toda gestion nacida en el escritorio de la tienda. Un mensajero cuyas unicas
-- gestiones sueltas son rechazos de tienda no llegaba a tener cierre (la guarda «algo paso» de
-- `crearCierre` hacia rollback), asi que ninguna aprobacion liberaba su orden. Medido en produccion
-- el 2026-09-14: 3 ordenes atascadas (NA-947, NA-981, NA-1103) y 46 rechazos fuera de todo cierre.
--
-- POR QUE TABLA PROPIA Y NO `gestion_orden.cierre_id` (design §3 y §7.1). `cierre_id` es la UNICA
-- llave de los cinco caminos de dinero (caja de Ordenex, libro de la tienda, libro del mensajero,
-- congelado de `pago_mensajero`/`ingreso_bodega_rechazo` y confirmacion fisica). Darsela al rechazo
-- COBRARIA DOS VECES a la tienda el flete de devolucion que la 337 ya cobra por su via propia
-- (24 cobros aprobados, ₡65.088, medido el 2026-09-14) y exigiria escanear paquetes que no vienen
-- con el mensajero. Con esta tabla el rechazo SE VE en el cierre y su aprobacion destraba la orden,
-- sin que exista el dato por el que preguntan los caminos de dinero.
--
-- NI UNA COLUMNA DE IMPORTE (R21). No es una promesa de la capa de arriba: es que no hay donde
-- guardar un importe. Ni DECIMAL, ni NUMERIC, ni MONEY. Lo afirma contra el catalogo real
-- `tests/integration/db/cierre-rechazo-tienda-migration.test.ts`.
--
-- SIN BACKFILL, y es una decision (design §4.2): ningun cierre existente se llevo un rechazo porque
-- el mecanismo no existia, asi que una lista vacia en un cierre viejo es un hecho CIERTO. Los 46
-- rechazos historicos entran solos en el SIGUIENTE cierre de cada mensajero (D3).
--
-- ADITIVA: no altera ninguna tabla existente, no crea enums y no toca ningun `down.sql` anterior.
--
-- EL TIMESTAMP (20260917120200) SE ESCRIBE A MANO y es POSTERIOR a la ultima migracion del arbol
-- (20260917120100_notificacion_evento_traspaso). JAMAS RENUMERAR una carpeta ya aplicada.

-- 1) tabla (fila INMUTABLE: sin updated_at ni deleted_at, molde `cierre_sin_gestion` de la 264).
CREATE TABLE "cierre_rechazo_tienda" (
  "id" TEXT NOT NULL,
  "cierre_id" TEXT NOT NULL,
  "gestion_id" TEXT NOT NULL,
  "orden_id" TEXT NOT NULL,

  -- Descriptivos CONGELADOS al incorporar: copia, no identidad (69/T18). `num_guia` SIN UNIQUE.
  "num_guia" INTEGER,
  "num_remision" TEXT NOT NULL,
  "destinatario" TEXT NOT NULL,
  "producto" TEXT NOT NULL,
  "tienda_nombre" TEXT NOT NULL,
  "zona_nombre" TEXT NOT NULL,

  -- R15: la EDAD del rechazo (`gestion_orden.created_at` de la gestion), que es lo que evita que un
  -- documento con tres semanas de rechazos parezca un error (D3). Y el motivo que escribio la tienda.
  "rechazado_at" TIMESTAMP(3) NOT NULL,
  "motivo" TEXT,

  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cierre_rechazo_tienda_pkey" PRIMARY KEY ("id")
);

-- 2) R3: el UNIQUE va en `gestion_id` y NO en el par (cierre_id, gestion_id). El par admitiria que
-- dos cierres se llevaran la misma gestion con dos filas validas; asi, «una sola vez en toda su vida»
-- lo impone Postgres. Es tambien la red del `skipDuplicates` de la escritura (R4) y de la carrera
-- entre dos creaciones de cierre concurrentes.
CREATE UNIQUE INDEX "cierre_rechazo_tienda_gestion_id_key" ON "cierre_rechazo_tienda"("gestion_id");

-- La ruta caliente: el detalle del cierre filtra por `cierre_id`.
CREATE INDEX "cierre_rechazo_tienda_cierre_id_idx" ON "cierre_rechazo_tienda"("cierre_id");

-- «¿En que cierre se reviso este paquete?» sin pasar por la gestion.
CREATE INDEX "cierre_rechazo_tienda_orden_id_idx" ON "cierre_rechazo_tienda"("orden_id");

-- 3) Las 3 FKs, todas RESTRICT (molde `cierre_sin_gestion`): ninguna de esas tablas borra
-- fisicamente, asi que el vinculo nunca queda huerfano.
ALTER TABLE "cierre_rechazo_tienda" ADD CONSTRAINT "cierre_rechazo_tienda_cierre_id_fkey"
  FOREIGN KEY ("cierre_id") REFERENCES "cierre_dia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cierre_rechazo_tienda" ADD CONSTRAINT "cierre_rechazo_tienda_gestion_id_fkey"
  FOREIGN KEY ("gestion_id") REFERENCES "gestion_orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cierre_rechazo_tienda" ADD CONSTRAINT "cierre_rechazo_tienda_orden_id_fkey"
  FOREIGN KEY ("orden_id") REFERENCES "orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) R21: RLS habilitada SIN policies. El acceso es por service role via Prisma; sin policies,
-- cualquier rol anon/authenticated que llegue por PostgREST ve cero filas. La tabla lleva
-- destinatario y guia (PII).
ALTER TABLE "cierre_rechazo_tienda" ENABLE ROW LEVEL SECURITY;
