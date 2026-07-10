-- Feature 21: postulacion de mensajero.
-- Extiende "usuario" (apellidos + vehiculo + placa, todo NULLABLE para no romper
-- filas existentes de otros roles) y crea la tabla "mensajero_documento" (5 docs
-- por mensajero). No modifica ninguna migracion previa.

-- CreateEnum
CREATE TYPE "mensajero_documento_tipo" AS ENUM ('cedula_anverso', 'cedula_reverso', 'propiedad_anverso', 'propiedad_reverso', 'foto_rostro');

-- AlterTable: columnas nuevas en "usuario".
-- primer_apellido es OBLIGATORIO (NOT NULL). La(s) fila(s) preexistente(s) (el
-- usuario maestro del seed) no tienen valor, asi que se agrega con DEFAULT ''
-- para backfillearlas y luego se elimina el DEFAULT: los inserts futuros DEBEN
-- proveer el valor. El resto (segundo_apellido, vehiculo_id, placa) sigue NULLABLE.
ALTER TABLE "usuario" ADD COLUMN "primer_apellido" TEXT NOT NULL DEFAULT '';
ALTER TABLE "usuario" ALTER COLUMN "primer_apellido" DROP DEFAULT;
ALTER TABLE "usuario" ADD COLUMN "segundo_apellido" TEXT;
ALTER TABLE "usuario" ADD COLUMN "vehiculo_id" TEXT;
ALTER TABLE "usuario" ADD COLUMN "placa" TEXT;

-- CreateIndex: soporte del FK usuario.vehiculo_id
CREATE INDEX "usuario_vehiculo_id_idx" ON "usuario"("vehiculo_id");

-- AddForeignKey: usuario.vehiculo_id -> vehiculos.id (RESTRICT: no borrar un tipo
-- de vehiculo referenciado por un mensajero)
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: mensajero_documento (R16)
CREATE TABLE "mensajero_documento" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "tipo" "mensajero_documento_tipo" NOT NULL,
    "storage_path" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensajero_documento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: un documento por tipo por usuario (R16)
CREATE UNIQUE INDEX "mensajero_documento_usuario_id_tipo_key" ON "mensajero_documento"("usuario_id", "tipo");

-- CreateIndex
CREATE INDEX "mensajero_documento_usuario_id_idx" ON "mensajero_documento"("usuario_id");

-- AddForeignKey: mensajero_documento.usuario_id -> usuario.id (CASCADE: borrar el
-- usuario borra sus documentos, base de la limpieza atomica R24)
ALTER TABLE "mensajero_documento" ADD CONSTRAINT "mensajero_documento_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EnableRowLevelSecurity (R25)
-- Defensa en profundidad (docs/architecture.md): "mensajero_documento" solo se
-- accede desde el servidor (Prisma con service role). Sin policies para
-- anon/authenticated, por lo que RLS bloquea todo acceso salvo el service role,
-- coherente con "usuario"/"cobro".
ALTER TABLE "mensajero_documento" ENABLE ROW LEVEL SECURITY;
