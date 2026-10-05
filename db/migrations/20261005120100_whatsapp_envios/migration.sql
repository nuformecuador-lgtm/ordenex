-- FICHA 474 (design §1.1-§1.5, T1.2) — ENVIOS AUTOMATICOS POR WHATSAPP.
--
-- DDL base tomado de `prisma migrate diff --from-config-datasource --to-schema db/schema.prisma
-- --script` sobre el clon `ordenex_474` (con T1.1 ya aplicada). Al final, a mano, lo que Prisma no
-- expresa: los indices PARCIALES (idempotencia R23/R27, el del puente R26, purga R44, prueba R41,
-- webhook R38, nombre unico entre vigentes R11), los CHECKs de forma y la RLS.
--
-- ADITIVA: dos columnas con default en `plantilla_mensaje` (toda fila existente queda «de orden»,
-- R3) y cuatro tablas nuevas. Ningun dato existente se reescribe.

-- CreateEnum
CREATE TYPE "whatsapp_envio_disparo" AS ENUM ('hora_fija', 'evento');

-- CreateEnum
CREATE TYPE "whatsapp_envio_origen" AS ENUM ('programado', 'evento', 'prueba');

-- CreateEnum
CREATE TYPE "whatsapp_ejecucion_estado" AS ENUM ('pendiente', 'generando', 'enviando', 'completada', 'vacia', 'sin_destinatarios', 'omitida', 'error');

-- CreateEnum
CREATE TYPE "whatsapp_entrega_estado" AS ENUM ('pendiente', 'en_curso', 'aceptada', 'enviada', 'entregada', 'leida', 'rechazada', 'fallida', 'telefono_invalido');

