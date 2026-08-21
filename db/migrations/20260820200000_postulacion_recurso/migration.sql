-- Feature 253 (T1.1, design §2.1) — DESTINO REAL de la postulacion de vehiculo o bodega que la
-- landing publica abre desde «Postular mi vehiculo» y «Postular mi bodega».
--
-- QUE ARREGLA. Hoy `app/_landing/PostularRecursoModal.tsx` valida, pinta «Postulacion enviada» y
-- NO ENVIA NADA (`handleSubmit` hace `setErrores({})` + `setEnviado(true)`, con un TODO al lado).
-- No hay tabla, ni log, ni correo: lo que la persona escribe muere en su navegador y recibe un
-- acuse de recibo de algo que no ocurrio. Esta tabla es el destino que faltaba (F1, firmada por el
-- humano el 2026-08-21).
--
-- POR QUE UNA TABLA PROPIA Y NO `usuario` (design §14-C): no hay cuenta que crear —sin
-- contrasena, sin documentos, sin cedula, sin rol que otorgar— y `usuario.email`/`usuario.cedula`
-- son UNICOS, asi que dos personas que ofrecen una bodega sin cedula no caben. Ademas ensanchar
-- con filas sin login la tabla de la que dependen sesion, permisos y dinero es exactamente lo que
-- no se debe hacer para ahorrar una migracion.
--
-- ADITIVA: no altera ninguna tabla, columna, indice ni enum preexistente. Solo crea un enum y una
-- tabla nuevos. INERTE hasta que exista la Server Action: nadie escribe aqui todavia.

-- El tipo de recurso ofrecido. Enum nativo (patron `rol_value` / `metodo_pago_value`) y no texto
-- libre: son DOS y cerrados, y la prop `RecursoTipo` del modal ya los fija desde la tarjeta que
-- abre el formulario (`LandingPostular.tsx`). Con texto libre, un tercer valor entraria sin que
-- nadie lo decidiera.
CREATE TYPE "postulacion_recurso_tipo" AS ENUM ('vehiculo', 'bodega');

CREATE TABLE "postulacion_recurso" (
  "id"              TEXT NOT NULL,
  "tipo"            "postulacion_recurso_tipo" NOT NULL,
  "nombre"          TEXT NOT NULL,
  "telefono"        TEXT NOT NULL,
  "correo"          TEXT NOT NULL,
  "mensaje"         TEXT NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- NULL = pendiente. Es lo UNICO que muta en una fila, una vez y en un solo sentido. Sin
  -- `updated_at`: nada mas de la fila se edita nunca (design §3).
  "atendida_at"     TIMESTAMP(3),
  "atendida_por_id" TEXT,

  CONSTRAINT "postulacion_recurso_pkey" PRIMARY KEY ("id"),
  -- RESTRICT y no CASCADE: quien atendio es EVIDENCIA de la operacion y no se pierde al dar de
  -- baja a un usuario. Mismo criterio que `orden_nota.autor_id`.
  CONSTRAINT "postulacion_recurso_atendida_por_id_fkey" FOREIGN KEY ("atendida_por_id")
    REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Las dos columnas de la atencion van juntas o no van: una fila atendida por nadie, o un
  -- responsable sin instante, serian estados que ningun productor puede escribir. Prisma no
  -- expresa CHECK (precedente: `notificacion_destinatario_xor`), asi que va a mano aqui.
  CONSTRAINT "postulacion_recurso_atendida_completa"
    CHECK (("atendida_at" IS NULL) = ("atendida_por_id" IS NULL))
);

-- La consulta del panel: `WHERE atendida_at IS NULL ORDER BY created_at DESC`. Un btree compuesto
-- la sirve entera (Postgres usa el indice para `IS NULL`), y sirve tambien la pestana de atendidas
-- (`IS NOT NULL`) y el barrido del cron de purga (`atendida_at < corte`). No hay indice por
-- `tipo`: el panel no filtra por el, y anadir un indice sin consulta que lo use es coste sin
-- beneficio.
CREATE INDEX "postulacion_recurso_atendida_at_created_at_idx"
  ON "postulacion_recurso"("atendida_at", "created_at");

-- Segunda FK indexada (patron `orden_nota`): sin el, un RESTRICT obliga a recorrer la tabla cada
-- vez que se intenta borrar un usuario.
CREATE INDEX "postulacion_recurso_atendida_por_id_idx"
  ON "postulacion_recurso"("atendida_por_id");

-- R22: RLS habilitada SIN policies (solo service role), patron `orden_nota` /
-- `plantilla_mensaje` / `notificacion`. Este repo NO usa Supabase Auth (sesion propia, sin
-- `auth.uid()`), asi que la autorizacion de negocio —rol `maestro`/`admin`— vive en el service,
-- no en una policy que no tendria a quien preguntar.
ALTER TABLE "postulacion_recurso" ENABLE ROW LEVEL SECURITY;
