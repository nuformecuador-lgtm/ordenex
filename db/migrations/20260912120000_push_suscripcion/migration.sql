-- FICHA 410 (design 4.1/4.2, T1.2) -- EL CANAL DE PUSH WEB: SUS DOS TABLAS.
--
-- QUE CAMBIA. Hoy un aviso urgente solo existe si alguien tiene la app abierta: `notificacion` se
-- pinta en la campana y nada mas. Estas dos tablas son el TRANSPORTE que lleva esa MISMA fila al
-- telefono con la app cerrada. NO se crea ningun aviso nuevo (R5): un hecho, un registro.
--
-- ADITIVA. No altera ninguna tabla, columna, indice ni enum preexistente. Ni un `UPDATE`, ni un
-- `DELETE`, ni un `INSERT` sobre nada que ya existiera. El valor nuevo de `job_tipo` va en la
-- migracion SIGUIENTE y con carpeta propia (55P04).
--
-- =============================================================================================
-- 1) `push_suscripcion` -- LA IDENTIDAD ES EL `endpoint`, NO LA PERSONA (R16, R17, R18)
-- =============================================================================================
-- El trio (endpoint, p256dh, auth) lo emite el NAVEGADOR de un dispositivo concreto. Si Ana cierra
-- sesion y Beto entra en el mismo telefono, ese navegador devuelve EL MISMO endpoint. Con
-- `endpoint` UNIQUE el registro es un upsert que reescribe `usuario_id`, y Beto pasa a ser el dueno
-- sin una sola linea de codigo que «detecte el cambio de dueno». Con la unicidad puesta en
-- (usuario_id, endpoint) habria DOS filas vivas y Ana seguiria recibiendo push en un telefono que
-- ya no es suyo -- que es justo lo que R18 prohibe.
CREATE TABLE "push_suscripcion" (
  "id"         TEXT NOT NULL,
  "usuario_id" TEXT NOT NULL,
  -- LA CLAVE. Es una URL larga del servicio de push; NUNCA se escribe en un log (R23).
  "endpoint"   TEXT NOT NULL,
  -- Claves de cifrado del payload. Mismo criterio: no salen jamas en un error ni en un log (R23).
  "p256dh"     TEXT NOT NULL,
  "auth"       TEXT NOT NULL,
  -- Texto corto que compone el CLIENTE para que la persona reconozca su dispositivo ("Chrome en
  -- Android"). NO es el user-agent crudo y no es PII.
  "etiqueta"   TEXT,
  -- Diagnostico, no politica: nada decide en funcion de este campo.
  "ultimo_envio_ok_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "push_suscripcion_pkey" PRIMARY KEY ("id"),

  -- CASCADE (R22), y no RESTRICT: esto es una CREDENCIAL DE ENTREGA, no evidencia. Dejarla
  -- huerfana al dar de baja a un usuario seria guardar el permiso de escribir en un telefono a
  -- nombre de nadie. Mismo criterio que `notificacion.destinatario_usuario_id`.
  CONSTRAINT "push_suscripcion_usuario_id_fkey" FOREIGN KEY ("usuario_id")
    REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- R16/R17/R18: un dispositivo-navegador, UNA fila. El nombre lo fija Prisma por convencion
-- (`<tabla>_<columna>_key`) y se escribe a mano aqui para que el datamodel y la base no difieran.
CREATE UNIQUE INDEX "push_suscripcion_endpoint_key" ON "push_suscripcion"("endpoint");

-- La unica consulta caliente del envio es `WHERE usuario_id IN (...)`. Ademas cubre la FK, cuyo
-- CASCADE SI se ejerce (borrar un usuario).
CREATE INDEX "push_suscripcion_usuario_id_idx" ON "push_suscripcion"("usuario_id");

-- =============================================================================================
-- 2) `push_envio_dia` -- EL CUPO DIARIO, QUE SE TOMA INSERTANDO (R6, R7)
-- =============================================================================================
-- ⚠️ ESTE INDICE UNICO **ES** LA REGLA «uno al dia por tipo». No es una red por detras de una
-- comprobacion: es el unico que decide. Quien consigue insertar (usuario, evento, jornada) manda
-- el push; un `23505` significa «ya salio hoy» y es un no-op. Una comprobacion previa
-- (`SELECT` y luego `INSERT`) deja abierta la rendija por la que dos productores concurrentes
-- mandan DOS push del mismo tipo el mismo dia, y ese fallo no rompe ningun test: suena dos veces
-- el telefono de otra persona.
--
-- `dia_cr` es TEXTO (`YYYY-MM-DD`, jornada de Costa Rica) y no `DATE` a proposito: forma parte de
-- una CLAVE, y una clave no se somete a la conversion de huso de un tipo temporal. Es la misma
-- convencion con la que la 409 compone sus `entidad_id`.
CREATE TABLE "push_envio_dia" (
  "id"         TEXT NOT NULL,
  "usuario_id" TEXT NOT NULL,
  "evento"     "notificacion_evento" NOT NULL,
  "dia_cr"     TEXT NOT NULL,
  -- TRAZABILIDAD, SIN FK: la fila del aviso puede borrarse y el cupo del dia tiene que seguir
  -- gastado. Es el mismo criterio polimorfico de `notificacion.entidad_id`.
  "notificacion_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "push_envio_dia_pkey" PRIMARY KEY ("id"),

  -- CASCADE (R22): es un contador del canal, no historia.
  CONSTRAINT "push_envio_dia_usuario_id_fkey" FOREIGN KEY ("usuario_id")
    REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- LA REGLA ANTIRRUIDO, ESCRITA EN LA BASE. Total y sin `WHERE`: un cupo parcial no es un cupo.
CREATE UNIQUE INDEX "push_envio_dia_cupo" ON "push_envio_dia"("usuario_id", "evento", "dia_cr");

-- =============================================================================================
-- 3) RLS (R47). Habilitada SIN policies en las DOS, patron `jobs` / `notificacion` /
--    `gasto_fijo_cobro`. Este repo NO usa Supabase Auth (sesion propia, sin `auth.uid()`), asi que
--    una policy no tendria a quien preguntar y la autorizacion de negocio vive en la Server Action.
--    Lo que la RLS garantiza es exactamente lo que R47 pide: a estas filas -- que son credenciales
--    de entrega -- no se llega si no es por el servidor de la aplicacion.
-- =============================================================================================
ALTER TABLE "push_suscripcion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_envio_dia" ENABLE ROW LEVEL SECURITY;
