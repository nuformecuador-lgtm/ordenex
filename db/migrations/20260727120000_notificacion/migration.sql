-- Feature 146 (design §1): campana de notificaciones funcional. Migracion ADITIVA:
-- no altera ni elimina ninguna tabla, columna ni enum preexistente (R7). Crea:
-- (1) 3 enums nativos (notificacion_tipo / notificacion_evento / notificacion_entidad_tipo),
--     patron RolValue / ChatMensajeTipo. `notificacion_evento` es el inventario CERRADO de
--     D1: anadir un evento exige migracion, lo que impide que un productor no especificado
--     se cuele sin revision.
-- (2) Tabla `notificacion` (R1): direccionamiento por ROL o por usuario (XOR, R4) y DOS
--     columnas de alcance opcionales e independientes, `tienda_id` y `zona_id` (R5). Un
--     evento con N roles destinatarios produce N filas (R6, F1.4-5). `entidad_id` es una
--     referencia POLIMORFICA (sin FK): apunta a `orden`/`usuario`/`cierre_dia`/carga segun
--     `entidad_tipo` (deuda aceptada, design Riesgo 4).
-- (3) Tabla `notificacion_lectura` (R2/R3): estado por USUARIO. `leida_at` NO vive en la
--     fila de la notificacion (D4): si viviera alli, el primer admin que leyera apagaria el
--     aviso para todos los demas del mismo rol.
-- RLS habilitada SIN policies en ambas tablas (solo service role, R9), patron
-- chat_conversacion / plantilla_mensaje / wallet_movimiento: este repo NO usa Supabase Auth
-- (sesion propia, sin auth.uid()), asi que el alcance por tienda/zona se aplica con un
-- predicado unico en el repositorio (design §1.5 y A8), no con policies.

-- 1) enums nativos.
CREATE TYPE "notificacion_tipo" AS ENUM ('alert', 'box', 'warning');

CREATE TYPE "notificacion_evento" AS ENUM (
  'orden_rechazada',
  'carga_masiva_terminada',
  'postulacion_mensajero_pendiente',
  'cierre_dia_por_aprobar'
);

CREATE TYPE "notificacion_entidad_tipo" AS ENUM ('orden', 'usuario', 'cierre_dia', 'carga');

-- 2) tabla notificacion.
CREATE TABLE "notificacion" (
  "id" TEXT NOT NULL,
  "tipo" "notificacion_tipo" NOT NULL,
  "evento" "notificacion_evento" NOT NULL,
  "descripcion" TEXT NOT NULL,
  "anexo" TEXT,
  "entidad_tipo" "notificacion_entidad_tipo" NOT NULL,
  "entidad_id" TEXT,
  "destinatario_rol" "rol_value",
  "destinatario_usuario_id" TEXT,
  "tienda_id" TEXT,
  "zona_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notificacion_pkey" PRIMARY KEY ("id")
);

-- R4: EXACTAMENTE uno de los dos destinatarios. El XOR se garantiza en el esquema, no en
-- el emisor: una fila sin destinatario seria invisible y una con los dos, ambigua.
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_destinatario_xor"
  CHECK (("destinatario_rol" IS NULL) <> ("destinatario_usuario_id" IS NULL));

