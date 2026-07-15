-- Feature 69 (R1/R2/R6/R7/R8/R10/R11/R24/R25/R26/R27): tabla NUEVA `cierre_detail` — el
-- SNAPSHOT congelado del detalle de cada orden incluida en un cierre del dia.
--
-- El PORQUE (money-critical): los feeds de wallet (42/43) leian `orden`, `zona` y `tarifas`
-- VIVAS dentro de la tx de APROBACION. Editar `monto_cobrar` o la tarifa entre SOLICITAR y
-- APROBAR descuadraba en silencio los `total_*` snapshot del cierre (37/R14) contra los
-- movimientos emitidos a los libros inmutables. Con esta tabla el cierre deja de PREGUNTAR y
-- pasa a RECORDAR: se congela al crear el cierre, en su misma tx (R3).
--
-- Grano (cierre_id, orden_id) via UNIQUE (R2): a lo sumo UNA fila por orden y cierre, aunque
-- la orden acumule varias gestiones vigentes en el (reintentos 46/47).
-- Fila INMUTABLE (patron `orden_historial_estado`, 49/R2): SIN updated_at/deleted_at (R10).
-- Migracion ADITIVA: no altera ninguna tabla existente.
-- Patron: `20260713150000_gasto_fijo_plantilla` (tabla simple) + `20260713120000_orden_historial_estado`
-- (FKs como ALTER TABLE aparte + RLS habilitada sin policies).

-- 1) tabla `cierre_detail` (fila inmutable: sin updated_at/deleted_at, R10).
CREATE TABLE "cierre_detail" (
  "id" TEXT NOT NULL,
  "cierre_id" TEXT NOT NULL,
  "orden_id" TEXT NOT NULL,

  -- money-critical (R6): las ENTRADAS de la formula de derivacion (42/`derivarIngresoOrden`).
  "monto_cobrar" DECIMAL(12,2),
  "cobra_comision" BOOLEAN NOT NULL,
  "zona_id" TEXT NOT NULL,
  "tienda_id" TEXT NOT NULL,
  -- `zona.es_central` EN ESE INSTANTE: es COLUMNA pese al FK a zona porque el flag es MUTABLE
  -- (la 54 lo renombro, la 55 lo administrara). Guardar solo el FK dejaria abierto el vector:
  -- cambiar la zona central re-etiquetaria cierres viejos. Idem los 5 nombres de abajo.
  "es_central" BOOLEAN NOT NULL,

  -- tarifa congelada (R8): todas o ninguna. NULL = la tienda no tenia tarifa vigente al
  -- solicitar (gap R9, decision (c)): conceptos 0.00, NO bloquea el cierre.
  -- `tarifa_id` deja rastro de QUE FILA se uso: es la contrapartida que hace AUDITABLE por
  -- primera vez la deuda (g) (`tarifas.status` no se filtra; design §6.1).
  "tarifa_id" TEXT,
  "tarifa_valor_flete" DECIMAL(12,2),
  "tarifa_valor_flete_gam" DECIMAL(12,2),
  "tarifa_valor_flete_devuelto" DECIMAL(12,2),
  "tarifa_valor_flete_devuelto_gam" DECIMAL(12,2),
  "tarifa_comision_cod" DECIMAL(5,2),
  "tarifa_iva_flete" DECIMAL(5,2),
  "tarifa_iva_comision_cod" DECIMAL(5,2),

  -- descriptivos (R7): lo que el admin ve del cierre (38), congelado.
  -- `num_guia` SIN UNIQUE: aqui es una COPIA, no la identidad de la orden.
  "num_guia" INTEGER,
  "num_remision" TEXT NOT NULL,
  "destinatario" TEXT NOT NULL,
  "direccion" TEXT,
  "producto" TEXT NOT NULL,
  "tienda_nombre" TEXT NOT NULL,
  "zona_nombre" TEXT NOT NULL,
  "provincia_nombre" TEXT NOT NULL,
  "canton_nombre" TEXT NOT NULL,
  "distrito_nombre" TEXT,

  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cierre_detail_pkey" PRIMARY KEY ("id")
);

-- 2) R2: el GRANO (cierre, orden). Es tambien el indice de la ruta caliente: los feeds de
-- wallet filtran por `cierre_id` al aprobar.
CREATE UNIQUE INDEX "cierre_detail_cierre_id_orden_id_key" ON "cierre_detail"("cierre_id", "orden_id");

-- Trazar en que cierres aparecio una orden.
CREATE INDEX "cierre_detail_orden_id_idx" ON "cierre_detail"("orden_id");

