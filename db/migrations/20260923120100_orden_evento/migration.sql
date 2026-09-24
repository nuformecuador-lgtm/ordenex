-- FICHA 454 (design §1.1/§1.2, T1.2 · M2) -- `orden_evento`: HECHOS append-only sobre una orden que
-- NO son transiciones de estado.
--
-- QUE ARREGLA. Con la 454 la gestion del mensajero deja de mover la orden: la orden se queda
-- `en_reparto` y el estado real se aplica al APROBAR el cierre. La gestion tiene que verse AL
-- INSTANTE igualmente (tienda, rastreo, API, webhooks) y la ayuda a la tienda deja de ser el estado
-- `ayuda_tienda`. Los dos son hechos que NO cambian el estado, y por eso NO pueden ser filas de
-- `orden_historial_estado`: el choke point rechaza `en_reparto -> en_reparto` (no hay auto-aristas,
-- nota de la 427) y emitiria un `orden.estado_actualizado` falso. Precedente exacto: la 262
-- (`orden_dia_reparto_cambio`) y la 427 (`orden_traspaso_mensajero`), que tampoco escriben historial.
--
-- «Gestion pendiente» y «ayuda abierta» son DERIVACIONES sobre esta tabla (design §3 y §4.1), no
-- marcas: nada que apagar (la razon de la D1 de la 236).
--
-- ADITIVA: no altera ninguna tabla, columna ni enum preexistente. Crea un TIPO nuevo
-- (`orden_evento_tipo`), asi que el down lo suelta; NO se toca ningun `down.sql` anterior.
-- El valor `webhook_evento` de `job_tipo` vive en M1 (`20260923120000_job_tipo_webhook_evento`),
-- separada, porque Postgres no deja usar un valor de enum en la misma transaccion (55P04).
--
-- SIN MIGRACION DE DATOS aqui: el backfill de las ordenes en `ayuda_tienda` /
-- `devolucion_por_confirmar` es M3, en su propia carpeta.
--
-- EL TIMESTAMP SE ESCRIBE A MANO (`db:migrate:create` da P3006 en la shadow db de este repo). El DDL
-- sale de `prisma migrate diff --from-schema <schema de HEAD> --to-schema db/schema.prisma --script`.
-- JAMAS RENUMERAR UNA CARPETA YA APLICADA.

-- CreateEnum
CREATE TYPE "orden_evento_tipo" AS ENUM ('gestion_registrada', 'gestion_anulada', 'gestion_corregida', 'ayuda_solicitada', 'ayuda_rescatada', 'ayuda_habilitada_api');

-- CreateTable
CREATE TABLE "orden_evento" (
    "id" TEXT NOT NULL,
    "orden_id" TEXT NOT NULL,
    "tipo" "orden_evento_tipo" NOT NULL,
    "gestion_orden_id" TEXT,
    "familia_aplicacion" "orden_historial_origen_tipo",
    "resultado" "gestion_resultado",
    "resultado_anterior" "gestion_resultado",
    "mensajero_id" TEXT,
    "actor_usuario_id" TEXT NOT NULL,
    "actor_rol" "rol_value" NOT NULL,
    "motivo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orden_evento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orden_evento_orden_id_created_at_idx" ON "orden_evento"("orden_id", "created_at");

-- CreateIndex
CREATE INDEX "orden_evento_gestion_orden_id_idx" ON "orden_evento"("gestion_orden_id");

-- CreateIndex
CREATE INDEX "orden_evento_mensajero_id_idx" ON "orden_evento"("mensajero_id");

-- CreateIndex
CREATE INDEX "orden_evento_actor_usuario_id_idx" ON "orden_evento"("actor_usuario_id");

-- AddForeignKey (las cuatro RESTRICT: un hecho sobre una orden es evidencia, patron 427)
ALTER TABLE "orden_evento" ADD CONSTRAINT "orden_evento_orden_id_fkey" FOREIGN KEY ("orden_id") REFERENCES "orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_evento" ADD CONSTRAINT "orden_evento_gestion_orden_id_fkey" FOREIGN KEY ("gestion_orden_id") REFERENCES "gestion_orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_evento" ADD CONSTRAINT "orden_evento_mensajero_id_fkey" FOREIGN KEY ("mensajero_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_evento" ADD CONSTRAINT "orden_evento_actor_usuario_id_fkey" FOREIGN KEY ("actor_usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Lo que Prisma no expresa (va solo aqui) ────────────────────────────────────────────────────

-- UN SOLO REGISTRO POR GESTION. Es ademas el indice que sirve al `EXISTS` de la 6.ª condicion de
-- intentos y del predicado de gestion pendiente (design §3, §10).
CREATE UNIQUE INDEX "orden_evento_gestion_registrada_uq"
  ON "orden_evento"("gestion_orden_id")
  WHERE "tipo" = 'gestion_registrada';

-- Los tres `gestion_*` hablan de UNA gestion: sin ella no son escribibles.
ALTER TABLE "orden_evento" ADD CONSTRAINT "orden_evento_gestion_obligatoria_check"
  CHECK ("tipo" NOT IN ('gestion_registrada', 'gestion_anulada', 'gestion_corregida')
         OR "gestion_orden_id" IS NOT NULL);

-- La familia con la que la aprobacion aplicara la gestion: SOLO en `gestion_registrada`, y ahi
-- OBLIGATORIA, y solo las tres familias de calle (design §1.1). El `IS NOT NULL` explicito NO sobra:
-- `NULL IN (...)` es NULL, y un CHECK que evalua a NULL PASA (medido al escribir el test de esta
-- migracion: sin el, un `gestion_registrada` sin familia entraba).
ALTER TABLE "orden_evento" ADD CONSTRAINT "orden_evento_familia_aplicacion_check"
  CHECK (
    ("tipo" = 'gestion_registrada'
      AND "familia_aplicacion" IS NOT NULL
      AND "familia_aplicacion" IN ('gestion', 'incidente', 'gestion_tienda_ayuda'))
    OR ("tipo" <> 'gestion_registrada' AND "familia_aplicacion" IS NULL)
  );

-- `gestion_registrada` lleva el resultado registrado; `gestion_corregida` el nuevo y el anterior.
ALTER TABLE "orden_evento" ADD CONSTRAINT "orden_evento_resultado_check"
  CHECK ("tipo" NOT IN ('gestion_registrada', 'gestion_corregida') OR "resultado" IS NOT NULL);

ALTER TABLE "orden_evento" ADD CONSTRAINT "orden_evento_resultado_anterior_check"
  CHECK (
    ("tipo" = 'gestion_corregida' AND "resultado_anterior" IS NOT NULL)
    OR ("tipo" <> 'gestion_corregida' AND "resultado_anterior" IS NULL)
  );

-- RLS habilitada SIN policies (solo service role), patron literal de
-- `20260917120000_orden_traspaso_mensajero`. La app entra por el servidor con su propia sesion; la
-- autorizacion de negocio vive en los servicios.
ALTER TABLE "orden_evento" ENABLE ROW LEVEL SECURITY;