-- R11: borrar el usuario destinatario, la tienda o la zona se lleva sus notificaciones; no
-- quedan filas huerfanas apuntando a una FK muerta.
-- `tienda_id` referencia `usuario`, NO una tabla `tienda`: en este esquema la tienda ES el
-- usuario con rol adminTienda (orden.tienda_id -> usuario.id, schema.prisma:452).
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_destinatario_usuario_id_fkey"
  FOREIGN KEY ("destinatario_usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_tienda_id_fkey"
  FOREIGN KEY ("tienda_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_zona_id_fkey"
  FOREIGN KEY ("zona_id") REFERENCES "zona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- R10: el listado del actor filtra por destinatario (+ alcance) y ordena por created_at
-- DESC. Indices PARCIALES (solo las filas que aplican a cada rama del predicado): Prisma no
-- los expresa, van a mano aqui (patron chat_mensaje_wa_message_id_key / wallet_movimiento).
CREATE INDEX "notificacion_rol_created_at_idx"
  ON "notificacion"("destinatario_rol", "created_at" DESC)
  WHERE "destinatario_rol" IS NOT NULL;
CREATE INDEX "notificacion_usuario_created_at_idx"
  ON "notificacion"("destinatario_usuario_id", "created_at" DESC)
  WHERE "destinatario_usuario_id" IS NOT NULL;
CREATE INDEX "notificacion_tienda_id_created_at_idx"
  ON "notificacion"("tienda_id", "created_at" DESC)
  WHERE "tienda_id" IS NOT NULL;
CREATE INDEX "notificacion_zona_id_created_at_idx"
  ON "notificacion"("zona_id", "created_at" DESC)
  WHERE "zona_id" IS NOT NULL;
CREATE INDEX "notificacion_entidad_idx" ON "notificacion"("entidad_tipo", "entidad_id");

-- R27 (F1.4-7): dedupe por (evento, entidad_id, destinatario). La regla de negocio completa
-- ("mientras exista una NO LEIDA") depende de `notificacion_lectura` y por eso vive como
-- guardia en el emisor; este indice es la RED DE SEGURIDAD ante carreras. `NULLS NOT
-- DISTINCT` (Postgres 15+) es imprescindible: una de las dos columnas de destinatario es
-- SIEMPRE NULL por el CHECK XOR, y con la semantica por defecto los NULL nunca colisionarian
-- y el indice no deduplicaria nada.
CREATE UNIQUE INDEX "notificacion_dedupe_key"
  ON "notificacion"("evento", "entidad_id", "destinatario_rol", "destinatario_usuario_id")
  NULLS NOT DISTINCT
  WHERE "entidad_id" IS NOT NULL;

-- 3) tabla notificacion_lectura: estado POR USUARIO (D4). Ausencia de fila = no leida y no
-- descartada. Descartar implica leida (escribe ambos instantes) para que descartar una no
-- leida no descuadre el contador.
CREATE TABLE "notificacion_lectura" (
  "id" TEXT NOT NULL,
  "notificacion_id" TEXT NOT NULL,
  "usuario_id" TEXT NOT NULL,
  "leida_at" TIMESTAMP(3),
  "descartada_at" TIMESTAMP(3),

  CONSTRAINT "notificacion_lectura_pkey" PRIMARY KEY ("id")
);

-- R11: la lectura muere con su notificacion y con su usuario.
ALTER TABLE "notificacion_lectura" ADD CONSTRAINT "notificacion_lectura_notificacion_id_fkey"
  FOREIGN KEY ("notificacion_id") REFERENCES "notificacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notificacion_lectura" ADD CONSTRAINT "notificacion_lectura_usuario_id_fkey"
  FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- R2: a lo sumo UNA fila por (notificacion, usuario). Es tambien la clave del upsert
-- idempotente de "marcar leida" / "descartar" (R37).
CREATE UNIQUE INDEX "notificacion_lectura_notificacion_id_usuario_id_key"
  ON "notificacion_lectura"("notificacion_id", "usuario_id");
-- R10: anti-join del listado por usuario.
CREATE INDEX "notificacion_lectura_usuario_id_idx" ON "notificacion_lectura"("usuario_id");

-- Una fila de lectura sin ninguna marca no significa nada (equivale a no tener fila).
ALTER TABLE "notificacion_lectura" ADD CONSTRAINT "notificacion_lectura_marca_presente"
  CHECK ("leida_at" IS NOT NULL OR "descartada_at" IS NOT NULL);

-- R9: RLS habilitada SIN policies (solo service role), patron chat_conversacion /
-- plantilla_mensaje / wallet_movimiento.
ALTER TABLE "notificacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notificacion_lectura" ENABLE ROW LEVEL SECURITY;