-- 3) Las 5 FKs. Todas RESTRICT es seguro: NINGUNA de esas tablas borra fisicamente
-- (`orden` y `tarifas` usan `deleted_at`), asi que el snapshot nunca queda huerfano.
ALTER TABLE "cierre_detail" ADD CONSTRAINT "cierre_detail_cierre_id_fkey"
  FOREIGN KEY ("cierre_id") REFERENCES "cierre_dia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cierre_detail" ADD CONSTRAINT "cierre_detail_orden_id_fkey"
  FOREIGN KEY ("orden_id") REFERENCES "orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cierre_detail" ADD CONSTRAINT "cierre_detail_zona_id_fkey"
  FOREIGN KEY ("zona_id") REFERENCES "zona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cierre_detail" ADD CONSTRAINT "cierre_detail_tienda_id_fkey"
  FOREIGN KEY ("tienda_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- `tarifa_id` nullable (gap R9): la FK solo aplica cuando hay tarifa congelada.
ALTER TABLE "cierre_detail" ADD CONSTRAINT "cierre_detail_tarifa_id_fkey"
  FOREIGN KEY ("tarifa_id") REFERENCES "tarifas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) R25: RLS habilitada SIN policies (solo service role), patron gestion_orden/cierre_dia/
-- wallet_movimiento. Un acceso con clave anonima es rechazado.
ALTER TABLE "cierre_detail" ENABLE ROW LEVEL SECURITY;

-- 5) BACKFILL (R26/R27) — decision (a): backfill en el UP y lectores SIN fallback.
--
-- Porque backfill y no fallback: un fallback `cierre_detail -> si no hay, orden.*` dejaria
-- vivos PARA SIEMPRE los dos caminos de lectura money-critical, y el camino B es justo el bug
-- que esta feature mata. Con el backfill, "falta la fila" pasa a ser un error DURO (R14) en
-- vez de un descuadre silencioso.
--
-- Riesgo aceptado y explicito (a): congela el valor ACTUAL, que para un cierre ya descuadrado
-- puede no ser el que habia al solicitarlo (no hay historial de `monto_cobrar`: el dato
-- original ya se perdio). El backfill NO repara descuadres pasados; los DETIENE desde hoy.
INSERT INTO "cierre_detail" (
  "id", "cierre_id", "orden_id",
  "monto_cobrar", "cobra_comision", "zona_id", "tienda_id", "es_central",
  "tarifa_id", "tarifa_valor_flete", "tarifa_valor_flete_gam", "tarifa_valor_flete_devuelto",
  "tarifa_valor_flete_devuelto_gam", "tarifa_comision_cod", "tarifa_iva_flete", "tarifa_iva_comision_cod",
  "num_guia", "num_remision", "destinatario", "direccion", "producto",
  "tienda_nombre", "zona_nombre", "provincia_nombre", "canton_nombre", "distrito_nombre",
  "created_at"
)
SELECT
  gen_random_uuid(), sub."cierre_id", sub."orden_id",
  o."monto_cobrar", o."cobra_comision", o."zona_id", o."tienda_id", z."es_central",
  t."id", t."valor_flete", t."valor_flete_gam", t."valor_flete_devuelto",
  t."valor_flete_devuelto_gam", t."comision_cod", t."iva_flete", t."iva_comision_cod",
  o."num_guia", o."num_remision", o."destinatario", o."direccion", o."producto",
  u."nombre", z."nombre", p."nombre", c."nombre", d."nombre",
  CURRENT_TIMESTAMP
-- DISTINCT (cierre_id, orden_id) => grano ORDEN (R2) aunque la orden tenga varias gestiones.
-- `anulada_at IS NULL` => mismo criterio que `crearCierre` (R5/67-R16): una gestion DESHECHA
-- no aporta detalle, igual que no aporta dinero.
FROM (
  SELECT DISTINCT g."cierre_id", g."orden_id"
    FROM "gestion_orden" g
   WHERE g."cierre_id" IS NOT NULL AND g."anulada_at" IS NULL
) sub
JOIN "orden" o         ON o."id" = sub."orden_id"
JOIN "zona" z          ON z."id" = o."zona_id"
JOIN "usuario" u       ON u."id" = o."tienda_id"
JOIN "provincia" p     ON p."id" = o."provincia_id"
JOIN "canton" c        ON c."id" = o."canton_id"
-- El distrito es el UNICO FK nullable de la orden: LEFT JOIN o se perderian filas.
LEFT JOIN "distrito" d ON d."id" = o."distrito_id"
-- Replica EXACTAMENTE la regla del resolver (`TarifaVigentePorTiendaRepository`): por TIENDA
-- (el PR #64 dropeo `tarifas.zona_id`), no borrada, la mas reciente.
-- (g) OVERRIDE DEL HUMANO: NO lleva `AND ta."status" = 'activo'`. Debe coincidir AL CARACTER
-- con el WHERE del resolver: si divergieran, un cierre backfilleado y uno nuevo liquidarian
-- DISTINTO para los mismos datos. Ver el `TODO:` del resolver (R30) y design §6.1.
LEFT JOIN LATERAL (
  SELECT * FROM "tarifas" ta
   WHERE ta."tienda_id" = o."tienda_id" AND ta."deleted_at" IS NULL
   ORDER BY ta."created_at" DESC
   LIMIT 1
) t ON TRUE
-- LEFT JOIN LATERAL => tienda sin tarifa deja las columnas `tarifa_*` en NULL: es el gap
-- (R9), no un fallo.
-- ON CONFLICT DO NOTHING => idempotente: la migracion se puede re-correr tras un rollback.
ON CONFLICT ("cierre_id", "orden_id") DO NOTHING;