-- AlterTable
ALTER TABLE "plantilla_mensaje" ADD COLUMN     "informe_clave" TEXT,
ADD COLUMN     "lleva_documento" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "whatsapp_envio" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "informe_clave" TEXT NOT NULL,
    "plantilla_id" TEXT NOT NULL,
    "parametros" JSONB NOT NULL DEFAULT '{}',
    "disparo" "whatsapp_envio_disparo" NOT NULL,
    "dias_semana" SMALLINT[],
    "hora" TEXT,
    "evento_clave" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "whatsapp_envio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_envio_destinatario" (
    "id" TEXT NOT NULL,
    "envio_id" TEXT NOT NULL,
    "rol" "rol_value",
    "usuario_id" TEXT,

    CONSTRAINT "whatsapp_envio_destinatario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_envio_ejecucion" (
    "id" TEXT NOT NULL,
    "envio_id" TEXT NOT NULL,
    "origen" "whatsapp_envio_origen" NOT NULL,
    "fecha_cr" DATE,
    "instante_programado" TIMESTAMP(3),
    "evento_clave" TEXT,
    "evento_referencia" TEXT,
    "evento_datos" JSONB,
    "notificacion_id" TEXT,
    "solicitada_por" TEXT,
    "estado" "whatsapp_ejecucion_estado" NOT NULL DEFAULT 'pendiente',
    "motivo" TEXT,
    "plantilla_id" TEXT,
    "plantilla_nombre" TEXT,
    "parametros" JSONB,
    "valores" JSONB,
    "pdf_ruta" TEXT,
    "pdf_nombre" TEXT,
    "pdf_bytes" INTEGER,
    "pdf_caduca_at" TIMESTAMP(3),
    "pdf_purgado_at" TIMESTAMP(3),
    "media_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "terminada_at" TIMESTAMP(3),

    CONSTRAINT "whatsapp_envio_ejecucion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_envio_entrega" (
    "id" TEXT NOT NULL,
    "ejecucion_id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "destinatario_nombre" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "estado" "whatsapp_entrega_estado" NOT NULL DEFAULT 'pendiente',
    "motivo" TEXT,
    "codigo_meta" INTEGER,
    "wa_message_id" TEXT,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "enviada_at" TIMESTAMP(3),

    CONSTRAINT "whatsapp_envio_entrega_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_envio_plantilla_id_idx" ON "whatsapp_envio"("plantilla_id");

-- CreateIndex
CREATE INDEX "whatsapp_envio_destinatario_envio_id_idx" ON "whatsapp_envio_destinatario"("envio_id");

-- CreateIndex
CREATE INDEX "whatsapp_envio_destinatario_usuario_id_idx" ON "whatsapp_envio_destinatario"("usuario_id");

-- CreateIndex
CREATE INDEX "whatsapp_envio_ejecucion_created_at_idx" ON "whatsapp_envio_ejecucion"("created_at" DESC);

-- CreateIndex
CREATE INDEX "whatsapp_envio_ejecucion_envio_id_created_at_idx" ON "whatsapp_envio_ejecucion"("envio_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "whatsapp_envio_entrega_usuario_id_idx" ON "whatsapp_envio_entrega"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_envio_entrega_ejecucion_usuario_key" ON "whatsapp_envio_entrega"("ejecucion_id", "usuario_id");

-- AddForeignKey
ALTER TABLE "whatsapp_envio" ADD CONSTRAINT "whatsapp_envio_plantilla_id_fkey" FOREIGN KEY ("plantilla_id") REFERENCES "plantilla_mensaje"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_envio" ADD CONSTRAINT "whatsapp_envio_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_envio" ADD CONSTRAINT "whatsapp_envio_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_envio_destinatario" ADD CONSTRAINT "whatsapp_envio_destinatario_envio_id_fkey" FOREIGN KEY ("envio_id") REFERENCES "whatsapp_envio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_envio_destinatario" ADD CONSTRAINT "whatsapp_envio_destinatario_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_envio_ejecucion" ADD CONSTRAINT "whatsapp_envio_ejecucion_envio_id_fkey" FOREIGN KEY ("envio_id") REFERENCES "whatsapp_envio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_envio_ejecucion" ADD CONSTRAINT "whatsapp_envio_ejecucion_solicitada_por_fkey" FOREIGN KEY ("solicitada_por") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_envio_entrega" ADD CONSTRAINT "whatsapp_envio_entrega_ejecucion_id_fkey" FOREIGN KEY ("ejecucion_id") REFERENCES "whatsapp_envio_ejecucion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_envio_entrega" ADD CONSTRAINT "whatsapp_envio_entrega_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- A MANO: lo que Prisma no expresa.
-- ---------------------------------------------------------------------------------------------

-- §1.1 (R6, mitad estructural): solo una plantilla de INFORME puede llevar cabecera documento.
ALTER TABLE "plantilla_mensaje" ADD CONSTRAINT "plantilla_mensaje_documento_requiere_informe_check"
  CHECK (NOT "lleva_documento" OR "informe_clave" IS NOT NULL);
-- §1.1: una plantilla de TIENDA no sale por Meta, asi que no puede ser de informe.
ALTER TABLE "plantilla_mensaje" ADD CONSTRAINT "plantilla_mensaje_tienda_sin_informe_check"
  CHECK (NOT "plantilla_tienda" OR "informe_clave" IS NULL);

-- §1.2 (R11): nombre UNICO entre los envios NO borrados.
CREATE UNIQUE INDEX "whatsapp_envio_nombre_vigente_key"
  ON "whatsapp_envio" ("nombre") WHERE "deleted_at" IS NULL;

-- §1.2 (R26/R50): la UNICA consulta del puente en el camino del aviso. Tiene que ser un index scan.
CREATE INDEX "whatsapp_envio_evento_encendido_idx"
  ON "whatsapp_envio" ("evento_clave")
  WHERE "activo" AND "deleted_at" IS NULL AND "disparo" = 'evento';

-- §1.2: forma del disparo. `hora_fija` => dias no vacios (ISO 1..7) y hora HH:mm, sin evento;
-- `evento` => evento, sin dias ni hora. (Prisma escribe NULL o `{}` en una lista omitida: se
-- aceptan los dos como «sin dias».)
ALTER TABLE "whatsapp_envio" ADD CONSTRAINT "whatsapp_envio_disparo_forma_check" CHECK (
  ("disparo" = 'hora_fija'
     AND coalesce(cardinality("dias_semana"), 0) >= 1
     AND "dias_semana" <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
     AND "hora" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     AND "evento_clave" IS NULL)
  OR
  ("disparo" = 'evento'
     AND "evento_clave" IS NOT NULL
     AND coalesce(cardinality("dias_semana"), 0) = 0
     AND "hora" IS NULL)
);
ALTER TABLE "whatsapp_envio" ADD CONSTRAINT "whatsapp_envio_nombre_check"
  CHECK (btrim("nombre") <> '');

-- §1.3: exactamente uno de rol / usuario, y como mucho una fila por (envio, rol) y (envio, usuario).
ALTER TABLE "whatsapp_envio_destinatario" ADD CONSTRAINT "whatsapp_envio_destinatario_xor_check"
  CHECK (num_nonnulls("rol", "usuario_id") = 1);
CREATE UNIQUE INDEX "whatsapp_envio_destinatario_rol_key"
  ON "whatsapp_envio_destinatario" ("envio_id", "rol") WHERE "rol" IS NOT NULL;
CREATE UNIQUE INDEX "whatsapp_envio_destinatario_usuario_key"
  ON "whatsapp_envio_destinatario" ("envio_id", "usuario_id") WHERE "usuario_id" IS NOT NULL;

-- §1.4 — LAS DOS CLAVES DE IDEMPOTENCIA DE EJECUCION. Las pruebas no tienen unico (R23: no
-- consumen el cupo del dia).
CREATE UNIQUE INDEX "whatsapp_envio_ejecucion_programado_key"
  ON "whatsapp_envio_ejecucion" ("envio_id", "fecha_cr") WHERE "origen" = 'programado';
CREATE UNIQUE INDEX "whatsapp_envio_ejecucion_evento_key"
  ON "whatsapp_envio_ejecucion" ("envio_id", "evento_clave", "evento_referencia") WHERE "origen" = 'evento';
-- R44: la purga del mantenimiento diario.
CREATE INDEX "whatsapp_envio_ejecucion_purga_idx"
  ON "whatsapp_envio_ejecucion" ("pdf_caduca_at")
  WHERE "pdf_ruta" IS NOT NULL AND "pdf_purgado_at" IS NULL;
-- R41: la ventana de 30 s de «Probar ahora».
CREATE INDEX "whatsapp_envio_ejecucion_prueba_idx"
  ON "whatsapp_envio_ejecucion" ("solicitada_por", "envio_id", "created_at" DESC)
  WHERE "origen" = 'prueba';
-- §1.4: forma por origen.
ALTER TABLE "whatsapp_envio_ejecucion" ADD CONSTRAINT "whatsapp_envio_ejecucion_origen_forma_check" CHECK (
  ("origen" = 'programado' AND "fecha_cr" IS NOT NULL AND "instante_programado" IS NOT NULL)
  OR ("origen" = 'evento' AND "evento_clave" IS NOT NULL AND "evento_referencia" IS NOT NULL)
  OR ("origen" = 'prueba' AND "solicitada_por" IS NOT NULL)
);
ALTER TABLE "whatsapp_envio_ejecucion" ADD CONSTRAINT "whatsapp_envio_ejecucion_motivo_check"
  CHECK ("motivo" IS NULL OR char_length("motivo") <= 500);

-- §1.5 (R38): el webhook localiza la entrega por el id de Meta.
CREATE UNIQUE INDEX "whatsapp_envio_entrega_wa_message_id_key"
  ON "whatsapp_envio_entrega" ("wa_message_id") WHERE "wa_message_id" IS NOT NULL;
ALTER TABLE "whatsapp_envio_entrega" ADD CONSTRAINT "whatsapp_envio_entrega_motivo_check"
  CHECK ("motivo" IS NULL OR char_length("motivo") <= 500);

-- RLS habilitada SIN policies (solo service role), patron `jobs` / `geocode_cache`: estas tablas
-- guardan telefonos y nombres y no las lee nunca el cliente.
ALTER TABLE "whatsapp_envio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_envio_destinatario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_envio_ejecucion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_envio_entrega" ENABLE ROW LEVEL SECURITY;

