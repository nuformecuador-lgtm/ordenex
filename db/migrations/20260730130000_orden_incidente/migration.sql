-- Feature 158 (T1.19, R37/R38/R39/R47) — camino del ADMIN del estado `incidente`:
--   1) `wallet_origen_tipo` + `orden_incidente`: origen del egreso de la caja principal
--      cuando la indemnizacion la aprueba un admin sobre un incidente de bodega (R37).
--   2) `orden_incidente`: entidad PROPIA del incidente reportado por un admin (R38/R39).
--   3) `orden_incidente_evidencia`: sus 1..N fotos (R46), espejo de `gestion_orden_evidencia`.
--
-- POR QUE UNA TABLA PROPIA Y NO UNA FILA DE `gestion_orden` (design §9.7/§12.1) — no es
-- preferencia de estilo, es un bug reproducible: `gestion_orden.mensajero_id` es NOT NULL, asi
-- que el admin tendria que escribirse ahi, y `CorteDiarioRepository.
-- findMensajerosConActividadSinCierre` consulta `{ cierreId: null, anuladaAt: null }` con
-- `distinct: ["mensajeroId"]` SIN filtrar rol ni resultado -> el corte diario le crearia al
-- ADMIN un `cierre_dia` `vencido` BLOQUEANTE que el no puede resolver (`CierreDiaService` esta
-- acotado por rol al `mensajero`). NO "simplificar" esto despues.
--
-- REUSOS DELIBERADOS (no se crea ningun enum nuevo):
--   - `gestion_causa_incidente` (158/PR1): la causa es la MISMA lista cerrada de 3 valores que
--     usa el camino del mensajero (R45 remite a R9).
--   - `cierre_estado` (37): tercera aplicacion del patron de aprobacion `solicitado ->
--     aprobado/rechazado` (38 -> `cierre_dia`, 40 -> `cierre_bodega`, 158 -> `orden_incidente`).
--     El valor `vencido` NO aplica aqui, igual que no aplica en `cierre_bodega`.
--
-- Patron "enum-existente" (features 41/45/67/158-PR1): `ALTER TYPE ... ADD VALUE` no puede
-- correr en la misma transaccion que USE el valor; aqui NADIE lo usa (las dos tablas nuevas no
-- tienen ninguna columna `wallet_origen_tipo`), asi que es seguro. `IF NOT EXISTS` lo hace
-- idempotente si se reintenta.
--
-- ADITIVA (R64): no renombra, no reordena y no borra ningun valor previo del enum, no altera
-- ninguna tabla existente y no mueve datos (no hay INSERT ni UPDATE).

-- 1) R37: origen del movimiento de la caja principal para el incidente del ADMIN. Valor PROPIO
-- y no el reservado `gestion_orden` (design §9.12): el indice `(origen_tipo, origen_id)` existe
-- para responder "movimientos de este origen", y un `origen_id` que apunta a `orden_incidente`
-- bajo el tipo `gestion_orden` devolveria basura.
ALTER TYPE "wallet_origen_tipo" ADD VALUE IF NOT EXISTS 'orden_incidente';

-- 2) R38/R39: el incidente reportado por un admin. `indemnizacion` NULL hasta que se apruebe
-- (R50); `resuelto_por`/`resuelto_at` NULL mientras `solicitado`; `motivo_rechazo` obligatorio
-- SOLO al rechazar (R54), sin CHECK en la base — la obligatoriedad vive en el borde (zod) y en
-- el service, igual que en `cierre_dia`/`cierre_bodega`.
CREATE TABLE "orden_incidente" (
  "id" TEXT NOT NULL,
  "orden_id" TEXT NOT NULL,
  "causa" "gestion_causa_incidente" NOT NULL,
  "motivo" TEXT NOT NULL,
  "estado" "cierre_estado" NOT NULL DEFAULT 'solicitado',
  "indemnizacion" DECIMAL(12,2),
  "reportado_por" TEXT NOT NULL,
  "resuelto_por" TEXT,
  "resuelto_at" TIMESTAMP(3),
  "motivo_rechazo" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "orden_incidente_pkey" PRIMARY KEY ("id")
);

-- FKs: orden (RESTRICT: un incidente es rastro money-critical, no se va con la orden),
-- reportado_por (RESTRICT: el autor es la mitad de R51), resuelto_por (SET NULL, patron
-- `cierre_dia.resuelto_por`).
ALTER TABLE "orden_incidente" ADD CONSTRAINT "orden_incidente_orden_id_fkey"
  FOREIGN KEY ("orden_id") REFERENCES "orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orden_incidente" ADD CONSTRAINT "orden_incidente_reportado_por_fkey"
  FOREIGN KEY ("reportado_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orden_incidente" ADD CONSTRAINT "orden_incidente_resuelto_por_fkey"
  FOREIGN KEY ("resuelto_por") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indices normales: por orden, por estado (las dos colas de R49), y los dos actores.
CREATE INDEX "orden_incidente_orden_id_idx" ON "orden_incidente"("orden_id");
CREATE INDEX "orden_incidente_estado_idx" ON "orden_incidente"("estado");
CREATE INDEX "orden_incidente_reportado_por_idx" ON "orden_incidente"("reportado_por");
CREATE INDEX "orden_incidente_resuelto_por_idx" ON "orden_incidente"("resuelto_por");

-- R47 (la mitad que NO se puede saltar en una carrera): a lo sumo UN incidente VIVO
-- (`solicitado` o `aprobado`) por orden, y tantos `rechazado` como haga falta. La comprobacion
-- previa del service es la otra mitad (mensaje accionable). Prisma no expresa indices parciales
-- -> va a mano aqui. Precedente literal: `cierre_bodega_zona_solicitado_uq`.
CREATE UNIQUE INDEX "orden_incidente_orden_vivo_uq"
  ON "orden_incidente"("orden_id") WHERE "estado" <> 'rechazado';

-- RLS habilitada SIN policies (solo service role), patron orden/gestion_orden/cierre_dia/
-- cierre_bodega/wallet_movimiento. La autorizacion de negocio (rol + zona) vive en el service.
ALTER TABLE "orden_incidente" ENABLE ROW LEVEL SECURITY;

-- 3) R46: evidencias 1..N del incidente. Espejo EXACTO de `gestion_orden_evidencia` (119). Es
-- tabla PROPIA y no una FK nullable sobre la de gestion (design §9.9): esa tiene `gestion_id`
-- NOT NULL y `@@unique([gestion_id, indice])`, que son el invariante de la 119.
CREATE TABLE "orden_incidente_evidencia" (
  "id" TEXT NOT NULL,
  "incidente_id" TEXT NOT NULL,
  "storage_path" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "indice" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "orden_incidente_evidencia_pkey" PRIMARY KEY ("id")
);

-- ON DELETE CASCADE: la evidencia es dato derivado del incidente (patron 119).
ALTER TABLE "orden_incidente_evidencia" ADD CONSTRAINT "orden_incidente_evidencia_incidente_id_fkey"
  FOREIGN KEY ("incidente_id") REFERENCES "orden_incidente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "orden_incidente_evidencia_incidente_id_indice_key"
  ON "orden_incidente_evidencia"("incidente_id", "indice");
CREATE INDEX "orden_incidente_evidencia_incidente_id_idx"
  ON "orden_incidente_evidencia"("incidente_id");

ALTER TABLE "orden_incidente_evidencia" ENABLE ROW LEVEL SECURITY;
